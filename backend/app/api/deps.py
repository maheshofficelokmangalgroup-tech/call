"""Shared FastAPI dependencies: DB session, authentication, role guards, pagination."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core import auth_cache, cache, rate_limit
from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import Forbidden, Unauthorized
from app.core.rate_limit import client_ip
from app.core.security import decode_access_token
from app.core.timeutils import utcnow
from app.models.employee import ROLE_ADMIN, ROLE_MANAGER, Employee, EmployeeDevice, EmployeeSession

_bearer = HTTPBearer(auto_error=False)

# A temporary password (a new employee's first one, or one an administrator reset) only opens these until it has been replaced.
PASSWORD_CHANGE_PATHS = ("/api/v1/auth/change-password", "/api/v1/auth/logout", "/api/v1/me")


def _touch_presence(db: Session, request: Request, session_id: str, device_id: int | None, session: EmployeeSession | None) -> None:
    """Remember that this employee's phone / browser is alive (the admin panel shows who is online).

    Redis decides, for all workers together, which request is the one that writes this minute - no row has to be read to find out.
    """
    now = utcnow()
    if cache.enabled():
        if not auth_cache.presence_due(session_id):
            return
    elif session is not None and (now - session.last_used_at).total_seconds() < auth_cache.PRESENCE_TOUCH_SECONDS:
        return
    db.execute(update(EmployeeSession).where(EmployeeSession.id == session_id).values(last_used_at=now))
    if device_id is not None:
        db.execute(update(EmployeeDevice).where(EmployeeDevice.id == device_id).values(last_seen_at=now, last_ip=client_ip(request)))
    db.commit()


DbSession = Annotated[Session, Depends(get_db)]


def get_current_employee(
    request: Request,
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)] = None,
) -> Employee:
    if credentials is None or credentials.scheme.lower() != "bearer" or not credentials.credentials:
        raise Unauthorized()
    claims = decode_access_token(credentials.credentials)
    settings = get_settings()
    session_id, employee_id = claims["sid"], str(claims["sub"])

    # one person cannot flood the service (a phone stuck in a retry loop, a script): the limit is per person, not per address
    if settings.rate_limit_user_per_minute > 0:
        rate_limit.enforce(f"user:{employee_id}", settings.rate_limit_user_per_minute, 60)

    session: EmployeeSession | None = None
    snap = auth_cache.lookup(session_id, employee_id)
    if snap is not None:
        employee = auth_cache.principal(db, snap)  # no database query
        device_id = snap["device"]
    else:
        session = db.get(EmployeeSession, session_id)
        if (
            session is None
            or session.revoked_at is not None
            or session.expires_at <= utcnow()
            or str(session.employee_id) != employee_id
        ):
            raise Unauthorized("Your session has ended. Please sign in again.", code="session_revoked")

        found = db.get(Employee, session.employee_id)
        if found is None:
            raise Unauthorized("Your session has ended. Please sign in again.", code="session_revoked")
        if not found.is_active:
            raise Forbidden("Your account has been deactivated. Contact your administrator.", code="account_disabled")
        employee, device_id = found, session.device_id
        auth_cache.store(employee, session)

    request.state.session_id = session_id
    request.state.device_id = device_id
    if employee.must_change_password and request.url.path not in PASSWORD_CHANGE_PATHS:
        raise Forbidden("Choose your own password before you continue.", code="password_change_required")
    _touch_presence(db, request, session_id, device_id, session)
    return employee


CurrentEmployee = Annotated[Employee, Depends(get_current_employee)]


def require_roles(*roles: str):
    async def _dependency(user: CurrentEmployee) -> Employee:  # (async: it only compares two strings, it needs no thread)
        if user.role_name not in roles:
            raise Forbidden()
        return user

    _dependency.required_roles = roles  # type: ignore[attr-defined]  (read by tests/test_authorization_matrix.py)
    return _dependency


AdminUser = Annotated[Employee, Depends(require_roles(ROLE_ADMIN))]
StaffUser = Annotated[Employee, Depends(require_roles(ROLE_ADMIN, ROLE_MANAGER))]


@dataclass(frozen=True)
class Pagination:
    page: int
    page_size: int

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


def pagination(
    page: Annotated[int, Query(ge=1, le=100_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 20,
) -> Pagination:
    return Pagination(page=page, page_size=page_size)


Paging = Annotated[Pagination, Depends(pagination)]
