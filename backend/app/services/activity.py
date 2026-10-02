"""Who is working. An employee is *active* when the account is switched on and the phone (or the panel) has been seen recently.

Used wherever work is shared out: an import gives contacts only to people who are working, and the rebalancing takes the
contacts back from people who are not.

  active        seen within `inactive_after_days` (default 2)
  new           created within that time and not seen yet - the account is waiting for its first sign-in, so it counts as working
  inactive      not seen for longer, or never seen although the account is older than that
  deactivated   the account is switched off
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.timeutils import utcnow
from app.models.contact import ContactAssignment
from app.models.employee import ROLE_EMPLOYEE, Employee, EmployeeDevice, EmployeeSession
from app.services import heartbeat_service
from app.services.settings_service import get_setting

ACTIVE, NEW, INACTIVE, DEACTIVATED = "active", "new", "inactive", "deactivated"
WORKING = (ACTIVE, NEW)
MIN_DAYS, MAX_DAYS, DEFAULT_DAYS = 1, 90, 2
_CHUNK = 500


@dataclass(frozen=True)
class EmployeeState:
    employee_id: int
    employee_code: str
    full_name: str
    team_id: int | None
    team_name: str | None
    role: str
    state: str
    reason: str  # empty for somebody who is working
    last_active_at: datetime | None
    assigned: int = 0  # contacts they own now

    @property
    def working(self) -> bool:
        return self.state in WORKING


def inactive_after_days(db: Session) -> int:
    try:
        days = int(get_setting(db, "inactive_after_days") or DEFAULT_DAYS)
    except (TypeError, ValueError):
        days = DEFAULT_DAYS
    return max(MIN_DAYS, min(MAX_DAYS, days))


def _chunks(items: Sequence[int]) -> Iterable[Sequence[int]]:
    for start in range(0, len(items), _CHUNK):
        yield items[start : start + _CHUNK]


def last_activity(db: Session, employees: Sequence[Employee]) -> dict[int, datetime | None]:
    """The latest sign of life of each employee: a sign-in, a request of the app, a phone report - whichever is newest."""
    seen: dict[int, datetime | None] = {e.id: e.last_login_at for e in employees}

    def note(employee_id: int, when: datetime | None) -> None:
        if when is not None and (seen.get(employee_id) is None or when > seen[employee_id]):  # type: ignore[operator]
            seen[employee_id] = when

    ids = [e.id for e in employees]
    for chunk in _chunks(ids):
        for employee_id, when in db.execute(
            select(EmployeeSession.employee_id, func.max(EmployeeSession.last_used_at))
            .where(EmployeeSession.employee_id.in_(chunk))
            .group_by(EmployeeSession.employee_id)
        ):
            note(employee_id, when)
        for employee_id, seen_at, beat_at in db.execute(
            select(EmployeeDevice.employee_id, func.max(EmployeeDevice.last_seen_at), func.max(EmployeeDevice.last_heartbeat_at))
            .where(EmployeeDevice.employee_id.in_(chunk))
            .group_by(EmployeeDevice.employee_id)
        ):
            note(employee_id, seen_at)
            note(employee_id, beat_at)
    for employee_id, report in heartbeat_service.latest(ids).items():  # what the open apps said in the last minutes (Redis)
        try:
            note(employee_id, datetime.fromisoformat(report["at"]))
        except (KeyError, ValueError, TypeError):
            continue
    return seen


def assigned_counts(db: Session, employee_ids: Sequence[int]) -> dict[int, int]:
    """Contacts each person owns now: one pass over an index, however many contacts there are."""
    counts = {employee_id: 0 for employee_id in employee_ids}
    for chunk in _chunks(list(employee_ids)):
        for employee_id, count in db.execute(
            select(ContactAssignment.employee_id, func.count(ContactAssignment.id))
            .where(ContactAssignment.status == "active", ContactAssignment.employee_id.in_(chunk))
            .group_by(ContactAssignment.employee_id)
        ):
            counts[employee_id] = int(count)
    return counts


def classify(employee: Employee, last_seen: datetime | None, now: datetime, days: int) -> tuple[str, str]:
    if not employee.is_active:
        return DEACTIVATED, "The account is switched off."
    limit = now - timedelta(days=days)
    if last_seen is not None:
        if last_seen >= limit:
            return ACTIVE, ""
        gone = int((now - last_seen).total_seconds() // 86400)
        return INACTIVE, f"Not seen for {gone} day{'s' if gone != 1 else ''}."
    if employee.created_at >= limit:
        return NEW, "Has not signed in yet."
    return INACTIVE, "Has never signed in."


def employee_states(
    db: Session,
    *,
    now: datetime | None = None,
    employee_ids: Sequence[int] | None = None,
    team_id: int | None = None,
    role: str | None = ROLE_EMPLOYEE,
    with_counts: bool = False,
) -> list[EmployeeState]:
    """Every employee (of one role, of one team, or the ones named) with the state they are in. Sorted by name."""
    now = now or utcnow()
    days = inactive_after_days(db)
    stmt = select(Employee)
    if employee_ids is not None:
        stmt = stmt.where(Employee.id.in_(list(employee_ids)))
    if team_id is not None:
        stmt = stmt.where(Employee.team_id == team_id)
    employees = [e for e in db.scalars(stmt.order_by(Employee.full_name, Employee.id)).unique() if role is None or e.role_name == role]
    seen = last_activity(db, employees)
    counts = assigned_counts(db, [e.id for e in employees]) if with_counts else {}
    result: list[EmployeeState] = []
    for e in employees:
        state, reason = classify(e, seen.get(e.id), now, days)
        result.append(
            EmployeeState(
                employee_id=e.id,
                employee_code=e.employee_code,
                full_name=e.full_name,
                team_id=e.team_id,
                team_name=e.team_name,
                role=e.role_name,
                state=state,
                reason=reason,
                last_active_at=seen.get(e.id),
                assigned=counts.get(e.id, 0),
            )
        )
    return result
