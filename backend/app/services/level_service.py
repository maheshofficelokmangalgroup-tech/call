"""Sharing the work equally between the people who are working - also when somebody comes later.

The problem: a sheet is shared out between the employees who are working at the moment it is added. Somebody who arrives later - a new
employee, or one who was away and signs in again - has nothing, while a colleague has thousands of contacts that nobody has called.
Here those contacts are shared out again, so that everybody who is working has the same number of them.

What is shared: only the contacts that are waiting for their first call (still "new", no callback promised). Everything somebody has
started on - a call that was made, a callback that was promised - stays where it is, and so does everything that is done. The
remainder (fewer than the number of people) stays with the ones who have the most, so as few contacts as possible change hands. A
person who gives takes nothing back: they give from the newest of their waiting contacts, the ones they would call last.

It can be started by an administrator (look at the plan first, then run it), and it runs by itself - while the setting `auto_level` is
on - in two cases: whenever somebody who is working owns no contact at all (a minute or two after a new employee is added, or after
somebody who was away is seen again), and - looked at every few minutes - whenever somebody who is working has far less than the fair
share of the waiting contacts (a new employee who was given a few, somebody who is back and kept only what he had called, somebody who
ran out). Moving is done in steps of 1,000 contacts, every step one transaction; contacts that somebody is editing at that
moment are left for the next round (SKIP LOCKED). Doing it twice is harmless: when everybody has the same there is nothing to move.
"""

from __future__ import annotations

import logging
import time
from collections import Counter
from dataclasses import dataclass, field

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.core import cache
from app.core.config import get_settings
from app.core.database import new_session
from app.core.dbutil import retry_transient
from app.core.errors import Conflict, ValidationFailed
from app.core.timeutils import utcnow
from app.models.cache_events import EVERYONE, employee_epoch
from app.models.contact import ContactAssignment
from app.models.distribution import RUN_COMPLETED, RUN_RUNNING, DistributionRun
from app.models.employee import ROLE_EMPLOYEE, Employee, Role
from app.models.imports import IMPORT_APPLYING, Import
from app.schemas.distribution import LevelEmployee, LevelIn, LevelPlanOut
from app.services import activity, audit_service, rebalance_service, workload
from app.services.distribution import Recipient, Schedule, level_targets
from app.services.notification_service import notify
from app.services.settings_service import get_setting

log = logging.getLogger(__name__)

KIND = "level"

# What the automatic sharing treats as "far less than the others". Everybody who is working has about the same, so the ordinary case is
# that nobody is short; somebody is short when they have less than this part of the fair share (the waiting contacts of everybody,
# divided by the number of people) - and only when enough would move to be worth it (a handful of contacts is not shuffled around, and
# nobody is sent a notification about it).
SHORT_OF_SHARE = 0.5
MIN_AUTO_MOVE = 10
BALANCE_CHECK_SECONDS = 300  # how often the scheduler looks for that (the "nobody has anything" case is looked at every minute)


@dataclass
class _Plan:
    people: list[activity.EmployeeState] = field(default_factory=list)  # who takes part: working (and chosen)
    waiting: dict[int, int] = field(default_factory=dict)  # contacts nobody has called yet, per person
    target: dict[int, int] = field(default_factory=dict)  # what each should have after the sharing
    gives: dict[int, int] = field(default_factory=dict)
    receives: dict[int, int] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    @property
    def total_waiting(self) -> int:
        return sum(self.waiting.values())

    @property
    def total_move(self) -> int:
        return sum(self.gives.values())

    @property
    def can_run(self) -> bool:
        return self.total_move > 0


def _build(db: Session, data: LevelIn, states: list[activity.EmployeeState] | None = None) -> _Plan:
    states = states if states is not None else activity.employee_states(db, with_counts=True)
    known = {s.employee_id for s in states}
    chosen = set(data.employee_ids or [])
    unknown = chosen - known
    if unknown:
        raise ValidationFailed(f"Unknown employee id(s): {sorted(unknown)[:5]}.", code="unknown_employee")
    plan = _Plan()
    for s in states:
        if chosen and s.employee_id in chosen and not s.working:
            plan.warnings.append(f"{s.full_name} is not working, so they take no part.")
    plan.people = [s for s in states if s.working and (not chosen or s.employee_id in chosen)]
    if len(plan.people) < 2:
        plan.warnings.append("Fewer than two people are working, so there is nobody to share with.")
        return plan
    ids = [s.employee_id for s in plan.people]
    plan.waiting = workload.waiting_counts(db, ids)
    plan.target = level_targets([Recipient(i, plan.waiting.get(i, 0)) for i in ids])
    for i in ids:
        have, want = plan.waiting.get(i, 0), plan.target[i]
        if have > want:
            plan.gives[i] = have - want
        elif want > have:
            plan.receives[i] = want - have
    if not plan.total_waiting:
        plan.warnings.append("Nobody has contacts that are waiting for a first call, so there is nothing to share.")
    elif not plan.total_move:
        plan.warnings.append("Everybody who is working already has the same number of contacts waiting for a first call.")
    return plan


