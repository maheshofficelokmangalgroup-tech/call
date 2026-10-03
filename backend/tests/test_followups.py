"""The follow-up dashboard: who the employees spoke to and what came of it, the follow-ups that are due, and one conversation in full.

One scenario, worked out by hand: eight conversations (an employee and a phone number) and four scheduled callbacks. "Now" is fixed
at noon (business time) so that "overdue", "later today" and "after today" do not depend on the hour the test runs.
"""

from __future__ import annotations

from datetime import UTC, timedelta

import pytest

from app.core.timeutils import business_date
from app.models.call import CALLBACK_DONE, CALLBACK_PENDING, Callback, CallNote
from app.services import followup_service
from tests.conftest import auth_headers
from tests.test_analytics import add_call, add_recording, get, local


@pytest.fixture()
def now(monkeypatch):
    fixed = local(business_date(), 12, 0).astimezone(UTC)
    monkeypatch.setattr(followup_service, "utcnow", lambda: fixed)
    return fixed


def talk_to(db, emp, contact, days_ago: int, hour: int, minute: int, *, talk: int = 0, outcome: str | None = None, phone: str | None = None, name: str | None = None):
    """A call of `emp` to `contact` (or to a number dialled by hand) at that local time, with the outcome the employee chose."""
    day = business_date() - timedelta(days=days_ago)
    call = add_call(db, emp, local(day, hour, minute), talk=talk, outcome=outcome, contact=name or (contact.name if contact else None), phone=phone or contact.normalized_phone)
    if contact is not None:
        call.contact_id = contact.id
        db.commit()
    return call


def note(db, call, author, body: str, *, hours_after: int = 0):
    row = CallNote(call_id=call.id, contact_id=call.contact_id, author_id=author.id, body=body, created_at=call.started_at + timedelta(minutes=5, hours=hours_after))
    db.add(row)
    db.commit()
    return row


def follow_up(db, emp, contact, call, when, text: str, *, status: str = CALLBACK_PENDING, completed=None):
    row = Callback(employee_id=emp.id, contact_id=contact.id, call_id=call.id, scheduled_at=when, status=status, note=text, completed_at=completed)
    db.add(row)
    db.commit()
    return row


@pytest.fixture()
def world(db, make, now):
    team_a, team_b = make.team("Team A"), make.team("Team B")
    a1 = make.employee(code="A1", name="Asha Patil", team=team_a, email="a1@example.com")
    a2 = make.employee(code="A2", name="Bhushan More", team=team_a, email="a2@example.com")
    b1 = make.employee(code="B1", name="Chetan Shah", team=team_b, email="b1@example.com")
    mgr = make.employee(role="manager", code="M1", name="Mina Manager", team=team_a, email="mgr@example.com")
    people = {n: make.contact(name=f"Customer {n}", phone=f"98765432{n:02d}") for n in range(1, 7)}
    today = business_date()
    tomorrow_10 = local(today + timedelta(days=1), 10).astimezone(UTC)
    later_today = local(today, 20).astimezone(UTC)

    # Asha: c1 three times over two days (no answer, then interested), c2 not interested, c3 asked to be called back (and is late)
    first = talk_to(db, a1, people[1], 2, 10, 0, outcome="NO_ANSWER")
    interested = talk_to(db, a1, people[1], 1, 11, 0, talk=120, outcome="INTERESTED")
    note(db, interested, a1, "Wants a demo on Friday")
    add_recording(db, interested)
    follow_up(db, a1, people[1], interested, tomorrow_10, "Send the brochure")
    refused = talk_to(db, a1, people[2], 0, 9, 10, talk=40, outcome="NOT_INTERESTED")
    note(db, refused, a1, "Already has a supplier")
    asked = talk_to(db, a1, people[3], 0, 10, 20, talk=60, outcome="CALLBACK")
    late = follow_up(db, a1, people[3], asked, now - timedelta(hours=1), "Call after lunch")

    # Bhushan: c4 follow-up later today, c5 never answers (the follow-up was done), c6 answered but no outcome chosen yet, and a number by hand
    promised = talk_to(db, a2, people[4], 1, 15, 0, talk=90, outcome="FOLLOW_UP")
    note(db, promised, a2, "Decision maker is travelling")
    due_today = follow_up(db, a2, people[4], promised, later_today, "Ask about the quote")
    talk_to(db, a2, people[5], 1, 9, 0, outcome="NO_ANSWER")
    silent = talk_to(db, a2, people[5], 0, 9, 30, outcome="NO_ANSWER")
    follow_up(db, a2, people[5], silent, now - timedelta(days=2), "Try again", status=CALLBACK_DONE, completed=now - timedelta(hours=2))
    unfinished = talk_to(db, a2, people[6], 0, 10, 40, talk=30)  # answered, no outcome
    by_hand = talk_to(db, a2, None, 0, 8, 5, talk=20, outcome="CONNECTED", phone="+919811111111", name=None)
    note(db, by_hand, a2, "Wrong number but chatty")

    # Chetan (another team) called Customer 1 as well: a different conversation
    talk_to(db, b1, people[1], 0, 9, 50, outcome="BUSY")
    return {
        "team_a": team_a, "team_b": team_b, "a1": a1, "a2": a2, "b1": b1, "mgr": mgr, "c": people,
        "calls": {"first": first, "interested": interested, "asked": asked, "unfinished": unfinished, "by_hand": by_hand},
        "late": late, "due_today": due_today, "tomorrow_10": tomorrow_10,
    }


