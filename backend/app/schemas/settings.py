"""Organisation settings an administrator can change from the web panel."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

RETRY_CODES = ("NO_ANSWER", "BUSY", "SWITCHED_OFF")


class RecordingSetting(BaseModel):
    enabled: bool
    notice_text: str = Field(min_length=10, max_length=1000)

    @field_validator("notice_text")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


class RetryRule(BaseModel):
    delay_minutes: int = Field(ge=1, le=7 * 24 * 60)
    max_attempts: int = Field(ge=1, le=20)


class RetryRulesSetting(BaseModel):
    NO_ANSWER: RetryRule
    BUSY: RetryRule
    SWITCHED_OFF: RetryRule


class SettingUpdate(BaseModel):
    value: Any


class SettingOut(BaseModel):
    key: str
    value: Any
    description: str | None = None
    updated_at: str | None = None


class SettingsOut(BaseModel):
    recording: dict
    retry_rules: dict
    default_daily_target: int
    duplicate_policy: Literal["skip", "update"]
    inactive_after_days: int
    auto_rebalance: bool
    items: list[SettingOut]
