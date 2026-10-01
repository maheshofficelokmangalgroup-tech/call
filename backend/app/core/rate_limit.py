"""Fixed-window rate limiting backed by Redis (INCR + EXPIRE) with in-memory fallback."""

from __future__ import annotations

import logging

import redis
from fastapi import Request

from app.core.config import get_settings
from app.core.errors import TooManyRequests
from app.core.redis_client import get_redis

log = logging.getLogger(__name__)


def client_ip(request: Request) -> str:
    settings = get_settings()
    if settings.trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "unknown")[:64]


def hit(key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
    """Register one hit. Returns (allowed, retry_after_seconds)."""
    store = get_redis()
    full_key = f"rl:{key}"
    try:
        count = store.incr(full_key)
        if count == 1:
            store.expire(full_key, window_seconds)
        if count > limit:
            ttl = store.ttl(full_key)
            return False, max(1, ttl if ttl and ttl > 0 else window_seconds)
        return True, 0
    except redis.RedisError as exc:
        log.warning("Rate limiter unavailable (%s); allowing request", exc)
        return True, 0


def reset(key: str) -> None:
    try:
        get_redis().delete(f"rl:{key}")
    except redis.RedisError:
        pass


def enforce(key: str, limit: int, window_seconds: int, *, message: str | None = None) -> None:
    if not get_settings().rate_limit_enabled:
        return
    allowed, retry_after = hit(key, limit, window_seconds)
    if not allowed:
        raise TooManyRequests(
            message or "Too many requests. Please wait a moment and try again.",
            details={"retry_after_seconds": retry_after},
            headers={"Retry-After": str(retry_after)},
        )


def enforce_sensitive(request: Request, bucket: str, actor_id: int | None = None) -> None:
    """Generic limiter for sensitive endpoints (imports, uploads, password changes...)."""
    settings = get_settings()
    who = f"u{actor_id}" if actor_id else client_ip(request)
    enforce(f"sensitive:{bucket}:{who}", settings.rate_limit_sensitive_per_minute, 60)
