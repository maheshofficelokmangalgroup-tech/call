"""A contact is a person with many numbers: a voter list (one row per number, the same voter on several rows) becomes one contact per
person with all the numbers, every column of the sheet is kept, a number can never be in two contacts, and the calls know which number
was dialled.

The sheet below is worked out by hand (the header names are those of the voter list):

  row  2-5   Aakash: three different numbers, the 4th row repeats the 1st number            -> 1 person, 3 numbers, 1 repeated row
  row  6-7   Suhas: two numbers                                                              -> 1 person, 2 numbers
  row  8     "Someone Else" with Aakash's 2nd number                                         -> that number is already taken: a repeat; nobody is made
  row  9-10  the same name and address, but another relative                                 -> two people
  row 11-13  "Twin One": two different voter cards = two people; the row without a card joins the first -> 2 people, 3 numbers
  row 14     a number that is not a number                                                   -> a problem
"""

from __future__ import annotations

import csv
import io

import pytest

from app.models.contact import Contact, ContactPhone
from app.services import contact_numbers
from app.core.timeutils import utcnow
from tests.conftest import auth_headers
from tests.test_import import confirm, get_import, upload
from tests.test_import_distribution import team_of

HEADER = ("Mobile Number", "Voter Name", "Relative Name", "Age", "Gender", "EPIC No", "Voter Pincode", "Voter Address")

VOTERS = [
    ["9111111111", "Aakash Pramod Dharavat", "Pramod Dharavat", "24", "M", "", "416112", "Maratha Nagar, Kolhapur Road, Peth Vadgaon"],
    ["9111111112", "Aakash Pramod Dharavat", "Pramod Dharavat", "24", "M", "", "416112", "maratha nagar,  Kolhapur Road,  Peth Vadgaon"],  # (spaces and case differ)
    ["9111111113", "AAKASH PRAMOD DHARAVAT", "Pramod Dharavat", "24", "M", "", "416112", "Maratha Nagar, Kolhapur Road, Peth Vadgaon"],
    ["9111111111", "Aakash Pramod Dharavat", "Pramod Dharavat", "24", "M", "", "416112", "Maratha Nagar, Kolhapur Road, Peth Vadgaon"],  # the 1st number again
    ["9222222221", "Suhas Jaykumar Aalmane", "Jaykumar", "33", "M", "", "416101", "Kavthesar rasta, Danoli, Shirol"],
    ["9222222222", "Suhas Jaykumar Aalmane", "Jaykumar", "33", "M", "", "416101", "Kavthesar rasta, Danoli, Shirol"],
    ["9111111112", "Someone Else", "Other", "40", "F", "", "416000", "Another address, Kolhapur"],  # Aakash's number
    ["9333333333", "Same Name", "Father A", "30", "M", "", "416200", "Ward 4, Hatkanangale"],
    ["9333333334", "Same Name", "Father B", "30", "M", "", "416200", "Ward 4, Hatkanangale"],  # another relative: another person
    ["9444444441", "Twin One", "Dad", "20", "M", "ABC1234567", "416300", "Same Place, Karveer"],
    ["9444444442", "Twin One", "Dad", "20", "M", "XYZ7654321", "416300", "Same Place, Karveer"],  # another voter card: another person
    ["9444444443", "Twin One", "Dad", "20", "M", "", "416300", "Same Place, Karveer"],  # no card: joins the first twin
    ["12345", "Bad Number", "Dad", "50", "M", "", "416300", "Somewhere"],
]


def csv_bytes(rows, header=HEADER) -> bytes:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(header)
    writer.writerows(rows)
    return out.getvalue().encode("utf-8")


def all_contacts(db):
    db.expire_all()
    return {c.name: c for c in db.query(Contact).order_by(Contact.id)}


def people_and_numbers(db):
    """[(name, relative, (numbers...))] of every contact, sorted (two people can have the same name and relative)."""
    db.expire_all()
    return sorted(
        (c.name, c.relative_name, tuple(p.normalized_phone for p in db.query(ContactPhone).filter_by(contact_id=c.id).order_by(ContactPhone.position)))
        for c in db.query(Contact)
    )


