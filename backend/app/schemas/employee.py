from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field, field_validator

from app.schemas.common import ORMModel, validate_email

Email = Annotated[str, AfterValidator(validate_email)]


class DeviceInfo(BaseModel):
    device_uid: str = Field(min_length=6, max_length=128)
    name: str | None = Field(default=None, max_length=150)
    platform: str = Field(default="android", max_length=32)
    os_version: str | None = Field(default=None, max_length=64)
    app_version: str | None = Field(default=None, max_length=32)


class EmployeeOut(ORMModel):
    id: int
    employee_code: str
    email: str
    full_name: str
    phone: str | None
    role_name: str = Field(serialization_alias="role")
    team_id: int | None
    team_name: str | None
    is_active: bool
    daily_target: int
    must_change_password: bool
    device_binding_enabled: bool
    last_login_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class EmployeeCreate(BaseModel):
    employee_code: str | None = Field(default=None, min_length=2, max_length=32, pattern=r"^[A-Za-z0-9_.-]+$")
    email: Email
    full_name: str = Field(min_length=2, max_length=150)
    phone: str | None = Field(default=None, max_length=32)
    role: Literal["admin", "manager", "employee"] = "employee"
    team_id: int | None = None
    daily_target: int = Field(default=50, ge=0, le=2000)
    password: str | None = Field(default=None, max_length=128)
    must_change_password: bool = True
    device_binding_enabled: bool = False

    @field_validator("full_name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        return v.strip()


class BulkEmployeesIn(BaseModel):
    employees: list[EmployeeCreate] = Field(min_length=1, max_length=100)


class BulkEmployeeResult(BaseModel):
    index: int  # position in the request (0-based)
    ok: bool
    employee: EmployeeOut | None = None
    temporary_password: str | None = None
    code: str | None = None
    error: str | None = None


class BulkEmployeesOut(BaseModel):
    created: int
    failed: int
    results: list[BulkEmployeeResult]


class EmployeeUpdate(BaseModel):
    email: Email | None = None
    full_name: str | None = Field(default=None, min_length=2, max_length=150)
    phone: str | None = Field(default=None, max_length=32)
    role: Literal["admin", "manager", "employee"] | None = None
    team_id: int | None = None
    clear_team: bool = False
    daily_target: int | None = Field(default=None, ge=0, le=2000)
    device_binding_enabled: bool | None = None


class EmployeeCreated(BaseModel):
    employee: EmployeeOut
    temporary_password: str | None = None


class CredentialOut(BaseModel):
    """What an administrator may see of an employee's login: the first password, while the employee has not chosen their own."""

    employee_id: int
    employee_code: str
    full_name: str
    email: str
    phone: str | None = None
    available: bool  # false: the employee has chosen their own password, or it was kept for too long
    password: str | None = None
    kind: str | None = None  # generated | admin_set
    set_at: datetime | None = None
    set_by: str | None = None
    must_change_password: bool = False
    view_count: int = 0
    keep_days: int = 30


class PasswordReset(BaseModel):
    new_password: str | None = Field(default=None, max_length=128)


class PasswordResetResult(BaseModel):
    temporary_password: str


class DeviceOut(ORMModel):
    id: int
    device_uid: str
    device_name: str | None
    platform: str
    os_version: str | None
    app_version: str | None
    is_approved: bool
    first_seen_at: datetime
    last_seen_at: datetime
    battery_percent: int | None = None
    charging: bool | None = None
    network_type: str | None = None
    app_state: str | None = None
    permissions_ok: bool | None = None
    missing_permissions: str | None = None
    pending_sync: int | None = None
    clock_skew_seconds: int | None = None
    last_heartbeat_at: datetime | None = None


class SessionOut(ORMModel):
    id: str
    created_at: datetime
    last_used_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    ip: str | None
    user_agent: str | None


class TeamOut(ORMModel):
    id: int
    name: str
    description: str | None
    is_active: bool
    member_count: int = 0


class TeamCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    description: str | None = Field(default=None, max_length=255)


class TeamUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    description: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None


# --------------------------------------------------------------------- auth
class LoginRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=255, description="Email or employee ID")
    password: str = Field(min_length=1, max_length=256)
    device: DeviceInfo | None = None


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=10, max_length=300)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    must_change_password: bool
    employee: EmployeeOut


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=128)
