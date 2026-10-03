"""Contact master data: CRUD, scoped search, notes and the detail view."""

from __future__ import annotations

from typing import Any

from fastapi import Request
from sqlalchemy import Select, and_, exists, func, select, update
from sqlalchemy.orm import Session

from app.core import cache
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.timeutils import utcnow
from app.models.call import Call, CallNote, Callback, CALLBACK_CANCELLED, CALLBACK_PENDING
from app.models.contact import (
    CONTACT_DNC,
    CONTACT_NEW,
    Campaign,
    CampaignContact,
    Contact,
    ContactAssignment,
    ContactPhone,
)
from app.models.cache_events import EVERYONE
from app.models.employee import Employee
from app.schemas.contact import (
    CampaignRef,
    ContactCreate,
    ContactOut,
    ContactUpdate,
    NoteIn,
    NoteOut,
    PersonRef,
)
from app.services import audit_service, contact_numbers
from app.services.import_rows import person_key
from app.services.phone import digits_only, normalize_phone
from app.services.scope import is_admin, visible_employee_ids

SORTS = {"name", "recent", "priority", "last_called"}


# ------------------------------------------------------------------ helpers
def build_search_text(
    *,
    name: str,
    phone_raw: str,
    normalized_phone: str,
    email: str | None,
    location: str | None,
    category: str | None,
    tags: list[str],
    custom_fields: dict[str, Any],
    numbers: list[str] | None = None,
    relative_name: str | None = None,
    epic_no: str | None = None,
    pincode: str | None = None,
    address: str | None = None,
) -> str:
    """The words a search looks in: every number of the person (first, so a long address can never push one out), the name, the
    relative, the voter card number, the pincode, the address, and the rest."""
    parts: list[str] = [phone_raw, normalized_phone, digits_only(normalized_phone)]
    for extra in numbers or []:
        if extra != normalized_phone:
            parts += [extra, digits_only(extra)]
    parts += [name]
    parts += [p for p in (relative_name, epic_no, pincode, (address or "")[:600], email, location, category) if p]
    parts += tags
    parts += [str(v) for v in custom_fields.values() if v not in (None, "")]
    return " ".join(parts).lower()[:4000]


def refresh_person_key(contact: Contact) -> None:
    """Who this contact is, so a later sheet with another number of the same person finds them."""
    contact.person_key = person_key(
        {
            "name": contact.name, "relative_name": contact.relative_name, "age": contact.age, "gender": contact.gender,
            "pincode": contact.pincode, "address": contact.address, "epic_no": contact.epic_no,
        }
    )


def refresh_search_text(contact: Contact, numbers: list[str] | None = None) -> None:
    contact.search_text = build_search_text(
        name=contact.name,
        phone_raw=contact.phone_raw,
        normalized_phone=contact.normalized_phone,
        email=contact.email,
        location=contact.location,
        category=contact.category,
        tags=list(contact.tags or []),
        custom_fields=dict(contact.custom_fields or {}),
        numbers=numbers,
        relative_name=contact.relative_name,
        epic_no=contact.epic_no,
        pincode=contact.pincode,
        address=contact.address,
    )


def escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def scoped_contacts(db: Session, user: Employee) -> Select:
    """SELECT of non-deleted contacts that `user` is allowed to see."""
    stmt = select(Contact).where(Contact.deleted_at.is_(None))
    visible = visible_employee_ids(db, user)
    if visible is not None:
        stmt = stmt.where(
            exists().where(
                and_(
                    ContactAssignment.contact_id == Contact.id,
                    ContactAssignment.status == "active",
                    ContactAssignment.employee_id.in_(visible),
                )
            )
        )
    return stmt


def get_visible_contact(db: Session, user: Employee, contact_id: int) -> Contact:
    """Fetch a contact or raise 404 (never 403: do not reveal whether the ID exists)."""
    contact = db.scalars(scoped_contacts(db, user).where(Contact.id == contact_id)).first()
    if contact is None:
        raise NotFound("Contact not found.")
    return contact


def get_contact_any(db: Session, contact_id: int) -> Contact:
    contact = db.get(Contact, contact_id)
    if contact is None or contact.deleted_at is not None:
        raise NotFound("Contact not found.")
    return contact


