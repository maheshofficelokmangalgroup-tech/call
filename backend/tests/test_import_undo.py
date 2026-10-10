"""Taking the contacts of a wrongly added import away again: only what nobody has touched, nothing else, and the numbers are free again."""

from __future__ import annotations

from datetime import timedelta

import pytest

from app.core.errors import Conflict
from app.core.timeutils import utcnow
from app.models.call import Call, Callback, CallNote
from app.models.contact import Contact, ContactAssignment, ContactPhone
from app.models.imports import Import
from app.models.system import AuditLog
from app.services import import_undo
from scripts import remove_import
from tests.test_import import confirm, get_import, upload
from tests.test_import_distribution import owned, sheet, team_of


def added(client, headers, count: int = 40, **kw) -> int:
    imp = upload(client, headers, sheet(count, **kw))
    confirm(client, headers, imp["id"])
    return imp["id"]


def test_it_counts_first_and_changes_nothing(client, make, as_admin, db):
    team = team_of(make, 2)
    import_id = added(client, as_admin, 40)
    found = import_undo.count(db, import_id)
    assert (found.contacts, found.untouched, found.touched) == (40, 40, 0)
    assert sorted(found.owners.values()) == [20, 20] and set(found.owners) == {e.id for e in team}
    assert db.query(Contact).count() == 40


def test_the_untouched_contacts_go_with_their_numbers_owners_and_nothing_else_does(client, make, as_admin, db):
    team = team_of(make, 2)
    first = added(client, as_admin, 40)
    other = added(client, as_admin, 10, start=500)  # another import: it must not be touched
    own = make.contact(name="By hand", phone="9876500001")  # a contact made by hand: not part of any import
    done = import_undo.remove_untouched(db, first)
    assert done == {"removed": 40, "kept": 0}
    db.expire_all()
    assert db.query(Contact).count() == 10 + 1
    assert db.query(Contact).filter_by(import_id=first).count() == 0 and db.query(Contact).filter_by(import_id=other).count() == 10
    assert db.get(Contact, own.id) is not None
    assert db.query(ContactPhone).count() == 11  # the numbers of the removed contacts are gone with them
    assert sum(owned(db, team).values()) == 10
    assert db.query(ContactAssignment).filter(ContactAssignment.status == "active").count() == 10
    assert get_import(client, as_admin, first)["result"]["removed_contacts"] == 40
    audit = db.query(AuditLog).filter_by(action="import.contacts_removed").one()
    assert audit.details["removed"] == 40 and audit.entity_id == str(first)


def test_what_somebody_has_started_on_stays(client, make, as_admin, db):
    team = team_of(make, 2)
    import_id = added(client, as_admin, 20)
    contacts = db.query(Contact).filter_by(import_id=import_id).order_by(Contact.id).all()
    called, noted, promised, worked, counted = contacts[:5]
    owner = team[0]
    db.add(Call(client_call_id="undo-call-1", employee_id=owner.id, contact_id=called.id, phone_number_snapshot=called.normalized_phone, started_at=utcnow(), status="completed"))
    db.add(CallNote(contact_id=noted.id, author_id=owner.id, body="spoke to the family"))
    db.add(Callback(employee_id=owner.id, contact_id=promised.id, scheduled_at=utcnow() + timedelta(days=1)))
    worked.status = "interested"
    counted.call_count = 2
    db.commit()
    found = import_undo.count(db, import_id)
    assert (found.contacts, found.untouched, found.touched) == (20, 15, 5)
    done = import_undo.remove_untouched(db, import_id)
    assert done == {"removed": 15, "kept": 5}
    db.expire_all()
    assert {c.id for c in db.query(Contact).filter_by(import_id=import_id)} == {c.id for c in contacts[:5]}
    assert db.query(Call).count() == 1 and db.query(CallNote).count() == 1 and db.query(Callback).count() == 1  # nothing of what was done is lost


def test_doing_it_twice_is_harmless_and_the_numbers_can_be_added_again_the_ordinary_way(client, make, as_admin, db):
    team = team_of(make, 2)
    import_id = added(client, as_admin, 30)
    assert import_undo.remove_untouched(db, import_id)["removed"] == 30
    assert import_undo.remove_untouched(db, import_id) == {"removed": 0, "kept": 0}
    again = upload(client, as_admin, sheet(30))  # the same sheet: every number is new again, none is "already there"
    checked = get_import(client, as_admin, again["id"])
    assert (checked["valid_rows"], checked["existing_rows"]) == (30, 0)
    confirm(client, as_admin, again["id"])
    assert db.query(Contact).count() == 30 and sorted(owned(db, team).values()) == [15, 15]


def test_an_import_that_is_running_is_not_touched(client, make, as_admin, db):
    team_of(make, 2)
    import_id = added(client, as_admin, 10)
    db.query(Import).filter_by(id=import_id).update({"status": "applying"})
    db.commit()
    with pytest.raises(Conflict):
        import_undo.remove_untouched(db, import_id)
    assert db.query(Contact).count() == 10


def test_the_command_only_looks_unless_it_is_told_to_remove(client, make, as_admin, db, capsys):
    team_of(make, 2)
    import_id = added(client, as_admin, 12)
    assert remove_import.main([str(import_id)]) == 0
    out = capsys.readouterr().out
    assert "nobody has touched: 12" in out and "Nothing was changed" in out and db.query(Contact).count() == 12
    assert remove_import.main([str(import_id), "--yes"]) == 0
    assert "Removed 12 contacts; 0 of this import stay." in capsys.readouterr().out
    db.expire_all()
    assert db.query(Contact).count() == 0
    assert remove_import.main(["99999"]) == 2
