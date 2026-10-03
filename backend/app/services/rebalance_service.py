"""Taking contacts back from people who stopped working and giving them to the people who are working.

An employee who has not been seen for `inactive_after_days` (see activity.py) is not working. The contacts they were given and did
not get to - still "new" or "in progress", no callback promised to them - are shared out, equally, between the people who are working.
Everything else of theirs stays with them: a callback they promised, and every contact whose call is done.

It can be started by an administrator (look at the plan first, then run it) and it runs by itself every few minutes while the setting
`auto_rebalance` is on. Moving is done in steps of 1,000 contacts, every step one transaction; contacts that somebody is editing at
that moment are left for the next round (SKIP LOCKED). Doing it twice is harmless: what was moved is not on the first list any more.
"""

from __future__ import annotations

import logging
import time
from collections import Counter
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core import cache
from app.core.config import get_settings
from app.core.database import new_session
from app.core.dbutil import insert_ignore, retry_transient
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.timeutils import utcnow
from app.models.cache_events import EVERYONE, QUIET, employee_epoch
from app.models.contact import ContactAssignment
from app.models.distribution import RUN_COMPLETED, RUN_FAILED, RUN_RUNNING, DistributionRun
from app.models.employee import Employee
from app.schemas.distribution import (
    ActivityOverviewOut,
    EmployeeStateOut,
    RebalanceIn,
    RebalancePlanOut,
    RebalanceSource,
    RebalanceTarget,
)
from app.services import activity, audit_service, workload
from app.services.distribution import ORDERS, STRATEGIES, Recipient, Schedule, quotas
from app.services.notification_service import notify
from app.services.settings_service import get_setting

log = logging.getLogger(__name__)

CHUNK = 1000
STALE_RUN_SECONDS = 300


class _Plan:
    def __init__(self, data: RebalanceIn) -> None:
        self.data = data
        self.sources: list[activity.EmployeeState] = []  # people who are not working and own something
        self.movable: dict[int, int] = {}
        self.targets: list[activity.EmployeeState] = []  # people who are working (and chosen)
        self.pending: dict[int, int] = {}
        self.quotas: dict[int, int] = {}
        self.total = 0
        self.warnings: list[str] = []

    @property
    def can_run(self) -> bool:
        return bool(self.total and self.targets)


def _build(db: Session, data: RebalanceIn, states: list[activity.EmployeeState] | None = None) -> _Plan:
    if data.strategy not in STRATEGIES:
        raise ValidationFailed("strategy must be 'equal' or 'balance_total'.", code="bad_strategy")
    if data.order not in ORDERS:
        raise ValidationFailed("order must be 'interleave' or 'blocks'.", code="bad_order")
    states = states if states is not None else activity.employee_states(db, with_counts=True)
    known = {s.employee_id for s in states}
    wanted_from, wanted_to = set(data.from_employee_ids or []), set(data.to_employee_ids or [])
    unknown = (wanted_from | wanted_to) - known
    if unknown:
        raise ValidationFailed(f"Unknown employee id(s): {sorted(unknown)[:5]}.", code="unknown_employee")
    plan = _Plan(data)
    for s in states:
        if wanted_from and s.employee_id not in wanted_from:
            continue
        if s.working:
            if wanted_from:
                plan.warnings.append(f"{s.full_name} is working, so nothing is taken from them.")
            continue
        if s.assigned:
            plan.sources.append(s)
    plan.targets = [s for s in states if s.working and (not wanted_to or s.employee_id in wanted_to)]
    for s in states:
        if wanted_to and s.employee_id in wanted_to and not s.working:
            plan.warnings.append(f"{s.full_name} is not working, so they do not receive anything.")
    plan.movable = workload.movable_counts(db, [s.employee_id for s in plan.sources]) if plan.sources else {}
    plan.total = sum(plan.movable.values())
    if plan.total and not plan.targets:
        plan.warnings.append("Nobody is working right now, so there is nobody to give the contacts to.")
    if plan.total and plan.targets:
        loads = {s.employee_id: s.assigned for s in plan.targets}
        if data.strategy == "balance_total":
            plan.pending = workload.pending_counts(db, [s.employee_id for s in plan.targets])
            loads = plan.pending
        plan.quotas = quotas(data.strategy, plan.total, [Recipient(s.employee_id, loads.get(s.employee_id, 0)) for s in plan.targets])
    return plan


