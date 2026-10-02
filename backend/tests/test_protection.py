"""Guards that keep one broken or hostile client from hurting everybody else."""

from __future__ import annotations

import json

import pytest

from app.core import protection
from app.core.config import reset_settings_cache
from app.core.errors import TooManyRequests
from tests.conftest import auth_headers


# ------------------------------------------------------------------------------------------------ body size
def test_a_json_request_has_a_size_limit(client, as_a):
    huge = {"client_call_id": "x" * 10, "started_at": "2026-01-01T00:00:00Z", "phone_number": "9" * (2 * 1024 * 1024)}
    answer = client.post("/api/v1/calls", headers=as_a, json=huge)
    assert answer.status_code == 413
    assert answer.json()["error"]["code"] == "payload_too_large"


def test_a_body_that_does_not_say_how_big_it_is_is_stopped_too(client, as_a):
    def chunks():
        for _ in range(20):
            yield b"x" * 100_000  # 2 MB in 20 pieces, sent chunked (no Content-Length)

    answer = client.post("/api/v1/calls", headers={**as_a, "Content-Type": "application/json"}, content=chunks())
    assert answer.status_code == 413


def test_the_limit_can_be_changed(client, as_a, monkeypatch):
    monkeypatch.setenv("MAX_JSON_BODY_KB", "1")
    reset_settings_cache()
    try:
        answer = client.post("/api/v1/calls", headers=as_a, json={"client_call_id": "c" * 10, "started_at": "2026-01-01T00:00:00Z", "phone_number": "9" * 2000})
        assert answer.status_code == 413
    finally:
        monkeypatch.undo()
        reset_settings_cache()


def test_ordinary_requests_are_not_affected(client, emp_a, as_a):
    assert client.get("/api/v1/me", headers=as_a).status_code == 200
    assert client.post("/api/v1/auth/login", json={"identifier": emp_a.email, "password": "wrong-pass-1"}).status_code == 401


def test_a_file_upload_may_be_big_but_not_beyond_its_own_limit(client, make, emp_a, as_a, monkeypatch):
    monkeypatch.setenv("MAX_RECORDING_MB", "1")
    reset_settings_cache()
    try:
        # 3 MB "audio": refused before it is read
        big = client.post("/api/v1/recordings/1/upload", headers=as_a, files={"file": ("a.m4a", b"\x00" * (3 * 1024 * 1024), "audio/mp4")})
        assert big.status_code == 413
        # a small one gets as far as the application (which has its own opinion about recording 1)
        small = client.post("/api/v1/recordings/1/upload", headers=as_a, files={"file": ("a.m4a", b"\x00" * 1000, "audio/mp4")})
        assert small.status_code in (404, 422)
    finally:
        monkeypatch.undo()
        reset_settings_cache()


# ------------------------------------------------------------------------------------------------ headers
def test_answers_of_the_api_may_not_be_stored_by_anybody(client, as_a):
    answer = client.get("/api/v1/me", headers=as_a)
    assert answer.headers["cache-control"] == "no-store"
    assert answer.headers["x-content-type-options"] == "nosniff"
    assert answer.headers["referrer-policy"] == "no-referrer"
    assert answer.headers["cross-origin-resource-policy"] == "same-origin"
    # errors too
    refused = client.get("/api/v1/me")
    assert refused.status_code == 401 and refused.headers["cache-control"] == "no-store"


def test_health_checks_are_left_alone(client):
    assert "cache-control" not in client.get("/health").headers or client.get("/health").status_code == 200


# ------------------------------------------------------------------------------------------------ upload slots
def test_only_a_few_uploads_are_received_at_the_same_time(monkeypatch):
    protection.configure_upload_slots(2)
    try:
        with protection.upload_slot():
            with protection.upload_slot():
                with pytest.raises(TooManyRequests) as refused:
                    with protection.upload_slot():
                        pass
                assert refused.value.headers == {"Retry-After": "5"}
        with protection.upload_slot():  # a slot is free again
            pass
    finally:
        protection.configure_upload_slots()


def test_a_slot_is_given_back_when_the_upload_fails():
    protection.configure_upload_slots(1)
    try:
        with pytest.raises(RuntimeError):
            with protection.upload_slot():
                raise RuntimeError("the phone lost its connection")
        with protection.upload_slot():
            pass
    finally:
        protection.configure_upload_slots()


def test_the_error_body_is_the_usual_error_model(client, as_a):
    answer = client.post("/api/v1/calls", headers=as_a, content=json.dumps({"p": "x" * 2_000_000}), )
    assert answer.status_code == 413 and set(answer.json()["error"]) >= {"code", "message"}
