"""The requests a calling phone makes all day. Each is held to a budget of database statements, so that a change which quietly turns
one query into one per row (or one per request into three) fails here instead of slowing down production."""

from __future__ import annotations

from datetime import timedelta

from app.core.timeutils import utcnow
from tests.conftest import iso
from tests.test_auth_cache import counting_queries
from tests.test_calls_queue import dispose, start_call


def events(call_started, *kinds):
    return [{"event_type": k, "occurred_at": iso(call_started + timedelta(seconds=i + 1))} for i, k in enumerate(kinds)]


def test_starting_a_call_stays_within_budget(client, make, emp_a, as_a):
    contact = make.contact(assign_to=emp_a)
    client.get("/api/v1/me", headers=as_a)  # sign-in work is not part of the call
    with counting_queries() as q:
        created = start_call(client, as_a, contact, cid="budget-call-001")
    assert created.status_code == 201
    assert q.count <= 8, (q.count, q.statements)


def test_reporting_a_whole_call_costs_a_handful_of_statements(client, make, emp_a, as_a):
    contact = make.contact(assign_to=emp_a)
    started = utcnow() - timedelta(minutes=2)
    call = start_call(client, as_a, contact, cid="budget-call-002", started=started).json()

    with counting_queries() as evs:
        sent = client.post(f"/api/v1/calls/{call['id']}/events", headers=as_a, json={"events": events(started, "dialing", "ringing", "connected", "ended")})
    assert sent.status_code == 200 and sent.json()["added"] == 4
    assert evs.count <= 8, (evs.count, evs.statements)  # not one duplicate check per event

    with counting_queries() as upd:
        done = client.patch(f"/api/v1/calls/{call['id']}", headers=as_a, json={"duration_seconds": 60, "status": "completed", "ended_at": iso(started + timedelta(seconds=90))})
    assert done.status_code == 200
    assert upd.count <= 5, (upd.count, upd.statements)

    with counting_queries() as fin:
        outcome = dispose(client, as_a, call["id"], "CONNECTED", notes="Asked for a quote")
    assert outcome.status_code == 200
    assert fin.count <= 14, (fin.count, fin.statements)


def test_the_same_event_twice_in_one_batch_is_stored_once(client, make, emp_a, as_a, db):
    from app.models.call import CallEvent

    contact = make.contact(assign_to=emp_a)
    started = utcnow() - timedelta(minutes=1)
    call = start_call(client, as_a, contact, cid="budget-call-003", started=started).json()
    one = {"event_type": "ringing", "occurred_at": iso(started + timedelta(seconds=2))}
    sent = client.post(f"/api/v1/calls/{call['id']}/events", headers=as_a, json={"events": [one, one, one]})
    assert sent.status_code == 200 and sent.json()["added"] == 1
    again = client.post(f"/api/v1/calls/{call['id']}/events", headers=as_a, json={"events": [one]})
    assert again.json()["added"] == 0  # replays from the phone's retry queue change nothing
    assert db.query(CallEvent).filter(CallEvent.call_id == call["id"], CallEvent.event_type == "ringing").count() == 1


def test_a_list_page_does_not_ask_per_row(client, make, emp_a, as_a):
    for n in range(12):
        contact = make.contact(assign_to=emp_a)
        start_call(client, as_a, contact, cid=f"budget-list-{n:03d}")
    client.get("/api/v1/me", headers=as_a)
    with counting_queries() as q:
        page = client.get("/api/v1/calls?page_size=50", headers=as_a)
    assert page.status_code == 200 and len(page.json()["items"]) == 12
    assert q.count <= 8, (q.count, q.statements)  # the same for 12 rows as for 2


def test_the_queue_page_does_not_ask_per_row(client, make, emp_a, as_a):
    for _ in range(25):
        make.contact(assign_to=emp_a)
    with counting_queries() as q:
        page = client.get("/api/v1/queue?limit=100", headers=as_a)
    assert page.status_code == 200 and len(page.json()["items"]) == 25
    assert q.count <= 8, (q.count, q.statements)
