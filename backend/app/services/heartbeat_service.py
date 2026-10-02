"""What a phone says about itself while the app is open: alive, battery, network, permissions, work it could not send yet.

The latest report of every employee lives in Redis (so the admin panel sees it within a minute without a single database write per
report); it is copied into the device's row only now and then, and at once when something that matters changes (a permission was
taken away, the app was updated).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

import redis
from fastapi import Request
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core import cache
from app.core.config import get_settings
from app.core.redis_client import get_redis
from app.core.timeutils import utcnow
from app.models.employee import Employee, EmployeeDevice
from app.schemas.misc import HeartbeatIn

log = logging.getLogger(__name__)

LATEST_TTL_SECONDS = 15 * 60  # a phone that has been silent for this long is simply shown as not heard from
PERSIST_EVERY_SECONDS = 5 * 60
# what is worth a database write the moment it changes
WATCHED = ("permissions_ok", "app_version", "os_version")


def _key(employee_id: int) -> str:
    return f"c:hb:{employee_id}"


def _skew_seconds(client_time: datetime | None, now: datetime) -> int | None:
    if client_time is None:
        return None
    return int((client_time - now).total_seconds())


def record(db: Session, *, employee: Employee, device_id: int | None, data: HeartbeatIn, request: Request) -> None:
    now = utcnow()
    report: dict[str, Any] = {
        "at": now.isoformat(),
        "app_state": data.app_state,
        "battery_percent": data.battery_percent,
        "charging": data.charging,
        "network": data.network,
        "app_version": data.app_version,
        "os_version": data.os_version,
        "pending_sync": data.pending_sync,
        "permissions_ok": data.permissions_ok,
        "missing_permissions": data.missing_permissions,
        "on_call": data.on_call,
        "clock_skew_seconds": _skew_seconds(data.client_time, now),
        "device_id": device_id,
    }
    previous: dict[str, Any] | None = None
    store = get_redis() if cache.enabled() else None
    if store is not None:
        try:
            raw = store.get(_key(employee.id))
            previous = json.loads(raw) if raw else None
            store.set(_key(employee.id), json.dumps(report), ex=LATEST_TTL_SECONDS)
        except (redis.RedisError, ValueError):
            previous = None

    changed = previous is None or any(previous.get(k) != report.get(k) for k in WATCHED)
    due = cache.once_per(f"heartbeat-write:{device_id}", PERSIST_EVERY_SECONDS) if store is not None else True
    if device_id is None or not (changed or due):
        return
    db.execute(
        update(EmployeeDevice)
        .where(EmployeeDevice.id == device_id, EmployeeDevice.employee_id == employee.id)
        .values(
            last_heartbeat_at=now,
            battery_percent=data.battery_percent,
            charging=data.charging,
            network_type=data.network,
            app_state=data.app_state,
            permissions_ok=data.permissions_ok,
            missing_permissions=",".join(data.missing_permissions)[:255] or None,
            pending_sync=data.pending_sync,
            clock_skew_seconds=report["clock_skew_seconds"],
            **({"app_version": data.app_version} if data.app_version else {}),
            **({"os_version": data.os_version} if data.os_version else {}),
        )
    )
    db.commit()


def latest(employee_ids: list[int]) -> dict[int, dict[str, Any]]:
    """The freshest report of each of these employees (those that have been silent for a while are simply missing)."""
    if not employee_ids or not cache.enabled():
        return {}
    try:
        values = get_redis().mget([_key(i) for i in employee_ids])
    except redis.RedisError:
        return {}
    found: dict[int, dict[str, Any]] = {}
    for employee_id, raw in zip(employee_ids, values):
        if not raw:
            continue
        try:
            found[employee_id] = json.loads(raw)
        except ValueError:
            continue
    return found


def interval_seconds() -> int:
    return get_settings().heartbeat_seconds
