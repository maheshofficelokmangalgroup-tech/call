"""Load a sheet of contacts (CSV or Excel, any size) into the database and share it between the employees who are working.

It is the same pipeline as the admin panel (the same checks, the same duplicate rules, the same equal sharing) - without the browser
and without the upload limit of the web server, so it is the way to load a sheet of a million rows.

    python -m scripts.import_contacts contacts.csv                  # check the sheet and show the plan; nothing is added yet
    python -m scripts.import_contacts contacts.csv --yes            # check it, then add the contacts and give them out
    python -m scripts.import_contacts contacts.xlsx --employees 12,15,18 --strategy balance_total --yes
    python -m scripts.import_contacts contacts.csv --unassigned --yes      # add them without an owner

Without --yes the import stays "previewed": it can be confirmed from the admin panel (Contacts -> Import) within a few days, or
by running the command again with --yes on the same sheet (a number that is a contact by then is a duplicate and is skipped).
Ctrl+C asks the import to stop after the step it is in; what was added stays, and "Continue" in the panel does the rest.
"""

from __future__ import annotations

import argparse
import sys
import threading
import time
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy import select

from app.core.config import get_settings
from app.core.database import new_session
from app.models.employee import Employee, Role
from app.models.imports import IMPORT_APPLYING, IMPORT_COMPLETED, IMPORT_PREVIEWED, IMPORT_VALIDATING, Import
from app.schemas.distribution import DistributionIn
from app.services import import_service


