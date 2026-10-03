"""Follow-ups and responses: who the employees spoke to, what came of it, and who has to be called back.

A *conversation* is one employee and one phone number (a number dialled by hand counts like a contact, as in the employee view). Its
figures are those of the calls of the period. Its *response* is the outcome the employee chose after the latest call that has one
("no outcome yet" when none has); the response, the calls, the notes and the follow-up are what an administrator needs to see.

A *follow-up* is a scheduled callback. The pending ones are what somebody still has to do: overdue (the time has passed), later
today, or after today.

Everything is read from the raw rows (like the rest of the analytics), the same SQL on SQLite and on MySQL 8: the latest call of every
conversation is found with window functions, one pass over the calls of the period.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime

from sqlalchemy import and_, case, exists, func, or_, select
from sqlalchemy.orm import Session

from app.core.timeutils import day_bounds_utc, utcnow
from app.models.call import (
    CALL_ANSWERED_STATUSES,
    CALLBACK_CANCELLED,
    CALLBACK_DONE,
    CALLBACK_PENDING,
    Call,
    Callback,
    CallDisposition,
    CallNote,
)
from app.models.contact import Contact
from app.models.employee import Employee, Team
from app.models.recording import REC_AVAILABLE, Recording
from app.schemas.call import DispositionRef
from app.schemas.contact import ContactBrief
from app.schemas.followups import (
    NO_RESPONSE,
    ConversationOut,
    EmployeeFollowups,
    FollowupBrief,
    FollowupCounts,
    FollowupItemOut,
    FollowupSummaryOut,
    NoteBrief,
    ResponseChip,
    TimelineCallOut,
    TimelineOut,
)
from app.services.analytics_service import DateRange, period_out, resolve_scope
from app.services.contact_service import escape_like
from app.services.scope import can_view_employee

ANSWERED = sorted(CALL_ANSWERED_STATUSES)
HISTORY_CHIPS = 6  # calls shown as small chips on a conversation
TIMELINE_CALLS = 200
TIMELINE_NOTES = 50


# ------------------------------------------------------------------------------------------------- building blocks
def _answered():
    return case((Call.status.in_(ANSWERED), 1), else_=0)


def _talk():
    return case((Call.status.in_(ANSWERED), Call.duration_seconds), else_=0)


def _call_conditions(scope: list[int] | None, rng: DateRange) -> list:
    conditions = [Call.started_at >= rng.start, Call.started_at < rng.end]
    if scope is not None:
        conditions.append(Call.employee_id.in_(scope))
    return conditions


def _ref(code: str | None, label: str | None, category: str | None) -> DispositionRef | None:
    return DispositionRef(code=code, label=label or code, category=category or "other") if code else None


def _conversations(scope: list[int] | None, rng: DateRange):
    """One row per conversation of the period: its latest call, the figures of all its calls, and the response.

    The response is the outcome of the latest call that HAS one: the window is ordered "has an outcome first, then newest", so the
    first value of it is that call's outcome (or none, when no call of the conversation has one)."""
    partition = [Call.employee_id, Call.phone_number_snapshot]
    newest = [Call.started_at.desc(), Call.id.desc()]
    outcome_first = [Call.disposition_id.is_(None), *newest]
    inner = (
        select(
            Call.employee_id.label("employee_id"),
            Call.phone_number_snapshot.label("phone"),
            Call.id.label("call_id"),
            Call.started_at.label("started_at"),
            Call.duration_seconds.label("seconds"),
            Call.status.label("status"),
            Call.disposition_id.label("own_outcome_id"),
            Call.contact_id.label("contact_id"),
            Call.contact_name_snapshot.label("contact_name"),
            func.row_number().over(partition_by=partition, order_by=newest).label("rn"),
            func.count(Call.id).over(partition_by=partition).label("calls"),
            func.sum(_answered()).over(partition_by=partition).label("answered"),
            func.sum(_talk()).over(partition_by=partition).label("talk"),
            func.min(Call.started_at).over(partition_by=partition).label("first_at"),
            func.first_value(Call.disposition_id).over(partition_by=partition, order_by=outcome_first).label("response_id"),
            # (the type is named: a window function does not carry it, and SQLite would hand back text instead of a datetime)
            func.first_value(Call.started_at, type_=Call.started_at.type).over(partition_by=partition, order_by=outcome_first).label("response_at"),
        )
        .where(*_call_conditions(scope, rng))
        .subquery("conversation_calls")
    )
    return select(inner).where(inner.c.rn == 1).subquery("conversation")


