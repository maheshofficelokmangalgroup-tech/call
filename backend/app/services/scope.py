"""Data-visibility rules (RBAC scoping). Used by every employee-facing query (IDOR prevention)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import Forbidden
from app.models.employee import ROLE_ADMIN, ROLE_MANAGER, Employee


def is_admin(user: Employee) -> bool:
    return user.role_name == ROLE_ADMIN


def is_manager(user: Employee) -> bool:
    return user.role_name == ROLE_MANAGER


def visible_employee_ids(db: Session, user: Employee) -> list[int] | None:
    """Employee IDs whose data `user` may read. None means unrestricted (administrators)."""
    if is_admin(user):
        return None
    if is_manager(user) and user.team_id:
        ids = list(db.scalars(select(Employee.id).where(Employee.team_id == user.team_id)))
        if user.id not in ids:
            ids.append(user.id)
        return ids
    return [user.id]


def can_view_employee(db: Session, user: Employee, employee_id: int) -> bool:
    ids = visible_employee_ids(db, user)
    return ids is None or employee_id in ids


def require_view_employee(db: Session, user: Employee, employee_id: int) -> None:
    if not can_view_employee(db, user, employee_id):
        raise Forbidden()