def window(**more):
    today = business_date()
    return {"date_from": (today - timedelta(days=6)).isoformat(), "date_to": today.isoformat(), **more}


# ------------------------------------------------------------------------------------------------- the dashboard
def test_the_summary_counts_people_by_their_latest_response_and_the_follow_ups_that_are_due(client, as_admin, world):
    data = get(client, "/analytics/followups", as_admin, **window()).json()
    assert data["scope"] == "organization"
    assert (data["calls"], data["people"], data["spoken"]) == (10, 8, 6)
    assert data["responses"] == {"INTERESTED": 1, "NOT_INTERESTED": 1, "CALLBACK": 1, "FOLLOW_UP": 1, "NO_ANSWER": 1, "NONE": 1, "BUSY": 1, "CONNECTED": 1}
    assert data["followups"] == {"pending": 3, "overdue": 1, "today": 1, "upcoming": 1, "closed": 1, "created": 4}


def test_the_latest_response_is_the_outcome_of_the_latest_call_that_has_one(client, as_admin, world, db):
    """Asha called Customer 1 and got "no answer", then "interested": the response is interested. A later call whose outcome has not been
    chosen yet does not hide it."""
    talk_to(db, world["a1"], world["c"][1], 0, 11, 30, talk=15)  # a newer call, no outcome yet
    rows = get(client, "/analytics/conversations", as_admin, employee_id=world["a1"].id, **window(q="Customer 1")).json()["items"]
    assert len(rows) == 1
    row = rows[0]
    assert row["response"]["code"] == "INTERESTED" and row["calls"] == 3
    assert row["last_call_has_outcome"] is False  # the employee has not chosen an outcome for the newest call yet
    assert [chip["code"] for chip in row["history"]] == [None, "INTERESTED", "NO_ANSWER"]  # newest first


def test_every_employee_has_a_row_with_their_figures_and_the_ones_with_late_follow_ups_come_first(client, as_admin, world):
    data = get(client, "/analytics/followups", as_admin, **window()).json()
    rows = {r["employee_code"]: r for r in data["employees"]}
    assert [r["employee_code"] for r in data["employees"]] == ["A1", "A2", "B1"]  # (late follow-ups, then pending ones, then the rest)
    assert (rows["A1"]["calls"], rows["A1"]["people"], rows["A1"]["spoken"], rows["A1"]["pending"], rows["A1"]["overdue"]) == (4, 3, 3, 2, 1)
    assert rows["A1"]["responses"] == {"INTERESTED": 1, "NOT_INTERESTED": 1, "CALLBACK": 1}
    assert (rows["A2"]["calls"], rows["A2"]["people"], rows["A2"]["spoken"], rows["A2"]["pending"], rows["A2"]["overdue"]) == (5, 4, 3, 1, 0)
    assert (rows["B1"]["calls"], rows["B1"]["people"], rows["B1"]["spoken"], rows["B1"]["pending"]) == (1, 1, 0, 0)
    assert rows["A1"]["next_followup_at"].startswith(world["late"].scheduled_at.strftime("%Y-%m-%dT%H:%M")) and rows["A1"]["next_followup_at"].endswith("Z")
    assert rows["A2"]["team_name"] == "Team A" and rows["B1"]["team_name"] == "Team B"