def _pending_callbacks(scope: list[int] | None):
    """Pending callbacks of people who still exist."""
    stmt = select(Callback).join(Contact, Contact.id == Callback.contact_id).where(Callback.status == CALLBACK_PENDING, Contact.deleted_at.is_(None))
    return stmt if scope is None else stmt.where(Callback.employee_id.in_(scope))


def _followup_counts(db: Session, scope: list[int] | None, rng: DateRange, now: datetime) -> FollowupCounts:
    _, today_end = day_bounds_utc(now=now)
    scoped = [] if scope is None else [Callback.employee_id.in_(scope)]
    pending, overdue, today, upcoming = db.execute(
        select(
            func.count(Callback.id),
            func.coalesce(func.sum(case((Callback.scheduled_at <= now, 1), else_=0)), 0),
            func.coalesce(func.sum(case((and_(Callback.scheduled_at > now, Callback.scheduled_at < today_end), 1), else_=0)), 0),
            func.coalesce(func.sum(case((Callback.scheduled_at >= today_end, 1), else_=0)), 0),
        )
        .join(Contact, Contact.id == Callback.contact_id)
        .where(Callback.status == CALLBACK_PENDING, Contact.deleted_at.is_(None), *scoped)
    ).one()
    closed = db.scalar(
        select(func.count(Callback.id)).where(
            Callback.status.in_([CALLBACK_DONE, CALLBACK_CANCELLED]), Callback.completed_at >= rng.start, Callback.completed_at < rng.end, *scoped
        )
    )
    created = db.scalar(select(func.count(Callback.id)).where(Callback.created_at >= rng.start, Callback.created_at < rng.end, *scoped))
    return FollowupCounts(pending=int(pending), overdue=int(overdue), today=int(today), upcoming=int(upcoming), closed=int(closed or 0), created=int(created or 0))


