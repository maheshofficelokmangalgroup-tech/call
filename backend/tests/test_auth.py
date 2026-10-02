from app.core.config import get_settings
from app.models.employee import EmployeeDevice, EmployeeSession
from app.models.system import AuditLog
from tests.conftest import DEVICE, PASSWORD, auth_headers, login


def test_health_and_ready(client):
    assert client.get("/health").json()["status"] == "ok"
    ready = client.get("/ready")
    assert ready.status_code == 200
    assert ready.json()["checks"]["database"] == "ok"


def test_login_with_email_and_employee_id(client, emp_a):
    by_email = login(client, emp_a.email)
    by_code = login(client, emp_a.employee_code.lower())  # employee IDs are case-insensitive
    assert by_email["employee"]["id"] == emp_a.id == by_code["employee"]["id"]
    assert by_email["employee"]["role"] == "employee"
    assert by_email["token_type"] == "bearer"
    assert by_email["expires_in"] == get_settings().jwt_access_ttl_minutes * 60


def test_login_wrong_password_and_unknown_user_look_identical(client, emp_a):
    bad_pw = client.post("/api/v1/auth/login", json={"identifier": emp_a.email, "password": "nope-nope-1"})
    unknown = client.post("/api/v1/auth/login", json={"identifier": "ghost@example.com", "password": "nope-nope-1"})
    assert bad_pw.status_code == unknown.status_code == 401
    assert bad_pw.json()["error"]["code"] == unknown.json()["error"]["code"] == "invalid_credentials"
    assert bad_pw.json()["error"]["message"] == unknown.json()["error"]["message"]


def test_deactivated_account_cannot_login_or_use_existing_token(client, make, emp_a):
    headers = auth_headers(client, emp_a)
    assert client.get("/api/v1/me", headers=headers).status_code == 200

    emp_a.is_active = False
    make.db.commit()

    assert client.get("/api/v1/me", headers=headers).json()["error"]["code"] == "account_disabled"
    resp = client.post("/api/v1/auth/login", json={"identifier": emp_a.email, "password": PASSWORD})
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "account_disabled"


def test_protected_endpoints_require_a_valid_token(client):
    assert client.get("/api/v1/me").status_code == 401
    assert client.get("/api/v1/me", headers={"Authorization": "Bearer not-a-token"}).json()["error"]["code"] == "invalid_token"


def test_refresh_rotates_token_and_detects_reuse(client, emp_a, db):
    data = login(client, emp_a.email)
    first = data["refresh_token"]

    rotated = client.post("/api/v1/auth/refresh", json={"refresh_token": first})
    assert rotated.status_code == 200
    second = rotated.json()["refresh_token"]
    assert second != first

    # old token is still tolerated inside the short grace window (lost-response retry)
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": first}).status_code == 200

    # force the grace window to be over, then replay the very first token: session must be killed
    session_id = first.split(".")[0]
    sess = db.get(EmployeeSession, session_id)
    from datetime import timedelta

    from app.core.timeutils import utcnow

    sess.prev_valid_until = utcnow() - timedelta(seconds=1)
    db.commit()
    replay = client.post("/api/v1/auth/refresh", json={"refresh_token": first})
    assert replay.status_code == 401
    # the legitimate newest token is dead too (whole session revoked)
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": second}).status_code == 401


def test_logout_revokes_session_immediately(client, emp_a):
    data = login(client, emp_a.email)
    headers = {"Authorization": f"Bearer {data['access_token']}"}
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 204
    assert client.get("/api/v1/me", headers=headers).json()["error"]["code"] == "session_revoked"
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": data["refresh_token"]}).status_code == 401


def test_admin_can_revoke_employee_sessions_remotely(client, emp_a, as_admin):
    headers = auth_headers(client, emp_a)
    assert client.get("/api/v1/me", headers=headers).status_code == 200
    resp = client.post(f"/api/v1/employees/{emp_a.id}/revoke-sessions", headers=as_admin)
    assert resp.status_code == 200
    assert client.get("/api/v1/me", headers=headers).status_code == 401


def test_change_password_flow(client, emp_a):
    other_device = login(client, emp_a.email, device={**DEVICE, "device_uid": "second-device-01"})
    headers = auth_headers(client, emp_a)

    weak = client.post("/api/v1/auth/change-password", headers=headers, json={"current_password": PASSWORD, "new_password": "short"})
    assert weak.status_code == 422 and weak.json()["error"]["code"] == "weak_password"

    wrong = client.post("/api/v1/auth/change-password", headers=headers, json={"current_password": "wrong", "new_password": "BrandNew-Pass9"})
    assert wrong.status_code == 401

    ok = client.post("/api/v1/auth/change-password", headers=headers, json={"current_password": PASSWORD, "new_password": "BrandNew-Pass9"})
    assert ok.status_code == 200
    assert client.get("/api/v1/me", headers=headers).status_code == 200  # current session survives
    assert client.get("/api/v1/me", headers={"Authorization": f"Bearer {other_device['access_token']}"}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"identifier": emp_a.email, "password": PASSWORD}).status_code == 401
    login(client, emp_a.email, password="BrandNew-Pass9")


