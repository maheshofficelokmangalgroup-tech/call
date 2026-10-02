"""A signed-in session remembered in Redis: a request then needs no database query at all to know who is calling.

Without it every request began with two queries (the session row, then the employee row) - hundreds of phones with a request every few
seconds meant most of the database's work was answering "is this person still signed in?". What is cached is exactly what those two
queries returned (never the password hash), for at most `auth_cache_seconds`.

It can never keep a person signed in who should not be:
  * sign-out, "sign out everywhere", password change/reset, deactivation, a change of role or team and every other edit of the employee
    bump the employee's epoch after the commit (`forget_employee`), which invalidates all of that employee's cached sessions at once;
  * a cached value older than a minute is not used;
  * if Redis cannot be reached the database is asked, as before.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session
from sqlalchemy.orm.session import make_transient_to_detached

from app.core import cache
from app.core.config import get_settings
from app.core.timeutils import utcnow
from app.models.employee import Employee, EmployeeSession, Role, Team


def _epoch_name(employee_id: int | str) -> str:
    return f"emp:{employee_id}"


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _dt(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def snapshot(employee: Employee, session: EmployeeSession) -> dict[str, Any]:
    return {
        "id": employee.id,
        "code": employee.employee_code,
        "email": employee.email,
        "name": employee.full_name,
        "phone": employee.phone,
        "role_id": employee.role_id,
        "role": employee.role.name,
        "role_description": employee.role.description,
        "team_id": employee.team_id,
        "team": employee.team.name if employee.team else None,
        "team_description": employee.team.description if employee.team else None,
        "team_active": employee.team.is_active if employee.team else None,
        "active": employee.is_active,
        "target": employee.daily_target,
        "must_change": employee.must_change_password,
        "bound": employee.device_binding_enabled,
        "last_login": _iso(employee.last_login_at),
        "pw_changed": _iso(employee.password_changed_at),
        "created": _iso(employee.created_at),
        "updated": _iso(employee.updated_at),
        "sid": session.id,
        "device": session.device_id,
        "expires": session.expires_at.timestamp(),
        "revoked": session.revoked_at is not None,
    }


def store(employee: Employee, session: EmployeeSession) -> None:
    """Remember a session that was just found valid in the database."""
    settings = get_settings()
    ttl = min(settings.auth_cache_seconds, int(session.expires_at.timestamp() - utcnow().timestamp()))
    if ttl <= 0:
        return
    cache.stamped_set(f"auth:s:{session.id}", snapshot(employee, session), ttl, _epoch_name(employee.id))


def lookup(session_id: str, employee_id: str | int) -> dict[str, Any] | None:
    """The cached session if it is still current - and, being cached, was valid (invalid sessions are never stored)."""
    if get_settings().auth_cache_seconds <= 0:
        return None
    snap = cache.stamped_get(f"auth:s:{session_id}", _epoch_name(employee_id))
    if not isinstance(snap, dict):
        return None
    if str(snap.get("id")) != str(employee_id) or snap.get("sid") != session_id:
        return None
    if snap.get("revoked") or not snap.get("active") or float(snap.get("expires", 0)) <= utcnow().timestamp():
        return None  # not something to decide here: let the database say why
    return snap


def principal(db: Session, snap: dict[str, Any]) -> Employee:
    """The signed-in employee as an ordinary, clean ORM object that is attached to this request's session without any query.

    Because it is a normal persistent object, code that changes it (a password change, for example) is saved as usual; columns the
    cache does not hold (the password hash) are loaded from the database on first use.
    """
    role = Role(id=snap["role_id"], name=snap["role"], description=snap.get("role_description"))
    make_transient_to_detached(role)
    team = None
    if snap.get("team_id"):
        team = Team(id=snap["team_id"], name=snap["team"], description=snap.get("team_description"), is_active=bool(snap.get("team_active", True)))
        make_transient_to_detached(team)
    employee = Employee(
        id=snap["id"],
        employee_code=snap["code"],
        email=snap["email"],
        full_name=snap["name"],
        phone=snap["phone"],
        role_id=snap["role_id"],
        team_id=snap["team_id"],
        is_active=snap["active"],
        daily_target=snap["target"],
        must_change_password=snap["must_change"],
        device_binding_enabled=snap["bound"],
        last_login_at=_dt(snap["last_login"]),
        password_changed_at=_dt(snap["pw_changed"]),
        created_at=_dt(snap["created"]),
        updated_at=_dt(snap["updated"]),
    )
    employee.role = role
    employee.team = team
    make_transient_to_detached(employee)
    return db.merge(employee, load=False)


# ------------------------------------------------------------------------------------------------ invalidation
def forget_session(db: Session, session_id: str) -> None:
    """After the commit: this one session is no longer known."""
    cache.defer_until_commit(db, lambda: cache.delete(f"auth:s:{session_id}"))


def forget_employee(db: Session, employee_id: int | str) -> None:
    """After the commit: every cached session of this employee is no longer known (sign-out everywhere, deactivation, edits...)."""
    cache.bump(db, _epoch_name(employee_id))