def _plan_out(plan: _Plan) -> LevelPlanOut:
    return LevelPlanOut(
        working=len(plan.people), total_waiting=plan.total_waiting, total_move=plan.total_move,
        employees=[
            LevelEmployee(
                employee_id=s.employee_id, employee_code=s.employee_code, full_name=s.full_name, state=s.state, assigned=s.assigned,
                waiting=plan.waiting.get(s.employee_id, 0), after=plan.target.get(s.employee_id, plan.waiting.get(s.employee_id, 0)),
                gives=plan.gives.get(s.employee_id, 0), receives=plan.receives.get(s.employee_id, 0),
            )
            for s in plan.people
        ],
        warnings=plan.warnings, can_run=plan.can_run,
    )


def preview(db: Session, data: LevelIn) -> LevelPlanOut:
    return _plan_out(_build(db, data))


# ------------------------------------------------------------------------------------------------------------ running
def start(db: Session, *, data: LevelIn, actor_id: int | None, trigger: str, quiet: bool = False) -> DistributionRun | None:
    """Plan and record a sharing; the moving itself is `execute_run`. With `quiet`, nothing to share is not an error (the automatic one
    comes by every minute)."""
    busy = rebalance_service._running_now(db)
    if busy is not None:
        if quiet:
            return None
        raise Conflict(f"Sharing {busy} is running right now. Wait until it is finished.", code="rebalance_busy")
    plan = _build(db, data)
    if not plan.can_run:
        if quiet:
            return None
        raise ValidationFailed(plan.warnings[0] if plan.warnings else "There is nothing to share.", code="nothing_to_level")
    now = utcnow()
    run = DistributionRun(
        kind=KIND, trigger=trigger, status=RUN_RUNNING, created_by=actor_id, created_at=now, heartbeat_at=now, planned=plan.total_move,
        details={"request": data.model_dump(), "inactive_after_days": activity.inactive_after_days(db)},
    )
    db.add(run)
    db.commit()
    return run


def execute_run(run_id: int) -> None:
    """Background job: move the contacts of a recorded sharing."""
    db = new_session()
    try:
        run = db.get(DistributionRun, run_id)
        if run is None or run.status != RUN_RUNNING:
            return
        from app import jobs

        try:
            with jobs.writer_slot():
                _move(db, run_id)
        except Exception as exc:  # noqa: BLE001
            log.exception("Sharing %s failed", run_id)
            rebalance_service._fail(
                db, run_id, f"Stopped because of a problem on the server ({exc.__class__.__name__}). What was moved stays; share again for the rest."
            )
    finally:
        db.close()


def _move(db: Session, run_id: int) -> None:
    run = db.get(DistributionRun, run_id)
    assert run is not None
    data = LevelIn(**{k: v for k, v in (run.details or {}).get("request", {}).items() if k in LevelIn.model_fields})
    plan = _build(db, data)  # the state of now, not the state of when it was recorded
    if not plan.can_run:
        _complete(db, run, plan, Counter(), Counter())
        return
    schedule = Schedule(sorted(plan.receives.items()), "interleave")
    gave: Counter[int] = Counter()  # received, by the people who receive
    took: Counter[int] = Counter()  # given away, by the people who give
    position = 0
    pause = get_settings().import_chunk_pause_ms / 1000
    for giver, count in sorted(plan.gives.items()):
        left, before = count, None
        while left > 0 and position < schedule.total:
            started = time.monotonic()
            page = workload.waiting_page(giver, before, min(rebalance_service.CHUNK, left, schedule.total - position))
            rows = list(db.execute(page.with_for_update(of=ContactAssignment, skip_locked=True)).all())
            if not rows:
                db.rollback()
                break  # what is left of theirs is being edited just now, or is gone: the next sharing carries on
            before = rows[-1].id  # (newest first: the last row is the oldest of this page)
            chunk_gave, chunk_took = retry_transient(db, lambda: rebalance_service._move_chunk(db, run_id, rows, position, schedule, run.created_by))
            gave.update(chunk_gave)
            took.update(chunk_took)
            position += len(rows)
            left -= len(rows)
            seconds = time.monotonic() - started
            time.sleep(max(pause, min(seconds * 0.5, 5.0)) if seconds > 1.0 else pause)
    db.refresh(run)
    _complete(db, run, plan, gave, took)