# ------------------------------------------------------------------------------------------------- the dashboard
def summary(db: Session, user: Employee, rng: DateRange, *, employee_id: int | None = None, team_id: int | None = None) -> FollowupSummaryOut:
    now = utcnow()
    scope_name, scope = resolve_scope(db, user, employee_id, team_id)
    _, row_scope = resolve_scope(db, user, None, team_id)  # the table lists everybody of the team, whoever is picked
    if scope is not None and not scope:
        return FollowupSummaryOut(period=period_out(rng), scope=scope_name, calls=0, people=0, spoken=0, responses={}, followups=FollowupCounts(), employees=[], generated_at=now)  # type: ignore[arg-type]

    conversation = _conversations(row_scope, rng)
    by_employee: dict[int, dict[str, int]] = defaultdict(dict)
    spoken_by_employee: dict[int, int] = defaultdict(int)
    for emp_id, code, people, spoken in db.execute(
        select(
            conversation.c.employee_id,
            CallDisposition.code,
            func.count(),
            func.coalesce(func.sum(case((conversation.c.answered > 0, 1), else_=0)), 0),
        )
        .select_from(conversation)
        .outerjoin(CallDisposition, CallDisposition.id == conversation.c.response_id)
        .group_by(conversation.c.employee_id, CallDisposition.code)
    ):
        by_employee[emp_id][code or NO_RESPONSE] = int(people)
        spoken_by_employee[emp_id] += int(spoken)

    calls = {
        emp_id: (int(n), last)
        for emp_id, n, last in db.execute(
            select(Call.employee_id, func.count(Call.id), func.max(Call.started_at)).where(*_call_conditions(row_scope, rng)).group_by(Call.employee_id)
        )
    }
    pending_stmt = (
        select(
            Callback.employee_id,
            func.count(Callback.id),
            func.coalesce(func.sum(case((Callback.scheduled_at <= now, 1), else_=0)), 0),
            func.min(Callback.scheduled_at),
        )
        .join(Contact, Contact.id == Callback.contact_id)
        .where(Callback.status == CALLBACK_PENDING, Contact.deleted_at.is_(None))
        .group_by(Callback.employee_id)
    )
    if row_scope is not None:
        pending_stmt = pending_stmt.where(Callback.employee_id.in_(row_scope))
    pending = {emp_id: (int(n), int(late), first) for emp_id, n, late, first in db.execute(pending_stmt)}

    ids = set(by_employee) | set(calls) | set(pending)
    people_rows: list[EmployeeFollowups] = []
    if ids:
        for emp_id, code, name, team_name, active in db.execute(
            select(Employee.id, Employee.employee_code, Employee.full_name, Team.name, Employee.is_active)
            .outerjoin(Team, Team.id == Employee.team_id)
            .where(Employee.id.in_(ids))
        ):
            n_calls, last_call = calls.get(emp_id, (0, None))
            n_pending, n_late, first_due = pending.get(emp_id, (0, 0, None))
            responses = dict(by_employee.get(emp_id, {}))
            people_rows.append(
                EmployeeFollowups(
                    id=emp_id,
                    employee_code=code,
                    full_name=name,
                    team_name=team_name,
                    is_active=bool(active),
                    calls=n_calls,
                    people=sum(responses.values()),
                    spoken=spoken_by_employee.get(emp_id, 0),
                    responses=responses,
                    pending=n_pending,
                    overdue=n_late,
                    next_followup_at=first_due,
                    last_call_at=last_call,
                )
            )
    people_rows.sort(key=lambda r: (-r.overdue, -r.pending, -r.people, r.full_name.lower()))

    chosen = None if scope is None else set(scope)
    selected = [r for r in people_rows if chosen is None or r.id in chosen]
    totals: dict[str, int] = defaultdict(int)
    for row in selected:
        for key, value in row.responses.items():
            totals[key] += value
    return FollowupSummaryOut(
        period=period_out(rng),
        scope=scope_name,  # type: ignore[arg-type]
        calls=sum(r.calls for r in selected),
        people=sum(r.people for r in selected),
        spoken=sum(r.spoken for r in selected),
        responses=dict(totals),
        followups=_followup_counts(db, scope, rng, now),
        employees=people_rows,
        generated_at=now,
    )


# ------------------------------------------------------------------------------------------------- conversations
def _note_brief(note: CallNote, author: str | None) -> NoteBrief:
    return NoteBrief(id=note.id, body=note.body, author_name=author, created_at=note.created_at)


def _followup_brief(callback: Callback, now: datetime) -> FollowupBrief:
    return FollowupBrief(
        id=callback.id,
        scheduled_at=callback.scheduled_at,
        status=callback.status,
        note=callback.note,
        overdue=callback.status == CALLBACK_PENDING and callback.scheduled_at <= now,
        created_at=callback.created_at,
        completed_at=callback.completed_at,
    )


