"""What happens to a sheet while it is checked and added: no duplicate can get in, a stop or a crash only delays the work, the
files are cleaned up, the limits hold."""

from __future__ import annotations

import csv
import io
from datetime import timedelta
from pathlib import Path

import pytest

from app.core.config import get_settings, reset_settings_cache
from app.core.database import new_session
from app.core.timeutils import utcnow
from app.models.contact import Contact, ContactAssignment
from app.models.imports import Import
from app.services import import_service
from tests.test_import import UNASSIGNED, confirm, get_import, make_csv, upload
from tests.test_import_distribution import away, owned, sheet, team_of


class Crash(BaseException):
    """What a killed process looks like to the code that was running: nothing after it runs, no `except Exception` sees it."""


@pytest.fixture()
def small_steps(monkeypatch):
    """100 contacts per step, so that a sheet of a few hundred rows is several steps."""
    monkeypatch.setenv("IMPORT_CHUNK_ROWS", "100")
    reset_settings_cache()
    yield
    monkeypatch.undo()
    reset_settings_cache()


@pytest.fixture()
def settings_env(monkeypatch):
    def set_env(**values):
        for key, value in values.items():
            monkeypatch.setenv(key.upper(), str(value))
        reset_settings_cache()

    yield set_env
    monkeypatch.undo()
    reset_settings_cache()


def after_steps(monkeypatch, count: int, action):
    """Do `action` after `count` steps of the adding (the hook sits in the pause between two steps)."""
    seen = {"n": 0}
    real = import_service._pause

    def hook(started):
        seen["n"] += 1
        if seen["n"] == count:
            action()
        real(started)

    monkeypatch.setattr(import_service, "_pause", hook)


def confirm_but_do_not_run(client, headers, import_id, monkeypatch, **body):
    with monkeypatch.context() as patch:
        patch.setattr("app.jobs.submit", lambda *a, **k: None)
        resp = client.post(f"/api/v1/contacts/import/{import_id}/confirm", headers=headers, json=body)
    assert resp.status_code == 202, resp.text


def folder_of(db, import_id) -> Path:
    db.expire_all()
    return Path(db.get(Import, import_id).file_path).parent


# --------------------------------------------------------------------------------------------------------- duplicates
def test_the_same_number_written_in_every_usual_way_is_one_contact(client, as_admin, db):
    variants = ["9876500001", "+91 98765 00001", "09876500001", "+919876500001", "98765-00001", "(98765) 00001", "9876500001.0", "'9876500001", "919876500001"]
    imp = upload(client, as_admin, make_csv([[f"Person {i}", v] for i, v in enumerate(variants)], header=("Name", "Mobile")))
    preview = get_import(client, as_admin, imp["id"])
    assert (preview["valid_rows"], preview["file_duplicate_rows"], preview["invalid_rows"]) == (1, len(variants) - 1, 0)
    confirm(client, as_admin, imp["id"], **UNASSIGNED)
    assert [c.name for c in db.query(Contact)] == ["Person 0"]  # the first one wins


def test_numbers_that_are_contacts_already_are_never_added_again(client, make, as_admin, db):
    team_of(make, 2)
    first = upload(client, as_admin, sheet(100))
    confirm(client, as_admin, first["id"])
    overlap = upload(client, as_admin, sheet(150, start=50))  # rows 50..99 are known, 100..199 are new
    preview = get_import(client, as_admin, overlap["id"])
    assert (preview["valid_rows"], preview["existing_rows"], preview["file_duplicate_rows"]) == (100, 50, 0)
    done = confirm(client, as_admin, overlap["id"])
    assert (done["inserted_rows"], done["skipped_rows"]) == (100, 50)
    assert db.query(Contact).count() == 200
    assert db.query(ContactAssignment).filter_by(status="active").count() == 200  # (the 50 known contacts kept their owners: nothing more)
    assert len({c.normalized_phone for c in db.query(Contact)}) == 200


