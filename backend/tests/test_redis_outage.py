"""What happens when Redis stops answering (it is restarted, the network between the containers breaks, it runs out of memory).

Found by a crash test: with Redis killed under load every call to it waited for its own timeout before failing, a request makes several
of them, and the admin panel took 13 seconds per page. Nothing may fail for a phone, and nothing may be slow for long.
"""

from __future__ import annotations

import threading
import time

import pytest
import redis
from fastapi import APIRouter

from app.core import cache, redis_client
from app.core.config import reset_settings_cache
from tests.conftest import PASSWORD, auth_headers


class FlakyClient:
    """A Redis that can be switched off; while it is off every call waits `delay` seconds and then fails (a timeout)."""

    def __init__(self, delay: float = 0.0) -> None:
        self.up = True
        self.delay = delay
        self.calls = 0
        self.data: dict[str, str] = {}
        self.lock = threading.Lock()

    def _enter(self) -> None:
        with self.lock:
            self.calls += 1
        if not self.up:
            time.sleep(self.delay)
            raise redis.TimeoutError("timed out")

    def ping(self) -> bool:
        self._enter()
        return True

    def get(self, key: str):
        self._enter()
        return self.data.get(key)

    def set(self, key: str, value: str, ex=None, nx=False):
        self._enter()
        if nx and key in self.data:
            return None
        self.data[key] = value
        return True

    def incr(self, key: str) -> int:
        self._enter()
        self.data[key] = str(int(self.data.get(key, "0")) + 1)
        return int(self.data[key])

    def mget(self, keys):
        self._enter()
        return [self.data.get(k) for k in keys]

    def delete(self, *keys):
        self._enter()
        return sum(1 for k in keys if self.data.pop(k, None) is not None)

    def expire(self, key, seconds):
        self._enter()
        return True

    def ttl(self, key):
        self._enter()
        return 30


# ------------------------------------------------------------------------------------------------------ the guard itself
def test_a_failed_call_costs_its_timeout_once_then_calls_are_refused_at_once():
    client = FlakyClient(delay=0.3)
    guard = redis_client.GuardedRedis(client, pause_seconds=0.6)
    assert guard.set("a", "1") is True
    client.up = False

    started = time.monotonic()
    with pytest.raises(redis.TimeoutError):
        guard.get("a")
    assert time.monotonic() - started >= 0.25  # the one call that finds out pays its timeout (the clock of a PC is coarse)

    calls_before = client.calls
    started = time.monotonic()
    for _ in range(50):
        with pytest.raises(redis.ConnectionError):
            guard.get("a")
    assert time.monotonic() - started < 0.2  # the rest are not even sent
    assert client.calls == calls_before


