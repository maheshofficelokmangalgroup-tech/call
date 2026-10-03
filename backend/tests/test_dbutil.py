"""insert_ignore: the rows that are there stay exactly as they are, the others go in - on both databases; and on MySQL it is written
in the form the driver can send in a few batches (a form it does not know costs seconds for every step of an import)."""

from __future__ import annotations

import re
import time

import pytest
from sqlalchemy import select
from sqlalchemy.dialects import mysql

from app.core.dbutil import KeepExistingRow, insert_ignore
from app.core.timeutils import utcnow
from app.models.contact import Contact, ContactPhone
from app.models.employee import Team


def team_rows(*names: str, description: str = "new") -> list[dict]:
    now = utcnow()
    return [{"name": name, "description": description, "is_active": True, "created_at": now, "updated_at": now} for name in names]


def test_a_row_that_is_there_stays_as_it_is_and_the_others_go_in(db):
    insert_ignore(db, Team.__table__, team_rows("Alpha", description="first"), conflict_column="name")
    db.commit()
    insert_ignore(db, Team.__table__, team_rows("Alpha", "Beta", "Gamma", description="second"), conflict_column="name")
    db.commit()
    found = {name: description for name, description in db.execute(select(Team.name, Team.description))}
    assert found == {"Alpha": "first", "Beta": "second", "Gamma": "second"}  # (Alpha was not touched)


def test_many_rows_in_one_call_and_the_same_again(db):
    names = [f"Team {i:05d}" for i in range(3_000)]
    insert_ignore(db, Team.__table__, team_rows(*names), conflict_column="name")
    insert_ignore(db, Team.__table__, team_rows(*names, "One more"), conflict_column="name")  # all there already, plus one
    db.commit()
    assert db.query(Team).count() == 3_001


def test_a_row_with_two_values_in_the_conflict_key(db, make):
    contact = make.contact()
    other = make.contact()
    now = utcnow()
    one = [{"contact_id": contact.id, "phone_raw": "9000000001", "normalized_phone": "+919000000001", "position": 1, "created_at": now}]
    insert_ignore(db, ContactPhone.__table__, one, conflict_column="normalized_phone")
    # the same number for ANOTHER contact is left out (a number belongs to one contact), a new number goes in
    again = [
        {"contact_id": other.id, "phone_raw": "9000000001", "normalized_phone": "+919000000001", "position": 1, "created_at": now},
        {"contact_id": other.id, "phone_raw": "9000000002", "normalized_phone": "+919000000002", "position": 2, "created_at": now},
    ]
    insert_ignore(db, ContactPhone.__table__, again, conflict_column="normalized_phone")
    db.commit()
    owners = dict(db.execute(select(ContactPhone.normalized_phone, ContactPhone.contact_id).where(ContactPhone.normalized_phone.like("+91900000000%"))).all())
    assert owners == {"+919000000001": contact.id, "+919000000002": other.id}


def test_nothing_to_insert_is_not_an_error(db):
    insert_ignore(db, Team.__table__, [], conflict_column="name")
    assert db.query(Team).count() == 0


def test_on_mysql_it_is_written_the_way_the_driver_can_batch():
    """No database needed: the statement for MySQL has the clause right after VALUES (no 'AS new'), and the driver's pattern for
    'INSERT ... VALUES (...) ON DUPLICATE KEY' recognises it at once - however many columns the table has."""
    pymysql_cursors = pytest.importorskip("pymysql.cursors")
    from sqlalchemy.dialects.mysql import insert as mysql_insert

    statement = mysql_insert(Contact.__table__)
    statement._post_values_clause = KeepExistingRow("normalized_phone")
    columns = [column.name for column in Contact.__table__.columns if column.name != "id"]
    compiled = str(statement.values({name: None for name in columns}).compile(dialect=mysql.dialect(paramstyle="format")))
    assert "AS new" not in compiled
    assert compiled.rstrip().endswith("ON DUPLICATE KEY UPDATE normalized_phone = normalized_phone")
    started = time.perf_counter()
    matched = pymysql_cursors.RE_INSERT_VALUES.match(re.sub(r"%\(\w+\)s", "%s", compiled))
    assert matched is not None and time.perf_counter() - started < 0.5