# ------------------------------------------------------------------------------------------------- the voter sheet
def test_a_voter_list_becomes_one_contact_per_person_with_all_their_numbers(client, make, as_admin, db):
    team_of(make, 3)
    imp = upload(client, as_admin, csv_bytes(VOTERS))
    checked = get_import(client, as_admin, imp["id"])
    assert (checked["total_rows"], checked["valid_rows"], checked["invalid_rows"], checked["file_duplicate_rows"], checked["existing_rows"]) == (13, 6, 1, 2, 0)
    result = checked["result"]
    assert (result["sheet_people"], result["sheet_numbers"], result["merged_rows"], result["numbers"]) == (6, 10, 4, 10)

    done = confirm(client, as_admin, imp["id"])
    assert (done["status"], done["inserted_rows"]) == ("completed", 6)
    assert people_and_numbers(db) == [
        ("Aakash Pramod Dharavat", "Pramod Dharavat", ("+919111111111", "+919111111112", "+919111111113")),
        ("Same Name", "Father A", ("+919333333333",)),
        ("Same Name", "Father B", ("+919333333334",)),
        ("Suhas Jaykumar Aalmane", "Jaykumar", ("+919222222221", "+919222222222")),
        ("Twin One", "Dad", ("+919444444441", "+919444444443")),  # (the first twin: the row without a voter card joined it)
        ("Twin One", "Dad", ("+919444444442",)),
    ]
    assert db.query(ContactPhone).count() == 10 and db.query(Contact).count() == 6
    # a number is in one contact only (the database says so)
    assert db.query(ContactPhone.normalized_phone).distinct().count() == 10


def test_every_column_of_the_sheet_is_kept_and_the_contact_shows_all_its_numbers(client, make, as_admin, db):
    team_of(make, 2)
    confirm(client, as_admin, upload(client, as_admin, csv_bytes(VOTERS))["id"])
    page = client.get("/api/v1/contacts", headers=as_admin, params={"q": "dharavat"}).json()
    assert page["total"] == 1
    person = page["items"][0]
    assert (person["name"], person["relative_name"], person["age"], person["gender"], person["pincode"], person["epic_no"]) == ("Aakash Pramod Dharavat", "Pramod Dharavat", 24, "M", "416112", None)
    assert person["address"] == "Maratha Nagar, Kolhapur Road, Peth Vadgaon"  # (the spaces of the first row, made equal)
    assert [p["phone"] for p in person["phones"]] == ["+919111111111", "+919111111112", "+919111111113"]
    assert [p["primary"] for p in person["phones"]] == [True, False, False] and person["phone"] == "+919111111111" and person["phone_count"] == 3
    assert person["call_phone"] == "+919111111111"
    detail = client.get(f"/api/v1/contacts/{person['id']}", headers=as_admin).json()
    assert len(detail["phones"]) == 3 and detail["address"].startswith("Maratha Nagar")
    twin = client.get("/api/v1/contacts", headers=as_admin, params={"q": "abc1234567"}).json()["items"]
    assert [t["epic_no"] for t in twin] == ["ABC1234567"] and twin[0]["phone_count"] == 2


def test_a_person_is_found_by_any_of_their_numbers_and_by_the_other_details(client, make, as_admin):
    team_of(make, 2)
    confirm(client, as_admin, upload(client, as_admin, csv_bytes(VOTERS))["id"])

    def found(q):
        return [c["name"] for c in client.get("/api/v1/contacts", headers=as_admin, params={"q": q}).json()["items"]]

    for number in ("9111111111", "9111111112", "+91 91111 11113", "09111111113"):
        assert found(number) == ["Aakash Pramod Dharavat"], number  # (a number written in full: through the unique index)
    assert found("9222222222") == ["Suhas Jaykumar Aalmane"]
    assert found("11111") == ["Aakash Pramod Dharavat"]  # part of a number
    assert found("kavthesar") == ["Suhas Jaykumar Aalmane"] and found("416300") == ["Twin One", "Twin One"] and found("xyz7654321") == ["Twin One"]
    assert found("jaykumar") == ["Suhas Jaykumar Aalmane"]  # the relative
    assert found("9999999999") == []