def test_the_summary_can_be_narrowed_to_a_team_or_an_employee(client, as_admin, world):
    team = get(client, "/analytics/followups", as_admin, **window(team_id=world["team_b"].id)).json()
    assert team["scope"] == "team" and (team["people"], team["calls"]) == (1, 1) and [r["employee_code"] for r in team["employees"]] == ["B1"]
    one = get(client, "/analytics/followups", as_admin, **window(employee_id=world["a2"].id)).json()
    assert one["scope"] == "employee" and one["people"] == 4 and one["followups"]["pending"] == 1
    assert [r["employee_code"] for r in one["employees"]] == ["A1", "A2", "B1"]  # the table still shows everybody


def test_a_manager_only_sees_their_own_team(client, db, make, world):
    manager = auth_headers(client, world["mgr"])
    data = get(client, "/analytics/followups", manager, **window()).json()
    assert [r["employee_code"] for r in data["employees"]] == ["A1", "A2"]
    assert data["people"] == 7 and data["followups"]["pending"] == 3
    other = get(client, "/analytics/followups", manager, **window(employee_id=world["b1"].id)).json()
    assert (other["people"], other["employees"]) == (0, []) and other["followups"]["pending"] == 0
    assert get(client, "/analytics/followups", manager, **window(team_id=world["team_b"].id)).json()["employees"] == []
    assert get(client, "/analytics/conversations", manager, **window(employee_id=world["b1"].id)).json()["total"] == 0
    assert get(client, "/analytics/followups/list", manager, employee_id=world["b1"].id).json()["total"] == 0
    assert get(client, "/analytics/conversations/timeline", manager, employee_id=world["b1"].id, phone=world["c"][1].normalized_phone).status_code == 404


def test_employees_cannot_open_any_of_it(client, as_a, world):
    for path, params in (
        ("/analytics/followups", {}),
        ("/analytics/followups/list", {}),
        ("/analytics/conversations", {}),
        ("/analytics/conversations/timeline", {"employee_id": world["a1"].id, "phone": world["c"][1].normalized_phone}),
    ):
        assert get(client, path, as_a, **params).status_code == 403, path


# ------------------------------------------------------------------------------------------------- who they spoke to
def test_the_conversations_come_newest_first_with_everything_an_administrator_wants_to_see(client, as_admin, world):
    page = get(client, "/analytics/conversations", as_admin, **window()).json()
    assert page["total"] == 8
    assert [(r["employee_name"], r["contact_name"]) for r in page["items"]] == [
        ("Bhushan More", "Customer 6"), ("Asha Patil", "Customer 3"), ("Chetan Shah", "Customer 1"), ("Bhushan More", "Customer 5"),
        ("Asha Patil", "Customer 2"), ("Bhushan More", None), ("Bhushan More", "Customer 4"), ("Asha Patil", "Customer 1"),
    ]
    row = {(r["employee_code"], r["contact_name"]): r for r in page["items"]}[("A1", "Customer 1")]
    assert (row["calls"], row["answered"], row["talk_seconds"]) == (2, 1, 120)
    assert row["response"] == {"code": "INTERESTED", "label": "Interested", "category": "connected"}
    assert row["response_at"].endswith("Z") and row["last_call_at"].endswith("Z") and row["first_call_at"].endswith("Z")
    assert [c["code"] for c in row["history"]] == ["INTERESTED", "NO_ANSWER"]
    assert row["last_note"]["body"] == "Wants a demo on Friday" and row["last_note"]["author_name"] == "Asha Patil" and row["notes"] == 1
    assert row["followup"]["note"] == "Send the brochure" and row["followup"]["overdue"] is False and row["followups_pending"] == 1
    assert row["has_recording"] is True and row["last_call_has_outcome"] is True
    assert row["contact_status"] == "new" and row["phone"] == "+919876543201" and row["last_call_status"] == "completed"
    # somebody else's conversation with the same person is its own row
    other = {(r["employee_code"], r["contact_name"]): r for r in page["items"]}[("B1", "Customer 1")]
    assert (other["calls"], other["response"]["code"], other["notes"], other["followup"]) == (1, "BUSY", 0, None)


def test_a_call_whose_outcome_was_not_chosen_has_no_response_and_a_number_dialled_by_hand_still_shows_its_notes(client, as_admin, world):
    rows = {r["phone"]: r for r in get(client, "/analytics/conversations", as_admin, **window(employee_id=world["a2"].id)).json()["items"]}
    unfinished = rows[world["c"][6].normalized_phone]
    assert unfinished["response"] is None and unfinished["response_at"] is None and unfinished["last_call_has_outcome"] is False and unfinished["answered"] == 1
    by_hand = rows["+919811111111"]
    assert by_hand["contact_id"] is None and by_hand["contact_name"] is None and by_hand["response"]["code"] == "CONNECTED"
    assert by_hand["last_note"]["body"] == "Wrong number but chatty" and by_hand["followup"] is None


