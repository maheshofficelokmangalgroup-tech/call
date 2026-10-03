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


def movable_condition(employee_ids: Sequence[int]):
    """The contacts of these people that can be given to somebody else: not worked on any further than "new" or "in progress", and
    no callback promised to the owner."""
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
        Contact.status.in_(MOVABLE_STATUSES),
        ~promised,
    )


def movable_counts(db: Session, employee_ids: Sequence[int]) -> dict[int, int]:
    counts = {employee_id: 0 for employee_id in employee_ids}
    for chunk in _chunks(list(employee_ids)):
        for employee_id, count in db.execute(
            select(ContactAssignment.employee_id, func.count(ContactAssignment.id))
            .join(Contact, Contact.id == ContactAssignment.contact_id)
            .where(movable_condition(chunk))
            .group_by(ContactAssignment.employee_id)
        ):
            counts[employee_id] = int(count)
    return counts


def movable_page(employee_ids: Sequence[int], after_id: int, limit: int) -> Select:
    """The next page of movable assignments of these people, in the order of their ids (a cursor that cannot skip or repeat)."""
    return (
        select(ContactAssignment.id, ContactAssignment.contact_id, ContactAssignment.employee_id, ContactAssignment.campaign_id)
        .join(Contact, Contact.id == ContactAssignment.contact_id)
        .where(movable_condition(employee_ids), ContactAssignment.id > after_id)
        .order_by(ContactAssignment.id)
        .limit(limit)
    )