def test_the_people_are_shared_equally_and_an_employee_sees_every_number(client, make, as_admin, db):
    team = team_of(make, 3)
    done = confirm(client, as_admin, upload(client, as_admin, csv_bytes(VOTERS))["id"])
    assert sorted(done["result"]["per_employee"].values()) == [2, 2, 2]  # 6 people, 3 employees (not 10 numbers)
    mine = auth_headers(client, team[0])
    queue = client.get("/api/v1/queue", headers=mine).json()
    assert queue["total"] == 2
    for item in queue["items"]:
        contact = item["contact"]
        assert contact["phone_count"] == len(contact["phones"]) and contact["call_phone"] in [p["phone"] for p in contact["phones"]]
        assert contact["address"] and contact["relative_name"]


# ------------------------------------------------------------------------------------------------- not too eager
def test_a_plain_list_of_names_and_numbers_is_not_merged(client, make, as_admin, db):
    team_of(make, 2)
    rows = [["Rahul", "9555555551"], ["Rahul", "9555555552"], ["Rahul Patil", "9555555553"]]
    done = confirm(client, as_admin, upload(client, as_admin, csv_bytes(rows, header=("Name", "Mobile")))["id"])
    assert done["inserted_rows"] == 3 and db.query(Contact).count() == 3  # two customers called Rahul are two contacts


def test_the_same_name_with_nothing_else_in_common_is_two_people(client, make, as_admin, db):
    team_of(make, 2)
    rows = [
        ["9666666661", "Sunita More", "Ramesh", "40", "F", "", "416001", "House 1, Karad"],
        ["9666666662", "Sunita More", "Suresh", "40", "F", "", "416001", "House 1, Karad"],  # another husband
        ["9666666663", "Sunita More", "Ramesh", "41", "F", "", "416001", "House 1, Karad"],  # another age
        ["9666666664", "Sunita More", "Ramesh", "40", "F", "", "416002", "House 1, Karad"],  # another pincode
    ]
    done = confirm(client, as_admin, upload(client, as_admin, csv_bytes(rows))["id"])
    assert done["inserted_rows"] == 4


# ------------------------------------------------------------------------------------------------- people that are there already
def test_a_second_sheet_with_a_new_number_of_somebody_who_is_there_adds_the_number_and_changes_nothing_else_unless_asked(client, make, as_admin, db):
    team_of(make, 2)
    confirm(client, as_admin, upload(client, as_admin, csv_bytes(VOTERS[:1]))["id"])
    header = (*HEADER, "Email")
    same_person = ["Aakash Pramod Dharavat", "Pramod Dharavat", "24", "M", "", "416112", "Maratha Nagar, Kolhapur Road, Peth Vadgaon"]
    more = [["9111111111", *same_person, ""], ["9111111119", *same_person, "aakash@example.com"]]  # the first number is there; a new number of the same person
    first = upload(client, as_admin, csv_bytes(more, header=header))
    checked = get_import(client, as_admin, first["id"])
    assert (checked["valid_rows"], checked["existing_rows"]) == (0, 1)  # one person, who is there (found by the first number)
    confirm(client, as_admin, first["id"])  # skip: nothing of the contact changes - but the number the contact did not have is added
    db.expire_all()
    person = db.query(Contact).one()
    assert contact_numbers.all_numbers(db, person.id) == ["+919111111111", "+919111111119"] and person.email is None

    again = upload(client, as_admin, csv_bytes([["9111111119", *same_person, "aakash@example.com"], ["9111111120", *same_person, ""]], header=header))
    confirm(client, as_admin, again["id"], mode="update")  # update: the data of the sheet too
    db.expire_all()
    person = db.query(Contact).one()
    assert contact_numbers.all_numbers(db, person.id) == ["+919111111111", "+919111111119", "+919111111120"] and person.email == "aakash@example.com"
    assert [c["name"] for c in client.get("/api/v1/contacts", headers=as_admin, params={"q": "9111111120"}).json()["items"]] == ["Aakash Pramod Dharavat"]
    assert db.query(Contact).count() == 1