def conversations(
    db: Session,
    user: Employee,
    rng: DateRange,
    *,
    employee_id: int | None = None,
    team_id: int | None = None,
    responses: list[str] | None = None,
    q: str | None = None,
    followup: str | None = None,
    page: int = 1,
    page_size: int = 25,
) -> tuple[list[ConversationOut], int]:
    now = utcnow()
    _, scope = resolve_scope(db, user, employee_id, team_id)
    if scope is not None and not scope:
        return [], 0
    conversation = _conversations(scope, rng)
    stmt = (
        select(
            conversation,
            CallDisposition.code.label("response_code"),
            CallDisposition.label.label("response_label"),
            CallDisposition.category.label("response_category"),
        )
        .select_from(conversation)
        .outerjoin(CallDisposition, CallDisposition.id == conversation.c.response_id)
    )
    if responses:
        wanted = [code for code in responses if code != NO_RESPONSE]
        parts = []
        if wanted:
            parts.append(CallDisposition.code.in_(wanted))
        if NO_RESPONSE in responses:
            parts.append(conversation.c.response_id.is_(None))
        stmt = stmt.where(or_(*parts))
    if q and q.strip():
        like = f"%{escape_like(q.strip().lower())}%"
        stmt = stmt.where(or_(func.lower(conversation.c.contact_name).like(like, escape="\\"), conversation.c.phone.like(like, escape="\\")))
    if followup in ("pending", "overdue"):
        due = [Callback.scheduled_at <= now] if followup == "overdue" else []
        stmt = stmt.where(
            exists().where(
                Callback.employee_id == conversation.c.employee_id,
                Callback.contact_id == conversation.c.contact_id,
                Callback.status == CALLBACK_PENDING,
                *due,
            )
        )
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    rows = db.execute(stmt.order_by(conversation.c.started_at.desc(), conversation.c.call_id.desc()).limit(page_size).offset((page - 1) * page_size)).all()
    return _describe(db, rows, rng, now), int(total)