def _plan_out(plan: _Plan) -> RebalancePlanOut:
    return RebalancePlanOut(
        strategy=plan.data.strategy, order=plan.data.order, total_movable=plan.total, working=len(plan.targets),
        sources=[
            RebalanceSource(
                employee_id=s.employee_id, employee_code=s.employee_code, full_name=s.full_name, state=s.state, reason=s.reason,
                movable=plan.movable.get(s.employee_id, 0), kept=max(0, s.assigned - plan.movable.get(s.employee_id, 0)),
            )
            for s in plan.sources
        ],
        targets=[
            RebalanceTarget(
                employee_id=s.employee_id, employee_code=s.employee_code, full_name=s.full_name, state=s.state, assigned=s.assigned,
                pending=plan.pending.get(s.employee_id), receives=plan.quotas.get(s.employee_id, 0),
            )
            for s in plan.targets
        ],
        warnings=plan.warnings, can_run=plan.can_run,
    )


def preview(db: Session, data: RebalanceIn) -> RebalancePlanOut:
    return _plan_out(_build(db, data))


# --------------------------------------------------------------------------------------------------------- overview
def overview(db: Session) -> ActivityOverviewOut:
    states = activity.employee_states(db, with_counts=True)
    away = [s.employee_id for s in states if not s.working and s.assigned]
    movable = workload.movable_counts(db, away) if away else {}
    last = db.scalar(select(DistributionRun).order_by(DistributionRun.created_at.desc(), DistributionRun.id.desc()).limit(1))
    return ActivityOverviewOut(
        inactive_after_days=activity.inactive_after_days(db),
        auto_rebalance=bool(get_setting(db, "auto_rebalance")),
        working=sum(1 for s in states if s.working),
        not_working=sum(1 for s in states if not s.working),
        movable=sum(movable.values()),
        employees=[
            EmployeeStateOut(
                employee_id=s.employee_id, employee_code=s.employee_code, full_name=s.full_name, team_id=s.team_id, team_name=s.team_name,
                state=s.state, reason=s.reason, last_active_at=s.last_active_at, assigned=s.assigned, movable=movable.get(s.employee_id, 0),
            )
            for s in states
        ],
        last_run=last,  # type: ignore[arg-type]
    )


def list_runs(db: Session, *, page: int, page_size: int) -> tuple[list[DistributionRun], int]:
    total = db.scalar(select(func.count(DistributionRun.id))) or 0
    rows = db.scalars(
        select(DistributionRun).order_by(DistributionRun.created_at.desc(), DistributionRun.id.desc()).limit(page_size).offset((page - 1) * page_size)
    ).all()
    return list(rows), total


def get_run(db: Session, run_id: int) -> DistributionRun:
    run = db.get(DistributionRun, run_id)
    if run is None:
        raise NotFound("Rebalancing not found.")
    return run


# ------------------------------------------------------------------------------------------------------------ running
def _running_now(db: Session) -> int | None:
    fresh = utcnow() - timedelta(seconds=STALE_RUN_SECONDS)
    return db.scalar(
        select(DistributionRun.id).where(
            DistributionRun.status == RUN_RUNNING, func.coalesce(DistributionRun.heartbeat_at, DistributionRun.created_at) > fresh
        ).limit(1)
    )


