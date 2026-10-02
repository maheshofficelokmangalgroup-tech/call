"""Organisation settings (administrators only): the recording switch and notice, retry rules, default target, duplicate policy."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from pydantic import ValidationError

from app.api.deps import AdminUser, DbSession
from app.core.errors import NotFound, ValidationFailed
from app.models.system import Setting
from app.schemas.settings import RecordingSetting, RetryRulesSetting, SettingOut, SettingsOut, SettingUpdate
from app.services import audit_service
from app.services.reference_data import DEFAULT_SETTINGS
from app.services.settings_service import get_recording_config, get_retry_rules, get_setting, set_setting

router = APIRouter()


def _validated(key: str, value: Any) -> Any:
    """Check a new value against the shape the rest of the application relies on."""
    try:
        if key == "recording":
            return RecordingSetting.model_validate(value).model_dump()
        if key == "retry_rules":
            return RetryRulesSetting.model_validate(value).model_dump()
    except ValidationError as exc:
        first = exc.errors()[0]
        raise ValidationFailed(f"{'.'.join(str(p) for p in first['loc'])}: {first['msg']}", code="invalid_setting") from exc
    if key == "default_daily_target":
        if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 2000:
            raise ValidationFailed("The daily target must be a whole number between 0 and 2000.", code="invalid_setting")
        return value
    if key == "duplicate_policy":
        if value not in ("skip", "update"):
            raise ValidationFailed("Duplicate policy must be 'skip' or 'update'.", code="invalid_setting")
        return value
    if key == "inactive_after_days":
        if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 90:
            raise ValidationFailed("Enter a whole number of days from 1 to 90.", code="invalid_setting")
        return value
    if key == "auto_rebalance":
        if not isinstance(value, bool):
            raise ValidationFailed("Automatic rebalancing is either on or off.", code="invalid_setting")
        return value
    raise NotFound("Unknown setting.")


def _all(db) -> SettingsOut:
    rows = {s.key: s for s in db.query(Setting).all()}
    items = [
        SettingOut(
            key=key,
            value=get_setting(db, key),
            description=DEFAULT_SETTINGS[key][1],
            updated_at=rows[key].updated_at.isoformat() if key in rows and getattr(rows[key], "updated_at", None) else None,
        )
        for key in DEFAULT_SETTINGS
    ]
    return SettingsOut(
        recording=get_recording_config(db),
        retry_rules=get_retry_rules(db),
        default_daily_target=int(get_setting(db, "default_daily_target") or 50),
        duplicate_policy=get_setting(db, "duplicate_policy") or "skip",  # type: ignore[arg-type]
        inactive_after_days=int(get_setting(db, "inactive_after_days") or 2),
        auto_rebalance=bool(get_setting(db, "auto_rebalance")),
        items=items,
    )


@router.get("", response_model=SettingsOut)
def read_settings(db: DbSession, _admin: AdminUser):
    return _all(db)


@router.put("/{key}", response_model=SettingsOut)
def update_setting(key: str, payload: SettingUpdate, request: Request, db: DbSession, admin: AdminUser):
    value = _validated(key, payload.value)
    before = get_setting(db, key)
    set_setting(db, key, value, actor_id=admin.id)
    audit_service.record(db, action="settings.update", actor=admin, entity_type="setting", entity_id=key, request=request, details={"before": before, "after": value})
    db.commit()
    return _all(db)
