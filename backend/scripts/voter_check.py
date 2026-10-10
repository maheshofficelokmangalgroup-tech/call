"""Prove the import of a voter list at the size of the real one WITH THE OPTION "put the numbers of one person together", on a real
database - with exact numbers. (Without the option, the ordinary way, every number is a contact of its own: scripts/number_check.py.)

    DATABASE_URL=mysql+pymysql://root@127.0.0.1:3307/calling_scale python -m scripts.voter_check --rows 209395

It makes up a list in the format of the real one (scripts/make_voter_sheet.py: one row per number, the same voter on several rows,
the same number on several rows, a few bad rows), imports it with the code of the admin panel and checks - not only measures - that
  * every row is accounted for: bad rows, rows that repeat a number, and the rows that became people with their numbers,
  * every PERSON is one contact with ALL their numbers (3,000 people are looked up by their numbers one by one),
  * no number is in two contacts, whatever the sheet says,
  * people that were there before (found by a number, or only by who they are) get their new numbers and are not made twice,
  * the new people are shared equally between the employees,
  * the same list a second time adds nobody,
  * the work stays inside a memory limit and the pages stay quick.
It refuses to run on a database whose name does not say it is for tests.
"""

from __future__ import annotations

import argparse
import os
import random
import statistics
import sys
import tempfile
import time
from pathlib import Path