def test_only_one_caller_checks_whether_redis_is_back_and_the_service_recovers_by_itself():
    client = FlakyClient(delay=0.2)
    guard = redis_client.GuardedRedis(client, pause_seconds=0.3)
    client.up = False
    with pytest.raises(redis.TimeoutError):
        guard.get("x")
    time.sleep(0.35)  # the pause is over, Redis is still down: ten callers arrive at once

    results: list[str] = []

    def caller() -> None:
        try:
            guard.get("x")
            results.append("answered")
        except redis.TimeoutError:
            results.append("probe")  # this one really asked
        except redis.ConnectionError:
            results.append("refused")

    before = client.calls
    threads = [threading.Thread(target=caller) for _ in range(10)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert results.count("probe") == 1 and results.count("refused") == 9, results
    assert client.calls - before == 1

    client.up = True  # Redis comes back
    time.sleep(0.35)
    assert guard.get("x") is None  # the next probe goes through ...
    assert guard.set("x", "1") is True  # ... and everything flows again, without anybody restarting anything
    assert guard.get("x") == "1"


def test_an_answer_that_is_not_an_outage_does_not_stop_the_calls():
    class Odd(FlakyClient):
        def get(self, key):
            raise redis.ResponseError("WRONGTYPE Operation against a key holding the wrong kind of value")

    guard = redis_client.GuardedRedis(Odd(), pause_seconds=60)
    for _ in range(3):
        with pytest.raises(redis.ResponseError):
            guard.get("k")
    assert guard.ping() is True  # Redis is fine: only that one key was the wrong kind


# ------------------------------------------------------------------------------------------------------ the service around it
@pytest.fixture()
def redis_that_dies(monkeypatch):
    """The service is wired to a Redis that can be switched off - as in production (Redis required, nothing private to fall back to)."""
    client = FlakyClient(delay=0.15)
    monkeypatch.setenv("REDIS_URL", "redis://redis.test:6379/0")
    monkeypatch.setenv("REDIS_REQUIRED", "true")
    reset_settings_cache()
    monkeypatch.setattr(redis_client.redis.Redis, "from_url", staticmethod(lambda *a, **k: client))
    redis_client.get_redis.cache_clear()
    yield client
    reset_settings_cache()
    redis_client.get_redis.cache_clear()


def test_a_required_redis_that_is_down_at_start_is_not_replaced_by_a_private_stand_in(redis_that_dies):
    redis_that_dies.up = False
    store = redis_client.get_redis()
    assert isinstance(store, redis_client.GuardedRedis) and not store.is_fallback
    assert redis_client.redis_status()["ok"] is False  # honest: /ready says so
    redis_that_dies.up = True
    time.sleep(3.2)  # the guard's pause
    assert redis_client.redis_status() == {"ok": True, "mode": "redis"}  # and it connects again by itself


def test_every_part_of_the_service_goes_on_without_redis(client, make, emp_a, as_admin, redis_that_dies):
    """Sign in, who-am-I, the queue, a call, the heartbeat and the admin figures - all with Redis dead."""
    contact = make.contact(assign_to=emp_a)
    redis_that_dies.up = True
    headers = auth_headers(client, emp_a)  # signed in while Redis was up: the remembered session is there
    admin_headers = auth_headers(client, make.employee(role="admin", code="OUT1", email="outage-admin@example.com"))
    redis_that_dies.up = False

    started = time.monotonic()
    me = client.get("/api/v1/me", headers=headers)
    assert me.status_code == 200 and me.json()["employee"]["id"] == emp_a.id
    queue = client.get("/api/v1/queue", headers=headers)
    assert queue.status_code == 200 and [i["contact"]["id"] for i in queue.json()["items"]] == [contact.id]
    created = client.post(
        "/api/v1/calls",
        headers=headers,
        json={"client_call_id": "outage-call-0001", "contact_id": contact.id, "started_at": "2026-10-02T10:00:00Z"},
    )
    assert created.status_code in (200, 201), created.text
    beat = client.post("/api/v1/me/heartbeat", headers=headers, json={"app_state": "foreground", "battery_percent": 50, "network": "wifi"})
    assert beat.status_code == 200, beat.text
    assert client.get("/api/v1/analytics/live", headers=admin_headers).status_code == 200
    assert client.get("/api/v1/analytics/employees", headers=admin_headers).status_code == 200
    assert client.get("/api/v1/dashboard", headers=headers).status_code == 200
    login = client.post("/api/v1/auth/login", json={"identifier": emp_a.email, "password": PASSWORD})
    assert login.status_code == 200, login.text  # signing in needs no Redis: the rate limit lets the request through
    elapsed = time.monotonic() - started
    assert elapsed < 4.0, f"{elapsed:.1f} s for a dozen requests without Redis"  # the guard: one 0.15 s wait, then straight refusals

    # the probes: the process is alive (health), but the service says honestly that Redis is missing (ready)
    assert client.get("/health").status_code == 200
    ready = client.get("/ready")
    assert ready.status_code in (200, 503) and ready.json()["checks"]["redis"] in ("error", "redis")


def test_a_pool_that_has_no_free_connection_answers_503_with_retry_after(client):
    from sqlalchemy.exc import TimeoutError as PoolTimeoutError

    router = APIRouter()

    @router.get("/__pool")
    def _pool():
        raise PoolTimeoutError("QueuePool limit of size 3 overflow 1 reached, connection timed out, timeout 10.00")

    client.app.include_router(router, prefix="/api/v1")
    try:
        answer = client.get("/api/v1/__pool")
    finally:
        client.app.router.routes[:] = [r for r in client.app.router.routes if getattr(r, "path", "") != "/api/v1/__pool"]
    assert answer.status_code == 503
    assert answer.json()["error"]["code"] == "database_busy" and answer.headers["retry-after"] == "2"


def test_epochs_and_caches_do_not_serve_anything_while_redis_is_down(redis_that_dies):
    redis_that_dies.up = False
    assert cache.epochs("settings") is None
    assert cache.stamped_get("anything", "settings") is None
    assert cache.get_json("anything") is None
    assert cache.once_per("x", 5) is True  # "cannot tell: let the caller do the work"