def active_assignment(db: Session, contact_id: int) -> ContactAssignment | None:
    return db.scalars(
        select(ContactAssignment).where(ContactAssignment.contact_id == contact_id, ContactAssignment.status == "active")
    ).first()


# --------------------------------------------------------------------- list
def list_contacts(
    db: Session,
    user: Employee,
    *,
    q: str | None = None,
    status: str | None = None,
    category: str | None = None,
    priority: int | None = None,
    tag: str | None = None,
    campaign_id: int | None = None,
    employee_id: int | None = None,
    unassigned: bool | None = None,
    sort: str = "name",
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[Contact], int]:
    stmt = scoped_contacts(db, user)

    if employee_id is not None:
        stmt = stmt.where(
            exists().where(
                and_(
                    ContactAssignment.contact_id == Contact.id,
                    ContactAssignment.status == "active",
                    ContactAssignment.employee_id == employee_id,
                )
            )
        )
    if unassigned is True and is_admin(user):
        stmt = stmt.where(~exists().where(and_(ContactAssignment.contact_id == Contact.id, ContactAssignment.status == "active")))
    if status:
        stmt = stmt.where(Contact.status == status)
    if category:
        stmt = stmt.where(func.lower(Contact.category) == category.lower())
    if priority:
        stmt = stmt.where(Contact.priority == priority)
    if tag:
        stmt = stmt.where(Contact.search_text.like(f"%{escape_like(tag.lower())}%", escape="\\"))
    if campaign_id is not None:
        stmt = stmt.where(exists().where(and_(CampaignContact.contact_id == Contact.id, CampaignContact.campaign_id == campaign_id)))

    if q:
        # A number written in full is found through the unique index on the phone number: one row however many contacts there are
        # (the words of a search are matched inside every contact's text, which reads them all).
        exact = normalize_phone(q) if page == 1 and len(digits_only(q)) >= 10 else None
        if exact is not None:  # (any of the person's numbers: the unique index of contact_phones)
            found = list(db.scalars(stmt.where(Contact.id.in_(select(ContactPhone.contact_id).where(ContactPhone.normalized_phone == exact))).limit(page_size)).all())
            if found:
                return found, len(found)
        for token in q.strip().lower().split()[:5]:
            stmt = stmt.where(Contact.search_text.like(f"%{escape_like(token)}%", escape="\\"))

    total = _count(db, user, stmt, key=(q, status, category, priority, tag, campaign_id, employee_id, unassigned))

    if sort == "recent":
        order = (Contact.created_at.desc(), Contact.id.desc())  # (the first entries of an index, read backwards)
    elif sort == "priority":
        order = (Contact.priority, Contact.name, Contact.id)
    elif sort == "last_called":
        order = (Contact.last_called_at.is_(None).desc(), Contact.last_called_at.asc(), Contact.id)
    else:
        # MySQL compares text without regard to case (its collation), so the index on the name gives the order; SQLite does not
        order = (Contact.name if db.get_bind().dialect.name == "mysql" else func.lower(Contact.name), Contact.id)
    rows = db.scalars(stmt.order_by(*order).limit(page_size).offset((page - 1) * page_size)).all()
    return list(rows), total


# a count of a few thousand rows is nothing; of a million it is a second or more - and the same question is asked again for every page
_BIG_COUNT = 20_000
_COUNT_SECONDS = 60


def _count(db: Session, user: Employee, stmt: Select, *, key: tuple) -> int:
    """How many contacts match. Exact always; once the answer is big it is remembered for a minute (and forgotten when any contact
    or assignment changes), so paging through a long list does not count it again for every page."""
    visible = visible_employee_ids(db, user)
    name = "contacts:total:" + cache.digest(None if visible is None else sorted(visible), *key)
    cached = cache.stamped_get(name, EVERYONE)
    if isinstance(cached, int):
        return cached
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    if total >= _BIG_COUNT:
        cache.stamped_set(name, total, _COUNT_SECONDS, EVERYONE)
    return total


