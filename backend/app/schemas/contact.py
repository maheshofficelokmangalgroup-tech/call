from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ORMModel, validate_email


class PersonRef(BaseModel):
    id: int
    name: str
    code: str | None = None


class CampaignRef(BaseModel):
    id: int
    name: str


class ContactBrief(ORMModel):
    id: int
    name: str
    phone: str = Field(validation_alias="normalized_phone")
    email: str | None = None
    location: str | None = None
    category: str | None = None
    priority: int
    tags: list[str] = []
    status: str
    call_count: int
    last_called_at: datetime | None = None
    last_disposition_code: str | None = None

    model_config = {"from_attributes": True, "populate_by_name": True}


class ContactOut(ContactBrief):
    phone_raw: str
    custom_fields: dict = {}
    source: str | None = None
    created_at: datetime
    updated_at: datetime
    assigned_to: PersonRef | None = None
    campaigns: list[CampaignRef] = []


class ContactCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    phone: str = Field(min_length=3, max_length=32)
    email: str | None = Field(default=None, max_length=255)
    location: str | None = Field(default=None, max_length=255)
    category: str | None = Field(default=None, max_length=100)
    priority: int = Field(default=2, ge=1, le=3)
    tags: list[str] = Field(default_factory=list, max_length=20)
    custom_fields: dict[str, str | int | float | bool | None] = Field(default_factory=dict)
    campaign_id: int | None = None
    assign_to_employee_id: int | None = None

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

    @field_validator("email")
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        return validate_email(v) if v else None

    @field_validator("tags")
    @classmethod
    def _tags(cls, v: list[str]) -> list[str]:
        return _clean_tags(v)

    @field_validator("custom_fields")
    @classmethod
    def _cf(cls, v: dict) -> dict:
        if len(v) > 30:
            raise ValueError("At most 30 custom fields are allowed.")
        return v


class ContactUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    phone: str | None = Field(default=None, min_length=3, max_length=32)
    email: str | None = Field(default=None, max_length=255)
    location: str | None = Field(default=None, max_length=255)
    category: str | None = Field(default=None, max_length=100)
    priority: int | None = Field(default=None, ge=1, le=3)
    tags: list[str] | None = Field(default=None, max_length=20)
    custom_fields: dict[str, str | int | float | bool | None] | None = None
    status: Literal[
        "new",
        "in_progress",
        "callback",
        "follow_up",
        "interested",
        "not_interested",
        "completed",
        "invalid",
        "unreachable",
        "do_not_contact",
    ] | None = None

    @field_validator("email")
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        return validate_email(v) if v else v

    @field_validator("tags")
    @classmethod
    def _tags(cls, v: list[str] | None) -> list[str] | None:
        return _clean_tags(v) if v is not None else None


def _clean_tags(tags: list[str]) -> list[str]:
    seen: list[str] = []
    for tag in tags:
        tag = tag.strip()[:40]
        if tag and tag.lower() not in (t.lower() for t in seen):
            seen.append(tag)
    return seen


class AssignRequest(BaseModel):
    contact_ids: list[int] | None = Field(default=None, max_length=50_000)
    # Alternative to contact_ids: every contact matching this filter.
    q: str | None = None
    status: str | None = None
    category: str | None = None
    unassigned_only: bool = False
    campaign_id: int | None = None  # used both as filter source and as the assignment campaign

    employee_ids: list[int] | None = None
    team_id: int | None = None
    strategy: Literal["single", "round_robin", "balanced"] = "round_robin"
    reassign: bool = False
    assignment_campaign_id: int | None = None


class AssignResult(BaseModel):
    total: int
    assigned: int
    reassigned: int
    skipped_already_assigned: int
    skipped_ineligible: int
    per_employee: dict[int, int] = {}


class UnassignRequest(BaseModel):
    contact_ids: list[int] = Field(min_length=1, max_length=50_000)


class NoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    call_id: int | None = None
    client_ref: str | None = Field(default=None, max_length=64)

    @field_validator("body")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Note cannot be empty.")
        return v


class NoteOut(ORMModel):
    id: int
    call_id: int | None
    contact_id: int | None
    author_id: int
    author_name: str | None = None
    body: str
    created_at: datetime


# ------------------------------------------------------------------ campaigns
class CampaignOut(ORMModel):
    id: int
    name: str
    description: str | None
    status: str
    priority: int
    start_date: date | None
    end_date: date | None
    target_calls: int | None
    created_at: datetime
    contact_count: int = 0
    completed_count: int = 0
    calls_made: int = 0
    completion_percent: float = 0.0


class CampaignCreate(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    description: str | None = None
    status: Literal["draft", "active", "paused", "completed", "archived"] = "draft"
    priority: int = Field(default=2, ge=1, le=3)
    start_date: date | None = None
    end_date: date | None = None
    target_calls: int | None = Field(default=None, ge=0)


class CampaignUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=150)
    description: str | None = None
    status: Literal["draft", "active", "paused", "completed", "archived"] | None = None
    priority: int | None = Field(default=None, ge=1, le=3)
    start_date: date | None = None
    end_date: date | None = None
    target_calls: int | None = Field(default=None, ge=0)


class CampaignContactsRequest(BaseModel):
    contact_ids: list[int] = Field(min_length=1, max_length=50_000)


class CampaignAssigneesRequest(BaseModel):
    employee_ids: list[int] = Field(default_factory=list)
    team_ids: list[int] = Field(default_factory=list)


class DistributeRequest(BaseModel):
    strategy: Literal["round_robin", "balanced"] = "balanced"
    employee_ids: list[int] | None = None  # defaults to the campaign assignees
