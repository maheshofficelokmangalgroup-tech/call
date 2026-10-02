"""The queue, the dashboard, the settings and the admin figures are remembered for a few seconds - and forgotten the moment the rows
they are built from change. Asserted here: the repeat is free (no database query), and nothing is ever stale after a change."""

from __future__ import annotations

from tests.test_auth_cache import counting_queries
from tests.test_calls_queue import dispose, queue_ids, start_call
from tests.conftest import auth_headers


# ------------------------------------------------------------------------------------------------------ the queue
def test_a_repeated_queue_request_costs_no_database_query(client, make, emp_a, as_a):
    for _ in range(3):
        make.contact(assign_to=emp_a)
    first = client.get("/api/v1/queue", headers=as_a)
    assert first.status_code == 200 and first.json()["total"] == 3
    with counting_queries() as repeat:
        again = client.get("/api/v1/queue", headers=as_a)
    assert again.json()["items"] == first.json()["items"]
    assert repeat.count == 0, repeat.statements


def test_the_queue_follows_every_change_at_once(client, make, emp_a, as_a, as_admin):
    one = make.contact(assign_to=emp_a)
    assert queue_ids(client, as_a) == [one.id]
    assert queue_ids(client, as_a) == [one.id]  # remembered

    # an administrator hands over another contact (a bulk statement)
    two = make.contact()
    handed = client.post("/api/v1/contacts/assign", headers=as_admin, json={"contact_ids": [two.id], "employee_ids": [emp_a.id]})
    assert handed.status_code == 200, handed.text
    assert set(queue_ids(client, as_a)) == {one.id, two.id}

    # taking one back
    taken = client.post("/api/v1/contacts/unassign", headers=as_admin, json={"contact_ids": [two.id]})
    assert taken.status_code == 200, taken.text
    assert queue_ids(client, as_a) == [one.id]

    # the employee finishes a call with a final outcome: the contact leaves the queue on the very next request
    call = start_call(client, as_a, one, cid="queue-final-001").json()
    assert dispose(client, as_a, call["id"], "NOT_INTERESTED").status_code == 200
    assert queue_ids(client, as_a) == []


def test_a_callback_shows_up_in_the_queue_at_once(client, make, emp_a, as_a):
    contact = make.contact(assign_to=emp_a)
    assert client.get("/api/v1/queue", headers=as_a).json()["due_callbacks"] == 0
    call = start_call(client, as_a, contact, cid="queue-callback-01").json()
    from datetime import timedelta

    from app.core.timeutils import utcnow
    from tests.conftest import iso

    done = dispose(client, as_a, call["id"], "CALLBACK", callback_at=iso(utcnow() + timedelta(hours=1)))
    assert done.status_code == 200, done.text
    item = client.get("/api/v1/queue", headers=as_a).json()["items"][0]
    assert item["reason"] == "callback" and item["callback"] is not None


def test_one_employees_queue_is_never_served_to_another(client, make, emp_a, emp_b, as_a, as_b):
    mine, theirs = make.contact(assign_to=emp_a), make.contact(assign_to=emp_b)
    assert queue_ids(client, as_a) == [mine.id]
    assert queue_ids(client, as_b) == [theirs.id]
    assert queue_ids(client, as_a) == [mine.id]


def test_pausing_a_campaign_empties_the_queue_at_once(client, make, emp_a, as_a, as_admin):
    campaign = make.campaign(status="active")
    contact = make.contact(assign_to=emp_a, campaign=campaign)
    assert queue_ids(client, as_a) == [contact.id]
    assert queue_ids(client, as_a) == [contact.id]
    paused = client.patch(f"/api/v1/campaigns/{campaign.id}", headers=as_admin, json={"status": "paused"})
    assert paused.status_code == 200, paused.text
    assert queue_ids(client, as_a) == []


# ------------------------------------------------------------------------------------------------------ the dashboard
def test_the_employees_dashboard_counts_a_new_call_at_once(client, make, emp_a, as_a):
    contact = make.contact(assign_to=emp_a)
    before = client.get("/api/v1/dashboard", headers=as_a).json()
    assert client.get("/api/v1/dashboard", headers=as_a).json()["total_calls"] == before["total_calls"] == 0
    assert start_call(client, as_a, contact, cid="dash-call-0001").status_code == 201
    assert client.get("/api/v1/dashboard", headers=as_a).json()["total_calls"] == 1


