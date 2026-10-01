from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models.system import Setting
from app.services.reference_data import DEFAULT_SETTINGS


def get_setting(db: Session, key: str, default: Any = None) -> Any:
    row = db.get(Setting, key)
    if row is not None and row.value is not None:
        return row.value
    if default is not None:
        return default
    fallback = DEFAULT_SETTINGS.get(key)
    return fallback[0] if fallback else None


def set_setting(db: Session, key: str, value: Any, *, actor_id: int | None = None) -> Setting:
    row = db.get(Setting, key)
    if row is None:
        description = DEFAULT_SETTINGS.get(key, (None, None))[1]
        row = Setting(key=key, value=value, description=description, updated_by=actor_id)
        db.add(row)
    else:
        row.value = value
        row.updated_by = actor_id
    db.flush()
    return row


def get_retry_rules(db: Session) -> dict[str, dict[str, int]]:
    rules = get_setting(db, "retry_rules") or {}
    defaults = DEFAULT_SETTINGS["retry_rules"][0]
    merged: dict[str, dict[str, int]] = {}
    for code, default_rule in defaults.items():  # type: ignore[union-attr]
        rule = dict(default_rule)
        rule.update({k: int(v) for k, v in (rules.get(code) or {}).items() if isinstance(v, (int, float))})
        merged[code] = rule
    return merged


def get_recording_config(db: Session) -> dict[str, Any]:
    config = dict(DEFAULT_SETTINGS["recording"][0])  # type: ignore[arg-type]
    config.update(get_setting(db, "recording") or {})
    return config
