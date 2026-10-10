"""A contact is a NUMBER. Importing a sheet adds every different number, once - the name decides nothing.

  "Only the same number must not go into the database twice. 2,00,000 rows were uploaded and only 27,000 were added."

(The real list: 209,395 rows, 129,675 different numbers, 79,720 rows that repeat a number. The same person - name, relative, age, address -
is on many rows, one number on each; it used to be put together into ONE contact, up to 20 numbers, and the rest were thrown away.)
With the option "put the numbers of one person together" nothing is thrown away either: see test_people_numbers.py.
"""

from __future__ import annotations

import csv
import io

from app.models.contact import Contact, ContactPhone
from tests.test_import import confirm, get_import, upload
from tests.test_import_distribution import owned, team_of

HEADER = ("Mobile Number", "Voter Name", "Relative Name", "Age", "Gender", "EPIC No", "Voter Pincode", "Voter Address")
ADDRESS = "Maratha Nagar, Kolhapur Road, Peth Vadgaon"

VOTERS = [
    ["9111111111", "Aakash Pramod Dharavat", "Pramod Dharavat", "24", "M", "", "416112", ADDRESS],
    ["9111111112", "Aakash Pramod Dharavat", "Pramod Dharavat", "24", "M", "", "416112", ADDRESS],  # the same person, another number
    ["9111111113", "AAKASH PRAMOD DHARAVAT", "Pramod Dharavat", "24", "M", "", "416112", ADDRESS],
    ["9111111111", "Aakash Pramod Dharavat", "Pramod Dharavat", "24", "M", "", "416112", ADDRESS],  # the 1st number again: a repeat
    ["9222222221", "Suhas Jaykumar Aalmane", "Jaykumar", "33", "M", "", "416101", "Kavthesar rasta, Danoli, Shirol"],
    ["9222222222", "Suhas Jaykumar Aalmane", "Jaykumar", "33", "M", "", "416101", "Kavthesar rasta, Danoli, Shirol"],
    ["9111111112", "Someone Else", "Other", "40", "F", "", "416000", "Another address, Kolhapur"],  # Aakash's 2nd number again: a repeat
    ["9333333333", "Same Name", "Father A", "30", "M", "", "416200", "Ward 4, Hatkanangale"],
    ["9333333334", "Same Name", "Father B", "30", "M", "", "416200", "Ward 4, Hatkanangale"],
    ["9444444441", "Twin One", "Dad", "20", "M", "ABC1234567", "416300", "Same Place, Karveer"],
    ["9444444442", "Twin One", "Dad", "20", "M", "XYZ7654321", "416300", "Same Place, Karveer"],
    ["9444444443", "Twin One", "Dad", "20", "M", "", "416300", "Same Place, Karveer"],
    ["12345", "Bad Number", "Dad", "50", "M", "", "416300", "Somewhere"],
]
DIFFERENT_VALID_NUMBERS = 10  # 13 rows - 1 bad - 2 repeats


def csv_bytes(rows, header=HEADER) -> bytes:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(header)
    writer.writerows(rows)
    return out.getvalue().encode("utf-8")


def numbers_in_database(db) -> list[str]:
    db.expire_all()
    return sorted(p.normalized_phone for p in db.query(ContactPhone))


def test_every_different_number_is_a_contact_and_only_the_same_number_twice_is_left_out(client, make, as_admin, db):
    team_of(make, 2)
    imp = upload(client, as_admin, csv_bytes(VOTERS))
    checked = get_import(client, as_admin, imp["id"])
    assert (checked["total_rows"], checked["valid_rows"], checked["invalid_rows"], checked["file_duplicate_rows"], checked["existing_rows"]) == (13, DIFFERENT_VALID_NUMBERS, 1, 2, 0)
    assert checked["result"]["merged_rows"] == 0 and checked["result"]["grouped"] is False
    assert checked["options"]["group_people"] is False

    done = confirm(client, as_admin, imp["id"])
    assert (done["status"], done["inserted_rows"], done["skipped_rows"]) == ("completed", DIFFERENT_VALID_NUMBERS, 2)  # (skipped: the 2 rows that repeat a number)
    assert db.query(Contact).count() == DIFFERENT_VALID_NUMBERS == db.query(ContactPhone).count()
    expected = sorted(f"+91{row[0]}" for row in {r[0]: r for r in VOTERS if len(r[0]) == 10}.values())
    assert numbers_in_database(db) == expected  # the numbers of the sheet, each exactly once - none lost, none twice
    # one number = one contact with one number, and no contact has been joined with another because of its name
    assert all(db.query(ContactPhone).filter_by(contact_id=c.id).count() == 1 for c in db.query(Contact))
    assert db.query(Contact).filter(Contact.person_key.isnot(None)).count() == 0


