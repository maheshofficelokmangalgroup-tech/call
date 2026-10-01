"""Acceptance: dashboard totals reconcile with raw call records for the selected period."""

from datetime import datetime, timedelta

from sqlalchemy import func

from app.core.timeutils import business_date, business_tz, day_bounds_utc, utcnow
from app.models.call import Call
from tests.conftest import auth_headers, iso, now_utc


def place(client, headers, contact, code=None, *, duration=None, cid):
    call = client.post("/api/v1/calls", headers=headers, json={"client_call_id": cid, "contact_id": contact.id, "started_at": iso(now_utc())}).json()
    if duration is not None:
        client.patch(
            f"/api/v1/calls/{call['id']}",
            headers=headers,
            json={"ended_at": iso(now_utc() + timedelta(seconds=duration + 1)), "duration_seconds": duration},
        )
    if code:
        resp = client.post(f"/api/v1/calls/{call['id']}/disposition", headers=headers, json={"disposition_code": code})
        assert resp.status_code == 200, resp.text
    return call


def raw_totals(db, employee_ids, day=None):
    start, end = day_bounds_utc(day)
    calls = db.query(Call).filter(Call.employee_id.in_(employee_ids), Call.started_at >= start, Call.started_at < end).all()
    answered = [c for c in calls if c.status in ("connected", "completed")]
    return {
        "total": len(calls),
        "connected": len(answered),
        "no_answer": sum(1 for c in calls if c.status == "no_answer"),
        "busy": sum(1 for c in calls if c.disposition and c.disposition.code == "BUSY"),
        "completed": sum(1 for c in calls if c.disposition_id is not None),
        "pending": sum(1 for c in calls if c.disposition_id is None),
        "talk": sum(c.duration_seconds for c in answered),
    }


def test_employee_dashboard_reconciles_with_raw_records(client, make, emp_a, emp_b, as_a, as_b, db):
    mine = [make.contact(assign_to=emp_a) for _ in range(9)]
    place(client, as_a, mine[0], "CONNECTED", duration=60, cid="dash-a-000001")
    place(client, as_a, mine[1], "INTERESTED", duration=30, cid="dash-a-000002")
    place(client, as_a, mine[2], "NO_ANSWER", duration=0, cid="dash-a-000003")
    place(client, as_a, mine[3], "BUSY", cid="dash-a-000004")
    place(client, as_a, mine[4], "SWITCHED_OFF", cid="dash-a-000005")
    place(client, as_a, mine[5], "INVALID_NUMBER", cid="dash-a-000006")
    place(client, as_a, mine[6], None, cid="dash-a-000007")  # still waiting for an outcome
    other = make.contact(assign_to=emp_b)
    place(client, as_b, other, "CONNECTED", duration=45, cid="dash-b-000001")
    # a call from yesterday must not leak into today's numbers
    old = place(client, as_a, mine[7], "NO_ANSWER", cid="dash-a-000008")
    yesterday_noon = datetime.combine(business_date() - timedelta(days=1), datetime.min.time().replace(hour=12), tzinfo=business_tz())
    row = db.get(Call, old["id"])
    row.started_at = yesterday_noon
    db.commit()

    dash = client.get("/api/v1/dashboard", headers=as_a).json()
    raw = raw_totals(db, [emp_a.id])
    assert dash["scope"] == "employee"
    assert dash["total_calls"] == raw["total"] == 7
    assert dash["connected_calls"] == raw["connected"] == 2
    assert dash["no_answer_calls"] == raw["no_answer"] == 3  # no answer + busy + switched off end unanswered
    assert dash["busy_calls"] == raw["busy"] == 1 and dash["switched_off_calls"] == 1 and dash["invalid_calls"] == 1
    assert dash["completed_calls"] == raw["completed"] == 6 and dash["pending_wrapup"] == raw["pending"] == 1
    assert dash["total_talk_seconds"] == raw["talk"] == 90 and dash["average_call_seconds"] == 45
    assert dash["daily_target"] == emp_a.daily_target
    assert dash["target_progress_percent"] == round(100 * 6 / emp_a.daily_target, 1)
    assert sum(dash["calls_by_hour"]) == dash["total_calls"]
    assert dash["assigned_contacts"] == 9  # all of `mine` stay assigned whatever their outcome; `other` belongs to B

    yesterday = client.get(f"/api/v1/dashboard?day={business_date() - timedelta(days=1)}", headers=as_a).json()
    assert yesterday["total_calls"] == 1 and yesterday["no_answer_calls"] == 1