def test_a_number_that_became_a_contact_after_the_check_is_still_not_added_twice(client, make, as_admin, db):
    team = team_of(make, 2)
    imp = upload(client, as_admin, sheet(40))
    assert get_import(client, as_admin, imp["id"])["valid_rows"] == 40
    sneaky = make.contact(phone=f"{9000000000 + 7 * 3 + 1:010d}", name="Added meanwhile")  # somebody adds one of the numbers by hand
    done = confirm(client, as_admin, imp["id"])
    assert done["status"] == "completed" and done["inserted_rows"] == 39 and done["skipped_rows"] == 1
    assert db.query(Contact).count() == 40
    db.expire_all()
    assert db.get(Contact, sneaky.id).name == "Added meanwhile"  # (and it is not given to anybody by the import)
    assert db.query(ContactAssignment).filter_by(contact_id=sneaky.id).count() == 0
    assert sum(owned(db, team).values()) == 39


def test_the_database_itself_refuses_a_second_contact_with_the_same_number(db, make):
    from sqlalchemy.exc import IntegrityError

    make.contact(phone="9876500001")
    with pytest.raises(IntegrityError):
        db.add(Contact(name="Again", phone_raw="9876500001", normalized_phone="+919876500001", search_text=""))
        db.commit()
    db.rollback()


# ------------------------------------------------------------------------------------------------------ the report
def test_the_report_has_every_problem_row_once_with_the_cells_of_the_sheet(client, make, as_admin):
    make.contact(name="Known", phone="9876500010")
    rows = [
        ["Good", "9876500001", "good@example.com"],  # ok
        ["No phone", "", ""],  # invalid
        ["Bad email", "9876500002", "nope"],  # invalid
        ["Twice", "9876500001", ""],  # same number as row 2
        ["Known again", "98765 00010", "known@example.com"],  # a contact already
    ]
    imp = upload(client, as_admin, make_csv(rows, header=("Name", "Mobile", "Email")))
    report = client.get(f"/api/v1/contacts/import/{imp['id']}/issues.csv", headers=as_admin)
    lines = list(csv.reader(io.StringIO(report.text)))
    assert lines[0] == ["row_number", "status", "problem", "Name", "Mobile", "Email"]
    body = {int(line[0]): line for line in lines[1:]}
    assert sorted(body) == [3, 4, 5, 6]
    assert body[3][1:3] == ["invalid", "Mobile number is required."] and body[3][3] == "No phone"
    assert body[4][2].startswith("Invalid email") and body[5][1] == "duplicate" and "earlier row" in body[5][2]
    assert body[6][1] == "duplicate" and "already exists" in body[6][2] and body[6][3:] == ["Known again", "98765 00010", "known@example.com"]


def test_only_the_first_problem_rows_are_kept_in_the_database_but_the_report_has_all(client, as_admin, settings_env):
    settings_env(import_issue_sample=20)
    rows = [[f"Bad {i}", "123"] for i in range(55)] + [["Fine", "9876500001"]]
    imp = upload(client, as_admin, make_csv(rows, header=("Name", "Mobile")))
    assert get_import(client, as_admin, imp["id"])["invalid_rows"] == 55
    assert client.get(f"/api/v1/contacts/import/{imp['id']}/rows?status=invalid&page_size=100", headers=as_admin).json()["total"] == 20
    report = client.get(f"/api/v1/contacts/import/{imp['id']}/issues.csv", headers=as_admin).text
    assert len(list(csv.reader(io.StringIO(report)))) == 56  # the header and 55 rows


