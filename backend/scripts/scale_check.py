"""Prove the import at the size it is meant for, on a real database: a sheet of a million contacts, shared between employees.

    DATABASE_URL=mysql+pymysql://root@127.0.0.1:3307/calling_scale python -m scripts.scale_check --rows 1000000

It makes up the data (nothing real), runs the same import code as the admin panel, and checks - not only measures - that
  * every number is a contact exactly once (the sheet's repeats, the bad rows and the numbers that were contacts already are not added),
  * the new contacts are shared equally (nobody has more than one more than anybody else),
  * the work stays inside a memory limit,
  * and the pages of the admin panel and the phones are still quick with that many contacts in the database.
It refuses to run on a database whose name does not say it is for tests (calling_test, calling_scale ...).
"""

from __future__ import annotations

import argparse
import os
import statistics
import sys
import tempfile
import threading
import time
from pathlib import Path


def peak_memory_mb() -> float:
    try:
        import resource  # Linux / macOS

        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return peak / (1024 * 1024) if sys.platform == "darwin" else peak / 1024
    except ImportError:  # Windows
        import ctypes
        from ctypes import wintypes

        class Counters(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
                (name, ctypes.c_size_t)
                for name in (
                    "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage", "QuotaPagedPoolUsage",
                    "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage",
                )
            ]

        kernel32 = ctypes.WinDLL("kernel32")
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        read = kernel32.K32GetProcessMemoryInfo
        read.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
        read.restype = wintypes.BOOL
        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        read(kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb)
        return counters.PeakWorkingSetSize / (1024 * 1024)