def _describe(db: Session, rows: list, rng: DateRange, now: datetime) -> list[ConversationOut]:
    """Names, notes, follow-ups, history chips and recordings for the conversations of one page (a handful of queries, whatever the size)."""
    if not rows:
        return []
    keys = {(r.employee_id, r.phone) for r in rows}
    emp_ids = {r.employee_id for r in rows}
    phones = {r.phone for r in rows}
    contact_ids = {r.contact_id for r in rows if r.contact_id}

    people = {
        emp_id: (name, code, team)
        for emp_id, name, code, team in db.execute(
            select(Employee.id, Employee.full_name, Employee.employee_code, Team.name).outerjoin(Team, Team.id == Employee.team_id).where(Employee.id.in_(emp_ids))
        )
    }
    contacts = {c_id: (name, status) for c_id, name, status in db.execute(select(Contact.id, Contact.name, Contact.status).where(Contact.id.in_(contact_ids)))} if contact_ids else {}

    history: dict[tuple[int, str], list[ResponseChip]] = defaultdict(list)
    for emp_id, phone, at, status, code, label in db.execute(
        select(Call.employee_id, Call.phone_number_snapshot, Call.started_at, Call.status, CallDisposition.code, CallDisposition.label)
        .select_from(Call)
        .outerjoin(CallDisposition, CallDisposition.id == Call.disposition_id)
        .where(Call.employee_id.in_(emp_ids), Call.phone_number_snapshot.in_(phones), Call.started_at >= rng.start, Call.started_at < rng.end)
        .order_by(Call.started_at.desc(), Call.id.desc())
    ):
        if (emp_id, phone) in keys and len(history[(emp_id, phone)]) < HISTORY_CHIPS:
            history[(emp_id, phone)].append(ResponseChip(code=code, label=label, status=status, at=at))

    # the employee's own notes: about the contact (any time) - and, for a number dialled by hand, the notes of its calls
    notes: dict[tuple[int, int | str], list[NoteBrief]] = defaultdict(list)
    if contact_ids:
        for note, author in db.execute(
            select(CallNote, Employee.full_name)
            .join(Employee, Employee.id == CallNote.author_id)
            .where(CallNote.author_id.in_(emp_ids), CallNote.contact_id.in_(contact_ids))
            .order_by(CallNote.created_at.desc(), CallNote.id.desc())
        ):
            notes[(note.author_id, note.contact_id)].append(_note_brief(note, author))  # type: ignore[index]
    by_hand = {(r.employee_id, r.phone) for r in rows if not r.contact_id}
    if by_hand:
        for note, author, emp_id, phone in db.execute(
            select(CallNote, Employee.full_name, Call.employee_id, Call.phone_number_snapshot)
            .join(Call, Call.id == CallNote.call_id)
            .join(Employee, Employee.id == CallNote.author_id)
            .where(Call.employee_id.in_({e for e, _ in by_hand}), Call.phone_number_snapshot.in_({p for _, p in by_hand}), CallNote.author_id == Call.employee_id)
            .order_by(CallNote.created_at.desc(), CallNote.id.desc())
        ):
            if (emp_id, phone) in by_hand:
                notes[(emp_id, phone)].append(_note_brief(note, author))

    followups: dict[tuple[int, int], list[Callback]] = defaultdict(list)
    if contact_ids:
        for callback in db.scalars(
            select(Callback)
            .where(Callback.status == CALLBACK_PENDING, Callback.employee_id.in_(emp_ids), Callback.contact_id.in_(contact_ids))
            .order_by(Callback.scheduled_at, Callback.id)
        ):
            followups[(callback.employee_id, callback.contact_id)].append(callback)

    recorded = set(
        db.scalars(select(Recording.call_id).where(Recording.call_id.in_({r.call_id for r in rows}), Recording.upload_status == REC_AVAILABLE))
    )

    result: list[ConversationOut] = []
    for r in rows:
        name, code, team = people.get(r.employee_id, ("Employee", "", None))
        contact = contacts.get(r.contact_id) if r.contact_id else None
        mine = notes.get((r.employee_id, r.contact_id if r.contact_id else r.phone), [])
        due = followups.get((r.employee_id, r.contact_id), []) if r.contact_id else []
        result.append(
            ConversationOut(
                employee_id=r.employee_id,
                employee_name=name,
                employee_code=code,
                team_name=team,
                contact_id=r.contact_id,
                contact_name=(contact[0] if contact else None) or r.contact_name,
                phone=r.phone,
                contact_status=contact[1] if contact else None,
                calls=int(r.calls),
                answered=int(r.answered or 0),
                talk_seconds=int(r.talk or 0),
                first_call_at=r.first_at,
                last_call_at=r.started_at,
                last_call_id=r.call_id,
                last_call_status=r.status,
                last_call_seconds=int(r.seconds or 0),
                last_call_has_outcome=r.own_outcome_id is not None,
                has_recording=r.call_id in recorded,
                response=_ref(r.response_code, r.response_label, r.response_category),
                response_at=r.response_at if r.response_id is not None else None,
                history=history.get((r.employee_id, r.phone), []),
                last_note=mine[0] if mine else None,
                notes=len(mine),
                followup=_followup_brief(due[0], now) if due else None,
                followups_pending=len(due),
            )
        )
    return result