# ---------------------------------------------------------------------------------------------- odd cells
def test_odd_cells_are_cleaned_or_reported_never_stored_raw(client, as_admin, db):
    rows = [
        [f"Zero{chr(0x200B)}Width{chr(0xA0)}Name", "9876500001", "", f"  Pune{chr(0x2060)}  "],  # invisible characters, stray spaces
        ["Café Joe", "9876500002", "", ""],  # decomposed accent -> one normal form
        ["N" * 300, "9876500003", "", ""],  # a name that is too long
        ["Tab\tSeparated\nName", "9876500004", "", ""],
    ]
    imp = upload(client, as_admin, make_csv(rows, header=("Name", "Mobile", "Email", "City")))
    preview = get_import(client, as_admin, imp["id"])
    assert (preview["valid_rows"], preview["invalid_rows"]) == (3, 1)
    confirm(client, as_admin, imp["id"], **UNASSIGNED)
    names = {c.normalized_phone: (c.name, c.location) for c in db.query(Contact)}
    assert names["+919876500001"] == ("ZeroWidth Name", "Pune")
    assert names["+919876500002"][0] == "Café Joe"
    assert names["+919876500004"][0] == "Tab Separated Name"


def test_lone_surrogates_and_control_characters_are_removed_from_a_cell():
    from app.services.import_rows import text

    assert text("Lone \ud800 surrogate") == "Lone  surrogate"
    assert text(f"bell\x07 and nul\x00 and {chr(0x202E)} rtl") == "bell and nul and  rtl"
    assert text(7.0) == "7" and text(True) == "yes" and text(None) == ""


def test_priority_tags_and_extra_columns_come_through(client, as_admin, db):
    rows = [["Ann", "9876500001", "high", "vip; gold|new", "Acme", "note"], ["Bob", "9876500002", "", "", "", ""]]
    imp = upload(client, as_admin, make_csv(rows, header=("Name", "Mobile", "Priority", "Tags", "Company", "Remark")), default_priority="3")
    confirm(client, as_admin, imp["id"], **UNASSIGNED)
    ann, bob = (db.query(Contact).filter_by(name=n).one() for n in ("Ann", "Bob"))
    assert (ann.priority, ann.tags, ann.custom_fields) == (1, ["vip", "gold", "new"], {"Company": "Acme", "Remark": "note"})
    assert (bob.priority, bob.tags, bob.custom_fields) == (3, [], {})  # the default priority of the upload


# ---------------------------------------------------------------------------------------- stop, crash, take over
def test_an_import_that_stops_in_the_middle_keeps_what_it_did_and_continues_on_retry(client, make, as_admin, db, small_steps, monkeypatch):
    team = team_of(make, 4)
    imp = upload(client, as_admin, sheet(1_000))
    boom = {"on": True}

    def explode():
        if boom["on"]:
            raise RuntimeError("the disk is on fire")

    after_steps(monkeypatch, 3, explode)
    confirm(client, as_admin, imp["id"])
    failed = get_import(client, as_admin, imp["id"])
    assert failed["status"] == "failed" and "Stopped after" in failed["error_message"]
    assert failed["applied_rows"] == 300 and db.query(Contact).count() == 300  # three steps of 100 are in, nothing of a fourth
    assert sum(owned(db, team).values()) == 300

    boom["on"] = False
    retry = client.post(f"/api/v1/contacts/import/{imp['id']}/retry", headers=as_admin)
    assert retry.status_code == 202, retry.text
    done = get_import(client, as_admin, imp["id"])
    assert done["status"] == "completed" and done["applied_rows"] == 1_000 and done["inserted_rows"] == 1_000
    assert db.query(Contact).count() == 1_000 and set(owned(db, team).values()) == {250}  # exactly as planned, nothing twice


def test_retry_is_only_for_an_import_that_stopped_while_adding(client, as_admin):
    done = upload(client, as_admin, sheet(3))
    assert client.post(f"/api/v1/contacts/import/{done['id']}/retry", headers=as_admin).status_code == 409  # still only previewed
    confirm(client, as_admin, done["id"], **UNASSIGNED)
    assert client.post(f"/api/v1/contacts/import/{done['id']}/retry", headers=as_admin).status_code == 409  # completed


