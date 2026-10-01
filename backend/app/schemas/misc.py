from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel
from app.schemas.call import DispositionOut
from app.schemas.employee import EmployeeOut


# ------------------------------------------------------------------ recordings
class RecordingCreate(BaseModel):
    content_type: str = Field(min_length=3, max_length=64)
    size_bytes: int = Field(gt=0)
    duration_seconds: int | None = Field(default=None, ge=0, le=6 * 3600)
    sha256: str | None = Field(default=None, pattern=r"^[A-Fa-f0-9]{64}$")


class PlaybackUrlOut(BaseModel):
    url: str
    expires_at: datetime
    mode: Literal["play", "download"]


# --------------------------------------------------------------------- imports
class ImportOut(ORMModel):
    id: int
    filename: str
    file_type: str
    mode: str
    status: str
    campaign_id: int | None
    total_rows: int
    valid_rows: int
    invalid_rows: int
    duplicate_rows: int
    inserted_rows: int
    updated_rows: int
    skipped_rows: int
    assigned_rows: int
    error_message: str | None
    options: dict
    created_at: datetime
    confirmed_at: datetime | None
    completed_at: datetime | None


class ImportRowOut(ORMModel):
    id: int
    row_number: int
    status: str
    duplicate_of: str | None
    action: str | None
    normalized_phone: str | None
    data: dict
    errors: list | None
    contact_id: int | None


class ImportConfirm(BaseModel):
    mode: Literal["skip", "update"] | None = None


# ------------------------------------------------------------------- dashboard
class DashboardOut(BaseModel):
    scope: Literal["employee", "team", "organization"]
    date: str
    timezone: str
    employee_count: int
    active_employees: int
    inactive_employees: int
    assigned_contacts: int
    pending_contacts: int
    total_calls: int
    connected_calls: int
    no_answer_calls: int
    busy_calls: int
    switched_off_calls: int
    invalid_calls: int
    completed_calls: int  # calls that already have an outcome recorded
    pending_wrapup: int  # calls still waiting for an outcome
    callbacks_due: int
    callbacks_scheduled_today: int
    total_talk_seconds: int
    average_call_seconds: int
    daily_target: int
    target_progress_percent: float
    calls_by_hour: list[int]  # 24 entries, business timezone
    generated_at: datetime


# ---------------------------------------------------------------- client config
class RecordingConfig(BaseModel):
    enabled: bool
    notice_text: str
    max_size_mb: int
    allowed_types: list[str]


class ClientConfig(BaseModel):
    server_time: datetime
    timezone: str
    daily_target: int
    default_phone_region: str
    recording: RecordingConfig
    dispositions: list[DispositionOut]
    unread_notifications: int


class MeOut(BaseModel):
    employee: EmployeeOut
    config: ClientConfig


# ---------------------------------------------------------------- notifications
class NotificationOut(ORMModel):
    id: int
    type: str
    title: str
    body: str | None
    data: dict | None
    is_read: bool
    created_at: datetime


class AuditLogOut(ORMModel):
    id: int
    actor_id: int | None
    actor_label: str | None
    action: str
    entity_type: str | None
    entity_id: str | None
    ip: str | None
    details: dict | None
    created_at: datetime
