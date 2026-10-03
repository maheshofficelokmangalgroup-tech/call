"""scripts/import_contacts.py: the same pipeline from the command line (the way to load a sheet of a million rows)."""

from __future__ import annotations

import pytest

from app.models.contact import Contact, ContactAssignment
from app.models.imports import Import
from scripts import import_contacts
from tests.test_import_distribution import owned, sheet, team_of


def write_sheet(tmp_path, count, **kw):
    path = tmp_path / "contacts.csv"
    path.write_bytes(sheet(count, **kw))
    return path


def test_without_yes_it_only_checks_and_shows_the_plan(tmp_path, make, admin, db, capsys):
    team_of(make, 4)
    path = write_sheet(tmp_path, 40)
    assert import_contacts.main([str(path)]) == 0
    out = capsys.readouterr().out
    assert "40" in out and "gets 10" in out and "Nothing was added" in out
    assert db.query(Contact).count() == 0
    assert db.query(Import).one().status == "previewed"  # it can be confirmed in the admin panel


def test_with_yes_it_adds_and_shares_equally(tmp_path, make, admin, db, capsys):
    team = team_of(make, 10)
    path = write_sheet(tmp_path, 1_000)
    assert import_contacts.main([str(path), "--yes"]) == 0
    out = capsys.readouterr().out
    assert "COMPLETED" in out and "1,000 added" in out
    assert set(owned(db, team).values()) == {100} and db.query(Contact).count() == 1_000


def test_options_are_passed_through(tmp_path, make, admin, db):
    team = team_of(make, 4)
    path = write_sheet(tmp_path, 10)
    assert import_contacts.main([str(path), "--employees", f"{team[0].id},{team[1].id}", "--yes"]) == 0
    assert sorted(owned(db, team).values()) == [0, 0, 5, 5]
    again = write_sheet(tmp_path, 6, start=500)
    assert import_contacts.main([str(again), "--unassigned", "--yes"]) == 0
    assert db.query(ContactAssignment).count() == 10 and db.query(Contact).count() == 16


def test_a_bad_sheet_or_nobody_working_is_a_clear_failure(tmp_path, make, admin, db, capsys):
    bad = tmp_path / "bad.csv"
    bad.write_bytes(b"Name,City\nAnna,Pune\n")
    assert import_contacts.main([str(bad)]) == 1
    assert "mobile number column" in capsys.readouterr().out
    with pytest.raises(SystemExit):
        import_contacts.main([str(tmp_path / "missing.csv")])
    path = write_sheet(tmp_path, 5)
    assert import_contacts.main([str(path), "--yes"]) == 1  # (there are no employees at all)
    assert "Nothing can be added until somebody is working" in capsys.readouterr().out


def test_the_administrator_can_be_named(tmp_path, make, admin, db):
    make.employee(role="admin", code="ADM2", email="second-admin@example.com")
    team_of(make, 2)
    path = write_sheet(tmp_path, 4)
    assert import_contacts.main([str(path), "--admin", "second-admin@example.com", "--yes"]) == 0
    assert db.query(Import).one().created_by != admin.id
    with pytest.raises(SystemExit):
        import_contacts.main([str(path), "--admin", "nobody@example.com"])
