"""What the API fuzzer (Schemathesis) found: nonsense input must always be answered with a 4xx, never with a server error and never
by cutting the connection. Each case below once produced a 500 (or a broken download)."""

from __future__ import annotations

import json

import pytest

HUGE = "2229827048046508638208"  # more digits than any database id
JSON = {"Content-Type": "application/json"}


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", f"/api/v1/contacts/{HUGE}"),
        ("DELETE", f"/api/v1/contacts/{HUGE}"),
        ("GET", f"/api/v1/calls/{HUGE}"),
        ("POST", f"/api/v1/contacts/import/{HUGE}/cancel"),
        ("GET", f"/api/v1/employees/{HUGE}"),
        ("POST", f"/api/v1/calls/{HUGE}/disposition"),
        ("GET", f"/api/v1/recordings/{HUGE}"),
    ],
)
def test_an_id_with_too_many_digits_is_simply_not_found(client, as_admin, method, path):
    answer = client.request(method, path, headers=as_admin, json={} if method == "POST" else None)
    assert answer.status_code == 404 and answer.json()["error"]["code"] == "not_found"


def test_numbers_beyond_the_databases_range_are_refused_not_crashed(client, as_admin):
    for url in (
        "/api/v1/analytics/overview?employee_id=-202360946606808949318309283627008",
        "/api/v1/analytics/employees.csv?state=active&team_id=3779859729844284375067999093129216",
        "/api/v1/calls?campaign_id=-42&date_to=2010-02-26T00%3A26%3A08.0Z&from_day=0001-01-01&q=&page_size=1&status=draft",
        "/api/v1/calls?employee_id=99999999999999999999999",
        "/api/v1/contacts?campaign_id=99999999999999999999999",
    ):
        answer = client.get(url, headers=as_admin)
        assert answer.status_code < 500, (url, answer.status_code, answer.text[:200])


def test_a_csv_download_with_a_filter_the_database_cannot_take_fails_cleanly(client, as_admin):
    """It used to send "200 OK" and the header row, and then cut the connection when the first query failed."""
    answer = client.get(
        "/api/v1/calls/export.csv?campaign_id=-13386524695875346432&from_day=1479-03-25&to_day=1560-06-08&min_duration=401&status=new",
        headers=as_admin,
    )
    assert answer.status_code in (200, 422)
    if answer.status_code == 200:  # an empty list is a fine answer too - but then it must be a complete, valid file
        assert answer.text.lstrip("﻿").startswith("Call ID,")


def test_text_the_database_cannot_store_is_a_422(client, make, emp_a, as_admin):
    contact = make.contact()
    lone_surrogate = '{"location": "l\\ud845|", "tags": null, "custom_fields": {"\\ud883\\udf7c\\ud845": "e"}}'  # half of an emoji
    answer = client.patch(f"/api/v1/contacts/{contact.id}", headers={**as_admin, **JSON}, content=lone_surrogate)
    assert 400 <= answer.status_code < 500, answer.text[:200]
    assert answer.json()["error"]["code"] in ("invalid_text", "validation_error", "out_of_range")


def test_unknown_outcome_text_is_refused_not_crashed(client, make, emp_a, as_a):
    contact = make.contact(assign_to=emp_a)
    from tests.test_calls_queue import start_call

    call = start_call(client, as_a, contact, cid="robust-call-001").json()
    odd = json.dumps({"disposition_code": "񀂷\u0006k", "note_client_ref": "\u0096"}, ensure_ascii=True)
    answer = client.post(f"/api/v1/calls/{call['id']}/disposition", headers={**as_a, **JSON}, content=odd)
    assert 400 <= answer.status_code < 500, answer.text[:200]


def test_a_duplicate_name_that_only_the_database_considers_a_duplicate_is_a_conflict(client, as_admin):
    first = client.post("/api/v1/teams", headers=as_admin, json={"name": "Sales East"})
    assert first.status_code == 201
    for twin in ("sales east", "SALES EAST", "Sales East"):
        answer = client.post("/api/v1/teams", headers=as_admin, json={"name": twin})
        assert answer.status_code == 409, (twin, answer.status_code)


def test_references_to_things_that_do_not_exist_are_refused(client, make, as_admin):
    campaign = make.campaign()
    answer = client.post(f"/api/v1/campaigns/{campaign.id}/assignees", headers=as_admin, json={"employee_ids": [-116, 19043059, 6986406589113056378014924800]})
    assert answer.status_code < 500, answer.text[:200]
    answer = client.post("/api/v1/contacts/unassign", headers=as_admin, json={"contact_ids": [144887634, -9999999999999999999, 2121210783]})
    assert answer.status_code < 500, answer.text[:200]
    answer = client.post(f"/api/v1/contacts/{HUGE}/notes", headers=as_admin, json={"body": "x"})
    assert answer.status_code == 404


def test_a_recording_for_a_call_that_does_not_exist_is_a_404(client, as_a):
    answer = client.post(f"/api/v1/calls/{HUGE}/recording", headers=as_a, json={"content_type": "audio/mp4", "size_bytes": 75376368715})
    assert answer.status_code == 404


def test_every_error_answer_has_the_usual_shape(client, as_admin):
    answer = client.get(f"/api/v1/contacts/{HUGE}", headers=as_admin)
    body = answer.json()["error"]
    assert set(body) >= {"code", "message"} and answer.headers["cache-control"] == "no-store"
