"""Dashboard numbers. Every figure is computed from raw call/assignment rows so totals reconcile.

Definitions (section 21):
  total_calls       call attempts started in the selected business day
  connected_calls   attempts whose status is connected/completed (answered)
  no_answer_calls   attempts that ended without being answered
  busy / switched_off / invalid   attempts whose recorded outcome is that disposition
  completed_calls   attempts that already have an outcome recorded
  pending_wrapup    attempts still waiting for an outcome
  talk seconds      sum of duration of connected attempts;  average = talk / connected
"""

from __future__ import annotations

import json
from datetime import date

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core import cache
from app.core.config import get_settings
from app.core.timeutils import business_tz, day_bounds_utc, utcnow
from app.models.call import (
    CALL_ANSWERED_STATUSES,
    CALL_NO_ANSWER,
    Call,
    CallDisposition,
)
from app.models.contact import ContactAssignment
from app.models.cache_events import EVERYONE, employee_epoch
from app.models.employee import Employee
from app.schemas.misc import DashboardOut
from app.services import queue_service
from app.services.scope import is_admin, visible_employee_ids


def _scope_ids(db: Session, user: Employee, employee_id: int | None, team_id: int | None) -> tuple[str, list[int] | None]:
    visible = visible_employee_ids(db, user)
    if employee_id is not None:
        if visible is not None and employee_id not in visible:
            return "employee", []
        return "employee", [employee_id]
    if team_id is not None:
        team_ids = list(db.scalars(select(Employee.id).where(Employee.team_id == team_id)))
        if visible is not None:
            team_ids = [i for i in team_ids if i in visible]
        return "team", team_ids
    if visible is None:
        return "organization", None
    if len(visible) == 1:
        return "employee", visible
    return "team", visible


def build_dashboard(db: Session, user: Employee, *, day: date | None, employee_id: int | None, team_id: int | None) -> DashboardOut:
    scope, ids = _scope_ids(db, user, employee_id, team_id)
    ttl = get_settings().dashboard_cache_seconds
    key = f"dash:{scope}:{'all' if ids is None else cache.digest(*sorted(ids))}:{day or 'today'}"

    def compute() -> dict:
        return _compute(db, scope, ids, day).model_dump(mode="json")

    if scope == "employee" and ids and len(ids) == 1:
        # one person's figures change when their own calls, callbacks or contacts do: those clear it at once (the seconds are a net)
        epochs = (EVERYONE, employee_epoch(ids[0]))
        payload = cache.stamped_get(key, *epochs)
        if payload is None:
            payload = compute()
            cache.stamped_set(key, payload, ttl, *epochs)
    else:
        # a team or the whole organisation changes all the time: computed once per few seconds however many people look
        payload = cache.single_flight(key, ttl, compute)
    return DashboardOut.model_validate(payload)


# from this many contacts handed out, the figures about what is left to call are not worked out for every look at the dashboard
LARGE_ORGANISATION = 50_000


def _contact_figures(ids: list[int] | None, db: Session | None = None, now=None) -> list[int]:
    """[contacts still to be called, callbacks due now, callbacks later today] for these employees (None: all of them)."""
    from app.core.database import new_session

    own = db is None
    session = db or new_session()
    try:
        moment = now or utcnow()
        pending = queue_service.count_pending(session, ids, moment)
        due_now, later = queue_service.callback_counts(session, ids, moment)
        return [int(pending), int(due_now), int(later)]
    finally:
        if own:
            session.close()