# ------------------------------------------------------------------- detail
def build_contact_out(db: Session, contact: Contact) -> ContactOut:
    out = ContactOut.model_validate(contact)
    numbered = contact_numbers.brief_many(db, [contact])[0]
    out.phones, out.phone_count, out.call_phone = numbered.phones, numbered.phone_count, numbered.call_phone
    assignment = active_assignment(db, contact.id)
    if assignment:
        owner = db.get(Employee, assignment.employee_id)
        if owner:
            out.assigned_to = PersonRef(id=owner.id, name=owner.full_name, code=owner.employee_code)
    rows = db.execute(
        select(Campaign.id, Campaign.name)
        .join(CampaignContact, CampaignContact.campaign_id == Campaign.id)
        .where(CampaignContact.contact_id == contact.id)
        .order_by(Campaign.name)
    ).all()
    out.campaigns = [CampaignRef(id=r[0], name=r[1]) for r in rows]
    return out


# ------------------------------------------------------------------- create
def create_contact(db: Session, *, data: ContactCreate, actor: Employee, request: Request) -> Contact:
    normalized = normalize_phone(data.phone)
    if normalized is None:
        raise ValidationFailed("Enter a valid mobile number.", code="invalid_phone", details=[{"field": "phone", "message": "Invalid phone number"}])
    numbers = contact_numbers.clean_numbers([data.phone, *data.more_phones])

    existing = db.scalars(select(Contact).where(Contact.normalized_phone == normalized)).first()
    if existing is not None and existing.deleted_at is None:
        raise Conflict(
            "A contact with this phone number already exists.",
            code="duplicate_phone",
            details={"contact_id": existing.id, "name": existing.name},
        )
    contact_numbers.refuse_numbers_of_others(db, existing.id if existing is not None else None, numbers)  # (any of the numbers may be somebody's)

    if data.campaign_id is not None and db.get(Campaign, data.campaign_id) is None:
        raise ValidationFailed("Campaign does not exist.", code="unknown_campaign")

    contact = existing or Contact(normalized_phone=normalized)
    contact.name = data.name
    contact.phone_raw = data.phone.strip()
    contact.relative_name = data.relative_name or None
    contact.age = data.age
    contact.gender = data.gender
    contact.epic_no = data.epic_no.strip().upper() if data.epic_no and data.epic_no.strip() else None
    contact.pincode = data.pincode.strip() if data.pincode and data.pincode.strip() else None
    contact.address = data.address.strip() if data.address and data.address.strip() else None
    contact.email = data.email
    contact.location = data.location
    contact.category = data.category
    contact.priority = data.priority
    contact.tags = data.tags
    contact.custom_fields = data.custom_fields
    contact.source = "manual"
    contact.created_by = actor.id
    if existing is not None:  # restoring a previously deleted contact
        contact.deleted_at = None
        contact.status = CONTACT_NEW
        contact.failed_attempts = 0
        contact.next_eligible_at = None
    refresh_search_text(contact, [n for n, _ in numbers])
    refresh_person_key(contact)
    db.add(contact)
    db.flush()  # (a new contact gets its first number here)
    if existing is not None:
        contact_numbers.set_numbers(db, contact, [raw for _, raw in numbers])
    else:
        contact_numbers.add_numbers(db, contact, [raw for _, raw in numbers[1:]])

    if data.campaign_id is not None:
        db.add(CampaignContact(campaign_id=data.campaign_id, contact_id=contact.id))
    audit_service.record(
        db, action="contact.create", actor=actor, entity_type="contact", entity_id=contact.id, request=request,
        details={"restored": existing is not None},
    )
    db.commit()

    if data.assign_to_employee_id is not None:
        from app.services import assignment_service  # local import avoids a cycle

        assignment_service.assign_single(
            db, contact_id=contact.id, employee_id=data.assign_to_employee_id, campaign_id=data.campaign_id, actor=actor, request=request
        )
    return contact