def test_a_repeated_dashboard_request_costs_no_database_query(client, make, emp_a, as_a):
    make.contact(assign_to=emp_a)
    client.get("/api/v1/dashboard", headers=as_a)
    with counting_queries() as repeat:
        assert client.get("/api/v1/dashboard", headers=as_a).status_code == 200
    assert repeat.count == 0, repeat.statements


# ------------------------------------------------------------------------------------------------------ settings and /me
def test_settings_are_remembered_and_a_change_is_seen_at_once(client, as_admin, as_a):
    first = client.get("/api/v1/me", headers=as_a).json()["config"]["recording"]["enabled"]
    assert first is False
    with counting_queries() as repeat:
        client.get("/api/v1/me", headers=as_a)
    assert repeat.count <= 2, repeat.statements  # the unread count is remembered too; nothing else is asked
    changed = client.put("/api/v1/settings/recording", headers=as_admin, json={"value": {"enabled": True, "notice_text": "Calls are recorded."}})
    assert changed.status_code == 200, changed.text
    assert client.get("/api/v1/me", headers=as_a).json()["config"]["recording"] == {
        **client.get("/api/v1/me", headers=as_a).json()["config"]["recording"],
        "enabled": True,
        "notice_text": "Calls are recorded.",
    }


def test_the_phone_is_told_how_often_to_report_and_sync(client, as_a):
    config = client.get("/api/v1/me", headers=as_a).json()["config"]
    assert config["heartbeat_seconds"] > 0 and config["sync_interval_seconds"] > 0


def test_unread_notifications_follow_reads_at_once(client, make, emp_a, as_a, db):
    from app.services import notification_service

    assert client.get("/api/v1/me", headers=as_a).json()["config"]["unread_notifications"] == 0
    notification_service.notify(db, emp_a.id, type="info", title="Hello")
    db.commit()
    assert client.get("/api/v1/me", headers=as_a).json()["config"]["unread_notifications"] == 1
    assert client.post("/api/v1/notifications/read-all", headers=as_a).status_code == 200
    assert client.get("/api/v1/me", headers=as_a).json()["config"]["unread_notifications"] == 0


# ------------------------------------------------------------------------------------------------------ the admin panel's figures
def test_the_live_view_is_worked_out_once_for_everybody(client, make, emp_a, as_admin):
    first = client.get("/api/v1/analytics/live", headers=as_admin)
    assert first.status_code == 200
    with counting_queries() as repeat:
        second = client.get("/api/v1/analytics/live", headers=as_admin)
    assert second.json() == first.json()
    assert repeat.count == 0, repeat.statements


def test_a_managers_figures_are_never_served_to_an_administrator_or_another_team(client, make):
    team_one, team_two = make.team("One"), make.team("Two")
    boss = make.employee(role="manager", code="MGR1", email="mgr1@example.com", team=team_one)
    other_boss = make.employee(role="manager", code="MGR2", email="mgr2@example.com", team=team_two)
    admin = make.employee(role="admin", code="ADM2", email="adm2@example.com")
    make.employee(code="TM1", email="tm1@example.com", team=team_one)
    make.employee(code="TM2", email="tm2@example.com", team=team_two)
    make.employee(code="TM3", email="tm3@example.com", team=team_two)

    totals = {}
    for name, user in (("one", boss), ("two", other_boss), ("admin", admin)):
        headers = auth_headers(client, user)
        for _ in range(2):  # the second time is the remembered answer
            stats = client.get("/api/v1/analytics/employees", headers=headers).json()
        totals[name] = stats["total"]
    assert totals["one"] == 2  # the manager and one team member
    assert totals["two"] == 3  # the manager and two team members
    assert totals["admin"] == 6  # everybody: two managers, the administrator and three team members


def test_the_admin_figures_serialise_exactly_as_before(client, make, emp_a, as_admin):
    """What is remembered is the response model's own JSON: a cached answer has the same shape as a fresh one."""
    fresh = client.get("/api/v1/analytics/employees", headers=as_admin).json()
    remembered = client.get("/api/v1/analytics/employees", headers=as_admin).json()
    assert fresh == remembered
    assert "role" in fresh["items"][0] and "role_name" not in fresh["items"][0]