def test_pending_contacts_and_callbacks_due(client, make, emp_a, as_a):
    make.contact(assign_to=emp_a)
    make.contact(assign_to=emp_a)
    cb_contact = make.contact(assign_to=emp_a)
    client.post("/api/v1/callbacks", headers=as_a, json={"contact_id": cb_contact.id, "scheduled_at": iso(now_utc() - timedelta(minutes=1))})
    dash = client.get("/api/v1/dashboard", headers=as_a).json()
    assert dash["assigned_contacts"] == 3
    assert dash["pending_contacts"] == 3  # the due callback is part of today's queue
    assert dash["callbacks_due"] == 1


def test_employee_cannot_read_anyone_elses_numbers(client, make, emp_a, emp_b, as_a, as_b):
    place(client, as_b, make.contact(assign_to=emp_b), "CONNECTED", duration=20, cid="dash-leak-0001")
    leak = client.get(f"/api/v1/dashboard?employee_id={emp_b.id}", headers=as_a).json()
    assert leak["scope"] == "employee" and leak["total_calls"] == 0 and leak["employee_count"] == 0


def test_admin_organisation_view_and_filters(client, make, emp_a, emp_b, admin, as_admin, as_a, as_b, db):
    team = make.team("North")
    emp_a.team_id = team.id
    db.commit()
    place(client, as_a, make.contact(assign_to=emp_a), "CONNECTED", duration=60, cid="dash-org-00001")
    place(client, as_b, make.contact(assign_to=emp_b), "NO_ANSWER", cid="dash-org-00002")
    inactive = make.employee(active=False)

    org = client.get("/api/v1/dashboard", headers=as_admin).json()
    assert org["scope"] == "organization"
    assert org["total_calls"] == raw_totals(db, [emp_a.id, emp_b.id])["total"] == 2
    assert (org["employee_count"], org["active_employees"], org["inactive_employees"]) == (4, 3, 1)
    assert org["daily_target"] == emp_a.daily_target + emp_b.daily_target + admin.daily_target  # only active staff count
    assert inactive.id  # created

    only_a = client.get(f"/api/v1/dashboard?employee_id={emp_a.id}", headers=as_admin).json()
    assert only_a["scope"] == "employee" and only_a["total_calls"] == 1 and only_a["connected_calls"] == 1
    by_team = client.get(f"/api/v1/dashboard?team_id={team.id}", headers=as_admin).json()
    assert by_team["scope"] == "team" and by_team["total_calls"] == 1


def test_manager_dashboard_is_limited_to_the_team(client, make):
    team, other = make.team("A"), make.team("B")
    manager = make.employee(role="manager", team=team)
    mate = make.employee(team=team)
    stranger = make.employee(team=other)
    m, w, s = (auth_headers(client, u) for u in (manager, mate, stranger))
    place(client, w, make.contact(assign_to=mate), "CONNECTED", duration=10, cid="dash-mgr-00001")
    place(client, s, make.contact(assign_to=stranger), "CONNECTED", duration=10, cid="dash-mgr-00002")
    dash = client.get("/api/v1/dashboard", headers=m).json()
    assert dash["scope"] == "team" and dash["total_calls"] == 1 and dash["employee_count"] == 2


def test_dashboard_sums_equal_sql_group_by(client, make, emp_a, as_a, db):
    for i in range(5):
        place(client, as_a, make.contact(assign_to=emp_a), "CONNECTED" if i % 2 == 0 else "NO_ANSWER", duration=12 if i % 2 == 0 else 0, cid=f"dash-sum-{i:05d}")
    dash = client.get("/api/v1/dashboard", headers=as_a).json()
    start, end = day_bounds_utc()
    by_status = dict(
        db.query(Call.status, func.count(Call.id)).filter(Call.employee_id == emp_a.id, Call.started_at >= start, Call.started_at < end).group_by(Call.status).all()
    )
    assert dash["connected_calls"] == by_status.get("completed", 0) + by_status.get("connected", 0) == 3
    assert dash["no_answer_calls"] == by_status.get("no_answer", 0) == 2
    assert dash["generated_at"] and utcnow()