def test_a_crashed_process_is_taken_over_and_the_work_carries_on_where_it_stopped(client, make, as_admin, db, small_steps, monkeypatch):
    team = team_of(make, 5)
    imp = upload(client, as_admin, sheet(1_000))
    confirm_but_do_not_run(client, as_admin, imp["id"], monkeypatch)

    def die():
        raise Crash()

    after_steps(monkeypatch, 4, die)
    with pytest.raises(Crash):
        import_service.run_apply(imp["id"])
    monkeypatch.undo()
    db.expire_all()
    crashed = db.get(Import, imp["id"])
    assert crashed.status == "applying" and crashed.applied_rows == 400 and crashed.lease_owner  # it still looks like somebody is working on it
    assert import_service.recover_stuck_imports() == 0  # ...and for a while that is respected

    crashed.heartbeat_at = utcnow() - timedelta(seconds=get_settings().import_lease_seconds + 30)  # nobody has reported for too long
    db.commit()
    assert import_service.recover_stuck_imports() == 1  # a new runner takes over (inline in the tests)
    done = get_import(client, as_admin, imp["id"])
    assert done["status"] == "completed" and done["inserted_rows"] == 1_000 and done["attempts"] == 2
    assert db.query(Contact).count() == 1_000 and set(owned(db, team).values()) == {200}


def test_a_crash_while_the_sheet_was_being_checked_is_recovered_too(client, as_admin, db, monkeypatch):
    with monkeypatch.context() as patch:
        patch.setattr("app.jobs.submit", lambda *a, **k: None)  # (the upload is made, but nobody checks it yet)
        upload(client, as_admin, sheet(300))
    db.expire_all()
    waiting = db.query(Import).one()

    def die(*args, **kwargs):
        raise Crash()

    with monkeypatch.context() as patch:
        patch.setattr(import_service, "_compare", die)
        with pytest.raises(Crash):
            import_service.run_validation(waiting.id)
    db.expire_all()
    stuck = db.query(Import).one()
    assert stuck.status == "validating"
    stuck.heartbeat_at = utcnow() - timedelta(minutes=10)
    db.commit()
    assert import_service.recover_stuck_imports() == 1
    checked = get_import(client, as_admin, stuck.id)
    assert checked["status"] == "previewed" and checked["valid_rows"] == 300 and checked["total_rows"] == 300


def test_a_runner_that_lost_its_lease_stops_without_writing_anything_more(client, make, as_admin, db, small_steps, monkeypatch):
    team = team_of(make, 2)
    imp = upload(client, as_admin, sheet(500))
    confirm_but_do_not_run(client, as_admin, imp["id"], monkeypatch)

    def somebody_else_takes_over():
        session = new_session()
        try:
            session.query(Import).filter(Import.id == imp["id"]).update({"lease_owner": "another-process"})
            session.commit()
        finally:
            session.close()

    after_steps(monkeypatch, 2, somebody_else_takes_over)
    import_service.run_apply(imp["id"])
    monkeypatch.undo()
    db.expire_all()
    row = db.get(Import, imp["id"])
    assert row.status == "applying" and row.lease_owner == "another-process" and row.applied_rows == 200
    assert db.query(Contact).count() == 200  # exactly what had been committed: the third step did not start


def test_cancelling_while_contacts_are_being_added_stops_after_the_current_step(client, make, as_admin, db, small_steps, monkeypatch):
    team = team_of(make, 2)
    imp = upload(client, as_admin, sheet(500))
    folder = folder_of(db, imp["id"])

    def cancel():
        response = client.post(f"/api/v1/contacts/import/{imp['id']}/cancel", headers=as_admin)
        assert response.status_code == 200 and response.json()["cancel_requested"] is True

    after_steps(monkeypatch, 2, cancel)
    confirm(client, as_admin, imp["id"])
    stopped = get_import(client, as_admin, imp["id"])
    assert stopped["status"] == "cancelled" and "Stopped by an administrator after 200 of 500" in stopped["error_message"]
    assert db.query(Contact).count() == 200 and sum(owned(db, team).values()) == 200  # what was added stays, whole
    assert sorted(p.name for p in folder.iterdir()) == ["issues.csv"]  # the rest of the files are gone
    assert client.post(f"/api/v1/contacts/import/{imp['id']}/confirm", headers=as_admin, json={}).status_code == 409


