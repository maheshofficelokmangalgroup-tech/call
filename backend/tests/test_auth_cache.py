"""The signed-in session is remembered in Redis: speed without ever keeping a person signed in who should not be."""

from __future__ import annotations

import threading
from contextlib import contextmanager

import pytest
from fastapi import APIRouter
from sqlalchemy import event

from app.api.deps import CurrentEmployee
from app.core import cache
from app.core.config import get_settings, reset_settings_cache
from app.core.database import get_engine
from app.core.redis_client import get_redis
from tests.conftest import DEVICE, PASSWORD, auth_headers, login


class QueryCounter:
    def __init__(self) -> None:
        self.statements: list[str] = []
        self._lock = threading.Lock()

    def __call__(self, conn, cursor, statement, parameters, context, executemany):
        with self._lock:
            self.statements.append(statement.strip().split("\n")[0][:90])

    @property
    def count(self) -> int:
        return len(self.statements)


@contextmanager
def counting_queries():
    counter = QueryCounter()
    engine = get_engine()
    event.listen(engine, "before_cursor_execute", counter)
    try:
        yield counter
    finally:
        event.remove(engine, "before_cursor_execute", counter)


@pytest.fixture()
def probe(client):
    """A route that does nothing but authenticate: what it costs is what authentication costs."""
    router = APIRouter()

    @router.get("/__probe")
    def _probe(user: CurrentEmployee):
        return {"id": user.id, "role": user.role_name, "team": user.team_name, "active": user.is_active, "must_change": user.must_change_password}

    client.app.include_router(router, prefix="/api/v1")
    yield "/api/v1/__probe"
    client.app.router.routes[:] = [r for r in client.app.router.routes if getattr(r, "path", "") != "/api/v1/__probe"]


# -------------------------------------------------------------------------------------------------- speed
def test_a_remembered_session_needs_no_database_query(client, emp_a, probe):
    headers = auth_headers(client, emp_a)
    cold = client.get(probe, headers=headers)  # the first request asks the database and remembers the answer
    assert cold.status_code == 200
    with counting_queries() as warm_queries:
        warm = client.get(probe, headers=headers)
    assert warm.status_code == 200 and warm.json() == cold.json()
    assert warm_queries.count == 0, warm_queries.statements


def test_the_first_request_costs_what_it_always_did(client, emp_a, probe):
    headers = auth_headers(client, emp_a)
    with counting_queries() as first:
        assert client.get(probe, headers=headers).status_code == 200
    assert 2 <= first.count <= 6, first.statements  # the session, the employee, and the once-a-minute "last seen" write


def test_the_database_decides_when_redis_is_not_there(client, emp_a, probe, monkeypatch):
    monkeypatch.setattr(cache, "enabled", lambda: False)
    headers = auth_headers(client, emp_a)
    with counting_queries() as q:
        assert client.get(probe, headers=headers).status_code == 200
        assert client.get(probe, headers=headers).status_code == 200
    assert q.count >= 4  # nothing is remembered: every request asks


def test_a_remembered_session_answers_like_the_database(client, make, probe, monkeypatch):
    team = make.team("Closers")
    employee = make.employee(code="TEAM1", email="team1@example.com", team=team)
    headers = auth_headers(client, employee)
    first = client.get("/api/v1/me", headers=headers).json()
    warm = client.get("/api/v1/me", headers=headers).json()  # served from what was remembered
    monkeypatch.setattr(cache, "enabled", lambda: False)
    cold = client.get("/api/v1/me", headers=headers).json()  # asked of the database
    assert warm["employee"] == cold["employee"] == first["employee"]
    assert warm["employee"]["team_name"] == "Closers"


# -------------------------------------------------------------------------------------------------- never wrong
def test_sign_out_is_felt_by_the_very_next_request(client, emp_a, probe):
    headers = auth_headers(client, emp_a)
    assert client.get(probe, headers=headers).status_code == 200
    assert client.get(probe, headers=headers).status_code == 200  # remembered by now
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 204
    gone = client.get(probe, headers=headers)
    assert gone.status_code == 401 and gone.json()["error"]["code"] == "session_revoked"


def test_deactivating_an_employee_is_felt_at_once(client, emp_a, probe, as_admin):
    headers = auth_headers(client, emp_a)
    for _ in range(2):
        assert client.get(probe, headers=headers).status_code == 200
    assert client.post(f"/api/v1/employees/{emp_a.id}/deactivate", headers=as_admin).status_code == 200
    assert client.get(probe, headers=headers).status_code in (401, 403)


def test_signing_everybody_out_is_felt_at_once(client, emp_a, probe, as_admin):
    first = auth_headers(client, emp_a)
    second = auth_headers(client, emp_a)
    for headers in (first, second):
        assert client.get(probe, headers=headers).status_code == 200
        assert client.get(probe, headers=headers).status_code == 200
    assert client.post(f"/api/v1/employees/{emp_a.id}/revoke-sessions", headers=as_admin).status_code == 200
    assert client.get(probe, headers=first).status_code == 401
    assert client.get(probe, headers=second).status_code == 401


def test_resetting_the_password_is_felt_at_once(client, emp_a, probe, as_admin):
    headers = auth_headers(client, emp_a)
    assert client.get(probe, headers=headers).status_code == 200
    assert client.get(probe, headers=headers).status_code == 200
    assert client.post(f"/api/v1/employees/{emp_a.id}/reset-password", json={}, headers=as_admin).status_code == 200
    assert client.get(probe, headers=headers).status_code == 401