def parse(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--rows", type=int, default=1_000_000)
    parser.add_argument("--employees", type=int, default=20)
    parser.add_argument("--existing", type=int, default=50_000, help="contacts that exist before the import (some of the sheet's numbers)")
    parser.add_argument("--invalid", type=float, default=0.01)
    parser.add_argument("--repeat", type=float, default=0.01)
    parser.add_argument("--xlsx", action="store_true", help="use an Excel file instead of CSV")
    parser.add_argument("--max-rss-mb", type=float, default=1500, help="fail when the process needs more memory than this")
    parser.add_argument("--max-endpoint-seconds", type=float, default=3.0, help="fail when a page of the panel takes longer than this")
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
    workdir = args.workdir or Path(tempfile.mkdtemp(prefix="scale-check-"))
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
    from sqlalchemy import func, insert, select

    from app.core.database import get_engine, new_session
    from app.core.security import hash_password
    from app.core.timeutils import utcnow
    from app.main import app
    from app.models.contact import Contact, ContactAssignment
    from app.models.employee import Employee, Role
    from app.models.imports import Import
    from app.schemas.distribution import DistributionIn
    from app.services import import_service
    from app.services.contact_service import build_search_text
    from app.services.reference_data import ensure_reference_data
    from scripts import make_big_sheet

    database = get_engine().url.database or ""
    if not any(word in database.lower() for word in ("test", "scale", "bench", "tmp", "temp")) and "sqlite" not in get_engine().url.drivername:
        raise SystemExit(f"Refusing to run on database '{database}': its name must say it is for tests (calling_test, calling_scale ...).")
    report = Report()
    report.line(f"Scale check: {args.rows:,} rows, {args.employees} employees, {args.existing:,} contacts before, on {get_engine().url.drivername} ({database})")

    # ------------------------------------------------------------------------------------------------ the organisation
    db = new_session()
    ensure_reference_data(db)
    admin_password = "Scale-Check-Admin-1!"
    roles = {r.name: r.id for r in db.scalars(select(Role))}
    admin = Employee(employee_code="SCADMIN", email="scale-admin@example.com", full_name="Scale Admin", password_hash=hash_password(admin_password), role_id=roles["admin"], daily_target=0)
    employees = [
        Employee(employee_code=f"SC{i:03d}", email=f"sc{i:03d}@example.com", full_name=f"Scale Employee {i:03d}", password_hash=hash_password(admin_password), role_id=roles["employee"], daily_target=50)
        for i in range(1, args.employees + 1)
    ]
    db.add_all([admin, *employees])
    db.commit()
    employee_ids = [e.id for e in employees]

    # ------------------------------------------------------------------------------------------------ the sheet
    started = time.perf_counter()
    suffix = "xlsx" if args.xlsx else "csv"
    sheet_path = workdir / f"sheet.{suffix}"
    expected = (make_big_sheet.write_xlsx if args.xlsx else make_big_sheet.write_csv)(sheet_path, args.rows, invalid=args.invalid, repeat=args.repeat)
    report.line(f"Sheet written: {sheet_path.stat().st_size / 1024 / 1024:,.1f} MB in {time.perf_counter() - started:.1f} s; expected {expected}")

    # contacts that exist before: some numbers of the sheet (they must be skipped), and some that are not in it at all
    started = time.perf_counter()
    stride = max(1, args.rows // max(1, args.existing))
    overlap = [make_big_sheet.number(i) for i in range(0, args.rows, stride)][: args.existing]
    # (an existing number that the sheet gives to a bad row would not be a duplicate; the ones chosen here are checked below)
    now = utcnow()
    rows = [
        {
            "name": f"Existing {n}", "phone_raw": n, "normalized_phone": "+91" + n, "priority": 2, "tags": [], "custom_fields": {},
            "search_text": build_search_text(name=f"Existing {n}", phone_raw=n, normalized_phone="+91" + n, email=None, location=None, category=None, tags=[], custom_fields={}),
            "status": "new", "source": "seed", "call_count": 0, "failed_attempts": 0, "created_at": now, "updated_at": now,
        }
        for n in overlap
    ]
    for i in range(0, len(rows), 5000):
        db.execute(insert(Contact.__table__), rows[i : i + 5000])
    db.commit()
    before_total = db.scalar(select(func.count(Contact.id))) or 0
    report.line(f"{before_total:,} contacts seeded in {time.perf_counter() - started:.1f} s")

    # ------------------------------------------------------------------------------------------------ the import
    with open(sheet_path, "rb") as handle:
        imp = import_service.create_import(
            db, upload=UploadFile(file=handle, filename=sheet_path.name), actor=admin, mode="skip", campaign_id=None, assign_employee_ids=[],
            assign_strategy="equal", default_priority=2, request=None,  # type: ignore[arg-type]
        )
    import_id = imp.id
    rss_after_upload = peak_memory_mb()

    started = time.perf_counter()
    ticker_stop = threading.Event()

    def ticker() -> None:
        probe = new_session()
        try:
            while not ticker_stop.wait(10):
                row = probe.execute(select(Import.status, Import.scanned_rows, Import.applied_rows, Import.valid_rows)).first()
                probe.rollback()
                report.line(f"    ... {row[0]}: read {row[1]:,}, added {row[2]:,}  (memory peak {peak_memory_mb():,.0f} MB)")
        finally:
            probe.close()

    threading.Thread(target=ticker, daemon=True).start()
    import_service.run_validation(import_id)
    check_seconds = time.perf_counter() - started
    db.expire_all()
    imp = db.get(Import, import_id)
    report.line(f"Checked in {check_seconds:.1f} s ({args.rows / check_seconds:,.0f} rows/s): status={imp.status} valid={imp.valid_rows:,} existing={imp.existing_rows:,} repeated={imp.file_duplicate_rows:,} invalid={imp.invalid_rows:,}")
    report.check(imp.status == "previewed", f"the check finished ({imp.error_message or 'previewed'})")
    if imp.status != "previewed":
        return finish(report)
    report.check(imp.total_rows == args.rows, f"all {args.rows:,} rows were read")
    report.check(imp.invalid_rows == expected["invalid"], f"invalid rows: {imp.invalid_rows:,} (expected {expected['invalid']:,})")
    report.check(imp.file_duplicate_rows == expected["repeated"], f"repeats inside the sheet: {imp.file_duplicate_rows:,} (expected {expected['repeated']:,})")
    new_expected = expected["unique"] - imp.existing_rows
    report.check(imp.valid_rows == new_expected and imp.valid_rows + imp.existing_rows == expected["unique"], f"new contacts: {imp.valid_rows:,} = {expected['unique']:,} unique numbers - {imp.existing_rows:,} that were contacts already")
    report.check(imp.existing_rows > 0 or args.existing == 0, f"the numbers that were contacts already were found ({imp.existing_rows:,})")

    plan = import_service.build_plan(db, imp, employee_ids=None, strategy="equal", order="interleave")
    report.check(plan.working == args.employees and plan.can_confirm, f"all {args.employees} employees are working in the plan")
    import_service.begin_apply(db, imp, admin, "skip", None, DistributionIn())  # type: ignore[arg-type]
    started = time.perf_counter()
    import_service.run_apply(import_id)
    apply_seconds = time.perf_counter() - started
    ticker_stop.set()
    db.expire_all()
    imp = db.get(Import, import_id)
    report.line(f"Added in {apply_seconds:.1f} s ({imp.valid_rows / max(apply_seconds, 0.001):,.0f} contacts/s): status={imp.status} inserted={imp.inserted_rows:,} given out={imp.assigned_rows:,}")
    report.check(imp.status == "completed", f"the adding finished ({imp.error_message or 'completed'})")
    after_total = db.scalar(select(func.count(Contact.id))) or 0
    report.check(after_total == before_total + imp.valid_rows, f"contacts now {after_total:,} = {before_total:,} before + {imp.valid_rows:,} new")
    distinct = db.scalar(select(func.count(func.distinct(Contact.normalized_phone)))) or 0
    report.check(distinct == after_total, f"no number is a contact twice ({distinct:,} different numbers in {after_total:,} contacts)")
    per = dict(db.execute(select(ContactAssignment.employee_id, func.count(ContactAssignment.id)).where(ContactAssignment.status == "active").group_by(ContactAssignment.employee_id)).all())
    counts = [per.get(i, 0) for i in employee_ids]
    report.check(sum(counts) == imp.valid_rows, f"every new contact has an owner ({sum(counts):,} of {imp.valid_rows:,})")
    report.check(max(counts) - min(counts) <= 1, f"equal sharing: {min(counts):,} to {max(counts):,} each (the most any of {args.employees} has over any other: {max(counts) - min(counts)})")

    # ------------------------------------------------------------------------------------------------ the rest of the system
    report.line("Pages with that many contacts:")
    with TestClient(app) as client:
        def login(identifier: str):
            body = {"identifier": identifier, "password": admin_password, "device": {"device_uid": "scale-device-0001", "name": "Scale Phone", "os_version": "14", "app_version": "1.0.0"}}
            response = client.post("/api/v1/auth/login", json=body)
            assert response.status_code == 200, response.text
            return {"Authorization": f"Bearer {response.json()['access_token']}"}

        admin_headers, employee_headers = login("scale-admin@example.com"), login("sc001@example.com")
        probes = [
            ("admin   dashboard", "/api/v1/dashboard", admin_headers),
            ("admin   contacts, first page", "/api/v1/contacts?page=1&page_size=50", admin_headers),
            ("admin   contacts, search by name", "/api/v1/contacts?q=Patil%20Aarav&page_size=50", admin_headers),
            ("admin   contacts, search by number", "/api/v1/contacts?q=600000123&page_size=50", admin_headers),
            ("admin   contacts, status=new", "/api/v1/contacts?status=new&page_size=50", admin_headers),
            ("admin   employees", "/api/v1/employees?page_size=100", admin_headers),
            ("admin   analytics overview", "/api/v1/analytics/overview", admin_headers),
            ("admin   live view", "/api/v1/analytics/live", admin_headers),
            ("admin   who is working", "/api/v1/distribution/overview", admin_headers),
            ("admin   rebalancing preview", "/api/v1/distribution/rebalance/preview", admin_headers),
            ("admin   imports", "/api/v1/contacts/import", admin_headers),
            ("phone   calling queue (first 100)", "/api/v1/queue?limit=100", employee_headers),
            ("phone   calling queue (page 40)", "/api/v1/queue?limit=100&offset=3900", employee_headers),
            ("phone   my dashboard", "/api/v1/dashboard", employee_headers),
        ]
        for label, path, headers in probes:
            times = []
            status = 0
            for attempt in range(3):
                begun = time.perf_counter()
                response = client.get(path, headers=headers) if path != "/api/v1/distribution/rebalance/preview" else client.post(path, headers=headers, json={})
                times.append(time.perf_counter() - begun)
                status = response.status_code
            slowest = max(times)
            ok = status in (200, 422) and slowest <= args.max_endpoint_seconds
            report.check(ok, f"{label:<36} {statistics.median(times) * 1000:>7.0f} ms median, {slowest * 1000:>7.0f} ms slowest  (HTTP {status})")
    peak = peak_memory_mb()
    report.line(f"Memory: {rss_after_upload:,.0f} MB after the upload, peak {peak:,.0f} MB")
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