def test_only_one_import_is_added_at_a_time(client, make, as_admin, db):
    team_of(make, 2)
    first = upload(client, as_admin, sheet(5))
    second = upload(client, as_admin, sheet(5, start=100))
    db.query(Import).filter(Import.id == first["id"]).update({"status": "applying", "lease_owner": "someone", "heartbeat_at": utcnow()})
    db.commit()
    busy = client.post(f"/api/v1/contacts/import/{second['id']}/confirm", headers=as_admin, json={})
    assert busy.status_code == 409 and busy.json()["error"]["code"] == "import_busy"
    assert get_import(client, as_admin, second["id"])["status"] == "previewed"  # nothing of it was started


def test_an_import_that_keeps_crashing_is_given_up(client, as_admin, db):
    imp = upload(client, as_admin, sheet(10))
    db.query(Import).filter(Import.id == imp["id"]).update(
        {"status": "validating", "attempts": 5, "lease_owner": "ghost", "heartbeat_at": utcnow() - timedelta(minutes=30)}
    )
    db.commit()
    assert import_service.recover_stuck_imports() == 0
    failed = get_import(client, as_admin, imp["id"])
    assert failed["status"] == "failed" and "kept stopping" in failed["error_message"]


def test_a_second_runner_cannot_start_while_the_first_is_alive(client, make, as_admin, db, monkeypatch):
    team_of(make, 2)
    imp = upload(client, as_admin, sheet(10))
    confirm_but_do_not_run(client, as_admin, imp["id"], monkeypatch)
    db.query(Import).filter(Import.id == imp["id"]).update({"lease_owner": "alive", "heartbeat_at": utcnow()})
    db.commit()
    import_service.run_apply(imp["id"])  # refused by the lease: does nothing
    assert db.query(Contact).count() == 0 and get_import(client, as_admin, imp["id"])["status"] == "applying"


# ----------------------------------------------------------------------------------------------------- the files
def test_files_are_removed_when_the_import_is_done_except_the_report(client, make, as_admin, db):
    team_of(make, 2)
    imp = upload(client, as_admin, make_csv([["Good", "9876500001"], ["Bad", "1"]], header=("Name", "Mobile")))
    folder = folder_of(db, imp["id"])
    assert sorted(p.name for p in folder.iterdir()) == ["issues.csv", "source.csv", "valid.jsonl"] or "existing.jsonl" in {p.name for p in folder.iterdir()}
    confirm(client, as_admin, imp["id"])
    assert sorted(p.name for p in folder.iterdir()) == ["issues.csv"]
    report = client.get(f"/api/v1/contacts/import/{imp['id']}/issues.csv", headers=as_admin)
    assert report.status_code == 200 and "Bad" in report.text  # still downloadable after the import is done


def test_a_cancelled_upload_leaves_nothing_behind(client, as_admin, db):
    imp = upload(client, as_admin, sheet(5))
    folder = folder_of(db, imp["id"])
    assert folder.is_dir()
    assert client.post(f"/api/v1/contacts/import/{imp['id']}/cancel", headers=as_admin).json()["status"] == "cancelled"
    assert not folder.exists()


def test_a_failed_check_leaves_nothing_behind(client, as_admin, db):
    imp = upload(client, as_admin, b"Name,City\nAnna,Pune\n")
    assert get_import(client, as_admin, imp["id"])["status"] == "failed"
    assert not folder_of(db, imp["id"]).exists()