def parse(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("file", type=Path, help="the .csv or .xlsx sheet (a header row with at least a name and a mobile number column)")
    parser.add_argument("--admin", help="email of the administrator the import is made in the name of (default: the first administrator)")
    parser.add_argument("--mode", choices=("skip", "update"), default="skip", help="a number that is a contact already: skip it (default) or update that contact")
    parser.add_argument("--employees", default="all", help="'all' (every employee who is working, default) or comma separated employee ids")
    parser.add_argument("--strategy", choices=("equal", "balance_total"), default="equal", help="equal: the same number for everybody (default); balance_total: even out the work")
    parser.add_argument("--order", choices=("interleave", "blocks"), default="interleave", help="interleave: everybody gets a mix of the sheet (default); blocks: a part each")
    parser.add_argument("--unassigned", action="store_true", help="add the contacts without giving them to anybody")
    parser.add_argument("--campaign", type=int, help="id of a campaign to add the contacts to")
    parser.add_argument("--priority", type=int, choices=(1, 2, 3), default=2, help="priority of rows that do not say (1 high, 2 medium, 3 low)")
    parser.add_argument("--yes", action="store_true", help="add the contacts after the check (without it only the check and the plan are done)")
    return parser.parse_args(argv)


def say(message: str = "") -> None:
    print(message, flush=True)


def find_admin(db, email: str | None) -> Employee:
    stmt = select(Employee).join(Role, Role.id == Employee.role_id).where(Role.name == "admin", Employee.is_active.is_(True)).order_by(Employee.id)
    if email:
        stmt = stmt.where(Employee.email == email.strip().lower())
    admin = db.scalars(stmt).first()
    if admin is None:
        raise SystemExit(f"No active administrator{' with the email ' + email if email else ''} was found.")
    return admin


def bar(done: int, total: int, started: float) -> str:
    share = (done / total) if total else 1.0
    rate = done / max(0.001, time.monotonic() - started)
    eta = f", about {int((total - done) / rate)} s left" if rate > 0 and done < total else ""
    return f"{done:>10,} / {total:,}  ({share * 100:5.1f}%)  {rate:,.0f} rows/s{eta}"


def check_line(imp: Import, started: float) -> str:
    rate = imp.scanned_rows / max(0.001, time.monotonic() - started)
    percent = f"{imp.progress_percent}%" if imp.progress_percent else ""
    return f"  checking: {imp.scanned_rows:>10,} rows read {percent:>5}  {rate:,.0f} rows/s  [{(imp.result or {}).get('stage', '')}]"


def watch(import_id: int, working: tuple[str, ...], line) -> None:
    """Print progress until the import leaves the given status(es)."""
    started = time.monotonic()
    while True:
        db = new_session()
        try:
            imp = db.get(Import, import_id)
            if imp.status not in working:
                return
            say(line(imp, started))
        finally:
            db.close()
        time.sleep(2)


def main(argv: list[str] | None = None) -> int:
    args = parse(argv)
    path: Path = args.file
    if not path.is_file() or path.suffix.lower() not in (".csv", ".xlsx"):
        raise SystemExit("Give the path of a .csv or .xlsx file.")
    employee_ids = [] if args.employees == "all" else [int(part) for part in args.employees.split(",") if part.strip()]
    db = new_session()
    try:
        admin = find_admin(db, args.admin)
        say(f"Reading {path.name} ({path.stat().st_size / 1024 / 1024:,.1f} MB) as {admin.email} ...")
        with open(path, "rb") as handle:
            imp = import_service.create_import(
                db, upload=UploadFile(file=handle, filename=path.name), actor=admin, mode=args.mode, campaign_id=args.campaign,
                assign_employee_ids=employee_ids, assign_strategy=args.strategy, default_priority=args.priority, request=None,  # type: ignore[arg-type]
            )
        import_id = imp.id
        runner = threading.Thread(target=import_service.run_validation, args=(import_id,), daemon=True)
        runner.start()
        watch(import_id, (IMPORT_VALIDATING,), check_line)
        runner.join()
        db.expire_all()
        imp = db.get(Import, import_id)
        if imp.status != IMPORT_PREVIEWED:
            say(f"\nThe sheet was not accepted: {imp.error_message or imp.status}")
            return 1
        say(
            f"\nChecked {imp.total_rows:,} rows in {(imp.result or {}).get('check_seconds', '?')} s:\n"
            f"  {imp.valid_rows:>10,}  new contacts to add\n"
            f"  {imp.existing_rows:>10,}  numbers that are contacts already (skipped)\n"
            f"  {imp.file_duplicate_rows:>10,}  the same number twice in the sheet (skipped)\n"
            f"  {imp.invalid_rows:>10,}  rows with a problem (not added; the list is in the report)"
        )
        plan = import_service.build_plan(
            db, imp, employee_ids=employee_ids or None, strategy=args.strategy, order=args.order, leave_unassigned=args.unassigned
        )
        say(f"\nPlan: {plan.to_distribute:,} contacts to give out ({plan.strategy}, {plan.order}); an employee counts as working if seen in the last {plan.inactive_after_days} day(s).")
        for e in plan.employees:
            if e.selected:
                say(f"  {e.employee_code:<10} {e.full_name:<28} {e.state:<12} {('gets ' + format(e.planned, ',')) if e.receives else 'gets nothing (' + e.reason.rstrip('.').lower() + ')'}")
        for warning in plan.warnings:
            say(f"  ! {warning}")
        if not plan.can_confirm:
            say("\nNothing can be added until somebody is working (or use --unassigned).")
            return 1
        report = import_service.issues_file(imp)
        if report is not None:
            say(f"\nReport of the rows that were not added: {report}")
        if not args.yes:
            say(f"\nNothing was added. Add them with:  --yes   (or press 'Add' on import {import_id} in the admin panel).")
            return 0

        distribution = DistributionIn(strategy=args.strategy, order=args.order, employee_ids=employee_ids or None, leave_unassigned=args.unassigned)
        import_service.begin_apply(db, imp, admin, args.mode, None, distribution)  # type: ignore[arg-type]
        say("\nAdding the contacts ...")
        applier = threading.Thread(target=import_service.run_apply, args=(import_id,), daemon=True)
        applier.start()
        try:
            watch(import_id, (IMPORT_APPLYING,), lambda i, started: f"  adding:   {bar(i.applied_rows, i.valid_rows, started)}")
        except KeyboardInterrupt:
            say("\nStopping after the step that is running (what was added stays) ...")
            db.expire_all()
            db.get(Import, import_id).cancel_requested = True
            db.commit()
        applier.join()
        db.expire_all()
        imp = db.get(Import, import_id)
        say(f"\n{imp.status.upper()}: {imp.inserted_rows:,} added, {imp.updated_rows:,} updated, {imp.skipped_rows:,} skipped, {imp.assigned_rows:,} given out.")
        if imp.error_message:
            say(imp.error_message)
        for row in (imp.result or {}).get("employees", []):
            say(f"  {row['employee_code']:<10} {row['full_name']:<28} {row['count']:>10,}")
        return 0 if imp.status == IMPORT_COMPLETED else 1
    finally:
        db.close()


if __name__ == "__main__":  # pragma: no cover
    get_settings()
    sys.exit(main())
