"""Everybody who is working has the same number of contacts to call - also the one who comes later.

  "I had one employee, I added the sheet and all of it went to him. Then another employee started and he got nothing."
"""

from __future__ import annotations

import random
from datetime import timedelta

import pytest

from app.core.timeutils import utcnow
from app.models.call import Callback
from app.models.contact import Contact, ContactAssignment
from app.models.distribution import DistributionRun
from app.models.imports import Import
from app.models.system import AuditLog, Notification
from app.services import level_service, rebalance_service
from app.services.distribution import Recipient, level_targets
from tests.test_import_distribution import away, owned, team_of
from tests.test_rebalance import give


def waiting(db, employee) -> int:
    """Contacts of this person that nobody has called."""
    return (
        db.query(ContactAssignment)
        .join(Contact, Contact.id == ContactAssignment.contact_id)
        .filter(ContactAssignment.employee_id == employee.id, ContactAssignment.status == "active", Contact.status == "new")
        .count()
    )


def level(client, headers, **body):
    resp = client.post("/api/v1/distribution/level", headers=headers, json=body)
    assert resp.status_code == 202, resp.text
    return client.get(f"/api/v1/distribution/runs/{resp.json()['id']}", headers=headers).json()


def preview(client, headers, **body):
    resp = client.post("/api/v1/distribution/level/preview", headers=headers, json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


# ----------------------------------------------------------------------------------------------------- the arithmetic
def test_two_people_one_has_everything_and_both_end_with_half():
    assert level_targets([Recipient(1, 100), Recipient(2, 0)]) == {1: 50, 2: 50}


def test_the_remainder_stays_with_whoever_has_the_most_so_that_as_little_as_possible_moves():
    assert level_targets([Recipient(1, 101), Recipient(2, 0)]) == {1: 51, 2: 50}
    assert level_targets([Recipient(1, 5), Recipient(2, 9), Recipient(3, 0)]) == {1: 5, 2: 5, 3: 4}  # 14 / 3 = 4, and two people have one more: the two who have the most


def test_three_people_two_of_them_new():
    assert level_targets([Recipient(1, 900), Recipient(2, 0), Recipient(3, 0)]) == {1: 300, 2: 300, 3: 300}


def test_equal_loads_stay_as_they_are_and_ties_go_to_the_lowest_id():
    assert level_targets([Recipient(7, 10), Recipient(3, 10)]) == {7: 10, 3: 10}
    assert level_targets([Recipient(7, 3), Recipient(3, 4)]) == {3: 4, 7: 3}  # 7 in all: the one with 4 keeps 4
    assert level_targets([Recipient(9, 1), Recipient(4, 0), Recipient(6, 0)]) == {9: 1, 4: 0, 6: 0}  # 1 / 3: the one that has it keeps it


def test_the_total_never_changes_and_nobody_differs_from_another_by_more_than_one():
    rng = random.Random(7)
    for _ in range(500):
        people = [Recipient(i, rng.choice([0, 0, 1, 7, 50, 1000, 12345])) for i in range(1, rng.randint(2, 12))]
        targets = level_targets(people)
        assert sum(targets.values()) == sum(p.load for p in people)
        assert max(targets.values()) - min(targets.values()) <= 1
        # nobody who has more than a share ends with less than the lightest share, nobody who has less ends with more than the heaviest
        gives = {p.employee_id: max(0, p.load - targets[p.employee_id]) for p in people}
        receives = {p.employee_id: max(0, targets[p.employee_id] - p.load) for p in people}
        assert sum(gives.values()) == sum(receives.values())
        assert not any(gives[i] and receives[i] for i in gives)


def test_nobody_to_share_with_and_a_person_listed_twice_are_refused():
    with pytest.raises(ValueError):
        level_targets([])
    with pytest.raises(ValueError):
        level_targets([Recipient(1, 3), Recipient(1, 4)])


# ------------------------------------------------------------------------------------------------------- the main case
def test_a_new_employee_gets_half_of_what_the_only_other_one_was_given(client, make, as_admin, db):
    old, new = team_of(make, 2)
    give(db, old, 1_000)

    shown = preview(client, as_admin)
    assert shown["working"] == 2 and shown["total_waiting"] == 1_000 and shown["total_move"] == 500 and shown["can_run"] is True
    by_id = {e["employee_id"]: e for e in shown["employees"]}
    assert (by_id[old.id]["waiting"], by_id[old.id]["after"], by_id[old.id]["gives"]) == (1_000, 500, 500)
    assert (by_id[new.id]["waiting"], by_id[new.id]["after"], by_id[new.id]["receives"]) == (0, 500, 500)
    assert db.query(DistributionRun).count() == 0  # a preview changes nothing

    done = level(client, as_admin)
    assert done["kind"] == "level" and done["status"] == "completed" and done["planned"] == 500 and done["moved"] == 500
    assert owned(db, [old, new]) == {old.id: 500, new.id: 500}
    assert (waiting(db, old), waiting(db, new)) == (500, 500)
    # what moved is history, not deleted; the contacts are in the new person's queue
    assert db.query(ContactAssignment).filter_by(employee_id=old.id, status="released").count() == 500


def test_three_people_one_has_everything_each_ends_with_a_third(client, make, as_admin, db):
    a, b, c = team_of(make, 3)
    give(db, a, 900)
    done = level(client, as_admin)
    assert done["moved"] == 600
    assert owned(db, [a, b, c]) == {a.id: 300, b.id: 300, c.id: 300}
    assert sorted(t["received"] for t in done["details"]["to"]) == [300, 300]
    assert done["details"]["from"][0]["moved"] == 600


def test_the_giver_keeps_the_contacts_they_would_call_first_and_gives_the_newest(client, make, as_admin, db):
    old, new = team_of(make, 2)
    mine = give(db, old, 10)
    level(client, as_admin)
    kept = {r.contact_id for r in db.query(ContactAssignment).filter_by(employee_id=old.id, status="active")}
    assert kept == {c.id for c in mine[:5]}  # the first five (the oldest assignments) stay


def test_only_what_nobody_has_started_on_is_shared(client, make, as_admin, db):
    old, new = team_of(make, 2)
    give(db, old, 100)  # new: 100
    give(db, old, 40, status="in_progress", start=1_000)  # somebody called these once
    done_ones = give(db, old, 30, status="completed", start=2_000)
    promised = give(db, old, 10, status="callback", start=3_000)
    db.add_all(Callback(contact_id=c.id, employee_id=old.id, scheduled_at=utcnow() + timedelta(days=1), status="pending") for c in promised)
    db.commit()
    shown = preview(client, as_admin)
    assert shown["total_waiting"] == 100 and shown["total_move"] == 50
    done = level(client, as_admin)
    assert done["moved"] == 50
    assert owned(db, [old, new]) == {old.id: 130, new.id: 50} and waiting(db, new) == 50
    assert {r.contact_id for r in db.query(ContactAssignment).filter_by(employee_id=old.id, status="active")} >= {c.id for c in [*done_ones, *promised]}


def test_somebody_who_is_not_working_takes_no_part_and_keeps_what_they_have(client, make, as_admin, db):
    a, b, gone = team_of(make, 3)
    away(db, gone, days=5)
    give(db, a, 60)
    give(db, gone, 90)
    shown = preview(client, as_admin)
    assert shown["working"] == 2 and shown["total_waiting"] == 60
    assert gone.id not in {e["employee_id"] for e in shown["employees"]}
    level(client, as_admin)
    assert owned(db, [a, b, gone]) == {a.id: 30, b.id: 30, gone.id: 90}


def test_the_administrator_can_choose_who_takes_part(client, make, as_admin, db):
    a, b, c = team_of(make, 3)
    give(db, a, 90)
    shown = preview(client, as_admin, employee_ids=[a.id, b.id])
    assert shown["working"] == 2 and shown["total_move"] == 45
    level(client, as_admin, employee_ids=[a.id, b.id])
    assert owned(db, [a, b, c]) == {a.id: 45, b.id: 45, c.id: 0}
    assert client.post("/api/v1/distribution/level/preview", headers=as_admin, json={"employee_ids": [999999]}).status_code == 422


def test_it_says_why_when_there_is_nothing_to_do(client, make, as_admin, db):
    (only,) = team_of(make, 1)
    give(db, only, 10)
    shown = preview(client, as_admin)
    assert shown["can_run"] is False and "Fewer than two" in shown["warnings"][0]
    resp = client.post("/api/v1/distribution/level", headers=as_admin, json={})
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "nothing_to_level"

    other = make.employee(code="T99", email="t99@example.com", name="Team Member 99")
    give(db, other, 10)  # now two people are working and both have the same
    shown = preview(client, as_admin)
    assert shown["can_run"] is False and "already has the same" in shown["warnings"][0]


def test_nobody_has_anything_waiting(client, make, as_admin, db):
    a, b = team_of(make, 2)
    give(db, a, 10, status="completed")
    shown = preview(client, as_admin)
    assert shown["can_run"] is False and shown["total_waiting"] == 0 and "nothing to share" in shown["warnings"][0]


def test_doing_it_twice_changes_nothing_the_second_time(client, make, as_admin, db):
    a, b = team_of(make, 2)
    give(db, a, 100)
    assert level(client, as_admin)["moved"] == 50
    resp = client.post("/api/v1/distribution/level", headers=as_admin, json={})
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "nothing_to_level"
    assert owned(db, [a, b]) == {a.id: 50, b.id: 50}


def test_receivers_and_givers_are_told_and_the_queues_follow(client, make, as_admin, db):
    a, b = team_of(make, 2)
    give(db, a, 40)
    done = level(client, as_admin)
    notes = {n.employee_id: n for n in db.query(Notification).filter(Notification.employee_id.in_([a.id, b.id]))}
    assert "20 contacts added to your list" in notes[b.id].title
    assert "20 of your waiting contacts went to a colleague" in notes[a.id].title
    assert notes[b.id].data["run_id"] == done["id"]
    # the new person's queue has them now (through the API, as the phone asks)
    from tests.conftest import auth_headers

    queue = client.get("/api/v1/queue?limit=50", headers=auth_headers(client, b)).json()
    assert queue["total"] == 20


def test_every_sharing_is_recorded_and_audited(client, make, as_admin, db):
    a, b = team_of(make, 2)
    give(db, a, 10)
    done = level(client, as_admin)
    run = db.get(DistributionRun, done["id"])
    assert (run.kind, run.trigger, run.status, run.moved) == ("level", "manual", "completed", 5)
    audit = db.query(AuditLog).filter_by(action="distribution.level").one()
    assert audit.details["moved"] == 5 and audit.entity_id == str(done["id"])
    listed = client.get("/api/v1/distribution/runs", headers=as_admin).json()["items"]
    assert listed[0]["kind"] == "level"


def test_moved_contacts_stay_in_their_campaign(client, make, as_admin, db):
    a, b = team_of(make, 2)
    campaign = make.campaign()
    give(db, a, 10, campaign=campaign)
    level(client, as_admin)
    assert {r.campaign_id for r in db.query(ContactAssignment).filter_by(employee_id=b.id, status="active")} == {campaign.id}


def test_a_failure_in_the_middle_keeps_what_was_moved_and_the_next_run_does_the_rest(client, make, as_admin, db, monkeypatch):
    a, b = team_of(make, 2)
    give(db, a, 60)
    monkeypatch.setattr(rebalance_service, "CHUNK", 10)
    real = rebalance_service._move_chunk
    calls = {"n": 0}

    def flaky(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("connection lost for good")
        return real(*args, **kwargs)

    monkeypatch.setattr(rebalance_service, "_move_chunk", flaky)
    failed = level(client, as_admin)
    assert failed["status"] == "failed" and failed["moved"] == 10 and "Stopped because of a problem" in failed["error_message"]
    monkeypatch.setattr(rebalance_service, "_move_chunk", real)
    done = level(client, as_admin)
    assert done["status"] == "completed" and done["moved"] == 20
    assert owned(db, [a, b]) == {a.id: 30, b.id: 30}


def test_a_sharing_that_is_running_blocks_a_second_one(client, make, as_admin, db):
    a, b = team_of(make, 2)
    give(db, a, 10)
    db.add(DistributionRun(kind="level", trigger="auto", status="running", heartbeat_at=utcnow(), created_at=utcnow()))
    db.commit()
    resp = client.post("/api/v1/distribution/level", headers=as_admin, json={})
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "rebalance_busy"


# -------------------------------------------------------------------------------------------------------- by itself
def test_a_new_employee_is_given_a_share_by_itself(client, make, as_admin, db):
    old = make.employee(code="OLD1", email="old1@example.com")
    give(db, old, 40)
    new = make.employee(code="NEW1", email="new1@example.com")  # the administrator adds somebody: no contact at all
    run = level_service.auto_level()
    assert run is not None
    db.expire_all()
    stored = db.get(DistributionRun, run.id)
    assert (stored.kind, stored.trigger, stored.status, stored.moved, stored.created_by) == ("level", "auto", "completed", 20, None)
    assert owned(db, [old, new]) == {old.id: 20, new.id: 20}
    assert db.query(AuditLog).filter_by(action="distribution.level").one().actor_label == "system"
    assert level_service.auto_level() is None  # everybody has contacts now: the ordinary case costs nothing and changes nothing
    assert db.query(DistributionRun).count() == 1


def test_somebody_who_was_away_and_is_back_gets_a_share_too(client, make, db):
    a, b = team_of(make, 2)
    away(db, b, days=5)
    give(db, a, 30)
    assert level_service.auto_level() is None  # b is not working: nothing happens
    b.last_login_at = utcnow()  # signs in again
    db.commit()
    run = level_service.auto_level()
    assert run is not None and owned(db, [a, b]) == {a.id: 15, b.id: 15}


def test_the_automatic_sharing_only_looks_after_somebody_who_has_nothing_at_all(client, make, as_admin, db):
    a, b = team_of(make, 2)
    give(db, a, 100)
    give(db, b, 10)  # (an uneven pair: that is for the administrator to even out, not a reason to take contacts away from somebody by itself)
    assert level_service.auto_level() is None
    assert owned(db, [a, b]) == {a.id: 100, b.id: 10}
    assert preview(client, as_admin)["total_move"] == 45  # by hand it can be done


def test_staff_who_are_not_employees_and_accounts_that_are_off_do_not_count(client, make, db):
    a = make.employee(code="E001", email="e001@example.com")
    give(db, a, 50)
    make.employee(role="manager", code="M001", email="m001@example.com")
    make.employee(role="admin", code="A001", email="a001@example.com")
    off = make.employee(code="E002", email="e002@example.com")
    off.is_active = False
    db.commit()
    assert level_service.auto_level() is None
    assert owned(db, [a]) == {a.id: 50}


def test_the_automatic_sharing_does_nothing_when_it_is_switched_off(client, make, as_admin, db):
    old = make.employee(code="OLD1", email="old1@example.com")
    give(db, old, 40)
    new = make.employee(code="NEW1", email="new1@example.com")
    assert client.put("/api/v1/settings/auto_level", headers=as_admin, json={"value": False}).status_code == 200
    assert level_service.auto_level() is None and owned(db, [old, new]) == {old.id: 40, new.id: 0}
    assert client.put("/api/v1/settings/auto_level", headers=as_admin, json={"value": True}).status_code == 200
    assert level_service.auto_level() is not None and owned(db, [old, new]) == {old.id: 20, new.id: 20}


def test_the_automatic_sharing_waits_while_a_sheet_is_being_added(client, make, db):
    old = make.employee(code="OLD1", email="old1@example.com")
    give(db, old, 40)
    new = make.employee(code="NEW1", email="new1@example.com")
    db.add(Import(created_by=old.id, filename="x.csv", file_type="csv", file_path="/nowhere", file_size=1, mode="skip", status="applying"))
    db.commit()
    assert level_service.auto_level() is None and owned(db, [old, new]) == {old.id: 40, new.id: 0}


def test_the_scheduler_does_it_within_the_minute(client, make, db):
    from app import jobs

    old = make.employee(code="OLD1", email="old1@example.com")
    give(db, old, 10)
    new = make.employee(code="NEW1", email="new1@example.com")
    jobs.tick()
    assert owned(db, [old, new]) == {old.id: 5, new.id: 5}


def test_the_settings_and_the_overview_know_about_it(client, make, as_admin, db):
    assert client.get("/api/v1/settings", headers=as_admin).json()["auto_level"] is True
    assert client.get("/api/v1/distribution/overview", headers=as_admin).json()["auto_level"] is True
    assert client.put("/api/v1/settings/auto_level", headers=as_admin, json={"value": "yes"}).status_code == 422
    assert client.put("/api/v1/settings/auto_level", headers=as_admin, json={"value": False}).json()["auto_level"] is False
    assert client.get("/api/v1/distribution/overview", headers=as_admin).json()["auto_level"] is False


def test_only_administrators_may_share(client, make, as_a):
    assert client.post("/api/v1/distribution/level/preview", headers=as_a, json={}).status_code == 403
    assert client.post("/api/v1/distribution/level", headers=as_a, json={}).status_code == 403