def test_the_name_of_the_uploaded_file_cannot_reach_outside_the_import_folder(client, as_admin, db):
    resp = client.post(
        "/api/v1/contacts/import", headers=as_admin, files={"file": ("../../../../evil.csv", io.BytesIO(sheet(2)), "text/csv")}
    )
    assert resp.status_code == 202
    root = Path(get_settings().import_storage_path).resolve()
    db.expire_all()
    stored = Path(db.get(Import, resp.json()["id"]).file_path).resolve()
    assert stored.is_relative_to(root) and stored.name == "source.csv" and ".." not in str(stored.relative_to(root))
    assert resp.json()["filename"] == "evil.csv"


def test_unconfirmed_uploads_and_old_reports_are_cleaned_up(client, as_admin, db):
    waiting = upload(client, as_admin, sheet(3))
    finished = upload(client, as_admin, sheet(3, start=50))
    confirm(client, as_admin, finished["id"], **UNASSIGNED)
    old = utcnow() - timedelta(days=get_settings().import_keep_days + 2)
    db.query(Import).update({"created_at": old})
    db.commit()
    assert import_service.expire_unconfirmed(db) == 1
    assert get_import(client, as_admin, waiting["id"])["status"] == "cancelled"
    assert not folder_of(db, waiting["id"]).exists()
    import_service.purge_old_imports(db, older_than_days=30)
    assert not folder_of(db, finished["id"]).exists()  # the report of a finished import is kept for a few days, then removed


# ------------------------------------------------------------------------------------------------------ limits
def test_a_file_over_the_size_limit_is_refused_while_it_is_received(client, as_admin, settings_env, db):
    settings_env(max_import_mb=1)
    root = Path(get_settings().import_storage_path)
    root.mkdir(parents=True, exist_ok=True)
    before = set(root.iterdir())
    big = make_csv([[f"Person {i}", f"{9000000000 + i}"] for i in range(60_000)], header=("Name", "Mobile"))
    assert len(big) > 1024 * 1024
    refused = client.post("/api/v1/contacts/import", headers=as_admin, files={"file": ("big.csv", big, "text/csv")})
    assert refused.status_code == 413
    assert set(root.iterdir()) == before  # nothing was kept


def test_a_sheet_with_more_rows_than_allowed_fails_with_the_reason(client, as_admin, settings_env):
    settings_env(max_import_rows=50)
    imp = upload(client, as_admin, sheet(80))
    failed = get_import(client, as_admin, imp["id"])
    assert failed["status"] == "failed" and "more than 50 rows" in failed["error_message"]


def test_not_enough_disk_space_is_said_clearly(client, as_admin, monkeypatch):
    import shutil
    from collections import namedtuple

    usage = namedtuple("usage", "total used free")
    monkeypatch.setattr(shutil, "disk_usage", lambda path: usage(10**9, 10**9 - 10, 10))
    refused = client.post("/api/v1/contacts/import", headers=as_admin, files={"file": ("a.csv", sheet(5), "text/csv")})
    assert refused.status_code == 507 and refused.json()["error"]["code"] == "disk_full"


# --------------------------------------------------------------------------------------------------- big sheets
def test_a_big_sheet_is_added_in_many_steps_with_progress_and_an_exact_split(client, make, as_admin, db):
    team = team_of(make, 7)
    imp = upload(client, as_admin, sheet(25_000))
    preview = get_import(client, as_admin, imp["id"])
    assert preview["total_rows"] == preview["scanned_rows"] == 25_000 and preview["progress_percent"] == 100
    done = confirm(client, as_admin, imp["id"])
    assert done["status"] == "completed" and done["applied_rows"] == done["inserted_rows"] == 25_000
    per = sorted(owned(db, team).values())
    assert sum(per) == 25_000 and per[-1] - per[0] <= 1
    assert db.query(Contact).count() == 25_000 and db.query(ContactAssignment).filter_by(status="active").count() == 25_000
    assert done["result"]["stage"] == "done" and len(done["result"]["employees"]) == 7
