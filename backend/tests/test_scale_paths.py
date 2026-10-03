"""The paths that matter once there are a million contacts: a list that does not read them all, a total that is not counted again for
every page, a dashboard that does not make anybody wait, an assignment that cannot be asked to do the impossible."""

from __future__ import annotations

import time

import pytest
from sqlalchemy import event

from app.core import cache
from app.core.config import reset_settings_cache
from app.core.database import get_engine
from app.models.contact import Contact
from app.services import contact_service, dashboard_service
from tests.test_import_distribution import team_of
from tests.test_rebalance import give


def list_contacts(client, headers, **params):
    resp = client.get("/api/v1/contacts", headers=headers, params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


class Statements:
    """The SQL a block of code runs."""

    def __init__(self) -> None:
        self.sql: list[str] = []

    def __enter__(self):
        event.listen(get_engine(), "before_cursor_execute", self._seen)
        return self

    def __exit__(self, *exc):
        event.remove(get_engine(), "before_cursor_execute", self._seen)

    def _seen(self, conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
        self.sql.append(statement.lower())

    def counts(self) -> int:
        return sum(1 for s in self.sql if "count(" in s)


# ------------------------------------------------------------------------------------------------------ the list
def test_a_number_written_in_full_is_found_by_the_phone_index(client, make, as_admin):
    for i in range(30):
        make.contact(phone=f"{9800000000 + i * 7 + 1}", name=f"Person {i}")
    target = make.contact(phone="9811111111", name="The One")
    for written in ("9811111111", "+91 98111 11111", "+919811111111", "098111 11111"):
        found = list_contacts(client, as_admin, q=written)
        assert [c["id"] for c in found["items"]] == [target.id] and found["total"] == 1, written
    with Statements() as seen:
        list_contacts(client, as_admin, q="9811111111")
    assert not any("search_text like" in s for s in seen.sql)  # the words were never matched inside every contact

    # a number nobody has is still answered (by the slower search): nothing, and no error
    assert list_contacts(client, as_admin, q="9899999999")["total"] == 0
    # part of a number, and words, still search the text of the contacts
    assert list_contacts(client, as_admin, q="811111")["total"] == 1
    assert list_contacts(client, as_admin, q="the one")["total"] == 1


def test_the_exact_number_still_respects_the_other_filters(client, make, as_admin):
    make.contact(phone="9822222222", name="Wanted", status="interested")
    assert list_contacts(client, as_admin, q="9822222222")["total"] == 1
    assert list_contacts(client, as_admin, q="9822222222", status="new")["total"] == 0


def test_names_are_listed_a_to_z_whatever_the_case(client, make, as_admin):
    for name in ("bob", "Alice", "carl", "Álvaro", "DAVE"):
        make.contact(name=name)
    names = [c["name"] for c in list_contacts(client, as_admin, sort="name")["items"]]
    assert [n.lower() for n in names if n != "Álvaro"] == ["alice", "bob", "carl", "dave"]


def test_recently_added_comes_first(client, make, as_admin):
    first = make.contact(name="Old")
    second = make.contact(name="New")
    ids = [c["id"] for c in list_contacts(client, as_admin, sort="recent")["items"]]
    assert ids[:2] == [second.id, first.id]


def test_the_total_of_a_long_list_is_counted_once_and_forgotten_when_anything_changes(client, make, as_admin, monkeypatch):
    monkeypatch.setattr(contact_service, "_BIG_COUNT", 5)
    for i in range(8):
        make.contact(phone=f"{9833000000 + i * 3 + 1}")
    with Statements() as first:
        assert list_contacts(client, as_admin)["total"] == 8
    with Statements() as second:
        assert list_contacts(client, as_admin, page=2)["total"] == 8  # another page of the same list
    assert first.counts() == 1 and second.counts() == 0
    make.contact(phone="9833999999")  # any change to the contacts clears it
    assert list_contacts(client, as_admin)["total"] == 9
    # a different list is a different question
    with Statements() as other:
        list_contacts(client, as_admin, status="new")
    assert other.counts() == 1


def test_a_small_list_is_always_counted_fresh(client, make, as_admin):
    make.contact(phone="9844000001")
    assert list_contacts(client, as_admin)["total"] == 1
    make.contact(phone="9844000002")
    assert list_contacts(client, as_admin)["total"] == 2


def test_an_employee_never_gets_the_total_of_somebody_elses_list(client, make, as_admin, emp_a, emp_b, as_a, monkeypatch):
    monkeypatch.setattr(contact_service, "_BIG_COUNT", 1)
    for i in range(3):
        make.contact(phone=f"{9855000000 + i * 3 + 1}", assign_to=emp_a)
    make.contact(phone="9855999999", assign_to=emp_b)
    assert list_contacts(client, as_admin)["total"] == 4
    assert list_contacts(client, as_a)["total"] == 3  # (a total counted for the administrator is not served to somebody else)


# -------------------------------------------------------------------------------------------- stale while revalidate
def test_stale_while_revalidate_waits_for_nobody_after_the_first_time(monkeypatch):
    calls = {"n": 0}

    def work():
        calls["n"] += 1
        return [calls["n"]]

    assert cache.stale_while_revalidate("swr-test", 60, 600, work) == [1]  # nothing known yet: worked out now
    assert cache.stale_while_revalidate("swr-test", 60, 600, work) == [1] and calls["n"] == 1  # fresh: nothing is done

    real_time = time.time
    monkeypatch.setattr(cache.time, "time", lambda: real_time() + 120)  # two minutes later: the answer is stale
    assert cache.stale_while_revalidate("swr-test", 60, 600, work) == [1]  # still the old one, at once
    for _ in range(100):  # ...and a new one is being worked out in the background
        if calls["n"] == 2:
            break
        time.sleep(0.02)
    assert calls["n"] == 2
    time.sleep(0.1)
    assert cache.stale_while_revalidate("swr-test", 60, 600, work) == [2]


def test_stale_while_revalidate_only_one_caller_refreshes(monkeypatch):
    calls = {"n": 0}

    def work():
        calls["n"] += 1
        time.sleep(0.2)
        return [calls["n"]]

    cache.stale_while_revalidate("swr-one", 1, 600, work)
    real_time = time.time
    monkeypatch.setattr(cache.time, "time", lambda: real_time() + 30)
    for _ in range(10):
        cache.stale_while_revalidate("swr-one", 1, 600, work)
    time.sleep(0.6)
    assert calls["n"] == 2  # the first, and one refresh - not one per caller


def test_a_failing_refresh_keeps_the_old_answer(monkeypatch):
    cache.stale_while_revalidate("swr-fail", 1, 600, lambda: [7])
    real_time = time.time
    monkeypatch.setattr(cache.time, "time", lambda: real_time() + 30)

    def broken():
        raise RuntimeError("database down")

    assert cache.stale_while_revalidate("swr-fail", 1, 600, broken) == [7]
    time.sleep(0.2)
    assert cache.stale_while_revalidate("swr-fail", 1, 600, broken) == [7]


# ------------------------------------------------------------------------------------------------------- dashboard
def test_the_dashboard_of_a_big_organisation_does_not_make_anybody_wait_for_the_slow_figures(client, make, as_admin, db, monkeypatch):
    monkeypatch.setattr(dashboard_service, "LARGE_ORGANISATION", 3)
    monkeypatch.setenv("DASHBOARD_CACHE_SECONDS", "0")  # (so that every look really asks the service)
    reset_settings_cache()
    try:
        a, b = team_of(make, 2)
        give(db, a, 4)
        first = client.get("/api/v1/dashboard", headers=as_admin).json()
        assert first["assigned_contacts"] == 4 and first["pending_contacts"] == 4  # nothing was known yet: worked out now, once

        give(db, b, 3, start=50)
        with Statements() as seen:
            second = client.get("/api/v1/dashboard", headers=as_admin).json()
        # the number of assigned contacts is one pass over an index (the new 3 are in it); what is left to call is the remembered answer
        assert second["assigned_contacts"] == 7 and second["pending_contacts"] == 4
        assert not any("contacts" in s and "join" in s for s in seen.sql)
    finally:
        monkeypatch.undo()
        reset_settings_cache()


def test_a_small_organisation_gets_exact_figures_every_time(client, make, as_admin, db, monkeypatch):
    monkeypatch.setenv("DASHBOARD_CACHE_SECONDS", "0")  # (the whole dashboard is otherwise remembered for a few seconds)
    reset_settings_cache()
    try:
        a, b = team_of(make, 2)
        give(db, a, 4)
        assert client.get("/api/v1/dashboard", headers=as_admin).json()["pending_contacts"] == 4
        give(db, b, 3, start=50)
        assert client.get("/api/v1/dashboard", headers=as_admin).json()["pending_contacts"] == 7
    finally:
        monkeypatch.undo()
        reset_settings_cache()


# ------------------------------------------------------------------------------------------------------- assignment
def test_an_assignment_by_filter_cannot_be_asked_for_more_contacts_than_the_limit(client, make, as_admin, emp_a, monkeypatch):
    monkeypatch.setenv("ASSIGN_MAX_CONTACTS", "3")
    reset_settings_cache()
    try:
        for i in range(5):
            make.contact(phone=f"{9866000000 + i * 3 + 1}")
        refused = client.post("/api/v1/contacts/assign", headers=as_admin, json={"unassigned_only": True, "employee_ids": [emp_a.id]})
        assert refused.status_code == 422 and refused.json()["error"]["code"] == "too_many_contacts"
        assert "Import sheet" in refused.json()["error"]["message"]
        ok = client.post("/api/v1/contacts/assign", headers=as_admin, json={"contact_ids": [c.id for c in make.db.query(Contact).limit(3)], "employee_ids": [emp_a.id]})
        assert ok.status_code == 200
    finally:
        monkeypatch.undo()
        reset_settings_cache()


# ------------------------------------------------------------------------------------------------------- the schema
def test_the_indexes_the_big_lists_need_exist(db):
    from sqlalchemy import inspect

    indexes = {i["name"]: i["column_names"] for i in inspect(get_engine()).get_indexes("contacts")}
    assert indexes["ix_contacts_status"] == ["status", "deleted_at"]
    assert indexes["ix_contacts_created"] == ["created_at"] and indexes["ix_contacts_name"] == ["name"]
    assert "ix_contact_assignments_employee_status" in {i["name"] for i in inspect(get_engine()).get_indexes("contact_assignments")}


@pytest.mark.parametrize("sort", ["name", "recent", "priority", "last_called"])
def test_every_way_of_ordering_still_works(client, make, as_admin, sort):
    make.contact(name="A")
    make.contact(name="B")
    assert list_contacts(client, as_admin, sort=sort)["total"] == 2