def parse(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--rows", type=int, default=209_395)
    parser.add_argument("--employees", type=int, default=10)
    parser.add_argument("--known-by-number", type=int, default=1500, help="people that are contacts already, with one of their numbers")
    parser.add_argument("--known-by-name", type=int, default=500, help="people that are contacts already, with a number the sheet does not have")
    parser.add_argument("--spot", type=int, default=3000, help="people looked up one by one")
    parser.add_argument("--max-rss-mb", type=float, default=1200)
    parser.add_argument("--max-endpoint-seconds", type=float, default=3.0)
    parser.add_argument("--workdir", type=Path, default=None)
    return parser.parse_args(argv)


class Report:
    def __init__(self) -> None:
        self.failures: list[str] = []

    def line(self, text: str = "") -> None:
        print(text, flush=True)

    def check(self, ok: bool, text: str) -> None:
        self.line(f"  {'ok  ' if ok else 'FAIL'} {text}")
        if not ok:
            self.failures.append(text)


def main(argv: list[str] | None = None) -> int:
    args = parse(argv)
    workdir = args.workdir or Path(tempfile.mkdtemp(prefix="voter-check-"))
    workdir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("BACKGROUND_JOBS", "false")
    os.environ.setdefault("LOG_LEVEL", "WARNING")
    os.environ.setdefault("LOG_JSON", "false")
    os.environ.setdefault("BCRYPT_ROUNDS", "4")
    os.environ["IMPORT_STORAGE_PATH"] = str(workdir / "imports")
    os.environ.setdefault("MAX_IMPORT_ROWS", str(max(1_100_000, args.rows + 1000)))
    os.environ.setdefault("MAX_IMPORT_MB", "400")
    os.environ.setdefault("RATE_LIMIT_ENABLED", "false")

    from fastapi import UploadFile
    from fastapi.testclient import TestClient
    from sqlalchemy import func, select

    from app.core.database import get_engine, new_session
    from app.core.security import hash_password
    from app.main import app
    from app.models.contact import Contact, ContactAssignment, ContactPhone
    from app.models.employee import Employee, Role
    from app.models.imports import Import
    from app.schemas.distribution import DistributionIn
    from app.services import contact_numbers, import_service
    from app.services.contact_service import refresh_person_key, refresh_search_text
    from app.services.reference_data import ensure_reference_data
    from scripts import make_voter_sheet
    from scripts.scale_check import peak_memory_mb

    database = get_engine().url.database or ""
    if not any(word in database.lower() for word in ("test", "scale", "bench", "tmp", "temp")) and "sqlite" not in get_engine().url.drivername:
        raise SystemExit(f"Refusing to run on database '{database}': its name must say it is for tests (calling_test, calling_scale ...).")
    report = Report()
    report.line(f"Voter list check: {args.rows:,} rows, {args.employees} employees, on {get_engine().url.drivername} ({database})")

    db = new_session()
    ensure_reference_data(db)
    password = "Voter-Check-Admin-1!"
    roles = {r.name: r.id for r in db.scalars(select(Role))}
    admin = Employee(employee_code="VCADMIN", email="voter-admin@example.com", full_name="Voter Admin", password_hash=hash_password(password), role_id=roles["admin"], daily_target=0)
    employees = [
        Employee(employee_code=f"VC{i:03d}", email=f"vc{i:03d}@example.com", full_name=f"Voter Employee {i:03d}", password_hash=hash_password(password), role_id=roles["employee"], daily_target=50)
        for i in range(1, args.employees + 1)
    ]
    db.add_all([admin, *employees])
    db.commit()
    employee_ids = [e.id for e in employees]

    # ------------------------------------------------------------------------------------------------ the list
    started = time.perf_counter()
    sheet = workdir / "voters.csv"
    expected = make_voter_sheet.write_csv(sheet, args.rows)
    people = expected.pop("_people")
    report.line(f"List written: {sheet.stat().st_size / 1024 / 1024:,.1f} MB in {time.perf_counter() - started:.1f} s; expected { {k: v for k, v in expected.items()} }")
    report.line(f"  ({expected['rows']:,} rows with {expected['unique_numbers_in_sheet']:,} different numbers; the most numbers of one person: {expected['most_numbers_of_one_person']})")

    # ------------------------------------------------------------------------------------------------ people that are there already
    rng = random.Random(11)
    keys = sorted(people)
    chosen = rng.sample(keys, min(len(keys), args.known_by_number + args.known_by_name))
    by_number, by_name = chosen[: args.known_by_number], chosen[args.known_by_number :]
    foreign: dict[str, str] = {}
    started = time.perf_counter()

    def seed(key: str, number: str, serial: int) -> None:
        relative, age, pin, address = key.split("|", 3)
        contact = Contact(
            name=f"Known {serial}", phone_raw=number, normalized_phone="+91" + number, relative_name=relative, age=int(age), gender=people_names[key][1], pincode=pin, address=address,
            priority=2, tags=[], custom_fields={}, search_text="", status="new", source="seed",
        )
        # (the person's name in the sheet is not the one of the seed: only the key matters, and the key has the name in it - so use the sheet's)
        contact.name = people_names[key][0]
        refresh_person_key(contact)
        refresh_search_text(contact, ["+91" + number])
        db.add(contact)

    people_names: dict[str, tuple[str, str]] = {}
    for line in make_voter_sheet.make_rows(args.rows):
        people_names.setdefault(f"{line[2]}|{line[3]}|{line[6]}|{line[7]}", (line[1], line[4]))
    for serial, key in enumerate(by_number):
        seed(key, people[key][0], serial)
    for serial, key in enumerate(by_name, start=len(by_number)):
        foreign[key] = "9" + f"{800000000 + serial}"  # a number that is not in the sheet
        seed(key, foreign[key], serial)
    db.commit()
    before = db.scalar(select(func.count(Contact.id))) or 0
    report.line(f"{before:,} people were contacts before ({len(by_number):,} with a number of the sheet, {len(by_name):,} with a number that is not in it) - {time.perf_counter() - started:.1f} s")

    # ------------------------------------------------------------------------------------------------ the check
    def run_import(label: str):
        with open(sheet, "rb") as handle:
            imp = import_service.create_import(
                db, upload=UploadFile(file=handle, filename=sheet.name), actor=admin, mode="skip", campaign_id=None, assign_employee_ids=[],
                assign_strategy="equal", default_priority=2, group_people=True, request=None,  # type: ignore[arg-type]
            )
        import_id = imp.id
        began = time.perf_counter()
        import_service.run_validation(import_id)
        seconds = time.perf_counter() - began
        db.expire_all()
        imp = db.get(Import, import_id)
        report.line(f"{label}: checked in {seconds:.1f} s ({args.rows / seconds:,.0f} rows/s): status={imp.status} people-to-add={imp.valid_rows:,} people-there-already={imp.existing_rows:,} repeated={imp.file_duplicate_rows:,} invalid={imp.invalid_rows:,} numbers={imp.result.get('numbers'):,}")
        return imp

    imp = run_import("First time")
    report.check(imp.status == "previewed", f"the check finished ({imp.error_message or 'previewed'})")
    if imp.status != "previewed":
        return finish(report)
    known = len(by_number) + len(by_name)
    report.check(imp.total_rows == args.rows, f"all {args.rows:,} rows were read")
    report.check(imp.invalid_rows == expected["invalid"], f"bad rows: {imp.invalid_rows:,} (expected {expected['invalid']:,})")
    report.check(imp.file_duplicate_rows == expected["repeated"], f"rows that repeat a number: {imp.file_duplicate_rows:,} (expected {expected['repeated']:,})")
    result = imp.result
    report.check(result["sheet_people"] == expected["people"], f"people in the list: {result['sheet_people']:,} (expected {expected['people']:,})")
    report.check(result["sheet_numbers"] == expected["numbers"] and result["merged_rows"] == expected["merged_rows"], f"numbers in the list: {result['sheet_numbers']:,} (expected {expected['numbers']:,}); rows that joined another row of the same person: {result['merged_rows']:,} (expected {expected['merged_rows']:,})")
    report.check(imp.total_rows == imp.invalid_rows + imp.file_duplicate_rows + result["sheet_numbers"], f"every row is accounted for: {imp.total_rows:,} = {imp.invalid_rows:,} bad + {imp.file_duplicate_rows:,} repeats + {result['sheet_numbers']:,} numbers of people")
    report.check(imp.existing_rows == known and imp.valid_rows == expected["people"] - known, f"people there already: {imp.existing_rows:,} (expected {known:,}: found by a number or by who they are); new people: {imp.valid_rows:,}")

    plan = import_service.build_plan(db, imp, employee_ids=None, strategy="equal", order="interleave")
    report.check(plan.working == args.employees and plan.can_confirm, f"all {args.employees} employees are working in the plan")
    import_service.begin_apply(db, imp, admin, "skip", None, DistributionIn())  # type: ignore[arg-type]
    began = time.perf_counter()
    import_service.run_apply(imp.id)
    seconds = time.perf_counter() - began
    db.expire_all()
    imp = db.get(Import, imp.id)
    report.line(f"Added in {seconds:.1f} s: status={imp.status} people={imp.inserted_rows:,} given out={imp.assigned_rows:,} existing people that got numbers={imp.updated_rows:,}")
    report.check(imp.status == "completed", f"the adding finished ({imp.error_message or 'completed'})")
    contacts = db.scalar(select(func.count(Contact.id))) or 0
    phones = db.scalar(select(func.count(ContactPhone.id))) or 0
    report.check(contacts == expected["people"], f"contacts now: {contacts:,} = the {expected['people']:,} people of the list (nobody twice, nobody missing)")
    expected_phones = expected["numbers"] + len(by_name)  # (the numbers of the list, and the number the contacts found by name had before)
    report.check(phones == expected_phones, f"numbers now: {phones:,} (expected {expected_phones:,})")
    distinct = db.scalar(select(func.count(func.distinct(ContactPhone.normalized_phone)))) or 0
    report.check(distinct == phones, f"no number is in two contacts ({distinct:,} different numbers in {phones:,})")
    firsts = db.scalar(select(func.count()).select_from(select(ContactPhone.contact_id).where(ContactPhone.position == 0).group_by(ContactPhone.contact_id).subquery())) or 0
    report.check(firsts == contacts, f"every contact has a first number ({firsts:,} of {contacts:,})")
    mismatch = db.scalar(select(func.count(Contact.id)).where(~select(ContactPhone.id).where(ContactPhone.contact_id == Contact.id, ContactPhone.normalized_phone == Contact.normalized_phone).exists())) or 0
    report.check(mismatch == 0, f"the first number of every contact is in the numbers table ({mismatch:,} that are not)")

    # people, one by one, by any of their numbers
    sample = rng.sample(keys, min(len(keys), args.spot))
    wrong = 0
    for key in sample:
        numbers = ["+91" + n for n in people[key]]
        owners = {contact_numbers.owner_of(db, n) for n in numbers}
        if len(owners) != 1 or None in owners:
            wrong += 1
            continue
        stored = set(contact_numbers.all_numbers(db, next(iter(owners))[0]))
        want = set(numbers) | ({"+91" + foreign[key]} if key in foreign else set())
        wrong += stored != want
    report.check(wrong == 0, f"{len(sample):,} people looked up by their numbers: every one is one contact with exactly their numbers ({wrong} wrong)")

    per = dict(db.execute(select(ContactAssignment.employee_id, func.count(ContactAssignment.id)).where(ContactAssignment.status == "active").group_by(ContactAssignment.employee_id)).all())
    counts = [per.get(i, 0) for i in employee_ids]
    report.check(sum(counts) == imp.valid_rows, f"every new person has an owner ({sum(counts):,} of {imp.valid_rows:,})")
    report.check(max(counts) - min(counts) <= 1, f"equal sharing of the PEOPLE: {min(counts):,} to {max(counts):,} each")

    again = run_import("Second time (the same list)")
    report.check(again.status == "previewed" and again.valid_rows == 0 and again.existing_rows == expected["people"], f"the same list again adds nobody: new={again.valid_rows:,}, there already={again.existing_rows:,}")
    after = db.scalar(select(func.count(Contact.id))) or 0
    report.check(after == contacts, f"contacts unchanged ({after:,})")

    # ------------------------------------------------------------------------------------------------ the pages
    report.line("Pages:")
    probe_key = sample[0]
    probe_number = people[probe_key][-1]
    with TestClient(app) as client:
        def login(identifier: str):
            body = {"identifier": identifier, "password": password, "device": {"device_uid": "voter-device-0001", "name": "Voter Phone", "os_version": "14", "app_version": "1.0.0"}}
            response = client.post("/api/v1/auth/login", json=body)
            assert response.status_code == 200, response.text
            return {"Authorization": f"Bearer {response.json()['access_token']}"}

        admin_headers, employee_headers = login("voter-admin@example.com"), login("vc001@example.com")
        probes = [
            ("admin   contacts, first page", f"/api/v1/contacts?page=1&page_size=50", admin_headers),
            ("admin   find a person by their LAST number", f"/api/v1/contacts?q={probe_number}", admin_headers),
            ("admin   search by name", "/api/v1/contacts?q=Patil%20Aakash&page_size=50", admin_headers),
            ("admin   search by pincode", f"/api/v1/contacts?q={probe_key.split('|')[2]}&page_size=50", admin_headers),
            ("admin   dashboard", "/api/v1/dashboard", admin_headers),
            ("phone   calling queue (first 100)", "/api/v1/queue?limit=100", employee_headers),
        ]
        for label, path, headers in probes:
            times, status, body = [], 0, None
            for _ in range(3):
                began = time.perf_counter()
                response = client.get(path, headers=headers)
                times.append(time.perf_counter() - began)
                status, body = response.status_code, response.json() if response.status_code == 200 else None
            ok = status == 200 and max(times) <= args.max_endpoint_seconds
            report.check(ok, f"{label:<42} {statistics.median(times) * 1000:>7.0f} ms median, {max(times) * 1000:>7.0f} ms slowest (HTTP {status})")
            if label.startswith("admin   find"):
                items = (body or {}).get("items", [])
                report.check(len(items) == 1 and len(items[0]["phones"]) >= len(people[probe_key]), "  the person is found by that number, and the answer lists all their numbers")
            if label.startswith("phone"):
                items = (body or {}).get("items", [])
                report.check(bool(items) and all(i["contact"]["phones"] and i["contact"]["call_phone"] for i in items), "  every person in the queue comes with their numbers and the one to dial")
    peak = peak_memory_mb()
    report.line(f"Memory peak {peak:,.0f} MB")
    report.check(peak <= args.max_rss_mb, f"memory peak {peak:,.0f} MB is within {args.max_rss_mb:,.0f} MB")
    return finish(report)


def finish(report: Report) -> int:
    if report.failures:
        report.line(f"\n{len(report.failures)} CHECK(S) FAILED:")
        for failure in report.failures:
            report.line(f"  - {failure}")
        return 1
    report.line("\nAll checks passed.")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
