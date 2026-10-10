"""How much calling work each employee has in front of them (used to even the work out, and to take it back from people who left it)."""

from __future__ import annotations

from collections.abc import Iterable, Sequence

from sqlalchemy import and_, exists, func, select
from sqlalchemy.orm import Session
from sqlalchemy.sql import Select

from app.models.call import CALLBACK_PENDING, Callback
from app.models.contact import Contact, ContactAssignment

# contacts that still need a call from their owner (the ones who answered, were rejected or are finished do not)
PENDING_STATUSES = ("new", "in_progress", "callback", "follow_up")
# contacts that can be given to somebody else without losing anything the owner has promised (a callback or follow-up is personal)
MOVABLE_STATUSES = ("new", "in_progress")
# contacts nobody has started on: the ones that are shared out again when somebody new arrives (level_service) - a contact that was
# already called once ("in progress") stays with the person who called it
WAITING_STATUSES = ("new",)
_CHUNK = 200


def _chunks(items: Sequence[int]) -> Iterable[Sequence[int]]:
    for start in range(0, len(items), _CHUNK):
        yield items[start : start + _CHUNK]


def pending_counts(db: Session, employee_ids: Sequence[int]) -> dict[int, int]:
    """Contacts each person still has to call. Joins the contacts, so it reads every contact of these people: ask for the few
    people it is needed for, not for the whole organisation."""
    counts = {employee_id: 0 for employee_id in employee_ids}
    for chunk in _chunks(list(employee_ids)):
        for employee_id, count in db.execute(
            select(ContactAssignment.employee_id, func.count(ContactAssignment.id))
            .join(Contact, Contact.id == ContactAssignment.contact_id)
            .where(
                ContactAssignment.status == "active",
                ContactAssignment.employee_id.in_(chunk),
                Contact.deleted_at.is_(None),
                Contact.status.in_(PENDING_STATUSES),
            )
            .group_by(ContactAssignment.employee_id)
        ):
            counts[employee_id] = int(count)
    return counts


def movable_condition(employee_ids: Sequence[int], statuses: Sequence[str] = MOVABLE_STATUSES):
    """The contacts of these people that can be given to somebody else: not worked on any further than `statuses` ("new" or "in
    progress" unless asked otherwise), and no callback promised to the owner."""
    promised = exists().where(
        and_(
            Callback.contact_id == ContactAssignment.contact_id,
            Callback.employee_id == ContactAssignment.employee_id,
            Callback.status == CALLBACK_PENDING,
        )
    )
    return and_(
        ContactAssignment.status == "active",
        ContactAssignment.employee_id.in_(list(employee_ids)),
        Contact.deleted_at.is_(None),
        Contact.status.in_(list(statuses)),
        ~promised,
    )


def movable_counts(db: Session, employee_ids: Sequence[int], statuses: Sequence[str] = MOVABLE_STATUSES) -> dict[int, int]:
    counts = {employee_id: 0 for employee_id in employee_ids}
    for chunk in _chunks(list(employee_ids)):
        for employee_id, count in db.execute(
            select(ContactAssignment.employee_id, func.count(ContactAssignment.id))
            .join(Contact, Contact.id == ContactAssignment.contact_id)
            .where(movable_condition(chunk, statuses))
            .group_by(ContactAssignment.employee_id)
        ):
            counts[employee_id] = int(count)
    return counts


def waiting_counts(db: Session, employee_ids: Sequence[int]) -> dict[int, int]:
    """Contacts each person was given and has not started on (nobody has called them)."""
    return movable_counts(db, employee_ids, WAITING_STATUSES)


def waiting_page(employee_id: int, before_id: int | None, limit: int) -> Select:
    """The next page of the not-yet-started contacts of ONE person, newest assignment first (so what they would call next stays with
    them): a cursor that cannot skip or repeat."""
    stmt = (
        select(ContactAssignment.id, ContactAssignment.contact_id, ContactAssignment.employee_id, ContactAssignment.campaign_id)
        .join(Contact, Contact.id == ContactAssignment.contact_id)
        .where(movable_condition([employee_id], WAITING_STATUSES))
    )
    if before_id is not None:
        stmt = stmt.where(ContactAssignment.id < before_id)
    return stmt.order_by(ContactAssignment.id.desc()).limit(limit)


def movable_page(employee_ids: Sequence[int], after_id: int, limit: int) -> Select:
    """The next page of movable assignments of these people, in the order of their ids (a cursor that cannot skip or repeat)."""
    return (
        select(ContactAssignment.id, ContactAssignment.contact_id, ContactAssignment.employee_id, ContactAssignment.campaign_id)
        .join(Contact, Contact.id == ContactAssignment.contact_id)
        .where(movable_condition(employee_ids), ContactAssignment.id > after_id)
        .order_by(ContactAssignment.id)
        .limit(limit)
    )
