"""The point of the feature: a sheet of contacts is shared EQUALLY between the people who are working - and only them.

  * 10,000 contacts and 10 employees: 1,000 each.
  * 10,003 contacts and 10 employees: nobody gets more than one more than anybody else.
  * somebody who has not been seen for two days gets nothing; their share goes to the others.
  * the administrator sees the plan before anything is written, and the plan is what happens.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from app.core.timeutils import utcnow
from app.models.contact import Contact, ContactAssignment
from app.models.employee import EmployeeDevice
from app.models.system import Notification
from tests.test_import import UNASSIGNED, confirm, get_import, make_csv, upload


def sheet(count: int, *, start: int = 0, extra_header=(), extra_cells=()) -> bytes:
    rows = [[f"Customer {i}", f"{9000000000 + i * 3 + 1:010d}", *extra_cells] for i in range(start, start + count)]
    return make_csv(rows, header=("Name", "Mobile", *extra_header))


def team_of(make, n: int, **kw):
    return [make.employee(code=f"T{i:02d}", email=f"t{i:02d}@example.com", name=f"Team Member {i:02d}", **kw) for i in range(1, n + 1)]


def owned(db, employees) -> dict[int, int]:
    return {e.id: db.query(ContactAssignment).filter_by(employee_id=e.id, status="active").count() for e in employees}


def away(db, employee, days: float, *, joined_days_ago: float = 30) -> None:
    """The employee has not been seen for `days`."""
    employee.created_at = utcnow() - timedelta(days=joined_days_ago)
    employee.last_login_at = utcnow() - timedelta(days=days)
    db.commit()


def plan_of(client, headers, import_id, **params):
    resp = client.get(f"/api/v1/contacts/import/{import_id}/plan", headers=headers, params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


# ---------------------------------------------------------------------------------------------------- equal
def test_ten_thousand_contacts_ten_employees_a_thousand_each(client, make, as_admin, db):
    team = team_of(make, 10)
    imp = upload(client, as_admin, sheet(10_000))
    assert get_import(client, as_admin, imp["id"])["valid_rows"] == 10_000

    plan = plan_of(client, as_admin, imp["id"])  # the administrator sees this first
    assert plan["to_distribute"] == 10_000 and plan["working"] == 10 and plan["can_confirm"] is True
    assert {e["planned"] for e in plan["employees"] if e["receives"]} == {1000}

    done = confirm(client, as_admin, imp["id"])
    assert done["status"] == "completed" and done["inserted_rows"] == 10_000 and done["assigned_rows"] == 10_000
    assert set(owned(db, team).values()) == {1000}
    assert db.query(Contact).count() == 10_000
    assert sorted(done["result"]["per_employee"].values()) == [1000] * 10
    assert {row["count"] for row in done["result"]["employees"]} == {1000}
    assert all(db.query(Notification).filter_by(employee_id=e.id, type="assignment").count() == 1 for e in team)


@pytest.mark.parametrize("count,employees", [(10_003, 10), (7, 3), (1, 4), (5, 1), (100, 7)])
def test_what_does_not_divide_is_spread_so_nobody_has_more_than_one_extra(client, make, as_admin, db, count, employees):
    team = team_of(make, employees)
    imp = upload(client, as_admin, sheet(count))
    confirm(client, as_admin, imp["id"])
    per = sorted(owned(db, team).values(), reverse=True)
    assert sum(per) == count
    assert per[0] - per[-1] <= 1
    assert per == sorted([count // employees + (1 if i < count % employees else 0) for i in range(employees)], reverse=True)


def test_the_plan_is_exactly_what_happens(client, make, as_admin, db):
    team = team_of(make, 6)
    imp = upload(client, as_admin, sheet(1_003))
    plan = plan_of(client, as_admin, imp["id"])
    confirm(client, as_admin, imp["id"])
    assert owned(db, team) == {e["employee_id"]: e["planned"] for e in plan["employees"] if e["receives"]}


# ----------------------------------------------------------------------------------- not working: nothing for them
def test_somebody_who_was_not_active_for_two_days_gets_nothing_and_the_others_share_their_part(client, make, as_admin, db):
    team = team_of(make, 10)
    gone = team[3]
    away(db, gone, days=3)  # has not been seen for 3 days
    imp = upload(client, as_admin, sheet(10_000))
    plan = plan_of(client, as_admin, imp["id"])
    gone_row = next(e for e in plan["employees"] if e["employee_id"] == gone.id)
    assert gone_row["state"] == "inactive" and gone_row["receives"] is False and gone_row["planned"] == 0
    assert "Not seen for 3 days" in gone_row["reason"]
    assert plan["working"] == 9 and plan["left_out"] == 1 and "not working" in plan["warnings"][0]

    confirm(client, as_admin, imp["id"])
    per = owned(db, team)
    assert per[gone.id] == 0
    others = sorted(v for k, v in per.items() if k != gone.id)
    assert sum(others) == 10_000 and others[-1] - others[0] <= 1  # 9 people: 1,111 and one 1,112


def test_a_deactivated_account_gets_nothing(client, make, as_admin, db):
    team = team_of(make, 4)
    team[0].is_active = False
    db.commit()
    imp = upload(client, as_admin, sheet(40))
    confirm(client, as_admin, imp["id"])
    assert list(owned(db, team).values()) == [0, 14, 13, 13] or sorted(owned(db, team).values()) == [0, 13, 13, 14]


def test_new_accounts_that_have_not_signed_in_yet_count_as_working_until_they_are_old_enough(client, make, as_admin, db):
    fresh, stale = team_of(make, 2)
    stale.created_at = utcnow() - timedelta(days=9)  # an account that was made long ago and never used
    db.commit()
    imp = upload(client, as_admin, sheet(20))
    plan = plan_of(client, as_admin, imp["id"])
    states = {e["employee_id"]: (e["state"], e["reason"]) for e in plan["employees"]}
    assert states[fresh.id][0] == "new" and states[stale.id] == ("inactive", "Has never signed in.")
    confirm(client, as_admin, imp["id"])
    assert owned(db, [fresh, stale]) == {fresh.id: 20, stale.id: 0}


def test_any_sign_of_life_counts_a_phone_report_a_session_or_a_sign_in(client, make, as_admin, db):
    login_only, phone_only, nothing = team_of(make, 3)
    for e in (login_only, phone_only, nothing):
        away(db, e, days=10)
    login_only.last_login_at = utcnow() - timedelta(hours=5)
    db.add(EmployeeDevice(employee_id=phone_only.id, device_uid="phone-1", last_seen_at=utcnow() - timedelta(days=9), last_heartbeat_at=utcnow() - timedelta(minutes=3)))
    db.commit()
    imp = upload(client, as_admin, sheet(30))
    plan = plan_of(client, as_admin, imp["id"])
    states = {e["employee_id"]: e["state"] for e in plan["employees"]}
    assert states == {login_only.id: "active", phone_only.id: "active", nothing.id: "inactive"}
    confirm(client, as_admin, imp["id"])
    assert owned(db, [login_only, phone_only, nothing]) == {login_only.id: 15, phone_only.id: 15, nothing.id: 0}


def test_the_number_of_days_is_a_setting(client, make, as_admin, db):
    team = team_of(make, 2)
    away(db, team[1], days=3)
    imp = upload(client, as_admin, sheet(10))
    assert plan_of(client, as_admin, imp["id"])["working"] == 1  # (the default is two days)
    assert client.put("/api/v1/settings/inactive_after_days", headers=as_admin, json={"value": 5}).status_code == 200
    plan = plan_of(client, as_admin, imp["id"])
    assert plan["inactive_after_days"] == 5 and plan["working"] == 2
    confirm(client, as_admin, imp["id"])
    assert sorted(owned(db, team).values()) == [5, 5]


def test_choosing_somebody_who_is_not_working_gives_them_nothing_and_says_so(client, make, as_admin, db):
    team = team_of(make, 3)
    away(db, team[2], days=4)
    imp = upload(client, as_admin, sheet(30))
    ids = ",".join(str(e.id) for e in team)
    plan = plan_of(client, as_admin, imp["id"], employee_ids=ids)
    assert plan["working"] == 2 and plan["left_out"] == 1
    assert any("not working" in w and team[2].full_name in w for w in plan["warnings"])
    confirm(client, as_admin, imp["id"], distribution={"employee_ids": [e.id for e in team]})
    assert sorted(owned(db, team).values()) == [0, 15, 15]


def test_only_the_chosen_employees_receive(client, make, as_admin, db):
    team = team_of(make, 5)
    chosen = team[:2]
    imp = upload(client, as_admin, sheet(11))
    done = confirm(client, as_admin, imp["id"], distribution={"employee_ids": [e.id for e in chosen]})
    assert done["status"] == "completed"
    assert sorted(owned(db, chosen).values()) == [5, 6] and set(owned(db, team[2:]).values()) == {0}


def test_who_is_working_is_decided_when_the_import_is_confirmed_not_when_the_plan_was_looked_at(client, make, as_admin, db):
    team = team_of(make, 4)
    imp = upload(client, as_admin, sheet(40))
    assert plan_of(client, as_admin, imp["id"])["working"] == 4
    away(db, team[0], days=5)  # ...and then somebody stops working before the administrator presses "Add"
    confirm(client, as_admin, imp["id"])
    per = owned(db, team)
    assert per[team[0].id] == 0 and sorted(per.values()) == [0, 13, 13, 14]


def test_nobody_working_is_refused_with_a_clear_message_unless_the_contacts_are_to_be_left_unassigned(client, make, as_admin, db):
    team = team_of(make, 2)
    for e in team:
        away(db, e, days=5)
    imp = upload(client, as_admin, sheet(10))
    plan = plan_of(client, as_admin, imp["id"])
    assert plan["can_confirm"] is False and plan["working"] == 0 and "Nobody is working" in plan["warnings"][0]
    refused = client.post(f"/api/v1/contacts/import/{imp['id']}/confirm", headers=as_admin, json={})
    assert refused.status_code == 422 and refused.json()["error"]["code"] == "no_working_employees"
    assert db.query(Contact).count() == 0 and get_import(client, as_admin, imp["id"])["status"] == "previewed"

    done = confirm(client, as_admin, imp["id"], **UNASSIGNED)
    assert done["status"] == "completed" and db.query(Contact).count() == 10 and db.query(ContactAssignment).count() == 0


# --------------------------------------------------------------------------------------------- other ways to share
def test_balance_total_gives_the_most_to_whoever_has_the_least(client, make, as_admin, db):
    busy, free = team_of(make, 2)
    for i in range(30):
        make.contact(phone=f"{9100000000 + i * 3 + 1}", assign_to=busy)  # busy already has 30 contacts to call
    imp = upload(client, as_admin, sheet(30))
    plan = plan_of(client, as_admin, imp["id"], strategy="balance_total")
    assert {e["employee_id"]: e["planned"] for e in plan["employees"] if e["receives"]} == {busy.id: 0, free.id: 30}
    confirm(client, as_admin, imp["id"], distribution={"strategy": "balance_total"})
    assert owned(db, [busy, free]) == {busy.id: 30, free.id: 30}

    equal = upload(client, as_admin, sheet(30, start=100))
    confirm(client, as_admin, equal["id"], distribution={"strategy": "equal"})  # "equal" gives the same number, whatever they have
    assert owned(db, [busy, free]) == {busy.id: 45, free.id: 45}


def test_interleave_gives_everybody_a_mix_of_the_sheet_and_blocks_gives_each_a_part(client, make, as_admin, db):
    team = team_of(make, 3)
    imp = upload(client, as_admin, sheet(9))
    confirm(client, as_admin, imp["id"], distribution={"order": "interleave"})
    by_row = {c.name: a.employee_id for c, a in db.query(Contact, ContactAssignment).join(ContactAssignment, ContactAssignment.contact_id == Contact.id)}
    assert len({by_row[f"Customer {i}"] for i in range(3)}) == 3  # the first three rows went to three different people

    db.query(ContactAssignment).delete()
    db.query(Contact).delete()
    db.commit()
    imp2 = upload(client, as_admin, sheet(9))
    confirm(client, as_admin, imp2["id"], distribution={"order": "blocks"})
    by_row = {c.name: a.employee_id for c, a in db.query(Contact, ContactAssignment).join(ContactAssignment, ContactAssignment.contact_id == Contact.id)}
    assert len({by_row[f"Customer {i}"] for i in range(3)}) == 1 and len({by_row[f"Customer {i}"] for i in range(9)}) == 3


def test_a_row_that_names_its_employee_goes_to_that_person_and_the_rest_is_shared(client, make, as_admin, db):
    a, b, c = team_of(make, 3)
    rows = [[f"Named {i}", f"{9200000000 + i * 3 + 1}", a.employee_code] for i in range(4)]  # four rows are for a, by name
    rows += [[f"Open {i}", f"{9300000000 + i * 3 + 1}", ""] for i in range(9)]
    imp = upload(client, as_admin, make_csv(rows, header=("Name", "Mobile", "Assigned To")))
    preview = get_import(client, as_admin, imp["id"])
    assert preview["explicit_rows"] == 4
    plan = plan_of(client, as_admin, imp["id"])
    assert plan["to_distribute"] == 9 and next(e for e in plan["employees"] if e["employee_id"] == a.id)["explicit"] == 4
    confirm(client, as_admin, imp["id"])
    assert owned(db, [a, b, c]) == {a.id: 4 + 3, b.id: 3, c.id: 3}


def test_unassigned_on_purpose_adds_the_contacts_without_owners(client, make, as_admin, db):
    team_of(make, 3)
    imp = upload(client, as_admin, sheet(12))
    done = confirm(client, as_admin, imp["id"], **UNASSIGNED)
    assert done["status"] == "completed" and done["inserted_rows"] == 12 and done["assigned_rows"] == 0
    assert db.query(Contact).count() == 12 and db.query(ContactAssignment).count() == 0


def test_unknown_employee_in_the_choice_is_refused(client, make, as_admin):
    team_of(make, 2)
    imp = upload(client, as_admin, sheet(5))
    refused = client.post(f"/api/v1/contacts/import/{imp['id']}/confirm", headers=as_admin, json={"distribution": {"employee_ids": [999999]}})
    assert refused.status_code == 422 and refused.json()["error"]["code"] == "unknown_employee"


def test_the_contacts_show_up_in_the_queue_of_the_people_who_received_them(client, make, as_admin, db):
    from tests.conftest import auth_headers

    a, b = team_of(make, 2)
    headers_a = auth_headers(client, a)
    assert client.get("/api/v1/queue", headers=headers_a).json()["items"] == []  # (this is also remembered by the cache)
    imp = upload(client, as_admin, sheet(8))
    confirm(client, as_admin, imp["id"])
    assert len(client.get("/api/v1/queue", headers=headers_a).json()["items"]) == 4
