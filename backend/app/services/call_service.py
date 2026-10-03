"""Call lifecycle: idempotent creation, device sync, lifecycle events and outcome (disposition) rules."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from app.core.timeutils import ensure_aware, next_business_day_start, utcnow
from app.models.call import (
    CALL_COMPLETED,
    CALL_CONNECTED,
    CALL_DIALING,
    CALL_FAILED,
    CALL_INITIATED,
    CALL_NO_ANSWER,
    CALL_RINGING,
    Call,
    CallDisposition,
    CallEvent,
    CallNote,
    Callback,
    CALLBACK_PENDING,
)
from app.models.contact import (
    CONTACT_CALLBACK,
    CONTACT_COMPLETED,
    CONTACT_DNC,
    CONTACT_FOLLOW_UP,
    CONTACT_IN_PROGRESS,
    CONTACT_INTERESTED,
    CONTACT_INVALID,
    CONTACT_NOT_INTERESTED,
    CONTACT_UNREACHABLE,
    CampaignContact,
    Contact,
    ContactPhone,
)
from app.models.employee import Employee
from app.models.recording import Recording
from app.schemas.call import (
    CallCreate,
    CallEventIn,
    CallEventOut,
    CallOut,
    CallUpdate,
    DispositionIn,
    DispositionRef,
    RecordingOut,
)
from app.schemas.contact import NoteOut
from app.services import callback_service, contact_numbers, contact_service
from app.services.phone import normalize_phone
from app.services.scope import is_admin, visible_employee_ids
from app.services.settings_service import get_retry_rules

STATUS_RANK = {
    CALL_INITIATED: 0,
    CALL_DIALING: 1,
    CALL_RINGING: 2,
    CALL_CONNECTED: 3,
    CALL_COMPLETED: 4,
    CALL_NO_ANSWER: 4,
    CALL_FAILED: 4,
}
TERMINAL = {CALL_COMPLETED, CALL_NO_ANSWER, CALL_FAILED}
MAX_OFFLINE_AGE = timedelta(days=14)
CLOCK_SKEW = timedelta(minutes=10)

# What each outcome does to the contact. `rule` refers to the admin-configurable retry rules.
EFFECTS: dict[str, dict[str, Any]] = {
    "CONNECTED": {"status": CONTACT_IN_PROGRESS, "success": True, "cooldown": "next_day"},
    "NO_ANSWER": {"status": CONTACT_IN_PROGRESS, "failure": True, "rule": "NO_ANSWER"},
    "BUSY": {"status": CONTACT_IN_PROGRESS, "failure": True, "rule": "BUSY"},
    "SWITCHED_OFF": {"status": CONTACT_IN_PROGRESS, "failure": True, "rule": "SWITCHED_OFF"},
    "INVALID_NUMBER": {"status": CONTACT_INVALID},
    "INTERESTED": {"status": CONTACT_INTERESTED, "success": True},
    "NOT_INTERESTED": {"status": CONTACT_NOT_INTERESTED, "success": True},
    "CALLBACK": {"status": CONTACT_CALLBACK, "success": True, "callback": True},
    "FOLLOW_UP": {"status": CONTACT_FOLLOW_UP, "success": True, "callback": True},
    "COMPLETED": {"status": CONTACT_COMPLETED, "success": True},
    "DO_NOT_CONTACT": {"status": CONTACT_DNC},
}
CAMPAIGN_DONE_CONTACT_STATUSES = {
    CONTACT_COMPLETED,
    CONTACT_NOT_INTERESTED,
    CONTACT_INTERESTED,
    CONTACT_INVALID,
    CONTACT_UNREACHABLE,
    CONTACT_DNC,
}


# --------------------------------------------------------------------- access
def get_call_for(db: Session, user: Employee, call_id: int, *, owner_only: bool = False) -> Call:
    call = db.get(Call, call_id)
    if call is None:
        raise NotFound("Call not found.")
    if owner_only:
        if call.employee_id != user.id and not is_admin(user):
            raise NotFound("Call not found.")
        return call
    visible = visible_employee_ids(db, user)
    if visible is not None and call.employee_id not in visible:
        raise NotFound("Call not found.")
    return call


def get_disposition(db: Session, code: str) -> CallDisposition:
    disp = db.scalars(select(CallDisposition).where(CallDisposition.code == code.upper(), CallDisposition.is_active.is_(True))).first()
    if disp is None:
        raise ValidationFailed(f"Unknown outcome '{code}'.", code="unknown_disposition")
    return disp


def list_dispositions(db: Session) -> list[CallDisposition]:
    return list(db.scalars(select(CallDisposition).where(CallDisposition.is_active.is_(True)).order_by(CallDisposition.sort_order)))


# --------------------------------------------------------------------- create
def create_call(db: Session, *, employee: Employee, data: CallCreate, device_id: int | None) -> tuple[Call, bool]:
    """Returns (call, created). Replays of the same client_call_id return the original row."""
    existing = db.scalars(select(Call).where(Call.employee_id == employee.id, Call.client_call_id == data.client_call_id)).first()
    if existing is not None:
        return existing, False

    if not employee.is_active:
        raise Forbidden("Your account has been deactivated. Contact your administrator.", code="account_disabled")

    now = utcnow()
    if data.started_at > now + CLOCK_SKEW:
        raise ValidationFailed("The call start time is in the future. Check the phone's clock.", code="bad_started_at")
    if data.started_at < now - MAX_OFFLINE_AGE:
        raise ValidationFailed("The call is too old to be recorded.", code="bad_started_at")

    contact: Contact | None = None
    if data.contact_id is not None:
        contact = contact_service.get_visible_contact(db, employee, data.contact_id)
        number = contact.normalized_phone
        chosen = normalize_phone(data.phone_number) if data.phone_number else None
        if chosen and chosen != number and chosen in contact_numbers.all_numbers(db, contact.id):  # one of the person's other numbers
            number = chosen
    else:
        if not data.phone_number:
            raise ValidationFailed("Provide a contact or a phone number.", code="missing_number")
        number = normalize_phone(data.phone_number)
        if number is None:
            raise ValidationFailed("Enter a valid phone number.", code="invalid_phone")
        known = db.scalars(
            contact_service.scoped_contacts(db, employee).where(Contact.id.in_(select(ContactPhone.contact_id).where(ContactPhone.normalized_phone == number)))
        ).first()  # (any number of a contact of this employee)
        if known is not None:
            contact = known

    if contact is not None and contact.status == CONTACT_DNC:
        raise Conflict("This contact is marked Do Not Contact.", code="contact_do_not_contact")

    campaign_id = data.campaign_id
    if contact is not None and campaign_id is None:
        assignment = contact_service.active_assignment(db, contact.id)
        if assignment is not None:
            campaign_id = assignment.campaign_id

    if contact is not None:
        attempt = (db.scalar(select(func.count(Call.id)).where(Call.contact_id == contact.id)) or 0) + 1
    else:
        attempt = (db.scalar(select(func.count(Call.id)).where(Call.phone_number_snapshot == number)) or 0) + 1

    call = Call(
        employee_id=employee.id,
        contact_id=contact.id if contact else None,
        campaign_id=campaign_id,
        client_call_id=data.client_call_id,
        external_call_reference=data.external_call_reference,
        phone_number_snapshot=number,
        contact_name_snapshot=contact.name if contact else None,
        direction="outgoing",
        attempt_number=attempt,
        started_at=data.started_at,
        status=CALL_INITIATED,
        duration_seconds=0,
        device_id=device_id,
    )
    db.add(call)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        again = db.scalars(select(Call).where(Call.employee_id == employee.id, Call.client_call_id == data.client_call_id)).first()
        if again is not None:
            return again, False
        raise

    db.add(CallEvent(call_id=call.id, event_type="initiated", occurred_at=data.started_at, payload={"attempt": attempt}))
    if contact is not None:
        contact.call_count = (contact.call_count or 0) + 1
        contact.last_called_at = data.started_at
    db.commit()
    return call, True


# ------------------------------------------------------------- device updates
def _advance_status(call: Call, new_status: str) -> None:
    if call.disposition_id is not None:
        return  # the outcome has finalised the status
    current = STATUS_RANK.get(call.status, 0)
    target = STATUS_RANK.get(new_status, 0)
    if call.status in TERMINAL:
        # a late, more accurate device result (e.g. call log read) may flip between terminal states
        if new_status in TERMINAL:
            call.status = new_status
        return
    if target >= current:
        call.status = new_status


def _derive_end_state(call: Call) -> None:
    """When the call has ended, settle answered/duration/status from what the device reported."""
    if call.ended_at is None or call.disposition_id is not None or call.status == CALL_FAILED:
        return
    if call.duration_seconds > 0:
        if call.answered_at is None:
            call.answered_at = max(call.started_at, call.ended_at - timedelta(seconds=call.duration_seconds))
        call.status = CALL_COMPLETED
    elif call.answered_at is not None:
        call.duration_seconds = max(0, int((call.ended_at - call.answered_at).total_seconds()))
        call.status = CALL_COMPLETED if call.duration_seconds > 0 else CALL_NO_ANSWER
    else:
        call.status = CALL_NO_ANSWER


def update_call(db: Session, *, user: Employee, call: Call, data: CallUpdate) -> Call:
    if call.employee_id != user.id and not is_admin(user):
        raise NotFound("Call not found.")
    fields = data.model_fields_set
    lower = call.started_at - timedelta(minutes=1)

    if "external_call_reference" in fields and data.external_call_reference:
        call.external_call_reference = data.external_call_reference
    if data.answered_at is not None:
        if data.answered_at < lower:
            raise ValidationFailed("answered_at cannot be before the call started.", code="bad_timestamps")
        call.answered_at = data.answered_at
    if data.ended_at is not None:
        if data.ended_at < lower:
            raise ValidationFailed("ended_at cannot be before the call started.", code="bad_timestamps")
        call.ended_at = data.ended_at
    if data.duration_seconds is not None:
        limit = (call.ended_at - call.started_at).total_seconds() + 30 if call.ended_at else 6 * 3600
        if data.duration_seconds > limit:
            raise ValidationFailed("duration_seconds exceeds the call window.", code="bad_timestamps")
        call.duration_seconds = data.duration_seconds
    if data.status is not None:
        _advance_status(call, data.status)
        if data.status == CALL_FAILED and call.ended_at is None and call.disposition_id is None:
            call.ended_at = utcnow()
    if call.ended_at is not None and data.status in (None, CALL_COMPLETED, CALL_NO_ANSWER):
        _derive_end_state(call)
    db.commit()
    return call


def add_events(db: Session, *, user: Employee, call: Call, events: list[CallEventIn]) -> int:
    if call.employee_id != user.id and not is_admin(user):
        raise NotFound("Call not found.")
    added = 0
    # one query for what is already there (a call has a handful of events), instead of one per event; the set also catches the
    # same event twice in one batch, which the unique key would otherwise reject at the commit
    known = {(kind, ensure_aware(at)) for kind, at in db.execute(select(CallEvent.event_type, CallEvent.occurred_at).where(CallEvent.call_id == call.id))}
    for ev in sorted(events, key=lambda e: e.occurred_at):
        identity = (ev.event_type, ensure_aware(ev.occurred_at))
        if identity in known:
            continue
        known.add(identity)
        db.add(CallEvent(call_id=call.id, event_type=ev.event_type, occurred_at=ev.occurred_at, payload=ev.payload))
        added += 1
        if call.disposition_id is not None:
            continue
        if ev.event_type == "dialing":
            _advance_status(call, CALL_DIALING)
        elif ev.event_type == "ringing":
            _advance_status(call, CALL_RINGING)
        elif ev.event_type == "connected":
            if call.answered_at is None:
                call.answered_at = max(call.started_at, ev.occurred_at)
            _advance_status(call, CALL_CONNECTED)
        elif ev.event_type == "ended":
            if call.ended_at is None or ev.occurred_at > call.ended_at:
                call.ended_at = max(ev.occurred_at, call.started_at)
            _derive_end_state(call)
        elif ev.event_type == "failed":
            call.status = CALL_FAILED
            call.ended_at = call.ended_at or max(ev.occurred_at, call.started_at)
    db.commit()
    return added


# ---------------------------------------------------------------- disposition
def set_disposition(db: Session, *, user: Employee, call: Call, data: DispositionIn) -> Call:
    if call.employee_id != user.id and not is_admin(user):
        raise NotFound("Call not found.")
    disp = get_disposition(db, data.disposition_code)

    if call.disposition_id is not None:
        if call.disposition_id == disp.id:
            return call  # idempotent replay from the offline sync queue
        raise Conflict("An outcome has already been recorded for this call.", code="disposition_already_set")

    effects = EFFECTS.get(disp.code, {})
    now = utcnow()

    if disp.requires_callback:
        if data.callback_at is None:
            raise ValidationFailed("Choose when to call back.", code="callback_required", details=[{"field": "callback_at", "message": "Required"}])
        callback_service.validate_schedule(data.callback_at, now)

    contact = db.get(Contact, call.contact_id) if call.contact_id else None

    # --- finalise the call record ------------------------------------------------
    call.disposition_id = disp.id
    call.disposition_at = now
    if call.ended_at is None:
        call.ended_at = max(now, call.started_at)
    answered = call.answered_at is not None or call.duration_seconds > 0
    if disp.category == "connected":
        call.status = CALL_COMPLETED
        if call.answered_at is None:
            call.answered_at = call.started_at if call.duration_seconds == 0 else max(call.started_at, call.ended_at - timedelta(seconds=call.duration_seconds))
    elif disp.code in ("NO_ANSWER", "BUSY", "SWITCHED_OFF"):
        call.status = CALL_NO_ANSWER
    elif disp.code == "INVALID_NUMBER":
        call.status = CALL_FAILED
    else:  # DO_NOT_CONTACT
        call.status = CALL_COMPLETED if answered else CALL_NO_ANSWER
    db.add(CallEvent(call_id=call.id, event_type="disposition", occurred_at=now, payload={"code": disp.code}))

    # --- notes ---------------------------------------------------------------------
    note_text = (data.notes or "").strip()
    if note_text:
        if not (
            data.note_client_ref
            and db.scalars(select(CallNote.id).where(CallNote.author_id == user.id, CallNote.client_ref == data.note_client_ref)).first()
        ):
            db.add(
                CallNote(
                    call_id=call.id,
                    contact_id=call.contact_id,
                    author_id=user.id,
                    body=note_text,
                    client_ref=data.note_client_ref,
                )
            )

    # --- contact state machine ---------------------------------------------------------
    if contact is not None:
        contact.last_called_at = call.started_at
        contact.last_disposition_code = disp.code
        new_status = effects.get("status", contact.status)
        contact.next_eligible_at = None
        if disp.code == "INVALID_NUMBER" and contact_numbers.has_other_usable_number(db, contact.id, call.phone_number_snapshot):
            new_status = CONTACT_IN_PROGRESS  # this number is wrong, the person is not: the next number is tried

        if effects.get("success"):
            contact.failed_attempts = 0
        if effects.get("failure"):
            contact.failed_attempts = (contact.failed_attempts or 0) + 1
            rule = get_retry_rules(db).get(effects["rule"], {"delay_minutes": 120, "max_attempts": 3})
            if contact.failed_attempts >= rule["max_attempts"]:
                new_status = CONTACT_UNREACHABLE
            else:
                contact.next_eligible_at = now + timedelta(minutes=rule["delay_minutes"])
        if effects.get("cooldown") == "next_day":
            contact.next_eligible_at = next_business_day_start(now)

        # a recorded outcome fulfils any pending callback for this contact
        callback_service.close_pending(db, employee_id=call.employee_id, contact_id=contact.id)

        if effects.get("callback") and data.callback_at is not None:
            callback_service.schedule(
                db,
                employee_id=call.employee_id,
                contact=contact,
                when=data.callback_at,
                note=data.callback_note or note_text or None,
                call_id=call.id,
                status_for_contact=new_status,
            )
        contact.status = new_status

        if call.campaign_id is not None:
            member = db.scalars(
                select(CampaignContact).where(CampaignContact.campaign_id == call.campaign_id, CampaignContact.contact_id == contact.id)
            ).first()
            if member is not None:
                member.attempts = (member.attempts or 0) + 1
                member.last_attempt_at = now
                if new_status in CAMPAIGN_DONE_CONTACT_STATUSES:
                    member.status = "completed"
                    member.completed_at = now
                else:
                    member.status = "in_progress"

    db.commit()
    return call


# --------------------------------------------------------------------- output
def to_out_many(
    db: Session, calls: list[Call], *, detail: bool = False, known_names: dict[int, str] | None = None, brand_new: bool = False
) -> list[CallOut]:
    """`known_names` (employee id -> name) saves asking for names the caller already has; `brand_new` says the calls were created a
    moment ago, so there is no recording and no callback to look for."""
    if not calls:
        return []
    ids = [c.id for c in calls]
    names = dict(known_names or {})
    missing = {c.employee_id for c in calls} - set(names)
    if missing:
        names.update(dict(db.execute(select(Employee.id, Employee.full_name).where(Employee.id.in_(missing))).all()))
    if brand_new:
        recordings: dict[int, Recording] = {}
        callbacks: dict[int, datetime] = {}
    else:
        recordings = {r.call_id: r for r in db.scalars(select(Recording).where(Recording.call_id.in_(ids)))}
        callbacks = {
            cb.call_id: cb.scheduled_at
            for cb in db.scalars(select(Callback).where(Callback.call_id.in_(ids), Callback.status == CALLBACK_PENDING))
        }
    notes: dict[int, list[NoteOut]] = {}
    events: dict[int, list[CallEventOut]] = {}
    if detail:
        for note, author in db.execute(
            select(CallNote, Employee.full_name).join(Employee, Employee.id == CallNote.author_id).where(CallNote.call_id.in_(ids)).order_by(CallNote.created_at)
        ):
            out = NoteOut.model_validate(note)
            out.author_name = author
            notes.setdefault(note.call_id, []).append(out)
        for ev in db.scalars(select(CallEvent).where(CallEvent.call_id.in_(ids)).order_by(CallEvent.occurred_at, CallEvent.id)):
            events.setdefault(ev.call_id, []).append(CallEventOut.model_validate(ev))

    result = []
    for c in calls:
        rec = recordings.get(c.id)
        result.append(
            CallOut(
                id=c.id,
                client_call_id=c.client_call_id,
                employee_id=c.employee_id,
                employee_name=names.get(c.employee_id),
                contact_id=c.contact_id,
                contact_name=c.contact_name_snapshot,
                phone_number=c.phone_number_snapshot,
                campaign_id=c.campaign_id,
                attempt_number=c.attempt_number,
                direction=c.direction,
                started_at=c.started_at,
                answered_at=c.answered_at,
                ended_at=c.ended_at,
                duration_seconds=c.duration_seconds,
                status=c.status,
                disposition=DispositionRef.model_validate(c.disposition) if c.disposition else None,
                disposition_at=c.disposition_at,
                recording=RecordingOut.model_validate(rec) if rec else None,
                callback_at=callbacks.get(c.id),
                notes=notes.get(c.id, []),
                events=events.get(c.id, []),
                created_at=c.created_at,
                updated_at=c.updated_at,
            )
        )
    return result


def to_out(db: Session, call: Call, *, detail: bool = False, known_names: dict[int, str] | None = None, brand_new: bool = False) -> CallOut:
    return to_out_many(db, [call], detail=detail, known_names=known_names, brand_new=brand_new)[0]


def list_contact_calls(db: Session, contact_id: int, *, page: int, page_size: int) -> tuple[list[CallOut], int]:
    """Call history of one contact, shared with whoever may see that contact."""
    base = select(Call).where(Call.contact_id == contact_id)
    total = db.scalar(select(func.count()).select_from(base.with_only_columns(Call.id).subquery())) or 0
    rows = db.scalars(base.order_by(Call.started_at.desc(), Call.id.desc()).limit(page_size).offset((page - 1) * page_size)).unique().all()
    return to_out_many(db, list(rows)), total


def _calls_stmt(
    db: Session,
    user: Employee,
    *,
    employee_id: int | None = None,
    contact_id: int | None = None,
    campaign_id: int | None = None,
    status: str | None = None,
    disposition: str | None = None,
    needs_disposition: bool | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    q: str | None = None,
    has_recording: bool | None = None,
    min_duration: int | None = None,
):
    """The call query shared by the list, the CSV export and the employee views. None when the caller may see nothing."""
    stmt = select(Call)
    visible = visible_employee_ids(db, user)
    if visible is not None:
        stmt = stmt.where(Call.employee_id.in_(visible))
    if employee_id is not None:
        if visible is not None and employee_id not in visible:
            return None
        stmt = stmt.where(Call.employee_id == employee_id)
    if contact_id is not None:
        stmt = stmt.where(Call.contact_id == contact_id)
    if campaign_id is not None:
        stmt = stmt.where(Call.campaign_id == campaign_id)
    if status:
        stmt = stmt.where(Call.status == status)
    if disposition:
        stmt = stmt.join(CallDisposition, CallDisposition.id == Call.disposition_id).where(CallDisposition.code == disposition.upper())
    if needs_disposition is True:
        stmt = stmt.where(Call.disposition_id.is_(None))
    elif needs_disposition is False:
        stmt = stmt.where(Call.disposition_id.is_not(None))
    if has_recording is True:
        stmt = stmt.where(exists().where(Recording.call_id == Call.id))
    elif has_recording is False:
        stmt = stmt.where(~exists().where(Recording.call_id == Call.id))
    if min_duration is not None:
        stmt = stmt.where(Call.duration_seconds >= min_duration)
    if date_from is not None:
        stmt = stmt.where(Call.started_at >= date_from)
    if date_to is not None:
        stmt = stmt.where(Call.started_at < date_to)
    if q:
        like = f"%{contact_service.escape_like(q.strip().lower())}%"
        stmt = stmt.where(
            or_(func.lower(Call.contact_name_snapshot).like(like, escape="\\"), Call.phone_number_snapshot.like(like, escape="\\"))
        )
    return stmt


_CALL_ORDER = {
    "newest": lambda: (Call.started_at.desc(), Call.id.desc()),
    "oldest": lambda: (Call.started_at.asc(), Call.id.asc()),
    "longest": lambda: (Call.duration_seconds.desc(), Call.started_at.desc(), Call.id.desc()),
}


def calls_page(db: Session, user: Employee, *, offset: int, page_size: int, sort: str = "newest", **filters) -> list[CallOut]:
    stmt = _calls_stmt(db, user, **filters)
    if stmt is None:
        return []
    order = _CALL_ORDER.get(sort, _CALL_ORDER["newest"])()
    rows = db.scalars(stmt.order_by(*order).limit(page_size).offset(offset)).unique().all()
    return to_out_many(db, list(rows))


def list_calls(
    db: Session,
    user: Employee,
    *,
    employee_id: int | None = None,
    contact_id: int | None = None,
    campaign_id: int | None = None,
    status: str | None = None,
    disposition: str | None = None,
    needs_disposition: bool | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    q: str | None = None,
    has_recording: bool | None = None,
    min_duration: int | None = None,
    sort: str = "newest",
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[CallOut], int]:
    filters = dict(
        employee_id=employee_id, contact_id=contact_id, campaign_id=campaign_id, status=status, disposition=disposition,
        needs_disposition=needs_disposition, date_from=date_from, date_to=date_to, q=q, has_recording=has_recording, min_duration=min_duration,
    )
    stmt = _calls_stmt(db, user, **filters)
    if stmt is None:
        return [], 0
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).with_only_columns(Call.id).subquery())) or 0
    return calls_page(db, user, offset=(page - 1) * page_size, page_size=page_size, sort=sort, **filters), total