def test_the_name_decides_nothing_the_first_row_with_a_number_gives_the_contact_its_data(client, make, as_admin, db):
    team_of(make, 2)
    confirm(client, as_admin, upload(client, as_admin, csv_bytes(VOTERS))["id"])
    by_number = {c.normalized_phone: c for c in db.query(Contact)}
    assert by_number["+919111111112"].name == "Aakash Pramod Dharavat"  # not "Someone Else", whose row came later with the same number
    assert by_number["+919111111112"].relative_name == "Pramod Dharavat" and by_number["+919111111112"].age == 24
    # the same name, relative, age and address on three rows: three contacts (three numbers)
    assert len([c for c in by_number.values() if c.name.lower() == "aakash pramod dharavat"]) == 3
    # the same name, two relatives: two contacts, as before
    assert sorted(c.relative_name for c in by_number.values() if c.name == "Same Name") == ["Father A", "Father B"]


def test_a_person_with_a_hundred_and_fifty_numbers_is_a_hundred_and_fifty_contacts_nothing_is_thrown_away(client, make, as_admin, db):
    team = team_of(make, 3)
    rows = [[f"96{n:08d}", "Many Numbers", "Dad", "50", "M", "", "416001", "Ward 1"] for n in range(150)]
    imp = upload(client, as_admin, csv_bytes(rows))
    assert get_import(client, as_admin, imp["id"])["valid_rows"] == 150
    done = confirm(client, as_admin, imp["id"])
    assert done["inserted_rows"] == 150 and db.query(Contact).count() == 150 and db.query(ContactPhone).count() == 150
    assert sorted(owned(db, team).values()) == [50, 50, 50]


def test_the_contacts_are_shared_equally_between_the_employees_who_are_working(client, make, as_admin, db):
    team = team_of(make, 3)
    rows = [[f"97{n:08d}", f"Person {n % 7}", "Dad", "40", "M", "", "416001", "Ward 2"] for n in range(100)]  # (seven names, a hundred numbers)
    confirm(client, as_admin, upload(client, as_admin, csv_bytes(rows))["id"])
    per = owned(db, team)
    assert sorted(per.values()) == [33, 33, 34] and sum(per.values()) == 100


def test_the_same_sheet_again_adds_nobody_and_a_new_number_of_somebody_who_is_there_is_added(client, make, as_admin, db):
    team_of(make, 2)
    confirm(client, as_admin, upload(client, as_admin, csv_bytes(VOTERS))["id"])
    again = get_import(client, as_admin, upload(client, as_admin, csv_bytes(VOTERS))["id"])
    assert (again["valid_rows"], again["existing_rows"]) == (0, DIFFERENT_VALID_NUMBERS)
    more = VOTERS[:1] + [["9555555555", "Aakash Pramod Dharavat", "Pramod Dharavat", "24", "M", "", "416112", ADDRESS]]
    third = upload(client, as_admin, csv_bytes(more))
    checked = get_import(client, as_admin, third["id"])
    assert (checked["valid_rows"], checked["existing_rows"]) == (1, 1)  # the new number is a contact, the old one is there already
    confirm(client, as_admin, third["id"])
    assert db.query(Contact).count() == DIFFERENT_VALID_NUMBERS + 1
    assert len(numbers_in_database(db)) == DIFFERENT_VALID_NUMBERS + 1


def test_a_number_that_is_a_contact_already_is_found_whatever_the_name_is(client, make, as_admin, db):
    team_of(make, 2)
    make.contact(name="Original Name", phone="9876500001")
    imp = upload(client, as_admin, csv_bytes([["+91 98765 00001", "Another Name", "X", "30", "M", "", "416001", "Somewhere"], ["9876500002", "Original Name", "X", "30", "M", "", "416001", "Somewhere"]]))
    checked = get_import(client, as_admin, imp["id"])
    assert (checked["valid_rows"], checked["existing_rows"]) == (1, 1)  # the first has the number of a contact; the second has the NAME of one, which is nothing
    confirm(client, as_admin, imp["id"])
    assert sorted(c.name for c in db.query(Contact)) == ["Original Name", "Original Name"]


def test_update_mode_changes_the_contact_that_has_the_number(client, make, as_admin, db):
    team_of(make, 2)
    make.contact(name="Old", phone="9876500001")
    imp = upload(client, as_admin, csv_bytes([["9876500001", "New Name", "Rel", "31", "F", "", "416002", "New address"]]), mode="update")
    confirm(client, as_admin, imp["id"])
    contact = db.query(Contact).one()
    db.refresh(contact)
    assert (contact.name, contact.relative_name, contact.age, contact.gender, contact.address) == ("New Name", "Rel", 31, "F", "New address")
