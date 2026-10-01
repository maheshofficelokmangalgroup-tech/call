from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ORMModel, UTCDatetime
from app.schemas.contact import CampaignRef, ContactBrief, NoteOut


class DispositionOut(ORMModel):
    id: int
    code: str
    label: str
    category: str
    requires_callback: bool
    sort_order: int


class DispositionRef(ORMModel):
    code: str
    label: str
    category: str


class RecordingOut(ORMModel):
    id: int
    uid: str
    call_id: int
    upload_status: str
    content_type: str
    size_bytes: int
    duration_seconds: int | None
    created_at: datetime
    uploaded_at: datetime | None
    failure_reason: str | None


class CallEventOut(ORMModel):
    id: int
    event_type: str
    occurred_at: datetime
    payload: dict | None


class CallOut(BaseModel):
    id: int
    client_call_id: str
    employee_id: int
    employee_name: str | None = None
    contact_id: int | None
    contact_name: str | None
    phone_number: str
    campaign_id: int | None
    attempt_number: int
    direction: str
    started_at: datetime
    answered_at: datetime | None
    ended_at: datetime | None
    duration_seconds: int
    status: str
    disposition: DispositionRef | None
    disposition_at: datetime | None
    recording: RecordingOut | None = None
    callback_at: datetime | None = None  # pending callback created for this call, if any
    notes: list[NoteOut] = []
    events: list[CallEventOut] = []
    created_at: datetime
    updated_at: datetime


class CallCreate(BaseModel):
    client_call_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_.:-]+$")
    contact_id: int | None = None
    phone_number: str | None = Field(default=None, max_length=32)
    campaign_id: int | None = None
    started_at: UTCDatetime
    external_call_reference: str | None = Field(default=None, max_length=128)


class CallUpdate(BaseModel):
    status: Literal["dialing", "ringing", "connected", "completed", "no_answer", "failed"] | None = None
    answered_at: UTCDatetime | None = None
    ended_at: UTCDatetime | None = None
    duration_seconds: int | None = Field(default=None, ge=0, le=6 * 3600)
    external_call_reference: str | None = Field(default=None, max_length=128)


class CallEventIn(BaseModel):
    event_type: Literal["dialing", "ringing", "connected", "ended", "failed", "app_resumed", "reconciled", "note"]
    occurred_at: UTCDatetime
    payload: dict | None = None

    @field_validator("payload")
    @classmethod
    def _small(cls, v: dict | None) -> dict | None:
        if v is not None and len(str(v)) > 2000:
            raise ValueError("Event payload too large.")
        return v


class CallEventsIn(BaseModel):
    events: list[CallEventIn] = Field(min_length=1, max_length=50)


class DispositionIn(BaseModel):
    disposition_code: str = Field(min_length=2, max_length=32)
    notes: str | None = Field(default=None, max_length=2000)
    callback_at: UTCDatetime | None = None
    callback_note: str | None = Field(default=None, max_length=500)
    note_client_ref: str | None = Field(default=None, max_length=64)


# ------------------------------------------------------------------ callbacks
class CallbackOut(BaseModel):
    id: int
    contact_id: int
    contact: ContactBrief | None = None
    call_id: int | None
    scheduled_at: datetime
    status: str
    note: str | None
    overdue: bool = False
    created_at: datetime


class CallbackCreate(BaseModel):
    contact_id: int
    scheduled_at: UTCDatetime
    note: str | None = Field(default=None, max_length=500)
    client_ref: str | None = Field(default=None, max_length=64)


class CallbackUpdate(BaseModel):
    scheduled_at: UTCDatetime | None = None
    status: Literal["done", "cancelled"] | None = None
    note: str | None = Field(default=None, max_length=500)


# ---------------------------------------------------------------------- queue
class QueueItem(BaseModel):
    contact: ContactBrief
    reason: Literal["callback", "retry", "new"]
    callback: CallbackOut | None = None
    campaign: CampaignRef | None = None
    attempts: int
    last_called_at: datetime | None = None
    eligible_at: datetime | None = None


class QueueOut(BaseModel):
    items: list[QueueItem]
    total: int
    due_callbacks: int
    server_time: datetime
