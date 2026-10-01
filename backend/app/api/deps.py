"""Shared FastAPI dependencies: DB session, authentication, role guards, pagination."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import Forbidden, Unauthorized
from app.core.security import decode_access_token
from app.core.timeutils import utcnow
from app.models.employee import ROLE_ADMIN, ROLE_MANAGER, Employee, EmployeeSession

_bearer = HTTPBearer(auto_error=False)

DbSession = Annotated[Session, Depends(get_db)]


def get_current_employee(
    request: Request,
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)] = None,
) -> Employee:
    if credentials is None or credentials.scheme.lower() != "bearer" or not credentials.credentials:
        raise Unauthorized()
    claims = decode_access_token(credentials.credentials)

    session = db.get(EmployeeSession, claims["sid"])
    if (
        session is None
        or session.revoked_at is not None
        or session.expires_at <= utcnow()
        or str(session.employee_id) != str(claims["sub"])
    ):
        raise Unauthorized("Your session has ended. Please sign in again.", code="session_revoked")

    employee = db.get(Employee, session.employee_id)
    if employee is None:
        raise Unauthorized("Your session has ended. Please sign in again.", code="session_revoked")
    if not employee.is_active:
        raise Forbidden("Your account has been deactivated. Contact your administrator.", code="account_disabled")

    request.state.session_id = session.id
    request.state.device_id = session.device_id
    return employee


CurrentEmployee = Annotated[Employee, Depends(get_current_employee)]


def require_roles(*roles: str):
    def _dependency(user: CurrentEmployee) -> Employee:
        if user.role_name not in roles:
            raise Forbidden()
        return user

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
