"""An employee who stops working: what they did not get to goes, equally, to the people who are working.

  "10 employees, one has not been seen for 2 days: the 1,000 contacts of that one are shared between the other 9"
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from app.core.timeutils import utcnow
from app.models.call import Callback
from app.models.contact import Contact, ContactAssignment
from app.models.distribution import DistributionRun
from app.models.system import AuditLog, Notification
from app.services import rebalance_service
from tests.test_import_distribution import away, owned, team_of


def give(db, employee, count: int, *, status: str = "new", start: int = 0, campaign=None) -> list[Contact]:
    """`count` contacts owned by `employee`, with this status."""
    base = 8000000000 + employee.id * 100_000 + start * 3
    contacts = [
        Contact(name=f"{employee.employee_code} contact {start + i}", phone_raw=str(base + i * 3 + 1), normalized_phone=f"+91{base + i * 3 + 1}", status=status, search_text="x")
        for i in range(count)
    ]
    db.add_all(contacts)
    db.flush()
    db.add_all(
        ContactAssignment(contact_id=c.id, employee_id=employee.id, status="active", active_contact_id=c.id, campaign_id=campaign.id if campaign else None)
        for c in contacts
    )
    db.commit()
    return contacts


def active_counts(db, employees):
    return owned(db, employees)


def run(client, headers, **body):
    resp = client.post("/api/v1/distribution/rebalance", headers=headers, json=body)
    assert resp.status_code == 202, resp.text
    return client.get(f"/api/v1/distribution/runs/{resp.json()['id']}", headers=headers).json()


def preview(client, headers, **body):
    resp = client.post("/api/v1/distribution/rebalance/preview", headers=headers, json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


# --------------------------------------------------------------------------------------------------- the main case
def test_the_contacts_of_somebody_who_stopped_are_shared_equally_between_the_ones_working(client, make, as_admin, db):
    gone, *working = team_of(make, 10)
    away(db, gone, days=3)
    give(db, gone, 1_000)
    for w in working:
        give(db, w, 50)

    shown = preview(client, as_admin)
    assert shown["total_movable"] == 1_000 and shown["working"] == 9 and shown["can_run"] is True
    assert [(s["employee_id"], s["movable"], s["kept"]) for s in shown["sources"]] == [(gone.id, 1_000, 0)]
    assert sorted(t["receives"] for t in shown["targets"]) == [111] * 8 + [112]  # 1,000 / 9
    assert db.query(DistributionRun).count() == 0  # a preview changes nothing

    done = run(client, as_admin)
    assert done["status"] == "completed" and done["planned"] == 1_000 and done["moved"] == 1_000
    per = active_counts(db, [gone, *working])
    assert per[gone.id] == 0
    got = sorted(per[w.id] - 50 for w in working)
    assert sum(got) == 1_000 and got[-1] - got[0] <= 1
    # the old assignments are kept as history, not deleted
    assert db.query(ContactAssignment).filter_by(employee_id=gone.id, status="released").count() == 1_000
    assert db.query(ContactAssignment).filter(ContactAssignment.status == "active").count() == 1_000 + 9 * 50


def test_the_overview_says_who_is_working_who_is_not_and_what_could_be_taken_back(client, make, as_admin, db):
    gone, ok, off = team_of(make, 3)
    away(db, gone, days=4)
    off.is_active = False
    db.commit()
    give(db, gone, 12)
    give(db, gone, 3, status="interested", start=100)
    give(db, ok, 7)
    give(db, off, 5)
    view = client.get("/api/v1/distribution/overview", headers=as_admin).json()
    assert (view["working"], view["not_working"], view["movable"], view["inactive_after_days"], view["auto_rebalance"]) == (1, 2, 17, 2, True)
    states = {e["employee_id"]: e for e in view["employees"]}
    assert states[gone.id]["state"] == "inactive" and states[gone.id]["movable"] == 12 and states[gone.id]["assigned"] == 15
    assert states[off.id]["state"] == "deactivated" and states[off.id]["reason"] == "The account is switched off."
    assert states[ok.id]["state"] == "new" and states[ok.id]["movable"] == 0


def test_a_deactivated_employees_contacts_move_too(client, make, as_admin, db):
    gone, ok = team_of(make, 2)
    gone.is_active = False
    db.commit()
    give(db, gone, 9)
    done = run(client, as_admin)
    assert done["moved"] == 9 and active_counts(db, [gone, ok]) == {gone.id: 0, ok.id: 9}


# -------------------------------------------------------------------------- what stays with the one who is away
def test_only_what_nobody_has_worked_on_is_moved(client, make, as_admin, db):
    gone, ok = team_of(make, 2)
    away(db, gone, days=5)
    give(db, gone, 10, status="new", start=0)
    give(db, gone, 5, status="in_progress", start=100)
    promised = give(db, gone, 3, status="callback", start=200)
    give(db, gone, 2, status="follow_up", start=300)
    for status, start in (("interested", 400), ("not_interested", 500), ("completed", 600), ("do_not_contact", 700)):
        give(db, gone, 2, status=status, start=start)
    # a contact that is still "new" but has a callback promised to the owner stays too
    still_new_with_callback = give(db, gone, 1, status="new", start=800)[0]
    for contact in [*promised, still_new_with_callback]:
        db.add(Callback(employee_id=gone.id, contact_id=contact.id, scheduled_at=utcnow() + timedelta(days=1)))
    db.commit()

    shown = preview(client, as_admin)
    assert shown["total_movable"] == 15 and shown["sources"][0]["movable"] == 15 and shown["sources"][0]["kept"] == 3 + 2 + 8 + 1
    done = run(client, as_admin)
    assert done["moved"] == 15
    assert db.query(ContactAssignment).filter_by(employee_id=gone.id, status="active").count() == 14
    assert db.query(ContactAssignment).filter_by(employee_id=ok.id, status="active").count() == 15
    # nothing of the promised callbacks was lost
    assert db.query(Callback).filter_by(employee_id=gone.id, status="pending").count() == 4


def test_somebody_who_is_working_is_never_touched(client, make, as_admin, db):
    busy, other = team_of(make, 2)
    give(db, busy, 40)
    resp = client.post("/api/v1/distribution/rebalance", headers=as_admin, json={})
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "nothing_to_rebalance"
    chosen = client.post("/api/v1/distribution/rebalance/preview", headers=as_admin, json={"from_employee_ids": [busy.id]}).json()
    assert chosen["total_movable"] == 0 and any("is working" in w for w in chosen["warnings"])
    assert active_counts(db, [busy, other]) == {busy.id: 40, other.id: 0}


def test_when_nobody_is_working_nothing_is_moved_and_it_says_why(client, make, as_admin, db):
    a, b = team_of(make, 2)
    away(db, a, days=5)
    away(db, b, days=6)
    give(db, a, 10)
    shown = preview(client, as_admin)
    assert shown["can_run"] is False and shown["working"] == 0 and "Nobody is working" in shown["warnings"][0]
    resp = client.post("/api/v1/distribution/rebalance", headers=as_admin, json={})
    assert resp.status_code == 422 and "Nobody is working" in resp.json()["error"]["message"]
    assert active_counts(db, [a, b]) == {a.id: 10, b.id: 0}


def test_doing_it_twice_is_harmless(client, make, as_admin, db):
    gone, ok = team_of(make, 2)
    away(db, gone, days=5)
    give(db, gone, 20)
    assert run(client, as_admin)["moved"] == 20
    again = client.post("/api/v1/distribution/rebalance", headers=as_admin, json={})
    assert again.status_code == 422 and again.json()["error"]["code"] == "nothing_to_rebalance"
    assert active_counts(db, [gone, ok]) == {gone.id: 0, ok.id: 20}


# ------------------------------------------------------------------------------------------------ how it is shared
def test_the_extra_contacts_can_also_even_out_the_work(client, make, as_admin, db):
    gone, busy, free = team_of(make, 3)
    away(db, gone, days=5)
    give(db, gone, 40)
    give(db, busy, 40)  # busy has 40 contacts to call already, free has none
    even = run(client, as_admin, strategy="balance_total")
    assert even["moved"] == 40
    assert active_counts(db, [busy, free]) == {busy.id: 40, free.id: 40}


def test_equal_gives_each_the_same_number_whatever_they_have_already(client, make, as_admin, db):
    gone, busy, free = team_of(make, 3)
    away(db, gone, days=5)
    give(db, gone, 40)
    give(db, busy, 40)
    equal = run(client, as_admin)  # the default
    assert equal["moved"] == 40 and active_counts(db, [busy, free]) == {busy.id: 60, free.id: 20}


def test_the_administrator_can_choose_who_gives_and_who_receives(client, make, as_admin, db):
    gone1, gone2, a, b = team_of(make, 4)
    for g in (gone1, gone2):
        away(db, g, days=5)
        give(db, g, 10)
    done = run(client, as_admin, from_employee_ids=[gone1.id], to_employee_ids=[a.id])
    assert done["moved"] == 10
    assert active_counts(db, [gone1, gone2, a, b]) == {gone1.id: 0, gone2.id: 10, a.id: 10, b.id: 0}
    shown = preview(client, as_admin, to_employee_ids=[gone1.id, b.id])
    assert any("not working, so they do not receive" in w for w in shown["warnings"])
    assert [t["employee_id"] for t in shown["targets"]] == [b.id]


def test_each_receiver_gets_a_mix_with_interleave_and_a_block_with_blocks(client, make, as_admin, db):
    gone, a, b = team_of(make, 3)
    away(db, gone, days=5)
    ids = [c.id for c in give(db, gone, 10)]
    run(client, as_admin, order="blocks")
    owner = {cid: eid for cid, eid in db.query(ContactAssignment.contact_id, ContactAssignment.employee_id).filter(ContactAssignment.status == "active")}
    first_half, second_half = {owner[c] for c in ids[:5]}, {owner[c] for c in ids[5:]}
    assert len(first_half) == 1 and len(second_half) == 1 and first_half != second_half


def test_moved_contacts_stay_in_their_campaign(client, make, as_admin, db):
    gone, ok = team_of(make, 2)
    away(db, gone, days=5)
    campaign = make.campaign("Autumn", status="active")
    give(db, gone, 6, campaign=campaign)
    run(client, as_admin)
    assert {a.campaign_id for a in db.query(ContactAssignment).filter_by(employee_id=ok.id, status="active")} == {campaign.id}


# ------------------------------------------------------------------------------------ what everybody gets to see
def test_the_receivers_are_told_and_the_queues_follow(client, make, as_admin, db):
    from tests.conftest import auth_headers

    gone, ok = team_of(make, 2)
    away(db, gone, days=5)
    give(db, gone, 8)
    headers_ok = auth_headers(client, ok)
    assert client.get("/api/v1/queue", headers=headers_ok).json()["items"] == []
    run(client, as_admin)
    assert len(client.get("/api/v1/queue", headers=headers_ok).json()["items"]) == 8
    note = db.query(Notification).filter_by(employee_id=ok.id, type="assignment").one()
    assert "8 contacts moved to you" == note.title


def test_every_rebalancing_is_recorded_and_audited(client, make, as_admin, db):
    gone, a, b = team_of(make, 3)
    away(db, gone, days=5)
    give(db, gone, 11)
    done = run(client, as_admin)
    assert done["trigger"] == "manual" and done["created_by"] and done["finished_at"]
    assert [x["moved"] for x in done["details"]["from"]] == [11] and sorted(x["received"] for x in done["details"]["to"]) == [5, 6]
    listing = client.get("/api/v1/distribution/runs", headers=as_admin).json()
    assert listing["total"] == 1 and listing["items"][0]["id"] == done["id"]
    audit = db.query(AuditLog).filter_by(action="distribution.rebalance").one()
    assert audit.details["moved"] == 11 and audit.entity_id == str(done["id"])


# ---------------------------------------------------------------------------------------------- by itself
def test_the_automatic_rebalancing_moves_the_contacts_of_somebody_who_stopped(client, make, as_admin, db):
    gone, ok = team_of(make, 2)
    away(db, gone, days=3)
    give(db, gone, 30)
    run_row = rebalance_service.auto_rebalance()
    assert run_row is not None
    db.expire_all()
    stored = db.get(DistributionRun, run_row.id)
    assert (stored.trigger, stored.status, stored.moved, stored.created_by) == ("auto", "completed", 30, None)
    assert active_counts(db, [gone, ok]) == {gone.id: 0, ok.id: 30}
    audit = db.query(AuditLog).filter_by(action="distribution.rebalance").one()
    assert audit.actor_label == "system"


def test_the_automatic_rebalancing_does_nothing_when_it_is_switched_off_or_there_is_nothing_to_do(client, make, as_admin, db):
    gone, ok = team_of(make, 2)
    away(db, gone, days=3)
    give(db, gone, 12)
    assert client.put("/api/v1/settings/auto_rebalance", headers=as_admin, json={"value": False}).status_code == 200
    assert rebalance_service.auto_rebalance() is None and active_counts(db, [gone, ok]) == {gone.id: 12, ok.id: 0}
    assert client.put("/api/v1/settings/auto_rebalance", headers=as_admin, json={"value": True}).status_code == 200
    assert rebalance_service.auto_rebalance() is not None
    assert rebalance_service.auto_rebalance() is None  # nothing left to take: no new run, no entry in the history
    assert db.query(DistributionRun).count() == 1


def test_the_scheduler_runs_the_automatic_rebalancing_once_per_window(client, make, db):
    from app import jobs

    gone, ok, later = team_of(make, 3)
    away(db, gone, days=3)
    give(db, gone, 5)
    jobs.tick()
    assert active_counts(db, [gone])[gone.id] == 0 and sum(active_counts(db, [ok, later]).values()) == 5
    away(db, later, days=4)  # somebody else stops...
    give(db, later, 6, start=500)
    before = active_counts(db, [gone, ok, later])
    jobs.tick()  # ...but the next round is only a few seconds later: it waits for the window of ten minutes
    assert active_counts(db, [gone, ok, later]) == before


# ----------------------------------------------------------------------------------- safety of the run itself
def test_a_rebalancing_that_is_running_blocks_a_second_one(client, make, as_admin, db):
    gone, ok = team_of(make, 2)
    away(db, gone, days=5)
    give(db, gone, 5)
    db.add(DistributionRun(kind="rebalance", trigger="manual", status="running", heartbeat_at=utcnow(), created_at=utcnow()))
    db.commit()
    resp = client.post("/api/v1/distribution/rebalance", headers=as_admin, json={})
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "rebalance_busy"


def test_a_rebalancing_whose_server_disappeared_is_closed_and_the_next_one_goes_on(client, make, as_admin, db):
    gone, ok = team_of(make, 2)
    away(db, gone, days=5)
    give(db, gone, 5)
    stale = DistributionRun(kind="rebalance", trigger="auto", status="running", heartbeat_at=utcnow() - timedelta(minutes=30), created_at=utcnow() - timedelta(minutes=31))
    db.add(stale)
    db.commit()
    assert rebalance_service.recover_stuck_runs(db) == 1
    db.refresh(stale)
    assert stale.status == "failed" and "server stopped" in stale.error_message
    assert run(client, as_admin)["moved"] == 5


def test_a_failure_in_the_middle_keeps_what_was_moved_and_the_next_run_does_the_rest(client, make, as_admin, db, monkeypatch):
    gone, a, b = team_of(make, 3)
    away(db, gone, days=5)
    give(db, gone, 30)
    monkeypatch.setattr(rebalance_service, "CHUNK", 10)
    real = rebalance_service._move_chunk
    calls = {"n": 0}

    def flaky(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("connection lost for good")
        return real(*args, **kwargs)

    monkeypatch.setattr(rebalance_service, "_move_chunk", flaky)
    failed = run(client, as_admin)
    assert failed["status"] == "failed" and failed["moved"] == 10 and "Stopped because of a problem" in failed["error_message"]
    assert db.query(ContactAssignment).filter_by(employee_id=gone.id, status="active").count() == 20
    monkeypatch.setattr(rebalance_service, "_move_chunk", real)
    done = run(client, as_admin)
    assert done["moved"] == 20 and active_counts(db, [gone, a, b])[gone.id] == 0
    assert sum(active_counts(db, [a, b]).values()) == 30