def test_the_conversations_can_be_filtered_by_response_person_employee_and_follow_up(client, as_admin, world):
    def found(**params):
        return sorted(r["contact_name"] or r["phone"] for r in get(client, "/analytics/conversations", as_admin, **window(**params)).json()["items"])

    assert found(response="INTERESTED") == ["Customer 1"]
    assert found(response="CALLBACK,FOLLOW_UP") == ["Customer 3", "Customer 4"]
    assert found(response="NONE") == ["Customer 6"]
    assert found(response="NO_ANSWER,BUSY") == ["Customer 1", "Customer 5"]
    assert found(q="customer 2") == ["Customer 2"]
    assert found(q="9876543205") == ["Customer 5"]
    assert found(q="%") == []  # a wildcard is just a character
    assert found(employee_id=world["a1"].id) == ["Customer 1", "Customer 2", "Customer 3"]
    assert found(followup="pending") == ["Customer 1", "Customer 3", "Customer 4"]
    assert found(followup="overdue") == ["Customer 3"]
    assert found(employee_id=world["a2"].id, followup="overdue") == []


def test_the_conversations_are_paged_and_the_period_decides_which_calls_count(client, as_admin, world):
    first = get(client, "/analytics/conversations", as_admin, page_size=3, **window()).json()
    last = get(client, "/analytics/conversations", as_admin, page_size=3, page=3, **window()).json()
    assert (first["total"], len(first["items"]), len(last["items"])) == (8, 3, 2)
    today = business_date().isoformat()
    only_today = get(client, "/analytics/conversations", as_admin, date_from=today, date_to=today).json()
    assert only_today["total"] == 6  # Customer 1 (Asha) and Customer 4 were only called before today
    asha = get(client, "/analytics/conversations", as_admin, date_from=today, date_to=today, employee_id=world["a1"].id).json()["items"]
    assert [r["contact_name"] for r in asha] == ["Customer 3", "Customer 2"] and all(len(r["history"]) == 1 for r in asha)


def test_bad_questions_are_refused_not_answered_with_an_error(client, as_admin, world):
    assert get(client, "/analytics/conversations", as_admin, response="interested").status_code == 422
    assert get(client, "/analytics/conversations", as_admin, followup="never").status_code == 422
    assert get(client, "/analytics/followups/list", as_admin, state="bogus").status_code == 422
    assert get(client, "/analytics/followups", as_admin, date_from="2026-02-01", date_to="2026-01-01").status_code == 422
    assert get(client, "/analytics/conversations/timeline", as_admin, employee_id=world["a1"].id).status_code == 422  # a number is needed
    assert get(client, "/analytics/conversations/timeline", as_admin, employee_id=world["a1"].id, phone="+910000000000").status_code == 404


# ------------------------------------------------------------------------------------------------- who has to be called back
def test_the_follow_ups_to_do_come_longest_waiting_first_with_what_was_said_before(client, as_admin, world):
    page = get(client, "/analytics/followups/list", as_admin).json()
    assert page["total"] == 3
    late, today, tomorrow = page["items"]
    assert (late["contact_name"], today["contact_name"], tomorrow["contact_name"]) == ("Customer 3", "Customer 4", "Customer 1")
    assert (late["overdue"], today["overdue"], tomorrow["overdue"]) == (True, False, False)
    assert (late["employee_name"], late["employee_code"], late["team_name"], late["phone"]) == ("Asha Patil", "A1", "Team A", "+919876543203")
    assert (late["note"], late["response"]["code"], late["calls"], late["last_note"]) == ("Call after lunch", "CALLBACK", 1, None)
    assert late["call_id"] == world["calls"]["asked"].id and late["last_call_id"] == world["calls"]["asked"].id
    assert today["response"]["code"] == "FOLLOW_UP" and today["last_note"]["body"] == "Decision maker is travelling"
    assert tomorrow["calls"] == 2 and tomorrow["response"]["code"] == "INTERESTED" and tomorrow["last_note"]["body"] == "Wants a demo on Friday"


