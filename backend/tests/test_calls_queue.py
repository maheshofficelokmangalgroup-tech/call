"""Acceptance: one primary call record per call, retries are separate attempts, callbacks appear in the queue,
deactivated employees cannot create calls, outcomes drive the contact state machine."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import update

from app.core.timeutils import day_bounds_utc, utcnow
from app.models.contact import Contact, ContactAssignment
from tests.conftest import auth_headers, iso, now_utc


def start_call(client, headers, contact=None, *, cid="call-0000001", phone=None, started=None, campaign_id=None):
    body = {"client_call_id": cid, "started_at": iso(started or now_utc())}
    if contact is not None:
        body["contact_id"] = contact.id
    if phone:
        body["phone_number"] = phone
    if campaign_id:
        body["campaign_id"] = campaign_id
    return client.post("/api/v1/calls", headers=headers, json=body)


def dispose(client, headers, call_id, code, **extra):
    return client.post(f"/api/v1/calls/{call_id}/disposition", headers=headers, json={"disposition_code": code, **extra})


def queue_ids(client, headers):
    return [i["contact"]["id"] for i in client.get("/api/v1/queue", headers=headers).json()["items"]]


def reload(db, contact):
    db.expire_all()
    return db.get(Contact, contact.id)


# ------------------------------------------------------------------ creation
def test_completed_call_creates_exactly_one_primary_record(client, make, emp_a, as_a, db):
    contact = make.contact(assign_to=emp_a)
    first = start_call(client, as_a, contact)
    assert first.status_code == 201
    replay = start_call(client, as_a, contact)  # the sync queue retried after a lost response
    assert replay.status_code == 200
    assert replay.json()["id"] == first.json()["id"]
    assert client.get("/api/v1/calls", headers=as_a).json()["total"] == 1
    assert reload(db, contact).call_count == 1


def test_retry_attempts_are_separate_and_numbered(client, make, emp_a, as_a):
    contact = make.contact(assign_to=emp_a)
    one = start_call(client, as_a, contact, cid="attempt-0000001").json()
    two = start_call(client, as_a, contact, cid="attempt-0000002").json()
    assert one["id"] != two["id"]
    assert (one["attempt_number"], two["attempt_number"]) == (1, 2)


def test_call_requires_assignment_but_manual_numbers_are_allowed(client, make, emp_a, emp_b, as_a):
    theirs = make.contact(assign_to=emp_b)
    assert start_call(client, as_a, theirs).status_code == 404
    manual = start_call(client, as_a, phone="+91 98765 11111", cid="manual-000001")
    assert manual.status_code == 201
    assert manual.json()["contact_id"] is None and manual.json()["phone_number"] == "+919876511111"
    assert start_call(client, as_a, phone="123", cid="manual-000002").status_code == 422


def test_manual_dial_of_a_known_assigned_number_links_the_contact(client, make, emp_a, as_a):
    contact = make.contact(phone="9876522222", assign_to=emp_a)
    resp = start_call(client, as_a, phone="98765 22222", cid="manual-000003").json()
    assert resp["contact_id"] == contact.id


def test_deactivated_employee_cannot_create_calls(client, make, emp_a, as_a):
    contact = make.contact(assign_to=emp_a)
    emp_a.is_active = False
    make.db.commit()
    resp = start_call(client, as_a, contact)
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "account_disabled"
    assert make.db.query(Contact).get(contact.id).call_count == 0


def test_do_not_contact_blocks_new_calls(client, make, emp_a, as_a):
    contact = make.contact(assign_to=emp_a, status="do_not_contact")
    resp = start_call(client, as_a, contact)
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "contact_do_not_contact"


def test_started_at_sanity_checks(client, make, emp_a, as_a):
    contact = make.contact(assign_to=emp_a)
    future = start_call(client, as_a, contact, cid="future-000001", started=now_utc() + timedelta(hours=2))
    ancient = start_call(client, as_a, contact, cid="ancient-00001", started=now_utc() - timedelta(days=30))
    offline = start_call(client, as_a, contact, cid="offline-00001", started=now_utc() - timedelta(days=2))
    assert future.status_code == ancient.status_code == 422
    assert offline.status_code == 201  # calls made offline are accepted when synced later


# ------------------------------------------------------------ device lifecycle
def test_lifecycle_events_drive_status_and_are_replay_safe(client, make, emp_a, as_a):
    contact = make.contact(assign_to=emp_a)
    t0 = now_utc() - timedelta(minutes=2)
    call = start_call(client, as_a, contact, started=t0).json()
    events = {
        "events": [
            {"event_type": "dialing", "occurred_at": iso(t0)},
            {"event_type": "ringing", "occurred_at": iso(t0 + timedelta(seconds=3))},
            {"event_type": "connected", "occurred_at": iso(t0 + timedelta(seconds=12))},
            {"event_type": "ended", "occurred_at": iso(t0 + timedelta(seconds=72))},
        ]
    }
    assert client.post(f"/api/v1/calls/{call['id']}/events", headers=as_a, json=events).json() == {"added": 4}
    assert client.post(f"/api/v1/calls/{call['id']}/events", headers=as_a, json=events).json() == {"added": 0}

    detail = client.get(f"/api/v1/calls/{call['id']}", headers=as_a).json()
    assert detail["status"] == "completed"
    assert detail["duration_seconds"] == 60
    assert [e["event_type"] for e in detail["events"]] == ["initiated", "dialing", "ringing", "connected", "ended"]


def test_call_log_reconciliation_marks_answered_or_no_answer(client, make, emp_a, as_a):
    contact = make.contact(assign_to=emp_a)
    t0 = now_utc() - timedelta(minutes=3)
    answered = start_call(client, as_a, contact, cid="sync-0000001", started=t0).json()
    patched = client.patch(
        f"/api/v1/calls/{answered['id']}",
        headers=as_a,
        json={"ended_at": iso(t0 + timedelta(seconds=100)), "duration_seconds": 75, "external_call_reference": "calllog-881"},
    ).json()
    assert patched["status"] == "completed" and patched["duration_seconds"] == 75
    assert patched["answered_at"] is not None

    missed = start_call(client, as_a, contact, cid="sync-0000002", started=t0).json()
    patched = client.patch(f"/api/v1/calls/{missed['id']}", headers=as_a, json={"ended_at": iso(t0 + timedelta(seconds=30)), "duration_seconds": 0}).json()
    assert patched["status"] == "no_answer" and patched["answered_at"] is None

    too_long = client.patch(f"/api/v1/calls/{missed['id']}", headers=as_a, json={"duration_seconds": 5000})
    assert too_long.status_code == 422


# ----------------------------------------------------------------- dispositions
def test_no_answer_uses_retry_rules_then_contact_becomes_unreachable(client, make, emp_a, as_a, db):
    contact = make.contact(assign_to=emp_a)
    assert queue_ids(client, as_a) == [contact.id]

    for attempt in (1, 2):
        call = start_call(client, as_a, contact, cid=f"retry-00000{attempt}").json()
        resp = dispose(client, as_a, call["id"], "NO_ANSWER")
        assert resp.status_code == 200 and resp.json()["status"] == "no_answer"
        c = reload(db, contact)
        assert c.status == "in_progress" and c.failed_attempts == attempt
        delta = c.next_eligible_at - utcnow()
        assert timedelta(minutes=118) < delta < timedelta(minutes=121)  # default rule: retry in 120 minutes
        assert queue_ids(client, as_a) == []  # cooling down
        c.next_eligible_at = utcnow() - timedelta(seconds=1)  # time passes
        db.commit()
        assert queue_ids(client, as_a) == [contact.id]

    third = start_call(client, as_a, contact, cid="retry-000003").json()
    dispose(client, as_a, third["id"], "NO_ANSWER")
    c = reload(db, contact)
    assert c.status == "unreachable" and c.failed_attempts == 3  # default max attempts reached
    assert queue_ids(client, as_a) == []


def test_busy_and_switched_off_have_their_own_delays(client, make, emp_a, as_a, db):
    busy = make.contact(assign_to=emp_a)
    off = make.contact(assign_to=emp_a)
    dispose(client, as_a, start_call(client, as_a, busy, cid="busy-0000001").json()["id"], "BUSY")
    dispose(client, as_a, start_call(client, as_a, off, cid="off-00000001").json()["id"], "SWITCHED_OFF")
    assert timedelta(minutes=28) < reload(db, busy).next_eligible_at - utcnow() < timedelta(minutes=31)
    assert timedelta(minutes=238) < reload(db, off).next_eligible_at - utcnow() < timedelta(minutes=241)


def test_connected_outcome_rests_the_contact_until_tomorrow_and_resets_failures(client, make, emp_a, as_a, db):
    contact = make.contact(assign_to=emp_a, failed_attempts=2)
    call = start_call(client, as_a, contact).json()
    resp = dispose(client, as_a, call["id"], "CONNECTED", notes="Spoke to owner")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "completed" and body["answered_at"] is not None
    assert [n["body"] for n in body["notes"]] == ["Spoke to owner"]
    c = reload(db, contact)
    assert c.failed_attempts == 0 and c.next_eligible_at == day_bounds_utc()[1]
    assert queue_ids(client, as_a) == []


def test_terminal_outcomes_leave_the_queue(client, make, emp_a, as_a, db):
    expected = {
        "INVALID_NUMBER": "invalid",
        "INTERESTED": "interested",
        "NOT_INTERESTED": "not_interested",
        "COMPLETED": "completed",
        "DO_NOT_CONTACT": "do_not_contact",
    }
    for i, (code, status) in enumerate(expected.items()):
        contact = make.contact(assign_to=emp_a)
        call = start_call(client, as_a, contact, cid=f"terminal-{i:05d}").json()
        assert dispose(client, as_a, call["id"], code).status_code == 200
        assert reload(db, contact).status == status
    assert queue_ids(client, as_a) == []


def test_callback_and_followup_require_a_time(client, make, emp_a, as_a):
    contact = make.contact(assign_to=emp_a)
    call = start_call(client, as_a, contact).json()
    for code in ("CALLBACK", "FOLLOW_UP"):
        resp = dispose(client, as_a, call["id"], code)
        assert resp.status_code == 422 and resp.json()["error"]["code"] == "callback_required"
    past = dispose(client, as_a, call["id"], "CALLBACK", callback_at=iso(now_utc() - timedelta(days=1)))
    assert past.status_code == 422 and past.json()["error"]["code"] == "callback_in_past"


def test_callback_scheduling_appears_in_the_employees_queue(client, make, emp_a, as_a, db):
    contact = make.contact(assign_to=emp_a)
    call = start_call(client, as_a, contact).json()
    _, day_end = day_bounds_utc()
    when = utcnow() + (day_end - utcnow()) / 2  # guaranteed to be later today
    resp = dispose(client, as_a, call["id"], "CALLBACK", callback_at=iso(when), callback_note="After lunch")
    assert resp.status_code == 200 and resp.json()["callback_at"] is not None

    q = client.get("/api/v1/queue", headers=as_a).json()
    assert [i["contact"]["id"] for i in q["items"]] == [contact.id]
    item = q["items"][0]
    assert item["reason"] == "callback" and item["callback"]["note"] == "After lunch" and item["callback"]["overdue"] is False
    assert reload(db, contact).status == "callback"

    cbs = client.get("/api/v1/callbacks", headers=as_a).json()
    assert cbs["total"] == 1 and cbs["items"][0]["contact"]["id"] == contact.id


def test_due_callbacks_jump_to_the_top_and_are_fulfilled_by_the_next_outcome(client, make, emp_a, as_a, db):
    regular = make.contact(name="Regular", assign_to=emp_a, priority=1)
    callback_contact = make.contact(name="Callback me", assign_to=emp_a, priority=3)
    resp = client.post(
        "/api/v1/callbacks",
        headers=as_a,
        json={"contact_id": callback_contact.id, "scheduled_at": iso(now_utc() - timedelta(minutes=1)), "note": "promised"},
    )
    assert resp.status_code == 201 and resp.json()["overdue"] is True

    q = client.get("/api/v1/queue", headers=as_a).json()
    assert [i["contact"]["id"] for i in q["items"]] == [callback_contact.id, regular.id]
    assert q["due_callbacks"] == 1

    call = start_call(client, as_a, callback_contact).json()
    dispose(client, as_a, call["id"], "COMPLETED")
    assert client.get("/api/v1/callbacks", headers=as_a).json()["total"] == 0  # fulfilled
    assert client.get("/api/v1/callbacks?status=done", headers=as_a).json()["total"] == 1


def test_queue_ordering_left_over_first_then_priority_then_never_called_first(client, make, emp_a, as_a):
    low = make.contact(name="low", assign_to=emp_a, priority=3)
    called_before = make.contact(name="mid-called", assign_to=emp_a, priority=2, call_count=1, last_called_at=utcnow() - timedelta(days=1))
    fresh_mid = make.contact(name="mid-fresh", assign_to=emp_a, priority=2)
    high = make.contact(name="high", assign_to=emp_a, priority=1)
    later = make.contact(name="later-callback", assign_to=emp_a, priority=1)
    _, day_end = day_bounds_utc()
    client.post("/api/v1/callbacks", headers=as_a, json={"contact_id": later.id, "scheduled_at": iso(utcnow() + (day_end - utcnow()) / 2)})
    # called yesterday = still waiting from an earlier day, so it leads; today's contacts follow by priority
    assert queue_ids(client, as_a) == [called_before.id, high.id, fresh_mid.id, low.id, later.id]


def test_contacts_left_over_from_earlier_days_are_listed_first(client, make, emp_a, as_a, db):
    today_high = make.contact(name="assigned-today-high", assign_to=emp_a, priority=1)
    yesterday_low = make.contact(name="assigned-yesterday-low", assign_to=emp_a, priority=3)
    yesterday_high = make.contact(name="assigned-yesterday-high", assign_to=emp_a, priority=1)
    db.execute(
        update(ContactAssignment)
        .where(ContactAssignment.contact_id.in_([yesterday_low.id, yesterday_high.id]))
        .values(assigned_at=utcnow() - timedelta(days=1))
    )
    db.commit()
    assert queue_ids(client, as_a) == [yesterday_high.id, yesterday_low.id, today_high.id]


def test_queue_respects_campaign_status_and_ownership(client, make, emp_a, emp_b, as_a):
    active = make.campaign("Active", status="active")
    paused = make.campaign("Paused", status="paused")
    a = make.contact(assign_to=emp_a, campaign=active)
    make.contact(assign_to=emp_a, campaign=paused)
    make.contact(assign_to=emp_b, campaign=active)
    free = make.contact(assign_to=emp_a)
    assert set(queue_ids(client, as_a)) == {a.id, free.id}


def test_queue_rows_carry_campaign_and_reason(client, make, emp_a, as_a):
    camp = make.campaign("Diwali Offer")
    make.contact(assign_to=emp_a, campaign=camp)
    make.contact(assign_to=emp_a, call_count=2, last_called_at=utcnow() - timedelta(days=2))
    items = client.get("/api/v1/queue", headers=as_a).json()["items"]
    reasons = {i["reason"] for i in items}
    assert reasons == {"new", "retry"}
    assert any(i["campaign"] == {"id": camp.id, "name": "Diwali Offer"} for i in items)


# ------------------------------------------------------------- conflict & IDOR
def test_disposition_is_idempotent_but_never_silently_overwritten(client, make, emp_a, as_a, db):
    contact = make.contact(assign_to=emp_a)
    call = start_call(client, as_a, contact).json()
    assert dispose(client, as_a, call["id"], "NO_ANSWER").status_code == 200
    assert dispose(client, as_a, call["id"], "NO_ANSWER").status_code == 200  # replay from the sync queue
    assert reload(db, contact).failed_attempts == 1  # the replay did not count twice
    changed = dispose(client, as_a, call["id"], "INTERESTED")
    assert changed.status_code == 409 and changed.json()["error"]["code"] == "disposition_already_set"
    assert dispose(client, as_a, call["id"], "NOT_A_CODE").status_code in (409, 422)


def test_unknown_disposition_is_rejected(client, make, emp_a, as_a):
    call = start_call(client, as_a, make.contact(assign_to=emp_a)).json()
    resp = dispose(client, as_a, call["id"], "MADE_UP")
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "unknown_disposition"


def test_employee_cannot_read_or_modify_other_employees_calls_and_callbacks(client, make, emp_a, emp_b, as_a, as_b):
    contact = make.contact(assign_to=emp_a)
    call = start_call(client, as_a, contact).json()
    cb = client.post("/api/v1/callbacks", headers=as_a, json={"contact_id": contact.id, "scheduled_at": iso(now_utc() + timedelta(hours=1))}).json()

    assert client.get(f"/api/v1/calls/{call['id']}", headers=as_b).status_code == 404
    assert client.patch(f"/api/v1/calls/{call['id']}", headers=as_b, json={"duration_seconds": 5}).status_code == 404
    assert dispose(client, as_b, call["id"], "COMPLETED").status_code == 404
    assert client.post(f"/api/v1/calls/{call['id']}/events", headers=as_b, json={"events": [{"event_type": "ended", "occurred_at": iso(now_utc())}]}).status_code == 404
    assert client.patch(f"/api/v1/callbacks/{cb['id']}", headers=as_b, json={"status": "cancelled"}).status_code == 404
    assert client.get("/api/v1/calls", headers=as_b).json()["total"] == 0
    assert client.get("/api/v1/callbacks", headers=as_b).json()["total"] == 0


def test_callbacks_can_be_rescheduled_and_cancelled(client, make, emp_a, as_a, db):
    contact = make.contact(assign_to=emp_a)
    cb = client.post("/api/v1/callbacks", headers=as_a, json={"contact_id": contact.id, "scheduled_at": iso(now_utc() + timedelta(hours=2))}).json()
    later = now_utc() + timedelta(days=1)
    moved = client.patch(f"/api/v1/callbacks/{cb['id']}", headers=as_a, json={"scheduled_at": iso(later)}).json()
    assert datetime.fromisoformat(moved["scheduled_at"]) == later
    assert reload(db, contact).next_eligible_at == later  # the contact now waits for the new time
    cancelled = client.patch(f"/api/v1/callbacks/{cb['id']}", headers=as_a, json={"status": "cancelled"})
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    assert reload(db, contact).status == "in_progress"  # callback flag cleared
    again = client.patch(f"/api/v1/callbacks/{cb['id']}", headers=as_a, json={"scheduled_at": iso(later)})
    assert again.status_code == 409


def test_reassigning_a_contact_cancels_the_previous_owners_callbacks(client, make, emp_a, emp_b, as_a, as_b, as_admin):
    contact = make.contact(assign_to=emp_a)
    client.post("/api/v1/callbacks", headers=as_a, json={"contact_id": contact.id, "scheduled_at": iso(now_utc() + timedelta(hours=1))})
    resp = client.post("/api/v1/contacts/assign", headers=as_admin, json={"contact_ids": [contact.id], "employee_ids": [emp_b.id], "reassign": True})
    assert resp.status_code == 200 and resp.json()["reassigned"] == 1
    assert client.get("/api/v1/callbacks", headers=as_a).json()["total"] == 0
    assert client.get(f"/api/v1/contacts/{contact.id}", headers=as_a).status_code == 404
    assert client.get(f"/api/v1/contacts/{contact.id}", headers=as_b).status_code == 200


def test_call_history_filters(client, make, emp_a, as_a):
    c1 = make.contact(name="Alpha Client", assign_to=emp_a)
    c2 = make.contact(name="Beta Client", assign_to=emp_a)
    k1 = start_call(client, as_a, c1, cid="hist-0000001").json()
    k2 = start_call(client, as_a, c2, cid="hist-0000002").json()
    dispose(client, as_a, k1["id"], "NO_ANSWER")
    assert client.get("/api/v1/calls?needs_disposition=true", headers=as_a).json()["items"][0]["id"] == k2["id"]
    assert client.get("/api/v1/calls?disposition=NO_ANSWER", headers=as_a).json()["total"] == 1
    assert client.get(f"/api/v1/calls?contact_id={c2.id}", headers=as_a).json()["total"] == 1
    assert client.get("/api/v1/calls?q=alpha", headers=as_a).json()["total"] == 1
    assert client.get(f"/api/v1/contacts/{c1.id}/calls", headers=as_a).json()["total"] == 1
    today = utcnow().astimezone(ZoneInfo("Asia/Kolkata")).date().isoformat()
    assert client.get(f"/api/v1/calls?day={today}", headers=as_a).json()["total"] == 2


def test_manager_can_read_team_calls_but_not_change_them(client, make):
    team = make.team("Field")
    manager = make.employee(role="manager", team=team)
    worker = make.employee(team=team)
    contact = make.contact(assign_to=worker)
    w = auth_headers(client, worker)
    m = auth_headers(client, manager)
    call = start_call(client, w, contact).json()
    assert client.get(f"/api/v1/calls/{call['id']}", headers=m).status_code == 200
    assert client.get("/api/v1/calls", headers=m).json()["total"] == 1
    assert dispose(client, m, call["id"], "COMPLETED").status_code == 404