def update_contact(db: Session, *, contact: Contact, data: ContactUpdate, actor: Employee, request: Request) -> Contact:
    changes: dict[str, Any] = {}
    fields = data.model_fields_set

    if "phones" in fields and data.phones is not None:  # every number of the person, the main one first
        changes["phones"] = contact_numbers.set_numbers(db, contact, data.phones)
    elif "phone" in fields and data.phone is not None:  # only the main number changes; the others stay
        normalized = normalize_phone(data.phone)
        if normalized is None:
            raise ValidationFailed("Enter a valid mobile number.", code="invalid_phone", details=[{"field": "phone", "message": "Invalid phone number"}])
        if normalized != contact.normalized_phone:
            others = [n for n in contact_numbers.all_numbers(db, contact.id)[1:] if n != normalized]
            contact_numbers.set_numbers(db, contact, [data.phone, *others])
            changes["phone"] = normalized
        else:
            contact.phone_raw = data.phone.strip()
            db.execute(update(ContactPhone).where(ContactPhone.contact_id == contact.id, ContactPhone.position == 0).values(phone_raw=data.phone.strip()[:64]))
    for field in ("name", "email", "location", "category", "priority", "tags", "custom_fields", "relative_name", "age", "gender", "epic_no", "pincode", "address"):
        if field in fields:
            value = getattr(data, field)
            if field == "name" and value is None:
                continue
            if field in ("tags", "custom_fields") and value is None:
                value = [] if field == "tags" else {}
            if field in ("relative_name", "epic_no", "pincode", "address") and isinstance(value, str):
                value = value.strip() or None
                if field == "epic_no" and value:
                    value = value.upper()
            setattr(contact, field, value)
            changes[field] = value if field not in ("custom_fields", "address") else "updated"
    if "status" in fields and data.status is not None and data.status != contact.status:
        contact.status = data.status
        if data.status in ("new", "in_progress"):
            contact.failed_attempts = 0
            contact.next_eligible_at = None
        changes["status"] = data.status

    db.flush()
    refresh_search_text(contact, contact_numbers.all_numbers(db, contact.id))
    refresh_person_key(contact)
    audit_service.record(db, action="contact.update", actor=actor, entity_type="contact", entity_id=contact.id, request=request, details=changes)
    db.commit()
    return contact


def delete_contact(db: Session, *, contact: Contact, actor: Employee, request: Request) -> None:
    now = utcnow()
    db.execute(
        update(ContactAssignment)
        .where(ContactAssignment.contact_id == contact.id, ContactAssignment.status == "active")
        .values(status="released", active_contact_id=None, released_at=now)
    )
    db.execute(
        update(Callback)
        .where(Callback.contact_id == contact.id, Callback.status == CALLBACK_PENDING)
        .values(status=CALLBACK_CANCELLED, completed_at=now)
    )
    contact.deleted_at = now
    audit_service.record(db, action="contact.delete", actor=actor, entity_type="contact", entity_id=contact.id, request=request)
    db.commit()


# -------------------------------------------------------------------- notes
def _note_out(note: CallNote, author_name: str | None) -> NoteOut:
    out = NoteOut.model_validate(note)
    out.author_name = author_name
    return out


def add_note(db: Session, *, user: Employee, contact: Contact, data: NoteIn) -> NoteOut:
    if data.client_ref:
        existing = db.scalars(select(CallNote).where(CallNote.author_id == user.id, CallNote.client_ref == data.client_ref)).first()
        if existing:
            return _note_out(existing, user.full_name)
    call_id = None
    if data.call_id is not None:
        call = db.get(Call, data.call_id)
        if call is None or (call.employee_id != user.id and not is_admin(user)):
            raise NotFound("Call not found.")
        call_id = call.id
    note = CallNote(call_id=call_id, contact_id=contact.id, author_id=user.id, body=data.body, client_ref=data.client_ref)
    db.add(note)
    db.commit()
    return _note_out(note, user.full_name)


def list_notes(db: Session, *, contact: Contact, page: int, page_size: int) -> tuple[list[NoteOut], int]:
    base = select(CallNote).where(CallNote.contact_id == contact.id)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.execute(
        select(CallNote, Employee.full_name)
        .join(Employee, Employee.id == CallNote.author_id)
        .where(CallNote.contact_id == contact.id)
        .order_by(CallNote.created_at.desc(), CallNote.id.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).all()
    return [_note_out(n, name) for n, name in rows], total


def is_callable(contact: Contact) -> bool:
    return contact.status != CONTACT_DNC and contact.deleted_at is None