def _compute(db: Session, scope: str, ids: list[int] | None, day: date | None) -> DashboardOut:
    now = utcnow()
    start, end = day_bounds_utc(day, now)
    tz = business_tz()

    def in_scope(col):
        return [] if ids is None else [col.in_(ids)]

    answered = case((Call.status.in_(CALL_ANSWERED_STATUSES), 1), else_=0)
    call_row = db.execute(
        select(
            func.count(Call.id),
            func.coalesce(func.sum(answered), 0),
            func.coalesce(func.sum(case((Call.status == CALL_NO_ANSWER, 1), else_=0)), 0),
            func.coalesce(func.sum(case((CallDisposition.code == "BUSY", 1), else_=0)), 0),
            func.coalesce(func.sum(case((CallDisposition.code == "SWITCHED_OFF", 1), else_=0)), 0),
            func.coalesce(func.sum(case((CallDisposition.code == "INVALID_NUMBER", 1), else_=0)), 0),
            func.coalesce(func.sum(case((Call.disposition_id.is_not(None), 1), else_=0)), 0),
            func.coalesce(func.sum(case((Call.disposition_id.is_(None), 1), else_=0)), 0),
            func.coalesce(func.sum(case((Call.status.in_(CALL_ANSWERED_STATUSES), Call.duration_seconds), else_=0)), 0),
        )
        .select_from(Call)
        .outerjoin(CallDisposition, CallDisposition.id == Call.disposition_id)
        .where(Call.started_at >= start, Call.started_at < end, *in_scope(Call.employee_id))
    ).one()
    total, connected, no_answer, busy, switched_off, invalid, completed, pending_wrapup, talk = (int(v) for v in call_row)

    hours = [0] * 24
    for (started,) in db.execute(select(Call.started_at).where(Call.started_at >= start, Call.started_at < end, *in_scope(Call.employee_id))):
        hours[started.astimezone(tz).hour] += 1

    emp_stmt = select(func.count(Employee.id), func.coalesce(func.sum(case((Employee.is_active.is_(True), 1), else_=0)), 0), func.coalesce(func.sum(case((Employee.is_active.is_(True), Employee.daily_target), else_=0)), 0))
    if ids is not None:
        emp_stmt = emp_stmt.where(Employee.id.in_(ids))
    employee_count, active_employees, target = (int(v) for v in db.execute(emp_stmt).one())

    # (no join with the contacts: deleting a contact ends its assignment, so an active assignment is always a live contact - and this
    # way it is one pass over an index, however many contacts there are)
    assigned = db.scalar(select(func.count(ContactAssignment.id)).where(ContactAssignment.status == "active", *in_scope(ContactAssignment.employee_id))) or 0
    if scope != "employee" and assigned >= LARGE_ORGANISATION:
        # Working out what is still to be called reads every contact of everybody - seconds, with a million of them. A dashboard that
        # is looked at all day does not need it to the second: the last answer is shown while a fresh one is worked out in the background.
        key = f"dash:contacts:{scope}:{'all' if ids is None else cache.digest(*sorted(ids))}"
        pending_contacts, due_now, callbacks_later = cache.stale_while_revalidate(key, 60, 3600, lambda: _contact_figures(ids))
    else:
        pending_contacts, due_now, callbacks_later = _contact_figures(ids, db, now)
    callbacks_due = due_now + callbacks_later  # everything the employee still has to call back today

    return DashboardOut(
        scope=scope,  # type: ignore[arg-type]
        date=(day or start.astimezone(tz).date()).isoformat(),
        timezone=get_settings().app_timezone,
        employee_count=employee_count,
        active_employees=active_employees,
        inactive_employees=employee_count - active_employees,
        assigned_contacts=int(assigned),
        pending_contacts=int(pending_contacts),
        total_calls=total,
        connected_calls=connected,
        no_answer_calls=no_answer,
        busy_calls=busy,
        switched_off_calls=switched_off,
        invalid_calls=invalid,
        completed_calls=completed,
        pending_wrapup=pending_wrapup,
        callbacks_due=int(callbacks_due),
        callbacks_scheduled_today=int(callbacks_later),
        total_talk_seconds=talk,
        average_call_seconds=int(talk / connected) if connected else 0,
        daily_target=target,
        target_progress_percent=round(100.0 * completed / target, 1) if target else 0.0,
        calls_by_hour=hours,
        generated_at=now,
    )
