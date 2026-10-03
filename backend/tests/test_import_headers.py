"""Which column of a sheet is which: the real lists come with every spelling there is."""

from __future__ import annotations

import pytest

from app.services.import_rows import map_headers, norm_header

VOTER = ["Mobile Number", "Voter Name", "Relative Name", "Age", "Gender", "EPIC No", "Voter Pincode", "Voter Address"]


def columns(headers: list[str]) -> dict[str, str]:
    """{canonical field: header as written}"""
    canonical, _ = map_headers(headers)
    return {field: headers[idx] for idx, field in canonical.items()}


def test_the_voter_list_as_the_company_has_it():
    assert columns(VOTER) == {
        "phone": "Mobile Number", "name": "Voter Name", "relative_name": "Relative Name", "age": "Age", "gender": "Gender",
        "epic_no": "EPIC No", "pincode": "Voter Pincode", "address": "Voter Address",
    }


@pytest.mark.parametrize("spelling", ["Voter Name", "voter name", "VOTER NAME", "Voter_Name", "voter-name", "VoterName", "  Voter   Name ", "Voter Name:"])
def test_one_header_in_every_spelling(spelling):
    assert norm_header(spelling) == "votername"
    assert columns([spelling, "Mobile"]) == {"name": spelling, "phone": "Mobile"}


def test_other_spellings_of_the_other_columns():
    headers = ["MOBILE_NO.", "Elector Name", "Father/Husband Name", "AGE", "Sex", "EPIC_NO", "PIN CODE", "House Address"]
    assert columns(headers) == {
        "phone": "MOBILE_NO.", "name": "Elector Name", "relative_name": "Father/Husband Name", "age": "AGE", "gender": "Sex",
        "epic_no": "EPIC_NO", "pincode": "PIN CODE", "address": "House Address",
    }


def test_a_possessive_name_header_is_found_as_the_only_one_that_says_name():
    assert columns(["Mobile", "Voter's Name", "Age"]) == {"phone": "Mobile", "name": "Voter's Name", "age": "Age"}


def test_the_only_header_that_says_name_is_the_name_when_no_header_is_a_known_one():
    assert columns(["Mobile", "Voter Full Name (English)", "Age"]) == {"phone": "Mobile", "name": "Voter Full Name (English)", "age": "Age"}
    assert columns(["Mobile Number (Primary)", "Name"])["phone"] == "Mobile Number (Primary)"


def test_a_name_that_is_somebody_elses_is_not_taken_for_the_person():
    # only the relative's name: there is no name column - the check will say so, instead of calling the relative the person
    assert "name" not in columns(["Mobile", "Relative Name"])
    assert "name" not in columns(["Mobile", "Agent Name", "Booth Name"])


def test_two_candidates_are_not_guessed():
    assert "name" not in columns(["Mobile", "First Name", "Last Name"])
    assert "phone" not in columns(["Voter Name", "Mobile A", "Mobile B"])


def test_a_header_that_is_not_known_stays_an_extra_field():
    canonical, custom = map_headers(["Name", "Phone", "Booth No"])
    assert sorted(canonical.values()) == ["name", "phone"] and list(custom.values()) == ["Booth No"]


def test_a_sheet_without_a_name_column_says_which_columns_it_has(client, as_admin):
    from tests.test_import import get_import, make_csv, upload

    imp = upload(client, as_admin, make_csv([["9876500001", "41"]], header=("Mobile Number", "Age")))
    job = get_import(client, as_admin, imp["id"])
    assert job["status"] == "failed"
    assert "No name column found" in job["error_message"]
    assert "'Mobile Number', 'Age'" in job["error_message"]  # the person can see what the sheet has and what to rename
