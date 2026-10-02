"""Redis access with a transparent in-memory fallback.

Redis is used only for short-lived, non-authoritative data (rate limits, locks, cache).
If Redis is unreachable the application keeps working with a process-local fallback
(fine for development and single-process use). In production `/ready` reports the
fallback as degraded so it is noticed.
"""

from __future__ import annotations

import logging
import secrets
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from functools import lru_cache
from typing import Any, Protocol

import redis

from app.core.config import get_settings

log = logging.getLogger(__name__)


class KeyValueStore(Protocol):
    def incr(self, key: str) -> int: ...
    def expire(self, key: str, seconds: int) -> Any: ...
    def ttl(self, key: str) -> int: ...
    def get(self, key: str) -> str | None: ...
    def mget(self, keys: list[str]) -> list[str | None]: ...
    def set(self, key: str, value: str, ex: int | None = None, nx: bool = False) -> Any: ...
    def delete(self, *keys: str) -> int: ...
    def ping(self) -> bool: ...


class InMemoryRedis:
    """Thread-safe subset of the redis-py API used by this application."""

    is_fallback = True

    def __init__(self) -> None:
        self._data: dict[str, tuple[str, float | None]] = {}
        self._lock = threading.RLock()

    def _alive(self, key: str) -> bool:
        item = self._data.get(key)
        if item is None:
            return False
        if item[1] is not None and item[1] <= time.monotonic():
            del self._data[key]
            return False
        return True

    def incr(self, key: str) -> int:
        with self._lock:
            if self._alive(key):
                value, expiry = self._data[key]
                new = int(value) + 1
                self._data[key] = (str(new), expiry)
                return new
            self._data[key] = ("1", None)
            return 1

    def expire(self, key: str, seconds: int) -> bool:
        with self._lock:
            if not self._alive(key):
                return False
            value, _ = self._data[key]
            self._data[key] = (value, time.monotonic() + seconds)
            return True

    def ttl(self, key: str) -> int:
        with self._lock:
            if not self._alive(key):
                return -2
            expiry = self._data[key][1]
            if expiry is None:
                return -1
            return max(0, int(round(expiry - time.monotonic())))

    def get(self, key: str) -> str | None:
        with self._lock:
            return self._data[key][0] if self._alive(key) else None

    def mget(self, keys: list[str]) -> list[str | None]:
        with self._lock:
            return [self._data[k][0] if self._alive(k) else None for k in keys]

    def set(self, key: str, value: str, ex: int | None = None, nx: bool = False) -> bool | None:
        with self._lock:
            if nx and self._alive(key):
                return None
            self._data[key] = (str(value), time.monotonic() + ex if ex else None)
            return True

    def delete(self, *keys: str) -> int:
        with self._lock:
            return sum(1 for k in keys if self._data.pop(k, None) is not None)

    def ping(self) -> bool:
        return True

    def flushall(self) -> None:
        with self._lock:
            self._data.clear()


_RELEASE_LUA = """
if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end
"""


@lru_cache
def get_redis() -> KeyValueStore:
    settings = get_settings()
    url = settings.redis_url
    if url:
        try:
            client = redis.Redis.from_url(
                url,
                decode_responses=True,
                socket_connect_timeout=1.5,
                socket_timeout=2.0,
                health_check_interval=30,
            )
            client.ping()
            client.is_fallback = False  # type: ignore[attr-defined]
            log.info("Connected to Redis", extra={"redis": url.split("@")[-1]})
            return client  # type: ignore[return-value]
        except redis.RedisError as exc:
            log.warning("Redis unavailable (%s) - using in-memory fallback", exc)
    else:
        log.info("REDIS_URL not set - using in-memory fallback")
    return InMemoryRedis()


def reset_redis() -> None:
    get_redis.cache_clear()


def redis_status() -> dict[str, Any]:
    store = get_redis()
    fallback = bool(getattr(store, "is_fallback", False))
    try:
        ok = bool(store.ping())
    except redis.RedisError:
        ok = False
    return {"ok": ok, "mode": "memory-fallback" if fallback else "redis"}


@contextmanager
def redis_lock(name: str, ttl_seconds: int = 60, wait_seconds: float = 0.0) -> Iterator[bool]:
    """Best-effort mutual exclusion. Yields True if the lock was acquired.

    Database constraints remain the authoritative guard against duplicates; this lock only
    prevents two workers from doing the same expensive job at the same time.
    """
    store = get_redis()
    key = f"lock:{name}"
    token = secrets.token_hex(8)
    deadline = time.monotonic() + wait_seconds
    acquired = False
    try:
        while True:
            try:
                acquired = bool(store.set(key, token, ex=ttl_seconds, nx=True))
            except redis.RedisError:
                log.warning("Redis error while acquiring lock %s; proceeding without it", name)
                acquired = True
                break
            if acquired or time.monotonic() >= deadline:
                break
            time.sleep(0.05)
        yield acquired
    finally:
        if acquired:
            try:
                if getattr(store, "is_fallback", False):
                    if store.get(key) == token:
                        store.delete(key)
                else:
                    store.eval(_RELEASE_LUA, 1, key, token)  # type: ignore[attr-defined]
            except redis.RedisError:
                pass


def cache_get_or_set(key: str, ttl_seconds: int, factory: Callable[[], str]) -> str:
    """Tiny string cache: returns cached value or computes/stores it. Never raises on Redis errors."""
    store = get_redis()
    try:
        cached = store.get(key)
        if cached is not None:
            return cached
    except redis.RedisError:
        return factory()
    value = factory()
    try:
        store.set(key, value, ex=ttl_seconds)
    except redis.RedisError:
        pass
    return value