def test_somebody_who_is_found_only_by_who_they_are_is_the_same_person(client, make, as_admin, db):
    """A later sheet has the same voter with numbers the contact has not got at all: they join the contact (not a second contact)."""
    team_of(make, 2)
    confirm(client, as_admin, upload(client, as_admin, csv_bytes(VOTERS[:1]))["id"])
    later = [["9100000001", "aakash pramod dharavat", "PRAMOD DHARAVAT", "24", "m", "", "416112", "maratha nagar,   kolhapur road, peth vadgaon"]]
    checked = get_import(client, as_admin, upload(client, as_admin, csv_bytes(later))["id"])
    assert (checked["valid_rows"], checked["existing_rows"]) == (0, 1)
    done = upload(client, as_admin, csv_bytes(later))
    confirm(client, as_admin, done["id"])
    db.expire_all()
    assert db.query(Contact).count() == 1 and contact_numbers.all_numbers(db, db.query(Contact).one().id) == ["+919111111111", "+919100000001"]
    # another age is another person
    other = get_import(client, as_admin, upload(client, as_admin, csv_bytes([["9100000002", *later[0][1:3], "31", *later[0][4:]]]))["id"])
    assert (other["valid_rows"], other["existing_rows"]) == (1, 0)


def test_a_person_found_by_a_second_number_is_the_same_person(client, make, as_admin, db):
    team_of(make, 2)
    confirm(client, as_admin, upload(client, as_admin, csv_bytes(VOTERS[:3]))["id"])  # Aakash with three numbers
    again = [["9111111113", "Aakash P. Dharavat", "Pramod Dharavat", "24", "M", "", "416112", "Another spelling of the address"]]
    checked = get_import(client, as_admin, upload(client, as_admin, csv_bytes(again))["id"])
    assert (checked["valid_rows"], checked["existing_rows"]) == (0, 1)  # (the third number is his: he is not made twice)
    assert db.query(Contact).count() == 1


def test_a_deleted_person_is_brought_back_with_the_numbers_of_the_sheet(client, make, as_admin, db):
    team_of(make, 2)
    confirm(client, as_admin, upload(client, as_admin, csv_bytes(VOTERS[:1]))["id"])
    person = db.query(Contact).one()
    assert client.delete(f"/api/v1/contacts/{person.id}", headers=as_admin).status_code == 204
    again = upload(client, as_admin, csv_bytes(VOTERS[:3]))
    assert get_import(client, as_admin, again["id"])["valid_rows"] == 1
    confirm(client, as_admin, again["id"])
    db.expire_all()
    assert db.query(Contact).count() == 1 and db.query(Contact).one().deleted_at is None
    assert contact_numbers.all_numbers(db, person.id) == ["+919111111111", "+919111111112", "+919111111113"]


def test_the_same_sheet_twice_adds_nobody_twice(client, make, as_admin, db):
    team_of(make, 2)
    confirm(client, as_admin, upload(client, as_admin, csv_bytes(VOTERS))["id"])
    second = get_import(client, as_admin, upload(client, as_admin, csv_bytes(VOTERS))["id"])
    assert (second["valid_rows"], second["existing_rows"]) == (0, 6)
    assert db.query(Contact).count() == 6 and db.query(ContactPhone).count() == 10


# ------------------------------------------------------------------------------------------------- calls know the number
def person_with_numbers(make, db, employee, numbers):
    contact = make.contact(phone=numbers[0], name="Many Numbers", assign_to=employee)
    contact_numbers.add_numbers(db, contact, numbers[1:])
    db.commit()
    return contact