# ------------------------------------------------------------------------------------------------- follow-ups to do
def followup_items(
    db: Session,
    user: Employee,
    rng: DateRange,
    *,
    state: str = "pending",
    employee_id: int | None = None,
    team_id: int | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int = 25,
) -> tuple[list[FollowupItemOut], int]:
    """Scheduled callbacks. `state`: overdue | today | upcoming | pending (all of those) | closed (done or cancelled in the period)."""
    now = utcnow()
    _, today_end = day_bounds_utc(now=now)
    _, scope = resolve_scope(db, user, employee_id, team_id)
    if scope is not None and not scope:
        return [], 0
    stmt = (
        select(Callback, Contact, Employee.full_name, Employee.employee_code, Team.name)
        .join(Contact, Contact.id == Callback.contact_id)
        .join(Employee, Employee.id == Callback.employee_id)
        .outerjoin(Team, Team.id == Employee.team_id)
        .where(Contact.deleted_at.is_(None))
    )
    if scope is not None:
        stmt = stmt.where(Callback.employee_id.in_(scope))
    if state == "closed":
        stmt = stmt.where(Callback.status.in_([CALLBACK_DONE, CALLBACK_CANCELLED]), Callback.completed_at >= rng.start, Callback.completed_at < rng.end)
        order = [Callback.completed_at.desc(), Callback.id.desc()]
    else:
        stmt = stmt.where(Callback.status == CALLBACK_PENDING)
        if state == "overdue":
            stmt = stmt.where(Callback.scheduled_at <= now)
        elif state == "today":
            stmt = stmt.where(Callback.scheduled_at > now, Callback.scheduled_at < today_end)
        elif state == "upcoming":
            stmt = stmt.where(Callback.scheduled_at >= today_end)
        order = [Callback.scheduled_at.asc(), Callback.id.asc()]  # the one that has waited longest first
    if q and q.strip():
        like = f"%{escape_like(q.strip().lower())}%"
        stmt = stmt.where(
            or_(func.lower(Contact.name).like(like, escape="\\"), Contact.normalized_phone.like(like, escape="\\"), func.lower(Employee.full_name).like(like, escape="\\"))
        )
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).with_only_columns(Callback.id).subquery())) or 0
    rows = db.execute(stmt.order_by(*order).limit(page_size).offset((page - 1) * page_size)).all()
    if not rows:
        return [], int(total)

    emp_ids = {cb.employee_id for cb, *_ in rows}
    contact_ids = {cb.contact_id for cb, *_ in rows}
    pairs = {(cb.employee_id, cb.contact_id) for cb, *_ in rows}
    calls: dict[tuple[int, int], int] = defaultdict(int)
    last_call: dict[tuple[int, int], tuple[int, datetime]] = {}
    outcome: dict[tuple[int, int], DispositionRef] = {}
    for emp_id, c_id, call_id, at, code, label, category in db.execute(
        select(Call.employee_id, Call.contact_id, Call.id, Call.started_at, CallDisposition.code, CallDisposition.label, CallDisposition.category)
        .select_from(Call)
        .outerjoin(CallDisposition, CallDisposition.id == Call.disposition_id)
        .where(Call.employee_id.in_(emp_ids), Call.contact_id.in_(contact_ids))
        .order_by(Call.started_at.desc(), Call.id.desc())
    ):
        key = (emp_id, c_id)
        if key not in pairs:
            continue
        calls[key] += 1
        last_call.setdefault(key, (call_id, at))
        if key not in outcome and code:
            outcome[key] = _ref(code, label, category)  # type: ignore[assignment]
    last_note: dict[tuple[int, int], NoteBrief] = {}
    for note, author in db.execute(
        select(CallNote, Employee.full_name)
        .join(Employee, Employee.id == CallNote.author_id)
        .where(CallNote.author_id.in_(emp_ids), CallNote.contact_id.in_(contact_ids))
        .order_by(CallNote.created_at.desc(), CallNote.id.desc())
    ):
        last_note.setdefault((note.author_id, note.contact_id), _note_brief(note, author))  # type: ignore[arg-type]

    items = []
    for callback, contact, emp_name, emp_code, team in rows:
        key = (callback.employee_id, callback.contact_id)
        latest = last_call.get(key)
        items.append(
            FollowupItemOut(
                id=callback.id,
                employee_id=callback.employee_id,
                employee_name=emp_name,
                employee_code=emp_code,
                team_name=team,
                contact_id=contact.id,
                contact_name=contact.name,
                phone=contact.normalized_phone,
                contact_status=contact.status,
                scheduled_at=callback.scheduled_at,
                status=callback.status,
                note=callback.note,
                overdue=callback.status == CALLBACK_PENDING and callback.scheduled_at <= now,
                created_at=callback.created_at,
                completed_at=callback.completed_at,
                call_id=callback.call_id,
                calls=calls.get(key, 0),
                last_call_at=latest[1] if latest else None,
                last_call_id=latest[0] if latest else None,
                response=outcome.get(key),
                last_note=last_note.get(key),
            )
        )
    return items, int(total)


