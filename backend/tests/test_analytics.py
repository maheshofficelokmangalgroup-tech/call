"""Administrator analytics: range totals, per-employee figures, live view, exports, settings and bulk employee creation.

Calls are inserted directly with exact local (business timezone) times so day / hour bucketing and the previous-period
comparison can be checked against hand-computed numbers.
"""

from __future__ import annotations

import csv
import io
import itertools
from datetime import date, datetime, time, timedelta

import pytest

from app.core.redis_client import get_redis
from app.core.timeutils import business_date, business_tz, utcnow
from app.models.call import Call, CallDisposition, CallEvent
from app.models.employee import Employee, EmployeeSession
from app.models.recording import Recording
from tests.conftest import auth_headers, login

_ids = itertools.count(1)


def local(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime.combine(day, time(hour, minute), tzinfo=business_tz())


def add_call(
    db,
    emp,
    started: datetime,
    *,
    talk: int = 0,
    status: str | None = None,
    outcome: str | None = None,
    contact: str | None = "Customer",
    phone: str | None = None,
    ring: int = 8,
    ended: bool = True,
) -> Call:
    """One call attempt. `talk` > 0 means it was answered `ring` seconds after dialing."""
    n = next(_ids)
    answered = talk > 0
    call = Call(
        employee_id=emp.id,
        client_call_id=f"analytics-test-{n:06d}",
        phone_number_snapshot=phone or f"+9198000{n:05d}",
        contact_name_snapshot=contact,
        direction="outgoing",
        started_at=started,
        answered_at=started + timedelta(seconds=ring) if answered else None,
        ended_at=(started + timedelta(seconds=ring + talk + 2)) if ended else None,
        duration_seconds=talk,
        status=status or ("completed" if answered else "no_answer"),
    )
    if outcome:
        disposition = db.query(CallDisposition).filter(CallDisposition.code == outcome).one()
        call.disposition_id = disposition.id
        call.disposition_at = started + timedelta(seconds=ring + talk + 30)
    db.add(call)
    db.commit()
    db.refresh(call)
    return call


def add_recording(db, call: Call, *, status: str = "available") -> Recording:
    rec = Recording(
        uid=f"rec-{call.id:08d}-0000-0000-0000-000000000000"[:36],
        call_id=call.id,
        employee_id=call.employee_id,
        storage_backend="local",
        storage_key=f"recordings/test/{call.id}.m4a",
        content_type="audio/mp4",
        size_bytes=1000,
        duration_seconds=call.duration_seconds,
        upload_status=status,
    )
    db.add(rec)
    db.commit()
    return rec


def add_ended_event(db, call: Call, payload: dict) -> None:
    db.add(CallEvent(call_id=call.id, event_type="ended", occurred_at=call.ended_at or call.started_at, payload=payload))
    db.commit()


def get(client, path, headers, **params):
    resp = client.get(f"/api/v1{path}", headers=headers, params=params)
    return resp


@pytest.fixture()
def team_a(make):
    return make.team("Team A")


@pytest.fixture()
def team_b(make):
    return make.team("Team B")


@pytest.fixture()
def staff(make, team_a, db):
    """Three employees: two in team A, one in team B, plus a manager of team A."""
    return {
        "a1": make.employee(code="A1", name="Asha Patil", team=team_a, email="a1@example.com", target=10),
        "a2": make.employee(code="A2", name="Bhushan More", team=team_a, email="a2@example.com", target=10),
        "b1": make.employee(code="B1", name="Chetan Shah", team=make.team("Team B"), email="b1@example.com", target=10),
        "mgr": make.employee(role="manager", code="M1", name="Mina Manager", team=team_a, email="mgr@example.com"),
    }


# ------------------------------------------------------------------------------------------- overview
def test_overview_reconciles_with_raw_rows_and_buckets_by_local_time(client, db, admin, as_admin, staff):
    today = business_date()
    d1, d2, d3 = today - timedelta(days=2), today - timedelta(days=1), today  # d1 = first day of a 3 day period
    a1, a2 = staff["a1"], staff["a2"]
    add_call(db, a1, local(d1, 10, 5), talk=60, outcome="CONNECTED", phone="+919800000001", contact="Rahul")
    add_call(db, a1, local(d1, 23, 50), talk=30, outcome="INTERESTED", phone="+919800000002")  # 18:20 UTC: still d1 locally
    add_call(db, a2, local(d3, 0, 20), talk=0, outcome="NO_ANSWER")  # 18:50 UTC the day before: d3 locally, hour 0
    add_call(db, a2, local(d3, 11, 0), talk=120, outcome="CALLBACK", phone="+919800000001", contact="Rahul")
    add_call(db, a2, local(d3, 12, 0), talk=0, status="failed")
    add_call(db, a2, local(d3, 12, 30), talk=0, status="dialing", ended=False)  # still on the call: no outcome yet, not "pending wrap-up"
    # the previous period (3 days before d1) for the comparison numbers
    add_call(db, a1, local(d1 - timedelta(days=2), 10, 0), talk=40, outcome="CONNECTED")
    add_call(db, a1, local(d1 - timedelta(days=3), 10, 0), talk=0, outcome="NO_ANSWER")
    # far outside both periods
    add_call(db, a1, local(d1 - timedelta(days=30), 10, 0), talk=500, outcome="CONNECTED")

    data = get(client, "/analytics/overview", as_admin, date_from=d1.isoformat(), date_to=d3.isoformat()).json()
    t = data["totals"]
    assert data["scope"] == "organization"
    assert data["period"]["days"] == 3 and data["period"]["previous_from"] == (d1 - timedelta(days=3)).isoformat()
    assert t["calls"] == 6 and t["connected"] == 3 and t["no_answer"] == 1 and t["failed"] == 1
    assert t["answer_rate"] == 50.0
    assert t["talk_seconds"] == 210 and t["avg_talk_seconds"] == 70 and t["longest_call_seconds"] == 120
    assert t["avg_ring_seconds"] == 8
    assert t["unique_contacts"] == 5  # +919800000001 twice; the rest differ (one call has no phone clash)
    assert t["active_employees"] == 2
    assert t["pending_wrapup"] == 1  # the failed call has no outcome; the call still in progress does not count
    assert data["previous"]["calls"] == 2 and data["previous"]["connected"] == 1 and data["previous"]["talk_seconds"] == 40

    series = {p["date"]: p for p in data["series"]}
    assert list(series) == [d1.isoformat(), d2.isoformat(), d3.isoformat()]  # no gaps, oldest first
    assert (series[d1.isoformat()]["calls"], series[d1.isoformat()]["talk_seconds"]) == (2, 90)
    assert series[d2.isoformat()] == {"date": d2.isoformat(), "calls": 0, "connected": 0, "talk_seconds": 0}
    assert (series[d3.isoformat()]["calls"], series[d3.isoformat()]["connected"]) == (4, 1)

    hourly = {h["hour"]: h for h in data["hourly"]}
    assert len(data["hourly"]) == 24
    assert hourly[10]["calls"] == 1 and hourly[23]["calls"] == 1 and hourly[0]["calls"] == 1 and hourly[11]["connected"] == 1
    assert sum(h["calls"] for h in data["hourly"]) == 6
    assert data["heatmap"][d1.weekday()][23] == 1 and data["heatmap"][d3.weekday()][0] == 1
    assert sum(sum(row) for row in data["heatmap"]) == 6

    outcomes = {o["code"]: o["count"] for o in data["outcomes"]}
    assert outcomes == {"CONNECTED": 1, "INTERESTED": 1, "NO_ANSWER": 1, "CALLBACK": 1, None: 2}
    assert {s["status"]: s["count"] for s in data["statuses"]} == {"completed": 3, "no_answer": 1, "failed": 1, "dialing": 1}
    assert [row["full_name"] for row in data["leaderboard"]] == ["Bhushan More", "Asha Patil"]  # 4 calls vs 2
    assert data["employees"] == {"total": 5, "active": 5, "with_calls": 2}  # + the admin and the manager


def test_overview_defaults_to_the_last_seven_days_and_validates_ranges(client, db, as_admin, staff):
    data = get(client, "/analytics/overview", as_admin).json()
    assert data["period"]["days"] == 7 and data["period"]["date_to"] == business_date().isoformat()
    assert get(client, "/analytics/overview", as_admin, date_from="2026-03-10", date_to="2026-03-01").status_code == 422
    assert get(client, "/analytics/overview", as_admin, date_from="2020-01-01", date_to="2026-03-01").status_code == 422


def test_manager_only_sees_their_own_team_and_employees_see_nothing(client, db, make, staff, as_a):
    today = business_date()
    add_call(db, staff["a1"], local(today, 9), talk=50, outcome="CONNECTED")
    add_call(db, staff["a2"], local(today, 9, 30), talk=0, outcome="NO_ANSWER")
    add_call(db, staff["b1"], local(today, 10), talk=70, outcome="CONNECTED")
    manager = auth_headers(client, staff["mgr"])

    mine = get(client, "/analytics/overview", manager, date_from=today.isoformat(), date_to=today.isoformat()).json()
    assert mine["scope"] == "team" and mine["totals"]["calls"] == 2 and mine["employees"]["total"] == 3  # a1, a2 and the manager
    other = get(client, "/analytics/overview", manager, employee_id=staff["b1"].id).json()
    assert other["totals"]["calls"] == 0
    listing = get(client, "/analytics/employees", manager).json()
    assert {e["employee_code"] for e in listing["items"]} == {"A1", "A2", "M1"}
    assert get(client, f"/analytics/employees/{staff['b1'].id}", manager).status_code == 404
    assert get(client, "/analytics/overview", as_a).status_code == 403
    assert get(client, "/analytics/live", as_a).status_code == 403


# ---------------------------------------------------------------------------------------- employees
def test_employee_figures_filters_and_sorting(client, db, as_admin, staff, team_a):
    today = business_date()
    yesterday = today - timedelta(days=1)
    a1, a2, b1 = staff["a1"], staff["a2"], staff["b1"]
    for _ in range(3):
        add_call(db, a1, local(today, 10, 30), talk=90, outcome="INTERESTED", phone="+919811111111")
    add_call(db, a1, local(yesterday, 10, 30), talk=30, outcome="CONNECTED", phone="+919822222222")
    add_call(db, a1, local(yesterday, 17, 0), talk=0, outcome="NO_ANSWER", phone="+919833333333")
    add_call(db, a2, local(today, 14, 0), talk=600, outcome="COMPLETED")
    add_call(db, b1, local(today, 9, 0), talk=0, outcome="BUSY")

    data = get(client, "/analytics/employees", as_admin, date_from=yesterday.isoformat(), date_to=today.isoformat()).json()
    rows = {r["employee_code"]: r for r in data["items"]}
    asha = rows["A1"]
    assert (asha["calls"], asha["connected"], asha["no_answer"], asha["answer_rate"]) == (5, 4, 1, 80.0)
    assert (asha["talk_seconds"], asha["avg_talk_seconds"], asha["longest_call_seconds"]) == (300, 75, 90)
    assert asha["unique_contacts"] == 3 and asha["active_days"] == 2
    assert asha["outcomes"] == {"INTERESTED": 3, "CONNECTED": 1, "NO_ANSWER": 1}
    # typical day: first call 10:30 both days; last call 10:30 today and 17:00 yesterday -> averages 10:30 and 13:45
    assert asha["avg_first_call_minute"] == 10 * 60 + 30 and asha["avg_last_call_minute"] == (10 * 60 + 30 + 17 * 60) // 2
    assert asha["today_calls"] == 3 and asha["today_target_percent"] == 30.0  # target 10
    assert asha["team_name"] == "Team A" and asha["role"] == "employee"
    assert rows["B1"]["calls"] == 1 and rows["B1"]["answer_rate"] == 0.0 and rows["M1"]["calls"] == 0

    by_talk = get(client, "/analytics/employees", as_admin, sort="talk", date_from=yesterday.isoformat(), date_to=today.isoformat()).json()["items"]
    assert [r["employee_code"] for r in by_talk][:2] == ["A2", "A1"]
    ascending = get(client, "/analytics/employees", as_admin, sort="name", order="asc").json()["items"]
    assert [r["full_name"] for r in ascending] == sorted(r["full_name"] for r in ascending)
    assert {r["employee_code"] for r in get(client, "/analytics/employees", as_admin, team_id=team_a.id).json()["items"]} == {"A1", "A2", "M1"}
    assert [r["employee_code"] for r in get(client, "/analytics/employees", as_admin, q="chetan").json()["items"]] == ["B1"]
    assert {r["role"] for r in get(client, "/analytics/employees", as_admin, role="manager").json()["items"]} == {"manager"}

    db.get(Employee, a2.id).is_active = False
    db.commit()
    inactive = get(client, "/analytics/employees", as_admin, state="inactive").json()["items"]
    assert [r["employee_code"] for r in inactive] == ["A2"] and inactive[0]["presence"] == "inactive"
    assert "A2" not in {r["employee_code"] for r in get(client, "/analytics/employees", as_admin, state="active").json()["items"]}


def test_presence_states(client, db, as_admin, staff):
    now = utcnow()
    for code, minutes_ago in (("A1", 1), ("A2", 30), ("B1", 300)):
        emp = staff[code.lower()]
        db.add(EmployeeSession(id=f"sess-{code}-0000-0000-0000-000000000000"[:36], employee_id=emp.id, refresh_hash="x" * 64,
                               created_at=now - timedelta(days=1), last_used_at=now - timedelta(minutes=minutes_ago), expires_at=now + timedelta(days=5)))
    db.commit()
    add_call(db, staff["a2"], now - timedelta(minutes=3), talk=0, status="connected", ended=False)  # a2 is on a call right now
    rows = {r["employee_code"]: r["presence"] for r in get(client, "/analytics/employees", as_admin).json()["items"]}
    assert rows["A1"] == "online" and rows["A2"] == "on_call" and rows["B1"] == "offline" and rows["M1"] == "offline"
    only_online = get(client, "/analytics/employees", as_admin, presence="online").json()["items"]
    assert {r["employee_code"] for r in only_online} == {"A1", "ADMIN"}  # the administrator is online too: this very request


def test_authenticated_requests_refresh_last_seen_once_a_minute(client, db, emp_a):
    headers = auth_headers(client, emp_a)
    session = db.query(EmployeeSession).filter(EmployeeSession.employee_id == emp_a.id).one()
    session.last_used_at = utcnow() - timedelta(minutes=10)
    db.commit()
    get_redis().delete(f"c:once:presence:{session.id}")  # the minute that signing in wrote "last seen" for is over
    assert client.get("/api/v1/me", headers=headers).status_code == 200
    db.expire_all()
    fresh = db.query(EmployeeSession).filter(EmployeeSession.employee_id == emp_a.id).one().last_used_at
    assert utcnow() - fresh < timedelta(seconds=30)
    assert client.get("/api/v1/me", headers=headers).status_code == 200  # within the minute: no second write needed
    db.expire_all()
    assert db.query(EmployeeSession).filter(EmployeeSession.employee_id == emp_a.id).one().last_used_at == fresh


def test_employee_detail_lists_top_contacts_recent_calls_and_devices(client, db, as_admin, staff):
    today = business_date()
    a1 = staff["a1"]
    login(client, a1.email)  # registers a device
    for hour in (9, 10, 11):
        add_call(db, a1, local(today, hour), talk=45, outcome="CONNECTED", phone="+919844444444", contact="Repeat Customer")
    add_call(db, a1, local(today, 12), talk=0, outcome="NO_ANSWER", phone="+919855555555", contact="Single")
    detail = get(client, f"/analytics/employees/{a1.id}", as_admin, date_from=today.isoformat(), date_to=today.isoformat()).json()
    assert detail["employee"]["calls"] == 4 and detail["employee"]["presence"] in ("online", "idle", "offline")
    top = detail["top_contacts"]
    assert top[0]["phone"] == "+919844444444" and top[0]["calls"] == 3 and top[0]["connected"] == 3 and top[0]["talk_seconds"] == 135
    assert top[0]["name"] == "Repeat Customer" and top[0]["last_outcome"] == "Connected"
    assert len(detail["recent_calls"]) == 4 and detail["recent_calls"][0]["started_at"] >= detail["recent_calls"][-1]["started_at"]
    assert detail["devices"] and detail["devices"][0]["device_name"] == "Test Phone"
    assert len(detail["series"]) == 1 and len(detail["hourly"]) == 24
    assert get(client, "/analytics/employees/999999", as_admin).status_code == 404


# ------------------------------------------------------------------------------------------- live
def test_live_view_shows_calls_in_progress_and_ignores_stale_ones(client, db, as_admin, staff):
    now = utcnow()
    add_call(db, staff["a1"], now - timedelta(minutes=2), talk=0, status="connected", ended=False, contact="Right Now")
    add_call(db, staff["a2"], now - timedelta(hours=5), talk=0, status="dialing", ended=False, contact="Stale")  # never reported its end
    done = add_call(db, staff["b1"], now - timedelta(minutes=10), talk=75, outcome="CONNECTED", contact="Done")
    add_recording(db, done)
    data = get(client, "/analytics/live", as_admin).json()
    assert [c["contact_name"] for c in data["on_call"]] == ["Right Now"]
    assert data["on_call"][0]["employee_code"] == "A1" and data["on_call"][0]["status"] == "connected"
    recent = {c["contact_name"]: c for c in data["recent"]}
    assert recent["Done"]["has_recording"] is True and recent["Done"]["outcome"] == "Connected" and recent["Done"]["duration_seconds"] == 75
    assert data["presence"]["on_call"] == 1 and data["presence"]["online"] >= 1


def test_timestamps_carry_a_utc_marker_so_browsers_do_not_read_them_as_local_time(client, db, as_admin, staff):
    now = utcnow()
    add_call(db, staff["a1"], now - timedelta(minutes=2), talk=0, status="connected", ended=False)
    add_call(db, staff["a1"], now - timedelta(minutes=30), talk=60, outcome="CONNECTED")
    live = get(client, "/analytics/live", as_admin).json()
    people = get(client, "/analytics/employees", as_admin).json()["items"]
    a1 = next(p for p in people if p["employee_code"] == "A1")
    stamps = [live["generated_at"], live["on_call"][0]["started_at"], live["recent"][0]["started_at"], a1["last_call_at"], a1["first_call_at"], a1["created_at"]]
    assert all(s.endswith("Z") or s.endswith("+00:00") for s in stamps), stamps


# ---------------------------------------------------------------------------------------- recordings
def test_recording_coverage_and_the_reasons_phones_reported(client, db, as_admin, staff):
    today = business_date()
    a1 = staff["a1"]
    recorded = add_call(db, a1, local(today, 9), talk=60, outcome="CONNECTED")
    add_recording(db, recorded)
    add_ended_event(db, recorded, {"source": "in_call_service", "recording": "saved"})
    for hour, reason in ((10, "silent"), (11, "silent"), (12, "no_permission")):
        call = add_call(db, a1, local(today, hour), talk=40, outcome="CONNECTED")
        add_ended_event(db, call, {"source": "in_call_service", "recording": reason, "recording_detail": "source MIC, loudest sound 0 of 32767"})
    add_call(db, a1, local(today, 13), talk=40, outcome="CONNECTED")  # no end report at all
    add_call(db, a1, local(today, 14), talk=0, outcome="NO_ANSWER")  # not answered: nothing to record
    data = get(client, "/analytics/overview", as_admin, date_from=today.isoformat(), date_to=today.isoformat()).json()
    rec = data["recording"]
    assert rec["answered_calls"] == 5 and rec["recorded_calls"] == 1 and rec["coverage_percent"] == 20.0 and rec["enabled"] is False
    reasons = {r["reason"]: r["count"] for r in rec["not_recorded"]}
    assert reasons == {"silent": 2, "no_permission": 1, "unreported": 1}
    assert data["totals"]["recordings"] == 1


# ------------------------------------------------------------------------------------------- calls list + export
def test_call_list_filters_by_recording_duration_range_and_sort(client, db, as_admin, staff):
    today = business_date()
    a1 = staff["a1"]
    short = add_call(db, a1, local(today - timedelta(days=3), 9), talk=20, contact="Short")
    long_call = add_call(db, a1, local(today - timedelta(days=1), 9), talk=400, contact="Long")
    recorded = add_call(db, a1, local(today, 9), talk=60, contact="Recorded")
    add_recording(db, recorded)

    def names(**params):
        return [c["contact_name"] for c in get(client, "/calls", as_admin, **params).json()["items"]]

    assert names(has_recording="true") == ["Recorded"]
    assert set(names(has_recording="false")) == {"Short", "Long"}
    assert set(names(min_duration=60)) == {"Long", "Recorded"}
    assert names(sort="longest")[0] == "Long" and names(sort="oldest")[0] == "Short" and names()[0] == "Recorded"
    assert set(names(from_day=(today - timedelta(days=1)).isoformat(), to_day=today.isoformat())) == {"Long", "Recorded"}
    assert names(day=today.isoformat()) == ["Recorded"]
    assert short.id and long_call.id


def test_calls_export_is_a_safe_spreadsheet_scoped_to_the_caller(client, db, as_admin, staff):
    today = business_date()
    add_call(db, staff["a1"], local(today, 9, 15), talk=61, outcome="INTERESTED", contact='=HYPERLINK("http://evil","x")', phone="+919866666666")
    add_call(db, staff["b1"], local(today, 10, 15), talk=0, outcome="NO_ANSWER", contact="Plain Name")
    resp = client.get("/api/v1/calls/export.csv", headers=as_admin, params={"day": today.isoformat()})
    assert resp.status_code == 200 and resp.headers["content-type"].startswith("text/csv")
    assert "attachment" in resp.headers["content-disposition"]
    assert resp.text.startswith("﻿")
    rows = list(csv.reader(io.StringIO(resp.text.lstrip("﻿"))))
    assert rows[0][:6] == ["Call ID", "Employee ID", "Employee", "Contact", "Phone", "Direction"]
    body = {r[3]: r for r in rows[1:]}
    assert "'=HYPERLINK" in next(iter(k for k in body if "HYPERLINK" in k))  # a formula is defused with a leading apostrophe
    named = body["Plain Name"]
    assert named[1] == "B1" and named[11] == "no_answer" and named[12] == "No Answer"
    interested = next(r for k, r in body.items() if "HYPERLINK" in k)
    assert interested[6].startswith(today.isoformat() + " 09:15") and interested[9] == "8" and interested[10] == "61"  # local time, ring and talk seconds

    manager = auth_headers(client, staff["mgr"])
    mine = client.get("/api/v1/calls/export.csv", headers=manager, params={"day": today.isoformat()}).text
    assert "Plain Name" not in mine and "HYPERLINK" in mine
    assert client.get("/api/v1/calls/export.csv", headers=auth_headers(client, staff["a1"])).status_code == 403
    audit = client.get("/api/v1/audit-logs", headers=as_admin, params={"action": "report.export"}).json()
    assert audit["total"] >= 1

    people = client.get("/api/v1/analytics/employees.csv", headers=as_admin)
    assert people.status_code == 200 and "Asha Patil" in people.text and people.text.startswith("﻿")


# ------------------------------------------------------------------------------------------- settings
def test_settings_can_be_read_and_changed_by_administrators_only(client, as_admin, as_a, emp_a):
    data = client.get("/api/v1/settings", headers=as_admin).json()
    assert data["recording"]["enabled"] is False and data["default_daily_target"] == 50 and data["duplicate_policy"] == "skip"
    assert {i["key"] for i in data["items"]} == {"recording", "retry_rules", "default_daily_target", "duplicate_policy", "inactive_after_days", "auto_rebalance", "auto_level"}
    assert data["auto_level"] is True

    notice = "Calls are recorded for quality and training. Recordings are private."
    updated = client.put("/api/v1/settings/recording", headers=as_admin, json={"value": {"enabled": True, "notice_text": notice}})
    assert updated.status_code == 200 and updated.json()["recording"] == {"enabled": True, "notice_text": notice}
    me = client.get("/api/v1/me", headers=as_a).json()
    assert me["config"]["recording"]["enabled"] is True and me["config"]["recording"]["notice_text"] == notice  # the phones follow the switch

    assert client.put("/api/v1/settings/default_daily_target", headers=as_admin, json={"value": 80}).json()["default_daily_target"] == 80
    assert client.put("/api/v1/settings/duplicate_policy", headers=as_admin, json={"value": "update"}).json()["duplicate_policy"] == "update"
    rules = {"NO_ANSWER": {"delay_minutes": 60, "max_attempts": 4}, "BUSY": {"delay_minutes": 15, "max_attempts": 6}, "SWITCHED_OFF": {"delay_minutes": 300, "max_attempts": 2}}
    assert client.put("/api/v1/settings/retry_rules", headers=as_admin, json={"value": rules}).json()["retry_rules"]["BUSY"] == {"delay_minutes": 15, "max_attempts": 6}

    assert client.put("/api/v1/settings/default_daily_target", headers=as_admin, json={"value": 5000}).status_code == 422
    assert client.put("/api/v1/settings/default_daily_target", headers=as_admin, json={"value": True}).status_code == 422
    assert client.put("/api/v1/settings/duplicate_policy", headers=as_admin, json={"value": "merge"}).status_code == 422
    assert client.put("/api/v1/settings/recording", headers=as_admin, json={"value": {"enabled": True, "notice_text": "x"}}).status_code == 422
    assert client.put("/api/v1/settings/retry_rules", headers=as_admin, json={"value": {"BUSY": {"delay_minutes": 0, "max_attempts": 1}}}).status_code == 422
    assert client.put("/api/v1/settings/nope", headers=as_admin, json={"value": 1}).status_code == 404

    assert client.get("/api/v1/settings", headers=as_a).status_code == 403
    assert client.put("/api/v1/settings/recording", headers=as_a, json={"value": {"enabled": False, "notice_text": notice}}).status_code == 403
    audit = client.get("/api/v1/audit-logs", headers=as_admin, params={"action": "settings.update"}).json()
    assert audit["total"] == 4 and audit["items"][-1]["details"]["after"] == {"enabled": True, "notice_text": notice}


# ---------------------------------------------------------------------------------------- bulk employees
def test_bulk_employee_creation_reports_each_row(client, db, as_admin, make, staff, team_a):
    make.employee(code="TAKEN", email="taken@example.com")
    payload = {
        "employees": [
            {"full_name": "Priya Kulkarni", "email": "priya@example.com", "phone": "9876500001", "team_id": team_a.id, "daily_target": 40},
            {"full_name": "Duplicate Email", "email": "taken@example.com"},
            {"full_name": "Own Code", "email": "own@example.com", "employee_code": "own77", "password": "Str0ng-Passw0rd!"},
            {"full_name": "Bad Team", "email": "badteam@example.com", "team_id": 999999},
            {"full_name": "Weak Password", "email": "weak@example.com", "password": "123"},
        ]
    }
    data = client.post("/api/v1/employees/bulk", headers=as_admin, json=payload).json()
    assert (data["created"], data["failed"]) == (2, 3)
    ok = [r for r in data["results"] if r["ok"]]
    assert [r["index"] for r in ok] == [0, 2]
    priya = ok[0]
    assert priya["employee"]["employee_code"].startswith("EMP") and priya["employee"]["team_name"] == "Team A" and priya["employee"]["daily_target"] == 40
    assert priya["temporary_password"] and ok[1]["temporary_password"] is None and ok[1]["employee"]["employee_code"] == "OWN77"
    failures = {r["index"]: r["code"] for r in data["results"] if not r["ok"]}
    assert failures[1] == "email_taken" and failures[3] and failures[4] == "weak_password"
    assert login(client, "priya@example.com", password=priya["temporary_password"], device=None)["must_change_password"] is True
    assert login(client, "OWN77", password="Str0ng-Passw0rd!", device=None)["employee"]["full_name"] == "Own Code"
    assert client.post("/api/v1/employees/bulk", headers=as_admin, json={"employees": []}).status_code == 422
    too_many = {"employees": [{"full_name": f"Person {i}", "email": f"p{i}@example.com"} for i in range(101)]}
    assert client.post("/api/v1/employees/bulk", headers=as_admin, json=too_many).status_code == 422
    assert client.post("/api/v1/employees/bulk", headers=auth_headers(client, staff["a1"]), json=payload).status_code == 403
