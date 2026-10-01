"""Time helpers. The database stores naive UTC; the API speaks timezone-aware ISO-8601."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo

from app.core.config import get_settings

UTC = timezone.utc


def utcnow() -> datetime:
    return datetime.now(UTC)


def ensure_aware(dt: datetime) -> datetime:
    """Treat naive datetimes as UTC and normalise everything to UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


@lru_cache
def _tz(name: str) -> ZoneInfo:
    return ZoneInfo(name)


def business_tz() -> ZoneInfo:
    return _tz(get_settings().app_timezone)


def business_date(now: datetime | None = None) -> date:
    now = ensure_aware(now or utcnow())
    return now.astimezone(business_tz()).date()


def day_bounds_utc(day: date | None = None, now: datetime | None = None) -> tuple[datetime, datetime]:
    """Return [start, end) of a business-timezone day expressed in UTC."""
    tz = business_tz()
    day = day or business_date(now)
    start_local = datetime.combine(day, time.min, tzinfo=tz)
    end_local = datetime.combine(day + timedelta(days=1), time.min, tzinfo=tz)
    return start_local.astimezone(UTC), end_local.astimezone(UTC)


def next_business_day_start(now: datetime | None = None) -> datetime:
    return day_bounds_utc(now=now)[1]
