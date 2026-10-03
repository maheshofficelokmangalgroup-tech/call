"""Response models of the follow-up dashboard: who the employees spoke to, what came of it, and who has to be called back."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from app.schemas.analytics import PeriodOut
from app.schemas.call import DispositionRef
from app.schemas.common import UTCDatetime
from app.schemas.contact import ContactBrief

NO_RESPONSE = "NONE"  # the key of "no outcome chosen yet" in a count of responses


class FollowupCounts(BaseModel):
    """Scheduled callbacks. `pending` and its three parts are as of now (whenever the callback was made); the last two are the period."""

    pending: int = 0  # still to be done
    overdue: int = 0  # ... and their time has passed
    today: int = 0  # ... and due later today
    upcoming: int = 0  # ... and due after today
    closed: int = 0  # done or cancelled during the period
    created: int = 0  # scheduled during the period


class EmployeeFollowups(BaseModel):
    id: int
    employee_code: str
    full_name: str
    team_name: str | None
    is_active: bool
    calls: int  # calls made in the period
    people: int  # different people called in the period (one employee + one number)
    spoken: int  # ... of whom somebody answered
    responses: dict[str, int]  # people by their latest response (outcome code; "NONE" = no outcome chosen yet)
    pending: int  # follow-ups still to be done
    overdue: int  # ... of which late
    next_followup_at: UTCDatetime | None
    last_call_at: UTCDatetime | None


class FollowupSummaryOut(BaseModel):
    period: PeriodOut
    scope: Literal["organization", "team", "employee"]
    calls: int
    people: int
    spoken: int
    responses: dict[str, int]
    followups: FollowupCounts
    employees: list[EmployeeFollowups]
    generated_at: UTCDatetime


class NoteBrief(BaseModel):
    id: int
    body: str
    author_name: str | None
    created_at: UTCDatetime


class FollowupBrief(BaseModel):
    """One scheduled callback."""

    id: int
    scheduled_at: UTCDatetime
    status: str  # pending | done | cancelled
    note: str | None
    overdue: bool
    created_at: UTCDatetime
    completed_at: UTCDatetime | None = None


class ResponseChip(BaseModel):
    """One call of the history of a conversation, small."""

    code: str | None  # outcome code; None = no outcome chosen
    label: str | None
    status: str  # call status
    at: UTCDatetime


class ConversationOut(BaseModel):
    """One employee and one phone number: the calls of the period, and what came of them."""

    employee_id: int
    employee_name: str
    employee_code: str
    team_name: str | None
    contact_id: int | None
    contact_name: str | None
    phone: str
    contact_status: str | None  # where the contact stands now
    calls: int
    answered: int
    talk_seconds: int
    first_call_at: UTCDatetime
    last_call_at: UTCDatetime
    last_call_id: int
    last_call_status: str
    last_call_seconds: int
    last_call_has_outcome: bool
    has_recording: bool  # the latest call has a recording that can be played
    response: DispositionRef | None  # the outcome of the latest call that has one; None = no outcome chosen yet
    response_at: UTCDatetime | None
    history: list[ResponseChip]  # the latest calls of the period, newest first
    last_note: NoteBrief | None  # the latest note the employee wrote about this person
    notes: int
    followup: FollowupBrief | None  # the next pending follow-up
    followups_pending: int


class FollowupItemOut(BaseModel):
    """A scheduled callback with the person, the employee and what was said before."""

    id: int
    employee_id: int
    employee_name: str
    employee_code: str
    team_name: str | None
    contact_id: int
    contact_name: str
    phone: str
    contact_status: str
    scheduled_at: UTCDatetime
    status: str
    note: str | None
    overdue: bool
    created_at: UTCDatetime
    completed_at: UTCDatetime | None
    call_id: int | None  # the call after which it was scheduled
    calls: int  # calls this employee made to this person (all time)
    last_call_at: UTCDatetime | None
    last_call_id: int | None
    response: DispositionRef | None  # the latest outcome of those calls
    last_note: NoteBrief | None


class TimelineCallOut(BaseModel):
    id: int
    started_at: UTCDatetime
    answered_at: UTCDatetime | None
    ended_at: UTCDatetime | None
    duration_seconds: int
    status: str
    response: DispositionRef | None
    notes: list[NoteBrief]
    callback_at: UTCDatetime | None  # the pending follow-up this call scheduled
    recording_id: int | None  # a recording that can be played
    recording_seconds: int | None


class TimelineOut(BaseModel):
    """Everything between one employee and one phone number."""

    employee_id: int
    employee_name: str
    employee_code: str
    phone: str
    contact: ContactBrief | None
    total_calls: int
    calls: list[TimelineCallOut]  # newest first (at most 200)
    followups: list[FollowupBrief]
    other_notes: list[NoteBrief]  # notes about the person that belong to no call of this employee
