"""Response models of the administrator analytics endpoints (/analytics/*)."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.call import CallOut
from app.schemas.common import UTCDatetime
from app.schemas.employee import DeviceOut

Presence = Literal["on_call", "online", "idle", "offline", "inactive"]


class PeriodOut(BaseModel):
    date_from: date
    date_to: date
    days: int
    timezone: str
    previous_from: date
    previous_to: date


class Totals(BaseModel):
    calls: int = 0
    connected: int = 0
    no_answer: int = 0
    failed: int = 0
    answer_rate: float = 0.0  # connected / calls, percent
    talk_seconds: int = 0
    avg_talk_seconds: int = 0  # talk time / connected calls (section 21)
    longest_call_seconds: int = 0
    avg_ring_seconds: int = 0  # dialing until the other side picked up (answered calls)
    unique_contacts: int = 0
    active_employees: int = 0  # employees who made at least one call
    pending_wrapup: int = 0  # ended calls still waiting for an outcome
    recordings: int = 0  # recordings available for the calls in the period
    callbacks_created: int = 0


class DayPoint(BaseModel):
    date: date
    calls: int
    connected: int
    talk_seconds: int


class HourPoint(BaseModel):
    hour: int
    calls: int
    connected: int


class OutcomeCount(BaseModel):
    code: str | None
    label: str
    category: str | None
    count: int


class StatusCount(BaseModel):
    status: str
    count: int


class NotRecordedReason(BaseModel):
    reason: str  # silent | no_permission | failed | saved | unreported
    label: str
    count: int


class RecordingInsight(BaseModel):
    enabled: bool
    answered_calls: int
    recorded_calls: int
    coverage_percent: float
    not_recorded: list[NotRecordedReason]


class EmployeeCounts(BaseModel):
    total: int
    active: int
    with_calls: int


class DeviceStatus(BaseModel):
    """How the employee's phone is, from what the app last reported (see POST /me/heartbeat)."""

    live: bool  # the report is recent (the app is open right now); otherwise it is the last one that was saved
    last_heartbeat_at: UTCDatetime | None
    app_state: str | None
    battery_percent: int | None
    charging: bool | None
    network: str | None
    permissions_ok: bool | None
    missing_permissions: list[str]
    pending_sync: int | None  # things the phone could not send yet
    clock_skew_seconds: int | None  # the phone's clock minus the server's


class EmployeeMetrics(BaseModel):
    id: int
    employee_code: str
    full_name: str
    email: str
    phone: str | None
    role: str
    team_id: int | None
    team_name: str | None
    is_active: bool
    daily_target: int
    device_binding_enabled: bool
    must_change_password: bool
    created_at: UTCDatetime
    last_login_at: UTCDatetime | None
    last_seen_at: UTCDatetime | None
    presence: Presence
    device_name: str | None
    device_os: str | None
    app_version: str | None
    device_status: DeviceStatus | None = None
    # figures of the selected period
    calls: int
    connected: int
    no_answer: int
    answer_rate: float
    talk_seconds: int
    avg_talk_seconds: int
    longest_call_seconds: int
    unique_contacts: int
    active_days: int
    first_call_at: UTCDatetime | None
    last_call_at: UTCDatetime | None
    avg_first_call_minute: int | None  # average minute of the business day (0-1439) of the first call
    avg_last_call_minute: int | None
    recordings: int
    outcomes: dict[str, int]
    # today (business timezone)
    today_calls: int
    today_target_percent: float


class OverviewOut(BaseModel):
    period: PeriodOut
    scope: Literal["organization", "team", "employee"]
    totals: Totals
    previous: Totals
    series: list[DayPoint]
    hourly: list[HourPoint]
    heatmap: list[list[int]]  # 7 rows (Monday..Sunday) x 24 hours of calls
    outcomes: list[OutcomeCount]
    statuses: list[StatusCount]
    recording: RecordingInsight
    employees: EmployeeCounts
    leaderboard: list[EmployeeMetrics]
    generated_at: UTCDatetime


class EmployeeStatsOut(BaseModel):
    period: PeriodOut
    total: int
    items: list[EmployeeMetrics]


class ContactStat(BaseModel):
    contact_id: int | None
    name: str | None
    phone: str
    calls: int
    connected: int
    talk_seconds: int
    last_call_at: UTCDatetime
    last_outcome: str | None


class EmployeeDetailOut(BaseModel):
    period: PeriodOut
    employee: EmployeeMetrics
    series: list[DayPoint]
    hourly: list[HourPoint]
    heatmap: list[list[int]]
    outcomes: list[OutcomeCount]
    statuses: list[StatusCount]
    top_contacts: list[ContactStat]
    recent_calls: list[CallOut]
    devices: list[DeviceOut]
    recording: RecordingInsight


class LiveCall(BaseModel):
    call_id: int
    employee_id: int
    employee_name: str
    employee_code: str
    team_name: str | None
    contact_id: int | None
    contact_name: str | None
    phone_number: str
    status: str
    started_at: UTCDatetime
    answered_at: UTCDatetime | None


class RecentCall(BaseModel):
    call_id: int
    employee_id: int
    employee_name: str
    contact_name: str | None
    phone_number: str
    status: str
    started_at: UTCDatetime
    duration_seconds: int
    outcome: str | None
    has_recording: bool


class PresenceCounts(BaseModel):
    on_call: int = 0
    online: int = 0
    idle: int = 0
    offline: int = 0
    inactive: int = 0


class LiveToday(BaseModel):
    calls: int
    connected: int
    talk_seconds: int


class LiveOut(BaseModel):
    generated_at: UTCDatetime
    on_call: list[LiveCall]
    recent: list[RecentCall]
    presence: PresenceCounts
    today: LiveToday = Field(default_factory=lambda: LiveToday(calls=0, connected=0, talk_seconds=0))