def start(db: Session, *, data: RebalanceIn, actor_id: int | None, trigger: str, quiet: bool = False) -> DistributionRun | None:
    """Plan and record a rebalancing; the moving itself is `execute_run`. With `quiet`, nothing to move is not an error (the
    automatic one comes by every few minutes)."""
    busy = _running_now(db)
    if busy is not None:
        if quiet:
            return None
        raise Conflict(f"Rebalancing {busy} is running right now. Wait until it is finished.", code="rebalance_busy")
    plan = _build(db, data)
    if not plan.can_run:
        if quiet:
            return None
        message = plan.warnings[0] if plan.warnings else (
            "Nobody who is not working has contacts that can be moved." if not plan.total else "There is nobody working to give the contacts to."
        )
        raise ValidationFailed(message, code="nothing_to_rebalance")
    now = utcnow()
    run = DistributionRun(
        kind="rebalance", trigger=trigger, status=RUN_RUNNING, created_by=actor_id, created_at=now, heartbeat_at=now, planned=plan.total,
        details={"request": data.model_dump(), "inactive_after_days": activity.inactive_after_days(db)},
    )
    db.add(run)
    db.commit()
    return run


def _names(db: Session, ids: list[int]) -> dict[int, str]:
    return {e.id: f"{e.full_name} ({e.employee_code})" for e in db.scalars(select(Employee).where(Employee.id.in_(ids or [0])))}


def execute_run(run_id: int) -> None:
    """Background job: move the contacts of a recorded rebalancing."""
    db = new_session()
    try:
        run = db.get(DistributionRun, run_id)
        if run is None or run.status != RUN_RUNNING:
            return
        # (no lock of its own: `start` refuses a second run while one is reporting in, and two runs that do overlap lock different
        # contacts - a contact somebody else is moving is skipped - so they cannot move one contact twice)
        from app import jobs

        try:
            with jobs.writer_slot():
                _move(db, run_id)
        except Exception as exc:  # noqa: BLE001
            log.exception("Rebalancing %s failed", run_id)
            _fail(db, run_id, f"Stopped because of a problem on the server ({exc.__class__.__name__}). What was moved stays; run it again for the rest.")
    finally:
        db.close()


def _fail(db: Session, run_id: int, message: str) -> None:
    db.rollback()
    run = db.get(DistributionRun, run_id)
    if run is not None and run.status == RUN_RUNNING:
        run.status = RUN_FAILED
        run.error_message = message[:2000]
        run.finished_at = utcnow()
        db.commit()


def _move_chunk(db: Session, run_id: int, rows: list[Any], first_position: int, schedule: Schedule, actor_id: int | None) -> tuple[Counter[int], Counter[int]]:
    now = utcnow()
    db.info[QUIET] = True  # the queues of the people involved are cleared once at the end
    gave: Counter[int] = Counter()
    took: Counter[int] = Counter()
    released = db.execute(
        update(ContactAssignment)
        .where(ContactAssignment.id.in_([r.id for r in rows]), ContactAssignment.status == "active")
        .values(status="released", active_contact_id=None, released_at=now),
        execution_options={"synchronize_session": False},
    )
    if released.rowcount != len(rows):  # (the rows are locked by us; this only happens if somebody released them in the meantime)
        raise RuntimeError("Assignments changed while they were being moved.")
    fresh = []
    for offset, r in enumerate(rows):
        target = schedule.employee_at(first_position + offset)
        fresh.append(
            {
                "contact_id": r.contact_id, "employee_id": target, "campaign_id": r.campaign_id, "status": "active",
                "active_contact_id": r.contact_id, "assigned_by": actor_id, "assigned_at": now,
            }
        )
        gave[target] += 1
        took[r.employee_id] += 1
    insert_ignore(db, ContactAssignment.__table__, fresh, conflict_column="active_contact_id")
    db.execute(
        update(DistributionRun).where(DistributionRun.id == run_id).values(moved=first_position + len(rows), heartbeat_at=now),
        execution_options={"synchronize_session": False},
    )
    db.commit()
    return gave, took


