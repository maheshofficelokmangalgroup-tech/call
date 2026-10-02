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


# ------------------------------------------------------------------------------------------------------ never older than a change
def test_a_changed_setting_shows_in_the_admin_figures_at_once(client, as_admin):
    """Found by the browser test: the dashboard went on saying "recording is on" for several seconds after an administrator switched
    it off, because the figures were only kept for a few seconds and not cleared by the change."""
    assert client.get("/api/v1/analytics/overview", headers=as_admin).json()["recording"]["enabled"] is False
    assert client.get("/api/v1/analytics/overview", headers=as_admin).json()["recording"]["enabled"] is False  # remembered
    changed = client.put("/api/v1/settings/recording", headers=as_admin, json={"value": {"enabled": True, "notice_text": "Calls are recorded."}})
    assert changed.status_code == 200, changed.text
    assert client.get("/api/v1/analytics/overview", headers=as_admin).json()["recording"]["enabled"] is True


def test_a_new_or_deactivated_person_shows_in_the_admin_list_at_once(client, make, as_admin):
    before = client.get("/api/v1/analytics/employees", headers=as_admin).json()["total"]
    assert client.get("/api/v1/analytics/employees", headers=as_admin).json()["total"] == before  # remembered
    created = client.post("/api/v1/employees", headers=as_admin, json={"email": "fresh.face@example.com", "full_name": "Fresh Face", "password": "Sup3r-Secret-Pw"})
    assert created.status_code == 201, created.text
    listed = client.get("/api/v1/analytics/employees", headers=as_admin).json()
    assert listed["total"] == before + 1
    new_id = created.json()["employee"]["id"]

    assert client.post(f"/api/v1/employees/{new_id}/deactivate", headers=as_admin).status_code == 200
    row = next(i for i in client.get("/api/v1/analytics/employees", headers=as_admin).json()["items"] if i["id"] == new_id)
    assert row["is_active"] is False and row["presence"] == "inactive"


def test_signing_in_does_not_clear_the_admin_figures(client, make, emp_a, as_admin):
    """A sign-in only changes "last sign-in" of one person: the figures built for everybody stay valid (otherwise the morning rush
    of sign-ins would make every refresh of the panel hit the database)."""
    client.get("/api/v1/analytics/employees", headers=as_admin)
    auth_headers(client, emp_a)  # signs in: the employee's row is changed
    with counting_queries() as repeat:
        assert client.get("/api/v1/analytics/employees", headers=as_admin).status_code == 200
    assert repeat.count == 0, repeat.statements


# ------------------------------------------------------------------------------------------------------ the queue under load
def test_an_outcome_clears_the_queue_of_the_person_who_made_it_and_nobody_elses(client, make, emp_a, emp_b, as_a, as_b):
    """Hundreds of phones record outcomes all day: if each outcome cleared every queue, no queue would ever be remembered."""
    mine, theirs = make.contact(assign_to=emp_a), make.contact(assign_to=emp_b)
    assert queue_ids(client, as_a) == [mine.id] and queue_ids(client, as_b) == [theirs.id]

    call = start_call(client, as_a, mine, cid="isolated-queue-01").json()
    assert dispose(client, as_a, call["id"], "NOT_INTERESTED").status_code == 200

    with counting_queries() as other:
        assert queue_ids(client, as_b) == [theirs.id]
    assert other.count == 0, other.statements  # B's remembered queue was not touched by A's work
    assert queue_ids(client, as_a) == []  # A's own queue is up to date at once


def test_a_contact_an_administrator_edits_is_fresh_in_every_queue(client, make, emp_a, emp_b, as_a, as_b, as_admin):
    mine, theirs = make.contact(assign_to=emp_a, priority=3), make.contact(assign_to=emp_b)
    other = make.contact(assign_to=emp_a, priority=2)
    assert queue_ids(client, as_a) == [other.id, mine.id]
    assert queue_ids(client, as_b) == [theirs.id]
    assert client.patch(f"/api/v1/contacts/{mine.id}", headers=as_admin, json={"priority": 1}).status_code == 200
    assert queue_ids(client, as_a) == [mine.id, other.id]  # the edit changed the order at once
