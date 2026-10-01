"""Assignment rules, employee/team/campaign administration, audit trail, notifications, configuration safety."""

from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from app.core.config import Settings
from app.models.contact import ContactAssignment
from app.models.system import AuditLog
from app.services.assignment_service import plan_distribution
from tests.conftest import PASSWORD, auth_headers, login


# ------------------------------------------------------------------ assignment
class Emp:  # minimal stand-in for plan_distribution
    def __init__(self, id):
        self.id = id


def test_distribution_strategies_are_pure_and_fair():
    emps = [Emp(1), Emp(2), Emp(3)]
    rr = plan_distribution(list(range(10)), emps, "round_robin", {})
    assert {k: len(v) for k, v in rr.items()} == {1: 4, 2: 3, 3: 3}
    balanced = plan_distribution(list(range(10)), emps, "balanced", {1: 10, 2: 0, 3: 4})
    assert len(balanced[2]) > len(balanced[3]) > len(balanced.get(1, []))  # the least loaded employee gets the most
    assert sum(len(v) for v in balanced.values()) == 10
    single = plan_distribution([1, 2, 3], emps, "single", {})
    assert single == {1: [1, 2, 3]}


def test_assign_by_ids_to_a_team_and_skip_already_assigned(client, make, emp_a, emp_b, as_admin, db):
    team = make.team("Closers")
    emp_a.team_id = emp_b.team_id = team.id
    db.commit()
    contacts = [make.contact() for _ in range(6)]
    owned = make.contact(assign_to=make.employee())
    ids = [c.id for c in contacts] + [owned.id]

    resp = client.post("/api/v1/contacts/assign", headers=as_admin, json={"contact_ids": ids, "team_id": team.id, "strategy": "round_robin"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert (body["total"], body["assigned"], body["skipped_already_assigned"]) == (7, 6, 1)
    assert sorted(body["per_employee"].values()) == [3, 3]
    assert db.query(ContactAssignment).filter_by(status="active").count() == 7  # 6 new + the pre-existing owner


def test_reassign_moves_ownership_and_keeps_history(client, make, emp_a, emp_b, as_admin, db):
    contact = make.contact(assign_to=emp_a)
    resp = client.post("/api/v1/contacts/assign", headers=as_admin, json={"contact_ids": [contact.id], "employee_ids": [emp_b.id], "reassign": True})
    assert resp.json()["reassigned"] == 1
    rows = db.query(ContactAssignment).filter_by(contact_id=contact.id).order_by(ContactAssignment.id).all()
    assert [(r.employee_id, r.status) for r in rows] == [(emp_a.id, "released"), (emp_b.id, "active")]
    assert rows[0].active_contact_id is None and rows[0].released_at is not None
    # assigning to the current owner again is a no-op
    again = client.post("/api/v1/contacts/assign", headers=as_admin, json={"contact_ids": [contact.id], "employee_ids": [emp_b.id], "reassign": True})
    assert again.json()["assigned"] == 0 and again.json()["skipped_already_assigned"] == 1


def test_the_database_itself_refuses_two_active_owners(make, emp_a, emp_b, db):
    contact = make.contact(assign_to=emp_a)
    db.add(ContactAssignment(contact_id=contact.id, employee_id=emp_b.id, status="active", active_contact_id=contact.id))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_ineligible_contacts_are_not_assigned(client, make, emp_a, as_admin):
    dnc = make.contact(status="do_not_contact")
    invalid = make.contact(status="invalid")
    ok = make.contact()
    resp = client.post("/api/v1/contacts/assign", headers=as_admin, json={"contact_ids": [dnc.id, invalid.id, ok.id, 99999], "employee_ids": [emp_a.id]}).json()
    assert (resp["assigned"], resp["skipped_ineligible"]) == (1, 3)


def test_assign_by_filter_requires_a_filter_and_inactive_employees_are_refused(client, make, emp_a, as_admin):
    make.contact(name="Needle One")
    make.contact(name="Needle Two")
    make.contact(name="Other")
    assert client.post("/api/v1/contacts/assign", headers=as_admin, json={"employee_ids": [emp_a.id]}).json()["error"]["code"] == "no_contact_selection"
    resp = client.post("/api/v1/contacts/assign", headers=as_admin, json={"q": "needle", "employee_ids": [emp_a.id]}).json()
    assert resp["assigned"] == 2
    inactive = make.employee(active=False)
    bad = client.post("/api/v1/contacts/assign", headers=as_admin, json={"q": "other", "employee_ids": [inactive.id]})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "no_target_employees"


def test_unassign_releases_contacts(client, make, emp_a, as_admin, as_a):
    contact = make.contact(assign_to=emp_a)
    assert client.post("/api/v1/contacts/unassign", headers=as_admin, json={"contact_ids": [contact.id]}).status_code == 200
    assert client.get("/api/v1/contacts", headers=as_a).json()["total"] == 0


def test_employees_are_notified_of_new_assignments(client, make, emp_a, as_admin, as_a):
    contacts = [make.contact() for _ in range(3)]
    client.post("/api/v1/contacts/assign", headers=as_admin, json={"contact_ids": [c.id for c in contacts], "employee_ids": [emp_a.id]})
    assert client.get("/api/v1/notifications/unread-count", headers=as_a).json() == {"unread": 1}
    items = client.get("/api/v1/notifications", headers=as_a).json()["items"]
    assert items[0]["title"] == "3 new contacts assigned" and items[0]["is_read"] is False
    client.post(f"/api/v1/notifications/{items[0]['id']}/read", headers=as_a)
    assert client.get("/api/v1/notifications/unread-count", headers=as_a).json() == {"unread": 0}
    assert client.get("/api/v1/me", headers=as_a).json()["config"]["unread_notifications"] == 0


# ------------------------------------------------------------ employee admin
def test_admin_creates_an_employee_with_a_temporary_password_that_must_be_changed(client, as_admin):
    created = client.post(
        "/api/v1/employees", headers=as_admin, json={"email": "New.Hire@Example.com", "full_name": "New Hire", "daily_target": 40}
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["employee"]["email"] == "new.hire@example.com" and body["employee"]["employee_code"].startswith("EMP")
    assert body["employee"]["daily_target"] == 40 and body["temporary_password"]

    tokens = login(client, "new.hire@example.com", body["temporary_password"])
    assert tokens["must_change_password"] is True

    dup_email = client.post("/api/v1/employees", headers=as_admin, json={"email": "new.hire@example.com", "full_name": "Again"})
    assert dup_email.status_code == 409 and dup_email.json()["error"]["code"] == "email_taken"
    weak = client.post("/api/v1/employees", headers=as_admin, json={"email": "x@example.com", "full_name": "Weak Pw", "password": "abc"})
    assert weak.status_code == 422


def test_admin_update_deactivate_reset_and_self_protection(client, make, admin, emp_a, as_admin):
    upd = client.patch(f"/api/v1/employees/{emp_a.id}", headers=as_admin, json={"full_name": "Renamed Person", "role": "manager", "daily_target": 10})
    assert upd.status_code == 200 and upd.json()["role"] == "manager" and upd.json()["daily_target"] == 10
    assert client.patch(f"/api/v1/employees/{admin.id}", headers=as_admin, json={"role": "employee"}).status_code == 422
    assert client.post(f"/api/v1/employees/{admin.id}/deactivate", headers=as_admin).status_code == 422

    emp_headers = auth_headers(client, emp_a)
    assert client.post(f"/api/v1/employees/{emp_a.id}/deactivate", headers=as_admin).json()["is_active"] is False
    assert client.get("/api/v1/me", headers=emp_headers).status_code in (401, 403)
    assert client.post(f"/api/v1/employees/{emp_a.id}/activate", headers=as_admin).json()["is_active"] is True

    reset = client.post(f"/api/v1/employees/{emp_a.id}/reset-password", headers=as_admin, json={}).json()["temporary_password"]
    assert client.post("/api/v1/auth/login", json={"identifier": emp_a.email, "password": PASSWORD}).status_code == 401
    assert login(client, emp_a.email, reset)["must_change_password"] is True


def test_employee_list_filters_and_teams_crud(client, make, emp_a, emp_b, as_admin):
    team = client.post("/api/v1/teams", headers=as_admin, json={"name": "West"}).json()
    assert client.post("/api/v1/teams", headers=as_admin, json={"name": "west"}).status_code == 409
    client.patch(f"/api/v1/employees/{emp_a.id}", headers=as_admin, json={"team_id": team["id"]})
    listing = client.get(f"/api/v1/employees?team_id={team['id']}", headers=as_admin).json()
    assert [e["id"] for e in listing["items"]] == [emp_a.id] and listing["items"][0]["team_name"] == "West"
    assert client.get("/api/v1/employees?q=employee%20b", headers=as_admin).json()["total"] == 1
    assert client.get("/api/v1/employees?role=admin", headers=as_admin).json()["total"] == 1
    assert client.get("/api/v1/teams", headers=as_admin).json()[0]["member_count"] == 1
    assert client.delete(f"/api/v1/teams/{team['id']}", headers=as_admin).status_code == 409  # still has members
    client.patch(f"/api/v1/employees/{emp_a.id}", headers=as_admin, json={"clear_team": True})
    assert client.delete(f"/api/v1/teams/{team['id']}", headers=as_admin).status_code == 204


# ------------------------------------------------------------------ campaigns
def test_campaign_lifecycle_distribution_and_progress(client, make, emp_a, emp_b, as_admin, as_a, db):
    created = client.post("/api/v1/campaigns", headers=as_admin, json={"name": "Festival", "status": "draft", "priority": 1, "target_calls": 100})
    assert created.status_code == 201
    cid = created.json()["id"]
    assert client.post("/api/v1/campaigns", headers=as_admin, json={"name": "festival"}).status_code == 409
    contacts = [make.contact() for _ in range(4)]
    attach = client.post(f"/api/v1/campaigns/{cid}/contacts", headers=as_admin, json={"contact_ids": [c.id for c in contacts]}).json()
    assert attach == {"added": 4}
    assert client.post(f"/api/v1/campaigns/{cid}/contacts", headers=as_admin, json={"contact_ids": [contacts[0].id]}).json() == {"added": 0}

    client.post(f"/api/v1/campaigns/{cid}/assignees", headers=as_admin, json={"employee_ids": [emp_a.id, emp_b.id]})
    assert client.post(f"/api/v1/campaigns/{cid}/distribute", headers=as_admin, json={}).status_code == 409  # still a draft
    client.patch(f"/api/v1/campaigns/{cid}", headers=as_admin, json={"status": "active"})
    dist = client.post(f"/api/v1/campaigns/{cid}/distribute", headers=as_admin, json={"strategy": "round_robin"}).json()
    assert dist["assigned"] == 4 and sorted(dist["per_employee"].values()) == [2, 2]

    mine = client.get("/api/v1/campaigns", headers=as_a).json()
    assert [c["name"] for c in mine] == ["Festival"] and mine[0]["contact_count"] == 4
    assert client.get(f"/api/v1/campaigns/{cid}", headers=as_a).status_code == 200
    other = make.campaign("Unrelated")
    assert client.get(f"/api/v1/campaigns/{other.id}", headers=as_a).status_code == 404

    queue_item = client.get("/api/v1/queue", headers=as_a).json()["items"][0]
    call = client.post(
        "/api/v1/calls", headers=as_a,
        json={"client_call_id": "camp-call-0001", "contact_id": queue_item["contact"]["id"], "started_at": datetime.now(timezone.utc).isoformat()},
    ).json()
    assert call["campaign_id"] == cid  # the call inherits the campaign of the assignment
    client.post(f"/api/v1/calls/{call['id']}/disposition", headers=as_a, json={"disposition_code": "COMPLETED"})
    progress = client.get(f"/api/v1/campaigns/{cid}/progress", headers=as_admin).json()
    assert progress["campaign"]["completed_count"] == 1 and progress["campaign"]["completion_percent"] == 25.0
    assert progress["campaign"]["calls_made"] == 1 and progress["calls_by_employee"][0]["calls"] == 1


# ---------------------------------------------------------- audit & hardening
def test_security_relevant_actions_leave_an_audit_trail_without_secrets(client, make, emp_a, as_admin, db):
    login(client, emp_a.email)
    client.post("/api/v1/auth/login", json={"identifier": emp_a.email, "password": "wrong-password-1"})
    created = client.post("/api/v1/employees", headers=as_admin, json={"email": "audit@example.com", "full_name": "Audit Me", "password": "Sup3r-Secret-Pw"}).json()
    client.post(f"/api/v1/employees/{created['employee']['id']}/reset-password", headers=as_admin, json={"new_password": "An0ther-Secret-Pw"})

    actions = {a.action for a in db.query(AuditLog)}
    assert {"auth.login", "auth.login_failed", "employee.create", "employee.reset_password"} <= actions
    dump = " ".join(str(a.details) for a in db.query(AuditLog))
    assert "Sup3r-Secret-Pw" not in dump and "An0ther-Secret-Pw" not in dump

    logs = client.get("/api/v1/audit-logs?action=auth.", headers=as_admin).json()
    assert logs["total"] >= 2 and all(i["action"].startswith("auth.") for i in logs["items"])


def test_production_refuses_weak_secrets_and_debug():
    with pytest.raises(ValueError, match="JWT_SECRET"):
        Settings(app_env="production", jwt_secret="change-me", _env_file=None)
    with pytest.raises(ValueError, match="JWT_SECRET"):
        Settings(app_env="staging", jwt_secret="short", _env_file=None)
    with pytest.raises(ValueError, match="APP_DEBUG"):
        Settings(app_env="production", jwt_secret="x" * 40, app_debug=True, _env_file=None)
    with pytest.raises(ValueError, match="AWS_S3_BUCKET"):
        Settings(app_env="production", jwt_secret="x" * 40, storage_backend="s3", _env_file=None)
    ok = Settings(app_env="production", jwt_secret="x" * 40, _env_file=None)
    assert ok.is_production


def test_api_docs_are_disabled_in_production(monkeypatch):
    from app.core import config
    from app.main import create_app

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("JWT_SECRET", "p" * 48)
    config.reset_settings_cache()
    try:
        app = create_app()
        assert app.docs_url is None and app.openapi_url is None
    finally:
        monkeypatch.undo()
        config.reset_settings_cache()


def test_env_files_with_secrets_are_git_ignored():
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    ignore = (root / ".gitignore").read_text()
    for pattern in (".env", "*.pem", "var/"):
        assert pattern in ignore
    assert (root / ".env.example").exists()
    example = (root / ".env.example").read_text()
    assert "AKIA" not in example and "<" in example  # placeholders only, no real keys
