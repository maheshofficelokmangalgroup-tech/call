from __future__ import annotations

from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.errors import NotFound
from app.core.timeutils import utcnow
from app.models.system import Notification


def notify(
    db: Session,
    employee_id: int,
    *,
    type: str,
    title: str,
    body: str | None = None,
    data: dict[str, Any] | None = None,
) -> Notification:
    row = Notification(employee_id=employee_id, type=type, title=title[:150], body=(body or "")[:500] or None, data=data)
    db.add(row)
    return row


def list_notifications(db: Session, employee_id: int, *, unread_only: bool, page: int, page_size: int):
    stmt = select(Notification).where(Notification.employee_id == employee_id)
    if unread_only:
        stmt = stmt.where(Notification.is_read.is_(False))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).all()
    return rows, total


def unread_count(db: Session, employee_id: int) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.employee_id == employee_id, Notification.is_read.is_(False))
        )
        or 0
    )


def mark_read(db: Session, employee_id: int, notification_id: int) -> Notification:
    row = db.get(Notification, notification_id)
    if row is None or row.employee_id != employee_id:
        raise NotFound("Notification not found.")
    if not row.is_read:
        row.is_read = True
        row.read_at = utcnow()
        db.commit()
    return row


def mark_all_read(db: Session, employee_id: int) -> int:
    result = db.execute(
        update(Notification)
        .where(Notification.employee_id == employee_id, Notification.is_read.is_(False))
        .values(is_read=True, read_at=utcnow())
    )
    db.commit()
    return result.rowcount or 0
