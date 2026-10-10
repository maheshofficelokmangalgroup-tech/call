"""Prove, on a real database, that a sheet is imported BY NUMBER: every different number is a contact, once - and nothing else decides.

    DATABASE_URL=mysql+pymysql://root@127.0.0.1:3307/calling_scale python -m scripts.number_check --rows 209395      # a made-up list the shape of the real one
    DATABASE_URL=...  python -m scripts.number_check --sheet "Kolhapur -1.xlsx"                                      # a list of your own

What the list says is worked out FIRST, from the file alone, without the import (which rows are good, which different numbers there are);
then the sheet is imported with the code of the admin panel and it is checked - not only measured - that
  * every row is accounted for: bad rows + rows that repeat a number + different numbers = all rows,
  * the numbers in the database are EXACTLY the different numbers of the sheet (the two sets are compared, one by one),
  * every number is a contact of its own with that one number: nobody was joined with anybody because of a name, and nothing was thrown away,
  * the contacts were shared equally between the employees who are working,
  * the same list a second time adds nobody,
  * an employee who is added afterwards (no contact at all) gets his equal share by itself, from what nobody had called yet,
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
    parser.add_argument("--rows", type=int, default=209_395, help="rows of the made-up list (ignored with --sheet)")
    parser.add_argument("--sheet", type=Path, default=None, help="a list of your own (.csv or .xlsx) instead of the made-up one")
    parser.add_argument("--employees", type=int, default=2)
    parser.add_argument("--known", type=int, default=1000, help="numbers of the sheet that are contacts before the import")
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


def different_numbers_of(sheet: Path) -> tuple[int, int, int, set[str]]:
    """(rows, bad rows, rows that repeat a number, the different good numbers) - from the file alone, row by row."""
    from app.services.import_files import open_sheet
    from app.services.import_rows import map_headers, validate_row

    total = bad = repeated = 0
    seen: set[str] = set()
    with open_sheet(sheet, "xlsx" if sheet.suffix.lower() in (".xlsx", ".xlsm") else "csv") as opened:
        canonical, custom = map_headers(opened.headers)
        for row_number, cells in opened.rows():
            total += 1
            result = validate_row(row_number, cells, canonical, custom, default_priority=2, employees={})
            if result.status != "valid":
                bad += 1
            elif result.normalized_phone in seen:
                repeated += 1
            else:
                seen.add(result.normalized_phone)  # type: ignore[arg-type]
    return total, bad, repeated, seen


def main(argv: list[str] | None = None) -> int:
    args = parse(argv)
    workdir = args.workdir or Path(tempfile.mkdtemp(prefix="number-check-"))
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
    from app.core.timeutils import utcnow
    from app.main import app
    from app.models.contact import Contact, ContactAssignment, ContactPhone
    from app.models.employee import Employee, Role
    from app.models.imports import Import
    from app.schemas.distribution import DistributionIn
    from app.services import import_service, level_service
    from app.services.contact_service import refresh_search_text
    from app.services.reference_data import ensure_reference_data
    from scripts import make_voter_sheet
    from scripts.scale_check import peak_memory_mb

    database = get_engine().url.database or ""
    if not any(word in database.lower() for word in ("test", "scale", "bench", "tmp", "temp")) and "sqlite" not in get_engine().url.drivername:
        raise SystemExit(f"Refusing to run on database '{database}': its name must say it is for tests (calling_test, calling_scale ...).")
    report = Report()

    # ------------------------------------------------------------------------------------------------ the list, and what it says
    started = time.perf_counter()
    if args.sheet is not None:
        sheet = args.sheet
    else:
        sheet = workdir / "voters.csv"
        make_voter_sheet.write_csv(sheet, args.rows)
    total, bad, repeated, wanted = different_numbers_of(sheet)
    report.line(f"Number check: {total:,} rows ({sheet.stat().st_size / 1024 / 1024:,.1f} MB), {args.employees} employees, on {get_engine().url.drivername} ({database})")
    report.line(f"  the list says (worked out from the file alone, {time.perf_counter() - started:.1f} s): {bad:,} bad rows, {repeated:,} rows that repeat a number, {len(wanted):,} DIFFERENT numbers")
    assert total == bad + repeated + len(wanted)

    db = new_session()
    ensure_reference_data(db)
    password = "Number-Check-Admin-1!"
    roles = {r.name: r.id for r in db.scalars(select(Role))}
    admin = Employee(employee_code="NCADMIN", email="number-admin@example.com", full_name="Number Admin", password_hash=hash_password(password), role_id=roles["admin"], daily_target=0)
    employees = [
        Employee(employee_code=f"NC{i:03d}", email=f"nc{i:03d}@example.com", full_name=f"Number Employee {i:03d}", password_hash=hash_password(password), role_id=roles["employee"], daily_target=50)
        for i in range(1, args.employees + 1)
    ]
    db.add_all([admin, *employees])
    db.commit()
    employee_ids = [e.id for e in employees]

    # numbers that are contacts before the import (some of the list's numbers): they must be left as they are, and not be added again
    rng = random.Random(5)
    known = sorted(rng.sample(sorted(wanted), min(args.known, len(wanted))))
    for number in known:
        contact = Contact(name=f"Known {number[-4:]}", phone_raw=number[3:], normalized_phone=number, priority=2, tags=[], custom_fields={}, search_text="", status="new", source="seed")
        refresh_search_text(contact, [number])
        db.add(contact)
    db.commit()  # (a contact made through the model gets its first number in the numbers table by itself)
    report.line(f"{len(known):,} numbers of the list are contacts before")

    def run_import(label: str):
        with open(sheet, "rb") as handle:
            imp = import_service.create_import(
                db, upload=UploadFile(file=handle, filename=sheet.name), actor=admin, mode="skip", campaign_id=None, assign_employee_ids=[],
                assign_strategy="equal", default_priority=2, request=None,  # type: ignore[arg-type]
            )
        import_id = imp.id
        began = time.perf_counter()
        import_service.run_validation(import_id)
        seconds = time.perf_counter() - began
        db.expire_all()
        imp = db.get(Import, import_id)
        report.line(
            f"{label}: checked in {seconds:.1f} s ({total / max(seconds, 0.001):,.0f} rows/s): status={imp.status} to-add={imp.valid_rows:,} there-already={imp.existing_rows:,} "
            f"repeated={imp.file_duplicate_rows:,} invalid={imp.invalid_rows:,}"
        )
        return imp

    imp = run_import("First time")
    report.check(imp.status == "previewed", f"the check finished ({imp.error_message or 'previewed'})")
    if imp.status != "previewed":
        return finish(report)
    report.check(imp.total_rows == total, f"all {total:,} rows were read")
    report.check(imp.invalid_rows == bad, f"bad rows: {imp.invalid_rows:,} (the list says {bad:,})")
    report.check(imp.file_duplicate_rows == repeated, f"rows that repeat a number: {imp.file_duplicate_rows:,} (the list says {repeated:,})")
    report.check(imp.existing_rows == len(known), f"numbers that are contacts already: {imp.existing_rows:,} (expected {len(known):,})")
    report.check(imp.valid_rows == len(wanted) - len(known), f"numbers to add: {imp.valid_rows:,} = {len(wanted):,} different - {len(known):,} there already")
    report.check(imp.result["merged_rows"] == 0 and imp.result["grouped"] is False, "no row was joined with another row (the name decides nothing)")
    report.check(imp.total_rows == imp.invalid_rows + imp.file_duplicate_rows + imp.existing_rows + imp.valid_rows, f"every row is accounted for: {imp.total_rows:,} = {imp.invalid_rows:,} bad + {imp.file_duplicate_rows:,} repeats + {imp.existing_rows + imp.valid_rows:,} different numbers")
    plan = import_service.build_plan(db, imp, employee_ids=None, strategy="equal", order="interleave")
    report.check(plan.working == args.employees and plan.can_confirm, f"all {args.employees} employees are working in the plan")

    import_service.begin_apply(db, imp, admin, "skip", None, DistributionIn())  # type: ignore[arg-type]
    began = time.perf_counter()
    import_service.run_apply(imp.id)
    seconds = time.perf_counter() - began
    db.expire_all()
    imp = db.get(Import, imp.id)
    report.line(f"Added in {seconds:.1f} s ({(imp.inserted_rows or 0) / max(seconds, 0.001):,.0f} contacts/s): status={imp.status} added={imp.inserted_rows:,} given out={imp.assigned_rows:,}")
    report.check(imp.status == "completed", f"the adding finished ({imp.error_message or 'completed'})")

    contacts = db.scalar(select(func.count(Contact.id))) or 0
    phones = db.scalar(select(func.count(ContactPhone.id))) or 0
    report.check(contacts == len(wanted), f"contacts now: {contacts:,} = the {len(wanted):,} different numbers of the list (nobody twice, nobody missing)")
    report.check(phones == contacts, f"numbers now: {phones:,} - one for every contact")
    in_database = {n for (n,) in db.execute(select(ContactPhone.normalized_phone))}
    report.check(in_database == wanted, f"the numbers in the database are EXACTLY the numbers of the list ({len(in_database ^ wanted):,} differences)")
    two = db.scalar(select(func.count()).select_from(select(ContactPhone.contact_id).group_by(ContactPhone.contact_id).having(func.count(ContactPhone.id) > 1).subquery())) or 0
    report.check(two == 0, f"every contact has one number ({two:,} have more)")
    mismatch = db.scalar(select(func.count(Contact.id)).where(~select(ContactPhone.id).where(ContactPhone.contact_id == Contact.id, ContactPhone.normalized_phone == Contact.normalized_phone).exists())) or 0
    report.check(mismatch == 0, f"the number of every contact is in the numbers table ({mismatch:,} that are not)")

    per = dict(db.execute(select(ContactAssignment.employee_id, func.count(ContactAssignment.id)).where(ContactAssignment.status == "active").group_by(ContactAssignment.employee_id)).all())
    counts = [per.get(i, 0) for i in employee_ids]
    report.check(sum(counts) == imp.valid_rows, f"every new contact has an owner ({sum(counts):,} of {imp.valid_rows:,})")
    report.check(max(counts) - min(counts) <= 1, f"equal sharing: {min(counts):,} to {max(counts):,} each")

    again = run_import("Second time (the same list)")
    report.check(again.status == "previewed" and again.valid_rows == 0 and again.existing_rows == len(wanted), f"the same list again adds nobody: new={again.valid_rows:,}, there already={again.existing_rows:,}")
    report.check((db.scalar(select(func.count(Contact.id))) or 0) == contacts, f"contacts unchanged ({contacts:,})")

    # ------------------------------------------------------------------------------------------------ somebody comes later
    newcomer = Employee(employee_code="NC900", email="nc900@example.com", full_name="Number Employee 900 (new)", password_hash=hash_password(password), role_id=roles["employee"], daily_target=50, created_at=utcnow())
    db.add(newcomer)
    db.commit()
    began = time.perf_counter()
    run = level_service.auto_level()
    seconds = time.perf_counter() - began
    report.check(run is not None, "the new employee was noticed (no contact at all) and a sharing was started by itself")
    db.expire_all()
    per = dict(db.execute(select(ContactAssignment.employee_id, func.count(ContactAssignment.id)).where(ContactAssignment.status == "active").group_by(ContactAssignment.employee_id)).all())
    everybody = [*employee_ids, newcomer.id]
    mine = [per.get(i, 0) for i in everybody]
    report.line(f"The new employee, shared in {seconds:.1f} s: {dict(zip(['NC%03d' % (i + 1) for i in range(args.employees)] + ['NC900'], mine))}")
    report.check(sum(mine) == sum(counts) and max(mine) - min(mine) <= 1, f"everybody has the same, to one: {min(mine):,} to {max(mine):,} ({sum(mine):,} in all, as before - none lost, none twice)")
    report.check(level_service.auto_level() is None, "and the next minute changes nothing")

    # ------------------------------------------------------------------------------------------------ the pages
    report.line("Pages:")
    probe_number = sorted(wanted)[len(wanted) // 2][3:]
    with TestClient(app) as client:
        def login(identifier: str):
            body = {"identifier": identifier, "password": password, "device": {"device_uid": "number-device-0001", "name": "Number Phone", "os_version": "14", "app_version": "1.0.0"}}
            response = client.post("/api/v1/auth/login", json=body)
            assert response.status_code == 200, response.text
            return {"Authorization": f"Bearer {response.json()['access_token']}"}

        admin_headers, employee_headers = login("number-admin@example.com"), login("nc900@example.com")
        probes = [
            ("admin   contacts, first page", "/api/v1/contacts?page=1&page_size=50", admin_headers),
            ("admin   find a contact by its number", f"/api/v1/contacts?q={probe_number}", admin_headers),
            ("admin   dashboard", "/api/v1/dashboard", admin_headers),
            ("admin   who is working", "/api/v1/distribution/overview", admin_headers),
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
                report.check(len((body or {}).get("items", [])) == 1, "  the number is found, once")
            if label.startswith("phone"):
                report.check(bool((body or {}).get("items")), "  the new employee's queue has contacts")
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