def test_login_rate_limit(client, emp_a):
    settings = get_settings()
    for _ in range(settings.rate_limit_login_per_identifier):
        client.post("/api/v1/auth/login", json={"identifier": emp_a.email, "password": "wrong-pass-1"})
    blocked = client.post("/api/v1/auth/login", json={"identifier": emp_a.email, "password": PASSWORD})
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "rate_limited"
    assert int(blocked.headers["Retry-After"]) > 0


def test_device_binding_blocks_a_second_device(client, make, admin):
    emp = make.employee(code="BOUND")
    emp.device_binding_enabled = True
    make.db.commit()

    login(client, emp.email, device={**DEVICE, "device_uid": "first-device-01"})  # trust on first use
    blocked = client.post(
        "/api/v1/auth/login",
        json={"identifier": emp.email, "password": PASSWORD, "device": {**DEVICE, "device_uid": "other-device-99"}},
    )
    assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "device_not_allowed"

    # admin unbinds the old device -> the new one can register
    admin_headers = auth_headers(client, admin)
    devices = client.get(f"/api/v1/employees/{emp.id}/devices", headers=admin_headers).json()
    assert len(devices) == 1
    assert client.delete(f"/api/v1/employees/{emp.id}/devices/{devices[0]['id']}", headers=admin_headers).status_code == 204
    login(client, emp.email, device={**DEVICE, "device_uid": "other-device-99"})


def test_me_returns_server_driven_config(client, as_a):
    data = client.get("/api/v1/me", headers=as_a).json()
    codes = [d["code"] for d in data["config"]["dispositions"]]
    assert codes == [
        "CONNECTED", "NO_ANSWER", "BUSY", "SWITCHED_OFF", "INVALID_NUMBER", "INTERESTED",
        "NOT_INTERESTED", "CALLBACK", "FOLLOW_UP", "COMPLETED", "DO_NOT_CONTACT",
    ]
    assert data["config"]["recording"]["enabled"] is False
    assert data["config"]["timezone"] == "Asia/Kolkata"


def test_validation_errors_use_the_uniform_error_shape(client):
    resp = client.post("/api/v1/auth/login", json={"identifier": ""})
    assert resp.status_code == 422
    body = resp.json()["error"]
    assert body["code"] == "validation_error"
    assert {d["field"] for d in body["details"]} >= {"identifier", "password"}


WEB = {"device_uid": "admin-panel", "name": "Admin panel (Chrome on Windows)", "platform": "web"}


def test_browser_sign_ins_never_become_registered_devices(client, make, admin, db):
    login(client, admin.email, device=WEB)
    assert db.query(EmployeeDevice).filter(EmployeeDevice.employee_id == admin.id).count() == 0
    session = db.query(EmployeeSession).filter(EmployeeSession.employee_id == admin.id).one()
    assert session.device_id is None and session.user_agent  # still visible as a sign-in, with its browser


def test_the_panel_refuses_employees_without_opening_a_session(client, emp_a, db):
    refused = client.post("/api/v1/auth/login", json={"identifier": emp_a.email, "password": PASSWORD, "device": WEB})
    assert refused.status_code == 403 and refused.json()["error"]["code"] == "panel_not_allowed"
    assert "access_token" not in refused.text
    assert db.query(EmployeeSession).filter(EmployeeSession.employee_id == emp_a.id).count() == 0
    assert db.query(EmployeeDevice).filter(EmployeeDevice.employee_id == emp_a.id).count() == 0
    blocked = db.query(AuditLog).filter(AuditLog.action == "auth.login_blocked", AuditLog.actor_id == emp_a.id).all()
    assert [b.details["reason"] for b in blocked] == ["panel_not_allowed"]
    # the same account still signs in on its phone
    assert login(client, emp_a.email)["employee"]["id"] == emp_a.id


def test_trying_the_panel_cannot_take_the_place_of_a_bound_phone(client, make, db):
    emp = make.employee(code="BOUND2")
    emp.device_binding_enabled = True
    db.commit()
    client.post("/api/v1/auth/login", json={"identifier": emp.email, "password": PASSWORD, "device": WEB})  # refused
    # the first real phone is still the one that gets registered...
    login(client, emp.email, device={**DEVICE, "device_uid": "the-real-phone-01"})
    assert [d.device_uid for d in db.query(EmployeeDevice).filter(EmployeeDevice.employee_id == emp.id)] == ["the-real-phone-01"]
    # ...and a second phone is still turned away
    blocked = client.post("/api/v1/auth/login", json={"identifier": emp.email, "password": PASSWORD, "device": {**DEVICE, "device_uid": "other-phone-02"}})
    assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "device_not_allowed"


def test_managers_may_use_the_panel(client, make, db):
    manager = make.employee(role="manager", code="MGRW", email="mgrw@example.com")
    assert login(client, manager.email, device=WEB)["employee"]["role"] == "manager"
    assert db.query(EmployeeDevice).filter(EmployeeDevice.employee_id == manager.id).count() == 0