def dial(client, headers, contact, number=None):
    body = {"client_call_id": f"people-{contact.id}-{utcnow().timestamp()}", "contact_id": contact.id, "started_at": utcnow().isoformat()}
    if number:
        body["phone_number"] = number
    resp = client.post("/api/v1/calls", headers=headers, json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def outcome(client, headers, call, code):
    resp = client.post(f"/api/v1/calls/{call['id']}/disposition", headers=headers, json={"disposition_code": code})
    assert resp.status_code == 200, resp.text


def call_phone(client, headers, contact):
    return client.get(f"/api/v1/contacts/{contact.id}", headers=headers).json()["call_phone"]


def test_a_call_to_one_of_the_numbers_records_that_number_and_the_numbers_take_turns(client, make, db, emp_a, as_a):
    contact = person_with_numbers(make, db, emp_a, ["9777777771", "9777777772", "9777777773"])
    assert call_phone(client, as_a, contact) == "+919777777771"
    first = dial(client, as_a, contact)  # no number given: the one to dial
    assert first["phone_number"] == "+919777777771"
    outcome(client, as_a, first, "NO_ANSWER")
    assert call_phone(client, as_a, contact) == "+919777777772"  # tried once: the next one is the one to dial
    second = dial(client, as_a, contact, "97777 77773")  # the employee chose the third number by hand
    assert second["phone_number"] == "+919777777773" and second["contact_id"] == contact.id
    outcome(client, as_a, second, "BUSY")
    assert call_phone(client, as_a, contact) == "+919777777772"
    stats = {p["phone"]: (p["calls"], p["answered"]) for p in client.get(f"/api/v1/contacts/{contact.id}", headers=as_a).json()["phones"]}
    assert stats == {"+919777777771": (1, 0), "+919777777772": (0, 0), "+919777777773": (1, 0)}
    stranger = dial(client, as_a, contact, "9888888888")  # not one of his numbers: the first number is used
    assert stranger["phone_number"] == "+919777777771"


def test_the_number_that_was_answered_is_the_one_to_dial_next_time(client, make, db, emp_a, as_a):
    contact = person_with_numbers(make, db, emp_a, ["9777777781", "9777777782"])
    call = dial(client, as_a, contact, "9777777782")
    client.patch(f"/api/v1/calls/{call['id']}", headers=as_a, json={"status": "connected", "answered_at": utcnow().isoformat()})
    outcome(client, as_a, call, "CONNECTED")
    assert call_phone(client, as_a, contact) == "+919777777782"


def test_a_wrong_number_does_not_end_a_person_who_has_other_numbers(client, make, db, emp_a, as_a):
    contact = person_with_numbers(make, db, emp_a, ["9777777791", "9777777792"])
    call = dial(client, as_a, contact)
    outcome(client, as_a, call, "INVALID_NUMBER")
    db.expire_all()
    assert db.get(Contact, contact.id).status == "in_progress"  # (the person stays in the queue)
    assert call_phone(client, as_a, contact) == "+919777777792"  # (and the wrong number is not dialled again)
    flags = {p["phone"]: p["invalid"] for p in client.get(f"/api/v1/contacts/{contact.id}", headers=as_a).json()["phones"]}
    assert flags == {"+919777777791": True, "+919777777792": False}
    second = dial(client, as_a, contact, call_phone(client, as_a, contact))  # the app dials the number it was told to
    assert second["phone_number"] == "+919777777792"
    outcome(client, as_a, second, "INVALID_NUMBER")  # now every number is wrong
    db.expire_all()
    assert db.get(Contact, contact.id).status == "invalid"


def test_a_person_with_one_number_that_is_wrong_is_invalid_as_before(client, make, db, emp_a, as_a):
    contact = make.contact(phone="9777777701", assign_to=emp_a)
    outcome(client, as_a, dial(client, as_a, contact), "INVALID_NUMBER")
    db.expire_all()
    assert db.get(Contact, contact.id).status == "invalid"


# ------------------------------------------------------------------------------------------------- typed in by hand
def test_a_contact_made_by_hand_can_have_many_numbers_and_none_can_be_somebody_elses(client, make, as_admin, db):
    made = client.post("/api/v1/contacts", headers=as_admin, json={
        "name": "By Hand", "phone": "98 7654 3210", "more_phones": ["9876543211", "+91 98765 43212", "9876543211"], "relative_name": "Father", "age": 51, "gender": "M",
        "pincode": "416001", "address": "Somewhere, Kolhapur", "epic_no": " abc123 ",
    })
    assert made.status_code == 201, made.text
    body = made.json()
    assert [p["phone"] for p in body["phones"]] == ["+919876543210", "+919876543211", "+919876543212"]
    assert (body["relative_name"], body["age"], body["gender"], body["epic_no"], body["address"]) == ("Father", 51, "M", "ABC123", "Somewhere, Kolhapur")
    clash = client.post("/api/v1/contacts", headers=as_admin, json={"name": "Other", "phone": "9000000001", "more_phones": ["9876543211"]})
    assert clash.status_code == 409 and clash.json()["error"]["code"] == "duplicate_phone"
    primary = client.post("/api/v1/contacts", headers=as_admin, json={"name": "Other", "phone": "9876543212"})
    assert primary.status_code == 409  # (a number that is the second number of another contact)
    assert client.post("/api/v1/contacts", headers=as_admin, json={"name": "Bad", "phone": "9000000002", "more_phones": ["123"]}).status_code == 422
    assert db.query(Contact).count() == 1 and db.query(ContactPhone).count() == 3


def test_the_numbers_of_a_contact_can_be_changed(client, make, as_admin, db):
    made = client.post("/api/v1/contacts", headers=as_admin, json={"name": "Edit Me", "phone": "9876500001", "more_phones": ["9876500002", "9876500003"]}).json()
    cid = made["id"]
    changed = client.patch(f"/api/v1/contacts/{cid}", headers=as_admin, json={"phones": ["9876500003", "9876500004"], "age": 33})
    assert changed.status_code == 200, changed.text
    body = changed.json()
    assert [p["phone"] for p in body["phones"]] == ["+919876500003", "+919876500004"] and body["phone"] == "+919876500003" and body["age"] == 33
    assert [c["name"] for c in client.get("/api/v1/contacts", headers=as_admin, params={"q": "9876500004"}).json()["items"]] == ["Edit Me"]
    assert client.get("/api/v1/contacts", headers=as_admin, params={"q": "9876500001"}).json()["total"] == 0  # (the old number is free again)
    # only the main number: the others stay
    only = client.patch(f"/api/v1/contacts/{cid}", headers=as_admin, json={"phone": "9876500009"}).json()
    assert [p["phone"] for p in only["phones"]] == ["+919876500009", "+919876500004"]
    # a number of somebody else is refused, and nothing is lost
    other = client.post("/api/v1/contacts", headers=as_admin, json={"name": "Somebody", "phone": "9876500050"}).json()
    refused = client.patch(f"/api/v1/contacts/{cid}", headers=as_admin, json={"phones": ["9876500050"]})
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "duplicate_phone"
    assert [p["phone"] for p in client.get(f"/api/v1/contacts/{cid}", headers=as_admin).json()["phones"]] == ["+919876500009", "+919876500004"]
    assert other["id"] != cid
    assert client.patch(f"/api/v1/contacts/{cid}", headers=as_admin, json={"phones": ["1"]}).status_code == 422


def test_the_database_itself_refuses_a_number_in_two_contacts(make, db):
    from sqlalchemy.exc import IntegrityError

    one = make.contact(phone="9777700001")
    two = make.contact(phone="9777700002")
    db.add(ContactPhone(contact_id=two.id, phone_raw="9777700001", normalized_phone="+919777700001", position=1))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    assert one.id != two.id