def test_a_new_role_and_a_new_team_are_seen_by_the_next_request(client, emp_a, make, probe, as_admin):
    team = make.team("Closers")
    headers = auth_headers(client, emp_a)
    assert client.get(probe, headers=headers).json() == {"id": emp_a.id, "role": "employee", "team": None, "active": True, "must_change": False}
    assert client.get(probe, headers=headers).status_code == 200
    assert client.get("/api/v1/analytics/overview", headers=headers).status_code == 403  # an employee has no analytics

    changed = client.patch(f"/api/v1/employees/{emp_a.id}", json={"role": "manager", "team_id": team.id}, headers=as_admin)
    assert changed.status_code == 200, changed.text

    after = client.get(probe, headers=headers).json()
    assert after["role"] == "manager" and after["team"] == "Closers"
    assert client.get("/api/v1/analytics/overview", headers=headers).status_code == 200


def test_changing_the_password_with_a_remembered_session(client, emp_a, probe):
    mine = auth_headers(client, emp_a)
    other_phone = auth_headers(client, emp_a)
    for headers in (mine, other_phone):
        assert client.get(probe, headers=headers).status_code == 200
        assert client.get(probe, headers=headers).status_code == 200

    done = client.post("/api/v1/auth/change-password", json={"current_password": PASSWORD, "new_password": "Brand-new-9pass"}, headers=mine)
    assert done.status_code == 200, done.text
    assert client.get(probe, headers=mine).status_code == 200  # the session that made the change carries on
    assert client.get(probe, headers=other_phone).status_code == 401  # every other one is signed out at once
    assert client.post("/api/v1/auth/login", json={"identifier": emp_a.email, "password": PASSWORD, "device": DEVICE}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"identifier": emp_a.email, "password": "Brand-new-9pass", "device": DEVICE}).status_code == 200


def test_a_wrong_current_password_is_still_refused_with_a_remembered_session(client, emp_a, probe):
    headers = auth_headers(client, emp_a)
    client.get(probe, headers=headers)
    refused = client.post("/api/v1/auth/change-password", json={"current_password": "not-it-at-all-1", "new_password": "Brand-new-9pass"}, headers=headers)
    assert refused.status_code == 401 and refused.json()["error"]["code"] == "invalid_credentials"


def test_a_cached_session_is_dropped_when_the_epoch_moves(client, emp_a, probe):
    headers = auth_headers(client, emp_a)
    client.get(probe, headers=headers)
    with counting_queries() as warm:
        client.get(probe, headers=headers)
    assert warm.count == 0
    cache.bump_now(f"emp:{emp_a.id}")  # what every edit of the employee does after its commit
    with counting_queries() as after_bump:
        assert client.get(probe, headers=headers).status_code == 200
    assert after_bump.count >= 2


def test_nothing_is_remembered_for_a_session_that_is_not_valid(client, emp_a, probe, db):
    from app.models.employee import EmployeeSession

    headers = auth_headers(client, emp_a)
    row = db.query(EmployeeSession).one()
    row.revoked_at = row.created_at
    db.commit()
    for _ in range(2):
        assert client.get(probe, headers=headers).status_code == 401


def test_the_cache_can_be_switched_off(client, emp_a, probe, monkeypatch):
    monkeypatch.setenv("AUTH_CACHE_SECONDS", "0")
    reset_settings_cache()
    try:
        headers = auth_headers(client, emp_a)
        client.get(probe, headers=headers)
        with counting_queries() as q:
            assert client.get(probe, headers=headers).status_code == 200
        assert q.count >= 2
    finally:
        monkeypatch.undo()
        reset_settings_cache()


# -------------------------------------------------------------------------------------------------- the temporary password
def test_a_temporary_password_only_opens_the_password_screens(client, make, probe):
    newcomer = make.employee(code="NEW1", email="new1@example.com", must_change=True)
    headers = auth_headers(client, newcomer)
    assert client.get("/api/v1/me", headers=headers).status_code == 200
    blocked = client.get("/api/v1/queue", headers=headers)
    assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "password_change_required"
    assert client.get(probe, headers=headers).status_code == 403
    assert client.get("/api/v1/calls", headers=headers).status_code == 403

    done = client.post("/api/v1/auth/change-password", json={"current_password": PASSWORD, "new_password": "Own-password-7x"}, headers=headers)
    assert done.status_code == 200, done.text
    assert client.get("/api/v1/queue", headers=headers).status_code == 200  # opened at once
    assert client.get(probe, headers=headers).json()["must_change"] is False


def test_a_temporary_password_can_still_sign_out(client, make):
    newcomer = make.employee(code="NEW2", email="new2@example.com", must_change=True)
    headers = auth_headers(client, newcomer)
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 204


# -------------------------------------------------------------------------------------------------- limits
def test_one_person_cannot_flood_the_api(client, make, emp_a, probe, monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_USER_PER_MINUTE", "5")
    reset_settings_cache()
    try:
        headers = auth_headers(client, emp_a)
        codes = [client.get(probe, headers=headers).status_code for _ in range(8)]
        assert codes[:5] == [200] * 5 and set(codes[5:]) == {429}
        limited = client.get(probe, headers=headers)
        assert limited.json()["error"]["code"] == "rate_limited" and int(limited.headers["Retry-After"]) >= 1
        # somebody else is not affected
        assert client.get(probe, headers=auth_headers(client, make.employee(code="OTHR", email="other@example.com"))).status_code == 200
    finally:
        monkeypatch.undo()
        reset_settings_cache()


def test_the_settings_defaults_are_sane():
    settings = get_settings()
    assert settings.auth_cache_seconds >= 0 and settings.rate_limit_user_per_minute >= 0
    assert get_redis() is not None
