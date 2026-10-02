"""Scheduled callbacks / follow-ups."""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.timeutils import utcnow
from app.models.call import CALLBACK_CANCELLED, CALLBACK_DONE, CALLBACK_PENDING, Callback
from app.models.contact import CONTACT_CALLBACK, CONTACT_FOLLOW_UP, CONTACT_IN_PROGRESS, Contact
from app.models.employee import Employee
from app.schemas.call import CallbackCreate, CallbackOut, CallbackUpdate
from app.schemas.contact import ContactBrief
from app.services import contact_service
from app.services.scope import is_admin, visible_employee_ids

PAST_TOLERANCE = timedelta(minutes=5)
MAX_FUTURE = timedelta(days=365)


def validate_schedule(when: datetime, now: datetime | None = None) -> None:
    now = now or utcnow()
    if when < now - PAST_TOLERANCE:
        raise ValidationFailed("Callback time must be in the future.", code="callback_in_past")
    if when > now + MAX_FUTURE:
        raise ValidationFailed("Callback time is too far in the future.", code="callback_too_far")


def to_out(callback: Callback, contact: Contact | None = None, now: datetime | None = None) -> CallbackOut:
    now = now or utcnow()
    return CallbackOut(
        id=callback.id,
        contact_id=callback.contact_id,
        contact=ContactBrief.model_validate(contact) if contact is not None else None,
        call_id=callback.call_id,
        scheduled_at=callback.scheduled_at,
        status=callback.status,
        note=callback.note,
        overdue=callback.status == CALLBACK_PENDING and callback.scheduled_at <= now,
        created_at=callback.created_at,
    )


def close_pending(db: Session, *, employee_id: int, contact_id: int, status: str = CALLBACK_DONE) -> int:
    result = db.execute(
        update(Callback)
        .where(Callback.employee_id == employee_id, Callback.contact_id == contact_id, Callback.status == CALLBACK_PENDING)
        .values(status=status, completed_at=utcnow()),
        execution_options={"queue_employee": employee_id},  # (only this person's queue changes: see models/cache_events.py)
    )
    return result.rowcount or 0


def schedule(
    db: Session,
    *,
    employee_id: int,
    contact: Contact,
    when: datetime,
    note: str | None,
    call_id: int | None = None,
    client_ref: str | None = None,
    status_for_contact: str = CONTACT_CALLBACK,
) -> Callback:
    """Create a pending callback and make the contact wait for it. Caller commits."""
    if client_ref:
        existing = db.scalars(select(Callback).where(Callback.employee_id == employee_id, Callback.client_ref == client_ref)).first()
        if existing:
            return existing
    callback = Callback(
        employee_id=employee_id,
        contact_id=contact.id,
        call_id=call_id,
        scheduled_at=when,
        status=CALLBACK_PENDING,
        note=(note or None),
        client_ref=client_ref,
    )
    db.add(callback)
    contact.status = status_for_contact
    contact.next_eligible_at = when
    db.flush()
    return callback


def list_callbacks(
    db: Session,
    user: Employee,
    *,
    status: str | None,
    employee_id: int | None,
    due_before: datetime | None,
    page: int,
    page_size: int,
) -> tuple[list[CallbackOut], int]:
    visible = visible_employee_ids(db, user)
    stmt = select(Callback, Contact).join(Contact, Contact.id == Callback.contact_id).where(Contact.deleted_at.is_(None))
    if visible is not None:
        stmt = stmt.where(Callback.employee_id.in_(visible))
    if employee_id is not None:
        if visible is not None and employee_id not in visible:
            return [], 0
        stmt = stmt.where(Callback.employee_id == employee_id)
    if status:
        stmt = stmt.where(Callback.status == status)
    if due_before is not None:
        stmt = stmt.where(Callback.scheduled_at <= due_before)
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).with_only_columns(Callback.id).subquery())) or 0
    rows = db.execute(stmt.order_by(Callback.scheduled_at, Callback.id).limit(page_size).offset((page - 1) * page_size)).all()
    now = utcnow()
    return [to_out(cb, contact, now) for cb, contact in rows], total


def get_callback(db: Session, user: Employee, callback_id: int) -> Callback:
    callback = db.get(Callback, callback_id)
    if callback is None:
        raise NotFound("Callback not found.")
    visible = visible_employee_ids(db, user)
    if visible is not None and callback.employee_id not in visible:
        raise NotFound("Callback not found.")
    return callback


def create_callback(db: Session, *, user: Employee, data: CallbackCreate) -> CallbackOut:
    contact = contact_service.get_visible_contact(db, user, data.contact_id)
    if contact.status == "do_not_contact":
        raise Conflict("This contact is marked Do Not Contact.", code="contact_do_not_contact")
    validate_schedule(data.scheduled_at)
    callback = schedule(
        db,
        employee_id=user.id,
        contact=contact,
        when=data.scheduled_at,
        note=data.note,
        client_ref=data.client_ref,
    )
    db.commit()
    return to_out(callback, contact)


def update_callback(db: Session, *, user: Employee, callback: Callback, data: CallbackUpdate) -> CallbackOut:
    if callback.employee_id != user.id and not is_admin(user):
        raise NotFound("Callback not found.")
    contact = db.get(Contact, callback.contact_id)
    if callback.status != CALLBACK_PENDING and (data.scheduled_at is not None):
        raise Conflict("Only pending callbacks can be rescheduled.", code="callback_not_pending")

    if data.note is not None:
        callback.note = data.note or None
    if data.scheduled_at is not None:
        validate_schedule(data.scheduled_at)
        callback.scheduled_at = data.scheduled_at
        if contact is not None:
            contact.next_eligible_at = data.scheduled_at
    if data.status in (CALLBACK_DONE, CALLBACK_CANCELLED) and callback.status == CALLBACK_PENDING:
        callback.status = data.status
        callback.completed_at = utcnow()
        if contact is not None:
            remaining = db.scalar(
                select(func.count(Callback.id)).where(
                    Callback.contact_id == contact.id, Callback.status == CALLBACK_PENDING, Callback.id != callback.id
                )
            )
            if not remaining and contact.status in (CONTACT_CALLBACK, CONTACT_FOLLOW_UP):
                contact.status = CONTACT_IN_PROGRESS
                contact.next_eligible_at = None
    db.commit()
    return to_out(callback, contact)
