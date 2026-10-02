from __future__ import annotations

from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core import cache
from app.core.config import get_settings
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
    _forget_unread(db, employee_id)
    return row


def _forget_unread(db: Session, employee_id: int) -> None:
    """The unread number is remembered for a few seconds; whatever changes it clears it after the commit."""
    cache.mark_dirty(db, f"unread:{employee_id}")
    cache.defer_until_commit(db, lambda: cache.delete(f"unread:{employee_id}"))


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
    key, own_change = f"unread:{employee_id}", cache.is_dirty(db, f"unread:{employee_id}")
    hit = None if own_change else cache.get_json(key)
    if isinstance(hit, int):
        return hit
    count = int(
        db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.employee_id == employee_id, Notification.is_read.is_(False))
        )
        or 0
    )
    if not own_change:
        cache.set_json(key, count, get_settings().config_cache_seconds // 10 or 30)
    return count


def mark_read(db: Session, employee_id: int, notification_id: int) -> Notification:
    row = db.get(Notification, notification_id)
    if row is None or row.employee_id != employee_id:
        raise NotFound("Notification not found.")
    if not row.is_read:
        row.is_read = True
        row.read_at = utcnow()
        _forget_unread(db, employee_id)
        db.commit()
    return row


def mark_all_read(db: Session, employee_id: int) -> int:
    result = db.execute(
        update(Notification)
        .where(Notification.employee_id == employee_id, Notification.is_read.is_(False))
        .values(is_read=True, read_at=utcnow())
    )
    _forget_unread(db, employee_id)
    db.commit()
    return result.rowcount or 0