def _move(db: Session, run_id: int) -> None:
    run = db.get(DistributionRun, run_id)
    assert run is not None
    data = RebalanceIn(**(run.details or {}).get("request", {}))
    plan = _build(db, data)
    if not plan.can_run:
        _complete(db, run, plan, Counter(), Counter())
        return
    schedule = Schedule(sorted(plan.quotas.items()), plan.data.order)
    source_ids = [s.employee_id for s in plan.sources if plan.movable.get(s.employee_id)]
    gave: Counter[int] = Counter()
    took: Counter[int] = Counter()
    cursor = position = 0
    pause = get_settings().import_chunk_pause_ms / 1000
    while position < schedule.total:
        started = time.monotonic()
        page = workload.movable_page(source_ids, cursor, min(CHUNK, schedule.total - position)).with_for_update(of=ContactAssignment, skip_locked=True)
        rows = list(db.execute(page).all())
        if not rows:
            db.rollback()
            break
        cursor = rows[-1].id
        chunk_gave, chunk_took = retry_transient(db, lambda: _move_chunk(db, run_id, rows, position, schedule, run.created_by))
        gave.update(chunk_gave)
        took.update(chunk_took)
        position += len(rows)
        took_seconds = time.monotonic() - started
        time.sleep(max(pause, min(took_seconds * 0.5, 5.0)) if took_seconds > 1.0 else pause)
    db.refresh(run)
    _complete(db, run, plan, gave, took)


def _complete(db: Session, run: DistributionRun, plan: _Plan, gave: Counter[int], took: Counter[int]) -> None:
    moved = sum(gave.values())
    names = _names(db, list(set(gave) | set(took)))
    details = {
        **(run.details or {}),
        "strategy": plan.data.strategy,
        "order": plan.data.order,
        "from": [{"employee_id": eid, "name": names.get(eid, f"#{eid}"), "moved": n} for eid, n in sorted(took.items(), key=lambda i: (-i[1], i[0]))],
        "to": [{"employee_id": eid, "name": names.get(eid, f"#{eid}"), "received": n} for eid, n in sorted(gave.items(), key=lambda i: (-i[1], i[0]))],
    }
    run.status = RUN_COMPLETED
    run.moved = moved
    run.finished_at = utcnow()
    run.details = details
    run.error_message = None
    for employee_id, count in gave.items():
        notify(
            db, employee_id, type="assignment", title=f"{count} contact{'s' if count != 1 else ''} moved to you",
            body="They were waiting with colleagues who are not working. Open your queue to start calling.",
            data={"count": count, "run_id": run.id},
        )
    actor = db.get(Employee, run.created_by) if run.created_by else None
    audit_service.record(
        db, action="distribution.rebalance", actor=actor, actor_label=None if actor else "system", entity_type="distribution_run", entity_id=run.id,
        details={"trigger": run.trigger, "moved": moved, "planned": run.planned, "from": len(took), "to": len(gave)},
    )
    cache.bump(db, EVERYONE)
    db.commit()
    cache.bump_now(*[employee_epoch(e) for e in set(gave) | set(took)])
    log.info("Rebalancing %s (%s): %s of %s contacts moved from %s to %s employees", run.id, run.trigger, moved, run.planned, len(took), len(gave))


def auto_rebalance() -> DistributionRun | None:
    """The scheduler's turn: when somebody has stopped working and there is something to take from them, do it."""
    db = new_session()
    try:
        recover_stuck_runs(db)
        if not bool(get_setting(db, "auto_rebalance")):
            return None
        states = activity.employee_states(db, with_counts=True)
        if not any(s.working for s in states) or not any((not s.working) and s.assigned for s in states):
            return None  # the ordinary case: nobody to take from - costs three cheap queries
        run = start(db, data=RebalanceIn(), actor_id=None, trigger="auto", quiet=True)
        if run is not None:
            execute_run(run.id)
        return run
    finally:
        db.close()


def recover_stuck_runs(db: Session) -> int:
    """A run whose server went away is marked as stopped (moving is safe to repeat: the next one picks up what is left)."""
    stale = utcnow() - timedelta(seconds=STALE_RUN_SECONDS)
    stuck = list(db.scalars(select(DistributionRun).where(DistributionRun.status == RUN_RUNNING, func.coalesce(DistributionRun.heartbeat_at, DistributionRun.created_at) < stale)))
    for run in stuck:
        run.status = RUN_FAILED
        run.finished_at = utcnow()
        run.error_message = "The server stopped while this was running. What was moved stays; the next rebalancing carries on."
    if stuck:
        db.commit()
    return len(stuck)
