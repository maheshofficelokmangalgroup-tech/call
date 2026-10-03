"""The numbers of a contact. A contact is a person and a person can have many numbers; a number belongs to ONE person.

* every number is a row of `contact_phones` (the first one, position 0, is also on the contact itself: `normalized_phone`)
* the unique index on `contact_phones.normalized_phone` is the last word - no number can be in two contacts
* what happened on each number (calls, answered, "invalid number") comes from the calls, so the employee can see which numbers were
  tried, and the app knows which one to dial next
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import case, delete, func, select
from sqlalchemy.orm import Session

from app.core.dbutil import insert_ignore
from app.core.errors import Conflict, ValidationFailed
from app.models.call import CALL_ANSWERED_STATUSES, Call, CallDisposition
from app.models.contact import Contact, ContactPhone
from app.schemas.contact import ContactBrief, PhoneOut
from app.services.phone import normalize_phone

MAX_NUMBERS = 20  # numbers of one person
ANSWERED = sorted(CALL_ANSWERED_STATUSES)
INVALID_CODE = "INVALID_NUMBER"


@dataclass
class NumberStat:
    calls: int = 0
    answered: int = 0
    invalid: bool = False
    last_called_at: datetime | None = None
    last_answered_at: datetime | None = None


# ---------------------------------------------------------------------------------------------------------- reading
def numbers_of(db: Session, contact_ids: Sequence[int]) -> dict[int, list[ContactPhone]]:
    """{contact id: its numbers in order} - one query."""
    found: dict[int, list[ContactPhone]] = defaultdict(list)
    if not contact_ids:
        return found
    for row in db.scalars(select(ContactPhone).where(ContactPhone.contact_id.in_(list(contact_ids))).order_by(ContactPhone.contact_id, ContactPhone.position, ContactPhone.id)):
        found[row.contact_id].append(row)
    return found


def stats_of(db: Session, contact_ids: Sequence[int]) -> dict[tuple[int, str], NumberStat]:
    """What happened on every number of these contacts: {(contact id, number): stat} - one query over the calls of the contacts."""
    stats: dict[tuple[int, str], NumberStat] = {}
    if not contact_ids:
        return stats
    invalid_ids = select(CallDisposition.id).where(CallDisposition.code == INVALID_CODE).scalar_subquery()
    answered = Call.status.in_(ANSWERED)
    for contact_id, phone, calls, ok, bad, last, last_ok in db.execute(
        select(
            Call.contact_id,
            Call.phone_number_snapshot,
            func.count(Call.id),
            func.coalesce(func.sum(case((answered, 1), else_=0)), 0),
            func.coalesce(func.sum(case((Call.disposition_id == invalid_ids, 1), else_=0)), 0),
            func.max(Call.started_at),
            func.max(case((answered, Call.started_at))),
        )
        .where(Call.contact_id.in_(list(contact_ids)))
        .group_by(Call.contact_id, Call.phone_number_snapshot)
    ):
        stats[(contact_id, phone)] = NumberStat(int(calls), int(ok), bool(bad), last, last_ok)
    return stats


def pick_call_phone(rows: Sequence[tuple[str, int, NumberStat]]) -> str | None:
    """Which number to dial: the one that was answered last time; else the one tried the fewest times (so the numbers take turns),
    the first of the person before the others. A number that was reported as not valid is left out unless nothing else is left."""
    if not rows:
        return None
    usable = [r for r in rows if not r[2].invalid] or list(rows)
    answered = [r for r in usable if r[2].answered > 0]
    if answered:
        return max(answered, key=lambda r: (r[2].last_answered_at or datetime.min.replace(tzinfo=None), -r[1]))[0]
    return min(usable, key=lambda r: (r[2].calls, r[1]))[0]


def brief_many(db: Session, contacts: Iterable[Contact]) -> list[ContactBrief]:
    """The contacts as the API shows them, each with all its numbers, what happened on each, and the one to dial."""
    listed = list(contacts)
    ids = [c.id for c in listed]
    numbers = numbers_of(db, ids)
    stats = stats_of(db, ids)
    result: list[ContactBrief] = []
    for contact in listed:
        brief = ContactBrief.model_validate(contact)
        rows = numbers.get(contact.id) or []
        if not rows:  # (a contact the table does not know yet: it still has its own number)
            rows = [ContactPhone(contact_id=contact.id, phone_raw=contact.phone_raw, normalized_phone=contact.normalized_phone, position=0)]
        brief.phones = [
            PhoneOut(
                phone=r.normalized_phone, phone_raw=r.phone_raw, position=r.position, primary=i == 0,
                calls=(s := stats.get((contact.id, r.normalized_phone), NumberStat())).calls, answered=s.answered, invalid=s.invalid,
                last_called_at=s.last_called_at, last_answered_at=s.last_answered_at,
            )
            for i, r in enumerate(rows)
        ]
        brief.phone_count = len(rows)
        brief.call_phone = pick_call_phone([(r.normalized_phone, r.position, stats.get((contact.id, r.normalized_phone), NumberStat())) for r in rows])
        result.append(brief)
    return result


def has_other_usable_number(db: Session, contact_id: int, this_number: str) -> bool:
    """Does the person have another number that nobody has reported as not valid? (Then one wrong number does not end the person.)"""
    stats = stats_of(db, [contact_id])
    for number in all_numbers(db, contact_id):
        if number != this_number and not stats.get((contact_id, number), NumberStat()).invalid:
            return True
    return False


def owner_of(db: Session, normalized: str) -> tuple[int, bool] | None:
    """(contact id, the contact was deleted) of whoever has this number."""
    row = db.execute(
        select(ContactPhone.contact_id, Contact.deleted_at).join(Contact, Contact.id == ContactPhone.contact_id).where(ContactPhone.normalized_phone == normalized)
    ).first()
    return (row[0], row[1] is not None) if row else None


def all_numbers(db: Session, contact_id: int) -> list[str]:
    return [p for p in db.scalars(select(ContactPhone.normalized_phone).where(ContactPhone.contact_id == contact_id).order_by(ContactPhone.position, ContactPhone.id))]


# ---------------------------------------------------------------------------------------------------------- writing
def clean_numbers(numbers: Iterable[str]) -> list[tuple[str, str]]:
    """[(normalized, as written)] in the order given, each number once. A number that is not valid is refused, naming it."""
    seen: set[str] = set()
    cleaned: list[tuple[str, str]] = []
    for raw in numbers:
        text = (raw or "").strip()
        if not text:
            continue
        normalized = normalize_phone(text)
        if normalized is None:
            raise ValidationFailed(f"'{text[:32]}' is not a valid mobile number.", code="invalid_phone", details=[{"field": "phones", "message": f"Invalid number {text[:32]}"}])
        if normalized not in seen:
            seen.add(normalized)
            cleaned.append((normalized, text[:64]))
    if len(cleaned) > MAX_NUMBERS:
        raise ValidationFailed(f"A person can have at most {MAX_NUMBERS} numbers.", code="too_many_numbers")
    return cleaned


def refuse_numbers_of_others(db: Session, contact_id: int | None, cleaned: list[tuple[str, str]]) -> None:
    if not cleaned:
        return
    rows = db.execute(
        select(ContactPhone.normalized_phone, ContactPhone.contact_id, Contact.name, Contact.deleted_at)
        .join(Contact, Contact.id == ContactPhone.contact_id)
        .where(ContactPhone.normalized_phone.in_([n for n, _ in cleaned]))
    ).all()
    for phone, owner_id, owner_name, deleted_at in rows:
        if owner_id != contact_id:
            where = "a contact that was deleted" if deleted_at is not None else f"the contact {owner_name}"
            raise Conflict(f"The number {phone} already belongs to {where}.", code="duplicate_phone", details={"contact_id": owner_id, "name": owner_name, "phone": phone})


def set_numbers(db: Session, contact: Contact, numbers: Iterable[str]) -> list[str]:
    """The numbers of the contact become exactly these (the first one is the main number). Returns the normalized numbers."""
    cleaned = clean_numbers(numbers)
    if not cleaned:
        raise ValidationFailed("A contact needs at least one number.", code="phone_required", details=[{"field": "phones", "message": "At least one number"}])
    refuse_numbers_of_others(db, contact.id, cleaned)
    existing = {p.normalized_phone: p for p in db.scalars(select(ContactPhone).where(ContactPhone.contact_id == contact.id))}
    wanted = {n for n, _ in cleaned}
    for phone, row in existing.items():
        if phone not in wanted:
            db.delete(row)
    db.flush()
    for position, (normalized, raw) in enumerate(cleaned):
        row = existing.get(normalized)
        if row is None:
            db.add(ContactPhone(contact_id=contact.id, phone_raw=raw, normalized_phone=normalized, position=position))
        else:
            row.position = position
            row.phone_raw = raw
    contact.normalized_phone, contact.phone_raw = cleaned[0]
    db.flush()
    return [n for n, _ in cleaned]


def add_numbers(db: Session, contact: Contact, numbers: Iterable[str]) -> list[str]:
    """Give the contact these numbers as well (the ones it has already are left as they are). Returns the numbers that were added."""
    cleaned = clean_numbers(numbers)
    refuse_numbers_of_others(db, contact.id, cleaned)
    have = {p.normalized_phone for p in db.scalars(select(ContactPhone).where(ContactPhone.contact_id == contact.id))}
    fresh = [(n, raw) for n, raw in cleaned if n not in have]
    if len(have) + len(fresh) > MAX_NUMBERS:
        raise ValidationFailed(f"A person can have at most {MAX_NUMBERS} numbers.", code="too_many_numbers")
    start = len(have)
    for offset, (normalized, raw) in enumerate(fresh):
        db.add(ContactPhone(contact_id=contact.id, phone_raw=raw, normalized_phone=normalized, position=start + offset))
    db.flush()
    return [n for n, _ in fresh]


# ---------------------------------------------------------------------------------- what the import does in bulk (core SQL)
def insert_numbers(db: Session, rows: list[dict]) -> None:
    """Many numbers at once, 'leave out the ones that are there': the unique index decides, so a number can never be in two contacts."""
    if rows:
        insert_ignore(db, ContactPhone.__table__, rows, conflict_column="normalized_phone")


def numbers_owned_by(db: Session, contact_ids: Sequence[int]) -> dict[str, int]:
    """{number: contact id} of the numbers these contacts have."""
    if not contact_ids:
        return {}
    return {phone: cid for phone, cid in db.execute(select(ContactPhone.normalized_phone, ContactPhone.contact_id).where(ContactPhone.contact_id.in_(list(contact_ids))))}


def forget_numbers(db: Session, contact_ids: Sequence[int]) -> None:
    if contact_ids:
        db.execute(delete(ContactPhone).where(ContactPhone.contact_id.in_(list(contact_ids))))