def _complete(db: Session, run: DistributionRun, plan: _Plan, gave: Counter[int], took: Counter[int]) -> None:
    moved = sum(gave.values())
    names = rebalance_service._names(db, list(set(gave) | set(took)))
    run.status = RUN_COMPLETED
    run.moved = moved
    run.finished_at = utcnow()
    run.error_message = None
    run.details = {
        **(run.details or {}),
        "from": [{"employee_id": eid, "name": names.get(eid, f"#{eid}"), "moved": n} for eid, n in sorted(took.items(), key=lambda i: (-i[1], i[0]))],
        "to": [{"employee_id": eid, "name": names.get(eid, f"#{eid}"), "received": n} for eid, n in sorted(gave.items(), key=lambda i: (-i[1], i[0]))],
    }
    for employee_id, count in gave.items():
        notify(
            db, employee_id, type="assignment", title=f"{count} contact{'s' if count != 1 else ''} added to your list",
            body="The contacts nobody had called were shared out, so that everybody who is working has the same number to call. Open your queue to start calling.",
            data={"count": count, "run_id": run.id},
        )
    for employee_id, count in took.items():
        notify(
            db, employee_id, type="assignment", title=f"{count} of your waiting contact{'s' if count != 1 else ''} went to a colleague",
            body="The contacts nobody had called were shared out, so that everybody who is working has the same number to call. The ones you have started on stay with you.",
            data={"count": count, "run_id": run.id},
        )
    actor = db.get(Employee, run.created_by) if run.created_by else None
    audit_service.record(
        db, action="distribution.level", actor=actor, actor_label=None if actor else "system", entity_type="distribution_run", entity_id=run.id,
        details={"trigger": run.trigger, "moved": moved, "planned": run.planned, "from": len(took), "to": len(gave)},
    )
    cache.bump(db, EVERYONE)
    db.commit()
    cache.bump_now(*[employee_epoch(e) for e in set(gave) | set(took)])
    log.info("Sharing %s (%s): %s of %s contacts moved from %s to %s employees", run.id, run.trigger, moved, run.planned, len(took), len(gave))


# ------------------------------------------------------------------------------------------------------- by itself
def _import_is_applying(db: Session) -> bool:
    return db.scalar(select(Import.id).where(Import.status == IMPORT_APPLYING).limit(1)) is not None


def _without_contacts(db: Session) -> list[int]:
    """Employees whose account is on and who own no contact at all. One indexed query - the ordinary answer is an empty list."""
    owns = exists().where(ContactAssignment.employee_id == Employee.id, ContactAssignment.status == "active")
    return list(db.scalars(select(Employee.id).join(Role, Role.id == Employee.role_id).where(Role.name == ROLE_EMPLOYEE, Employee.is_active.is_(True), ~owns)))


def _short_of_share(plan: _Plan) -> bool:
    """Does somebody who is working have far less than the fair share of the waiting contacts - and would enough move to be worth it?"""
    if len(plan.people) < 2 or plan.total_waiting == 0 or plan.total_move < MIN_AUTO_MOVE:
        return False
    fair = plan.total_waiting / len(plan.people)
    fewest = min(plan.waiting.get(person.employee_id, 0) for person in plan.people)
    return fewest < fair * SHORT_OF_SHARE


def auto_level(*, check_balance: bool = True) -> DistributionRun | None:
    """The scheduler's turn. Share the waiting contacts equally when
      * somebody who is working has no contact at all (a new account) and the others have contacts nobody has called, or
      * `check_balance` and somebody who is working has less than half of the fair share (a new employee who was given a few, somebody
        who is back and kept only what he had called, somebody who ran out).
    Waits while a sheet is being added (that is being shared out right now, with the same people)."""
    db = new_session()
    try:
        rebalance_service.recover_stuck_runs(db)
        if not bool(get_setting(db, "auto_level")):
            return None
        if _import_is_applying(db):
            return None
        empty = _without_contacts(db)
        has_nothing = bool(empty) and any(s.working for s in activity.employee_states(db, employee_ids=empty))  # (accounts that are off or not seen for days are not waiting for anything)
        if not has_nothing:
            if not check_balance or not _short_of_share(_build(db, LevelIn())):
                return None
        run = start(db, data=LevelIn(), actor_id=None, trigger="auto", quiet=True)
        if run is not None:
            execute_run(run.id)
        return run
    finally:
        db.close()
