"""The open app reports that it is alive and how the phone is - and the admin panel sees it, without a database write per report."""

from __future__ import annotations

import pytest

from app.core.config import reset_settings_cache
from app.models.employee import EmployeeDevice
from tests.conftest import auth_headers
from tests.test_auth_cache import counting_queries


@pytest.fixture(autouse=True)
def _figures_are_never_remembered(monkeypatch):
    """The admin figures are remembered for a few seconds; these tests look at each report the moment it is made."""
    monkeypatch.setenv("ANALYTICS_CACHE_SECONDS", "0")
    reset_settings_cache()
    yield
    monkeypatch.undo()
    reset_settings_cache()


REPORT = {
    "app_state": "foreground",
    "battery_percent": 63,
    "charging": False,
    "network": "wifi",
    "app_version": "1.2.0",
    "os_version": "14",
    "pending_sync": 2,
    "permissions_ok": True,
    "missing_permissions": [],
    "on_call": False,
}


def beat(client, headers, **changes):
    return client.post("/api/v1/me/heartbeat", headers=headers, json={**REPORT, **changes})


def status_of(client, admin_headers, employee):
    items = client.get("/api/v1/analytics/employees", headers=admin_headers).json()["items"]
    return next(i for i in items if i["id"] == employee.id)


def test_a_phone_can_report_and_is_told_when_to_report_again(client, emp_a, as_a):
    answer = beat(client, as_a)
    assert answer.status_code == 200
    assert answer.json()["next_in_seconds"] > 0 and answer.json()["server_time"]


def test_the_report_reaches_the_admin_panel_at_once(client, emp_a, as_a, as_admin):
    assert status_of(client, as_admin, emp_a)["device_status"] is None  # nothing heard yet
    assert beat(client, as_a, battery_percent=17, charging=True, network="cellular", pending_sync=5).status_code == 200
    seen = status_of(client, as_admin, emp_a)
    assert seen["device_status"]["live"] is True
    assert seen["device_status"]["battery_percent"] == 17 and seen["device_status"]["charging"] is True
    assert seen["device_status"]["network"] == "cellular" and seen["device_status"]["pending_sync"] == 5
    assert seen["device_status"]["permissions_ok"] is True and seen["device_status"]["missing_permissions"] == []
    assert seen["presence"] in ("online", "on_call")


def test_a_missing_permission_is_visible_to_the_administrator(client, emp_a, as_a, as_admin):
    assert beat(client, as_a, permissions_ok=False, missing_permissions=["microphone", "call_log"]).status_code == 200
    status = status_of(client, as_admin, emp_a)["device_status"]
    assert status["permissions_ok"] is False and status["missing_permissions"] == ["microphone", "call_log"]


def test_most_reports_cost_the_database_nothing(client, emp_a, as_a):
    assert beat(client, as_a).status_code == 200  # the first one is saved on the device's row
    with counting_queries() as q:
        assert beat(client, as_a, battery_percent=61).status_code == 200
        assert beat(client, as_a, battery_percent=60).status_code == 200
    assert q.count == 0, q.statements


def test_the_first_report_and_an_important_change_are_saved_on_the_device(client, emp_a, as_a, db):
    assert beat(client, as_a, battery_percent=80).status_code == 200
    db.expire_all()
    device = db.query(EmployeeDevice).filter(EmployeeDevice.employee_id == emp_a.id).one()
    assert device.battery_percent == 80 and device.network_type == "wifi" and device.last_heartbeat_at is not None

    # a permission taken away is worth a write straight away, not in five minutes
    assert beat(client, as_a, battery_percent=79, permissions_ok=False, missing_permissions=["microphone"]).status_code == 200
    db.expire_all()
    device = db.query(EmployeeDevice).filter(EmployeeDevice.employee_id == emp_a.id).one()
    assert device.permissions_ok is False and device.missing_permissions == "microphone" and device.battery_percent == 79


def test_the_app_version_follows_an_update(client, emp_a, as_a, db):
    beat(client, as_a, app_version="1.1.0")
    beat(client, as_a, app_version="1.2.0")
    db.expire_all()
    assert db.query(EmployeeDevice).filter(EmployeeDevice.employee_id == emp_a.id).one().app_version == "1.2.0"


def test_a_clock_that_is_wrong_is_noticed(client, emp_a, as_a, as_admin):
    from datetime import timedelta

    from app.core.timeutils import utcnow
    from tests.conftest import iso

    assert beat(client, as_a, client_time=iso(utcnow() + timedelta(minutes=42))).status_code == 200
    skew = status_of(client, as_admin, emp_a)["device_status"]["clock_skew_seconds"]
    assert 41 * 60 <= skew <= 43 * 60


def test_nonsense_is_refused(client, as_a):
    assert beat(client, as_a, battery_percent=150).status_code == 422
    assert beat(client, as_a, network="carrier-pigeon").status_code == 422
    assert beat(client, as_a, missing_permissions=["x" * 40]).status_code == 422
    assert beat(client, as_a, pending_sync=-1).status_code == 422
    assert client.post("/api/v1/me/heartbeat", json=REPORT).status_code == 401  # signed in only


def test_a_temporary_password_cannot_report_yet(client, make):
    newcomer = make.employee(code="HB1", email="hb1@example.com", must_change=True)
    headers = auth_headers(client, newcomer)
    assert beat(client, headers).json()["error"]["code"] == "password_change_required"


def test_a_manager_sees_only_their_own_teams_phones(client, make):
    mine, other = make.team("Mine"), make.team("Other")
    boss = make.employee(role="manager", code="HBM", email="hbm@example.com", team=mine)
    worker = make.employee(code="HBW", email="hbw@example.com", team=mine)
    stranger = make.employee(code="HBX", email="hbx@example.com", team=other)
    for person in (worker, stranger):
        assert beat(client, auth_headers(client, person), battery_percent=55).status_code == 200
    items = client.get("/api/v1/analytics/employees", headers=auth_headers(client, boss)).json()["items"]
    assert {i["id"] for i in items} == {boss.id, worker.id}
    assert next(i for i in items if i["id"] == worker.id)["device_status"]["battery_percent"] == 55