def test_the_follow_ups_can_be_asked_for_by_state_person_and_employee(client, as_admin, world):
    def found(**params):
        return [i["contact_name"] for i in get(client, "/analytics/followups/list", as_admin, **params).json()["items"]]

    assert found(state="overdue") == ["Customer 3"]
    assert found(state="today") == ["Customer 4"]
    assert found(state="upcoming") == ["Customer 1"]
    assert found(state="pending") == ["Customer 3", "Customer 4", "Customer 1"]
    assert found(state="closed", **window()) == ["Customer 5"]  # done this week
    assert found(state="closed", date_from="2020-01-01", date_to="2020-01-02") == []
    assert found(employee_id=world["a2"].id) == ["Customer 4"]
    assert found(q="bhushan") == ["Customer 4"] and found(q="customer 3") == ["Customer 3"] and found(q="%") == []
    paged = get(client, "/analytics/followups/list", as_admin, page_size=2, page=2).json()
    assert (paged["total"], [i["contact_name"] for i in paged["items"]]) == (3, ["Customer 1"])


def test_follow_ups_of_deleted_people_are_not_listed_or_counted(client, as_admin, world, db):
    from app.core.timeutils import utcnow

    world["c"][4].deleted_at = utcnow()
    db.commit()
    assert get(client, "/analytics/followups/list", as_admin).json()["total"] == 2
    assert get(client, "/analytics/followups", as_admin, **window()).json()["followups"]["pending"] == 2


# ------------------------------------------------------------------------------------------------- one conversation
def test_a_conversation_shows_every_call_with_its_outcome_notes_follow_up_and_recording(client, as_admin, admin, world, db):
    db.add(CallNote(call_id=None, contact_id=world["c"][1].id, author_id=admin.id, body="Customer 1 is the owner of the shop", created_at=world["calls"]["first"].started_at))
    db.commit()
    data = get(client, "/analytics/conversations/timeline", as_admin, employee_id=world["a1"].id, phone=world["c"][1].normalized_phone).json()
    assert (data["employee_name"], data["employee_code"], data["total_calls"]) == ("Asha Patil", "A1", 2)
    assert data["contact"]["name"] == "Customer 1" and data["contact"]["status"] == "new"
    newest, oldest = data["calls"]
    assert newest["response"]["code"] == "INTERESTED" and newest["duration_seconds"] == 120 and newest["status"] == "completed"
    assert [n["body"] for n in newest["notes"]] == ["Wants a demo on Friday"] and newest["notes"][0]["author_name"] == "Asha Patil"
    assert newest["callback_at"].startswith(world["tomorrow_10"].strftime("%Y-%m-%dT%H:%M")) and newest["recording_id"] and newest["recording_seconds"] == 120
    assert (oldest["response"]["code"], oldest["notes"], oldest["callback_at"], oldest["recording_id"]) == ("NO_ANSWER", [], None, None)
    assert [(f["note"], f["status"], f["overdue"]) for f in data["followups"]] == [("Send the brochure", "pending", False)]
    assert [n["body"] for n in data["other_notes"]] == ["Customer 1 is the owner of the shop"]  # (written by somebody else, tied to no call of Asha)


def test_a_number_dialled_by_hand_has_a_timeline_too(client, as_admin, world):
    data = get(client, "/analytics/conversations/timeline", as_admin, employee_id=world["a2"].id, phone="+919811111111").json()
    assert data["contact"] is None and data["total_calls"] == 1 and data["followups"] == []
    assert [n["body"] for n in data["calls"][0]["notes"]] == ["Wrong number but chatty"]


# ------------------------------------------------------------------------------------------------- the same on a big day
def test_a_busy_employee_does_not_slow_a_page_down_to_one_query_per_row(client, as_admin, db, make, now):
    """A page of conversations costs a fixed handful of queries, however many people the employee called."""
    from sqlalchemy import event

    emp = make.employee(code="BUSY", name="Busy Person", email="busy@example.com")
    for n in range(60):
        contact = make.contact(name=f"Lead {n}", phone=f"97000{n:05d}")
        talk_to(db, emp, contact, 0, 9, n % 50, talk=30 + n, outcome="INTERESTED" if n % 2 else "NOT_INTERESTED")
    statements: list[str] = []
    engine = db.get_bind()

    def count(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", count)
    try:
        page = get(client, "/analytics/conversations", as_admin, page_size=50, employee_id=emp.id, **window()).json()
    finally:
        event.remove(engine, "before_cursor_execute", count)
    assert page["total"] == 60 and len(page["items"]) == 50
    assert len(statements) < 25, f"{len(statements)} statements for one page"