# ------------------------------------------------------------------------------------------------- one conversation
def timeline(db: Session, user: Employee, employee_id: int, phone: str) -> TimelineOut | None:
    """Every call between one employee and one number, with the notes written after each, the follow-ups and the recordings."""
    if not can_view_employee(db, user, employee_id):
        return None
    employee = db.execute(select(Employee.full_name, Employee.employee_code).where(Employee.id == employee_id)).first()
    if employee is None:
        return None
    base = [Call.employee_id == employee_id, Call.phone_number_snapshot == phone]
    total = db.scalar(select(func.count(Call.id)).where(*base)) or 0
    if total == 0:
        return None
    now = utcnow()
    calls = list(db.scalars(select(Call).where(*base).order_by(Call.started_at.desc(), Call.id.desc()).limit(TIMELINE_CALLS)).unique())
    call_ids = [c.id for c in calls]
    contact_id = next((c.contact_id for c in calls if c.contact_id), None)

    notes: dict[int, list[NoteBrief]] = defaultdict(list)
    for note, author in db.execute(
        select(CallNote, Employee.full_name).join(Employee, Employee.id == CallNote.author_id).where(CallNote.call_id.in_(call_ids)).order_by(CallNote.created_at, CallNote.id)
    ):
        notes[note.call_id].append(_note_brief(note, author))  # type: ignore[index]
    recordings = {call_id: (rec_id, seconds) for call_id, rec_id, seconds in db.execute(select(Recording.call_id, Recording.id, Recording.duration_seconds).where(Recording.call_id.in_(call_ids), Recording.upload_status == REC_AVAILABLE))}
    scheduled = {cb.call_id: cb.scheduled_at for cb in db.scalars(select(Callback).where(Callback.call_id.in_(call_ids), Callback.status == CALLBACK_PENDING))}

    contact = db.get(Contact, contact_id) if contact_id else None
    followups: list[FollowupBrief] = []
    other: list[NoteBrief] = []
    if contact_id:
        followups = [
            _followup_brief(cb, now)
            for cb in db.scalars(select(Callback).where(Callback.employee_id == employee_id, Callback.contact_id == contact_id).order_by(Callback.scheduled_at.desc(), Callback.id.desc()).limit(50))
        ]
        for note, author in db.execute(
            select(CallNote, Employee.full_name)
            .join(Employee, Employee.id == CallNote.author_id)
            .where(CallNote.contact_id == contact_id, or_(CallNote.call_id.is_(None), CallNote.call_id.not_in(call_ids)))
            .order_by(CallNote.created_at.desc(), CallNote.id.desc())
            .limit(TIMELINE_NOTES)
        ):
            other.append(_note_brief(note, author))

    return TimelineOut(
        employee_id=employee_id,
        employee_name=employee[0],
        employee_code=employee[1],
        phone=phone,
        contact=ContactBrief.model_validate(contact) if contact is not None and contact.deleted_at is None else None,
        total_calls=int(total),
        calls=[
            TimelineCallOut(
                id=c.id,
                started_at=c.started_at,
                answered_at=c.answered_at,
                ended_at=c.ended_at,
                duration_seconds=c.duration_seconds,
                status=c.status,
                response=_ref(c.disposition.code, c.disposition.label, c.disposition.category) if c.disposition else None,
                notes=notes.get(c.id, []),
                callback_at=scheduled.get(c.id),
                recording_id=recordings[c.id][0] if c.id in recordings else None,
                recording_seconds=recordings[c.id][1] if c.id in recordings else None,
            )
            for c in calls
        ],
        followups=followups,
        other_notes=other,
    )
