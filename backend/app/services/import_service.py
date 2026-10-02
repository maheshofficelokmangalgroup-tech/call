"""Importing contacts from a sheet of any size - ten rows or a million - and sharing them equally between the people who are working.

  upload   the file is stored (private folder, size limits, free disk checked); a background job then checks it      validating
  check    row by row, never the whole file in memory:
             valid rows       -> valid.jsonl
             the number is already a contact -> existing.jsonl       (compared in batches against a unique index)
             anything wrong / the same number twice in the sheet -> issues.csv  (the whole list; the first rows also in the database
             for the preview)                                                                                        previewed
  plan     who is working right now and how many each of them would get (activity.py, distribution.py)
  confirm  the plan is frozen: the people who are working at this moment and the exact number for each        applying
  apply    2,000 rows per database transaction. The transaction also moves the resume point, so a crash or a restart only delays the
           work: the next runner goes on exactly where the last one stopped. Contacts are inserted with "ignore when the number is
           there" - the unique index decides, so a duplicate can never get in, whatever else is going on.         completed

Who runs a step is decided in the database (a lease that has to be renewed every few seconds), so exactly one runner works on an
import at any time, and a runner that lost its lease stops at its next step without having written anything more.
"""

from __future__ import annotations

import csv
import json
import logging
import os
import shutil
import threading
import time
import uuid
from collections import Counter
from collections.abc import Iterator
from contextlib import closing
from datetime import timedelta
from itertools import islice
from pathlib import Path
from typing import Any

from fastapi import Request, UploadFile
from sqlalchemy import delete, func, insert, or_, select, update
from sqlalchemy.orm import Session

from app.core import cache
from app.core.config import get_settings
from app.core.database import new_session
from app.core.dbutil import insert_ignore, retry_transient
from app.core.errors import AppError, Conflict, NotFound, PayloadTooLarge, ValidationFailed
from app.core.timeutils import utcnow
from app.models.cache_events import EVERYONE, QUIET, employee_epoch
from app.models.contact import Campaign, CampaignContact, Contact, ContactAssignment
from app.models.employee import ROLE_EMPLOYEE, Employee
from app.models.imports import (
    IMPORT_APPLYING,
    IMPORT_CANCELLED,
    IMPORT_COMPLETED,
    IMPORT_FAILED,
    IMPORT_PREVIEWED,
    IMPORT_VALIDATING,
    ROW_DUPLICATE,
    ROW_INVALID,
    ROW_VALID,
    Import,
    ImportRow,
)
from app.schemas.distribution import DistributionIn, ImportPlanOut, PlanEmployee
from app.services import activity, audit_service, workload
from app.services.contact_service import build_search_text, refresh_search_text
from app.services.distribution import ORDERS, STRATEGIES, Recipient, Schedule, quotas
from app.services.import_files import SheetError, open_sheet
from app.services.import_rows import map_headers, validate_row
from app.services.notification_service import notify

log = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {".csv", ".xlsx"}
SOURCE, VALID, EXISTING, ISSUES = "source", "valid.jsonl", "existing.jsonl", "issues.csv"
LOOKUP_BATCH = 1000  # numbers compared with the contacts in one query
VALID_SAMPLE = 200  # valid rows kept in the database for the preview
MAX_ATTEMPTS = 5  # a job that has been taken over this many times (it keeps crashing) is given up
LEGACY_STRATEGIES = {"round_robin": "equal", "balanced": "balance_total"}  # what the first version of the API called them
_heavy = threading.Semaphore(1)  # one sheet at a time is read in this process (a million numbers are kept in memory while it is checked)
_queued: set[tuple[str, int]] = set()  # jobs of this process that are running or waiting for their turn
_queued_lock = threading.Lock()


class _Lost(Exception):
    """This runner no longer owns the import (another one took it over, or it was cancelled)."""


class _Stopped(Exception):
    """An administrator asked the import to stop."""


# ------------------------------------------------------------------------------------------------------------- files
def _root() -> Path:
    path = Path(get_settings().import_storage_path)
    path.mkdir(parents=True, exist_ok=True)
    return path


def import_dir(imp: Import) -> Path:
    return Path(imp.file_path).parent


def _file(imp: Import, name: str) -> Path:
    return import_dir(imp) / name


def _inside_root(path: Path) -> bool:
    try:
        return path.resolve().is_relative_to(_root().resolve())
    except OSError:  # pragma: no cover
        return False


def remove_files(imp: Import, *, keep_issues: bool = False) -> None:
    """Delete what an import left on disk (never anything outside the import folder)."""
    folder = import_dir(imp)
    try:
        if folder.resolve() == _root().resolve():  # an import of the first version: one loose file
            Path(imp.file_path).unlink(missing_ok=True)
            return
        if not folder.is_dir() or not _inside_root(folder):
            return
        for child in folder.iterdir():
            if keep_issues and child.name == ISSUES:
                continue
            child.unlink(missing_ok=True)
        if not keep_issues:
            folder.rmdir()
    except OSError:  # pragma: no cover
        log.warning("Could not delete the files of import %s", imp.id, exc_info=True)


def save_upload(upload: UploadFile) -> tuple[Path, str, int]:
    settings = get_settings()
    filename = os.path.basename(upload.filename or "upload")
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValidationFailed("Only .csv and .xlsx files can be imported.", code="unsupported_file_type")
    folder = _root() / uuid.uuid4().hex
    folder.mkdir(parents=True)
    target = folder / f"{SOURCE}{ext}"
    limit = settings.max_import_mb * 1024 * 1024
    no_room = AppError(
        "The server does not have enough free disk space for this file. Tell the person who runs the server.", code="disk_full", status_code=507
    )
    size = 0
    try:
        with open(target, "wb") as out:
            while True:
                chunk = upload.file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > limit:
                    raise PayloadTooLarge(f"File is larger than {settings.max_import_mb} MB.", code="file_too_large")
                out.write(chunk)
        if size == 0:
            raise ValidationFailed("The uploaded file is empty.", code="empty_file")
        # the file itself, what is made of it (valid lines, a second copy while they are compared, the report) and room for the rest
        if shutil.disk_usage(folder).free < size * 5 + 256 * 1024 * 1024:
            raise no_room
    except OSError as exc:
        shutil.rmtree(folder, ignore_errors=True)
        if getattr(exc, "errno", None) == 28:  # ENOSPC
            raise no_room from exc
        raise
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    return target, ext.lstrip("."), size


# --------------------------------------------------------------------------------------------------- the lease
def _new_owner() -> str:
    return f"{os.getpid()}-{threading.get_ident()}-{uuid.uuid4().hex[:8]}"


def _claim(db: Session, import_id: int, status: str, owner: str) -> bool:
    """Become the runner of this import - when nobody is, or the one that was has not reported for a while."""
    now = utcnow()
    stale = now - timedelta(seconds=get_settings().import_lease_seconds)
    claimed = db.execute(
        update(Import)
        .where(
            Import.id == import_id,
            Import.status == status,
            or_(Import.lease_owner.is_(None), Import.heartbeat_at.is_(None), Import.heartbeat_at < stale),
        )
        .values(lease_owner=owner, heartbeat_at=now, attempts=Import.attempts + 1),
        execution_options={"synchronize_session": False},
    )
    db.commit()
    return bool(claimed.rowcount)


def _beat(db: Session, import_id: int, owner: str, status: str, **values: Any) -> None:
    """Report progress and renew the lease. Raises when the lease is gone or an administrator asked to stop."""
    updated = db.execute(
        update(Import)
        .where(Import.id == import_id, Import.lease_owner == owner, Import.status == status)
        .values(heartbeat_at=utcnow(), **values),
        execution_options={"synchronize_session": False},
    )
    if not updated.rowcount:
        db.rollback()
        raise _Lost()
    wanted = db.scalar(select(Import.cancel_requested).where(Import.id == import_id))
    db.commit()
    if wanted:
        raise _Stopped()


def _fail(db: Session, import_id: int, message: str, *, keep_files: bool = False) -> None:
    db.rollback()
    imp = db.get(Import, import_id)
    if imp is None:
        return
    db.refresh(imp)
    if imp.status in (IMPORT_VALIDATING, IMPORT_APPLYING):  # (an import that was cancelled in the meantime stays cancelled)
        imp.status = IMPORT_FAILED
        imp.error_message = message[:2000]
        imp.lease_owner = None
        db.commit()
    if not keep_files:
        remove_files(imp)


# ------------------------------------------------------------------------------------------------------- create
def _clean_strategy(value: str) -> str:
    strategy = LEGACY_STRATEGIES.get(value, value)
    if strategy not in STRATEGIES:
        raise ValidationFailed("assign_strategy must be 'equal' or 'balance_total'.", code="bad_strategy")
    return strategy


def create_import(
    db: Session,
    *,
    upload: UploadFile,
    actor: Employee,
    mode: str,
    campaign_id: int | None,
    assign_employee_ids: list[int],
    assign_strategy: str,
    default_priority: int,
    request: Request,
) -> Import:
    if mode not in ("skip", "update"):
        raise ValidationFailed("mode must be 'skip' or 'update'.", code="bad_mode")
    strategy = _clean_strategy(assign_strategy)
    if default_priority not in (1, 2, 3):
        raise ValidationFailed("default_priority must be 1, 2 or 3.", code="bad_priority")
    if campaign_id is not None and db.get(Campaign, campaign_id) is None:
        raise ValidationFailed("Campaign does not exist.", code="unknown_campaign")

    path, file_type, size = save_upload(upload)
    imp = Import(
        created_by=actor.id,
        filename=os.path.basename(upload.filename or "upload")[:255],
        file_type=file_type,
        file_path=str(path),
        file_size=size,
        mode=mode,
        status=IMPORT_VALIDATING,
        campaign_id=campaign_id,
        options={"assign_employee_ids": assign_employee_ids, "assign_strategy": strategy, "default_priority": default_priority},
        result={"stage": "waiting"},
    )
    db.add(imp)
    db.flush()
    audit_service.record(
        db, action="import.upload", actor=actor, entity_type="import", entity_id=imp.id, request=request,
        details={"filename": imp.filename, "size": size, "mode": mode},
    )
    db.commit()
    return imp


# ----------------------------------------------------------------------------------------------------- the check
def _json_line(row: dict[str, Any]) -> str:
    return json.dumps({k: v for k, v in row.items() if v not in (None, "", [], {})}, ensure_ascii=False, separators=(",", ":"))


def _employee_lookup(db: Session) -> dict[str, int]:
    found: dict[str, int] = {}
    for emp_id, code, email in db.execute(select(Employee.id, Employee.employee_code, Employee.email).where(Employee.is_active.is_(True))):
        found[code.lower()] = emp_id
        found[email.lower()] = emp_id
    return found


def _csv_safe(value: Any) -> str:
    text = "" if value is None else str(value)
    if text[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + text  # neutralise spreadsheet formula injection
    return text


def _scan(db: Session, imp: Import, owner: str) -> dict[str, Any]:
    """Pass 1: read the sheet row by row."""
    settings = get_settings()
    employees = _employee_lookup(db)
    default_priority = int((imp.options or {}).get("default_priority", 2))
    seen: set[int | str] = set()
    counts: dict[str, Any] = {"total": 0, "valid": 0, "invalid": 0, "file_duplicates": 0}
    issue_rows: list[dict[str, Any]] = []
    stored_issues = 0
    last_beat = time.monotonic()
    folder = import_dir(imp)

    with open_sheet(Path(imp.file_path), imp.file_type) as sheet:
        counts["headers"] = list(sheet.headers)
        canonical, custom = map_headers(sheet.headers)
        if "phone" not in canonical.values():
            raise SheetError("No mobile number column found. Name a column 'Mobile' or 'Phone'.")
        if "name" not in canonical.values():
            raise SheetError("No name column found. Name a column 'Name'.")
        db.execute(delete(ImportRow).where(ImportRow.import_id == imp.id))  # a fresh start (this is a second try, or a takeover)
        db.commit()
        with open(folder / VALID, "w", encoding="utf-8", newline="\n") as valid_file, open(folder / ISSUES, "w", encoding="utf-8", newline="") as issues_file:
            issues = csv.writer(issues_file)
            issues.writerow(["row_number", "status", "problem", *[_csv_safe(h) for h in sheet.headers]])
            for row_number, cells in sheet.rows():
                counts["total"] += 1
                if counts["total"] > settings.max_import_rows:
                    raise SheetError(f"The sheet has more than {settings.max_import_rows:,} rows. Split it into smaller files.")
                result = validate_row(row_number, cells, canonical, custom, default_priority=default_priority, employees=employees)
                problem: str | None = None
                status = ROW_INVALID
                if result.status == ROW_VALID:
                    digits = (result.normalized_phone or "").lstrip("+")
                    key: int | str = int(digits) if digits.isdigit() else digits
                    if key in seen:
                        counts["file_duplicates"] += 1
                        problem, status = "Same mobile number as an earlier row of this sheet.", ROW_DUPLICATE
                    else:
                        seen.add(key)
                        counts["valid"] += 1
                        data = result.data
                        valid_file.write(
                            _json_line(
                                {
                                    "r": row_number, "n": data["name"], "p": data["phone_raw"], "m": result.normalized_phone, "e": data["email"],
                                    "l": data["location"], "c": data["category"], "pr": data["priority"], "t": data["tags"],
                                    "cf": data["custom_fields"], "a": data["assigned_employee_id"],
                                }
                            )
                            + "\n"
                        )
                else:
                    counts["invalid"] += 1
                    problem = "; ".join(result.errors)
                if problem is not None:
                    issues.writerow([row_number, status, _csv_safe(problem), *[_csv_safe(c) for c in cells]])
                    if stored_issues < settings.import_issue_sample:
                        stored_issues += 1
                        issue_rows.append(
                            {
                                "import_id": imp.id, "row_number": row_number, "status": status,
                                "duplicate_of": "file" if status == ROW_DUPLICATE else None, "normalized_phone": result.normalized_phone,
                                "data": result.data, "errors": [problem],
                            }
                        )
                if counts["total"] % 2000 == 0 or time.monotonic() - last_beat > 3:
                    last_beat = time.monotonic()
                    if issue_rows:
                        db.execute(insert(ImportRow), issue_rows)
                        issue_rows = []
                    _beat(
                        db, imp.id, owner, IMPORT_VALIDATING,
                        scanned_rows=counts["total"], progress_percent=sheet.progress() or 0,
                        result={"stage": "reading"},
                    )
    if issue_rows:
        db.execute(insert(ImportRow), issue_rows)
        db.commit()
    counts["stored_issues"] = stored_issues
    return counts


def _read_lines(path: Path, skip: int = 0) -> Iterator[dict[str, Any]]:
    with open(path, encoding="utf-8") as handle:
        for line in islice(handle, skip, None):
            yield json.loads(line)


def _original_cells(headers_by_position: dict[int, str], width: int, row: dict[str, Any]) -> list[str]:
    """Rebuild the cells of a row from what was read of it (for the report of rows that are already contacts)."""
    cells = [""] * width
    by_key = {"name": row.get("n"), "phone": row.get("p"), "email": row.get("e"), "location": row.get("l"), "category": row.get("c"),
              "priority": row.get("pr"), "tags": ", ".join(row.get("t") or [])}
    custom = row.get("cf") or {}
    for idx, key in headers_by_position.items():
        if idx < width:
            cells[idx] = str(by_key[key] if key in by_key and by_key[key] is not None else custom.get(key, ""))
    return cells


def _compare(db: Session, imp: Import, owner: str, counts: dict[str, Any], headers: list[str]) -> None:
    """Pass 2: which numbers are already contacts. Writes the final valid.jsonl (new numbers) and existing.jsonl (the others)."""
    settings = get_settings()
    folder = import_dir(imp)
    canonical, custom = map_headers(headers)
    positions = {idx: key for idx, key in canonical.items()} | {idx: name for idx, name in custom.items()}
    explicit_by_employee: Counter[int] = Counter()
    existing_rows = new_rows = restored = explicit = 0
    stored_issues = int(counts.get("stored_issues", 0))
    next_index = 0
    sample: list[dict[str, Any]] = []
    issue_rows: list[dict[str, Any]] = []
    batch: list[dict[str, Any]] = []

    def flush(handle_valid: Any, handle_existing: Any, issues: csv.writer) -> None:
        nonlocal existing_rows, new_rows, restored, explicit, next_index, stored_issues
        if not batch:
            return
        found = {
            phone: (contact_id, deleted_at is not None)
            for contact_id, phone, deleted_at in db.execute(
                select(Contact.id, Contact.normalized_phone, Contact.deleted_at).where(Contact.normalized_phone.in_([row["m"] for row in batch]))
            )
        }
        for row in batch:
            hit = found.get(row["m"])
            if hit and not hit[1]:  # a contact that is there and alive: this row is a duplicate
                existing_rows += 1
                handle_existing.write(_json_line({**row, "id": hit[0]}) + "\n")
                issues.writerow([row["r"], ROW_DUPLICATE, "Mobile number already exists in contacts.", *[_csv_safe(c) for c in _original_cells(positions, len(headers), row)]])
                if stored_issues < settings.import_issue_sample:
                    stored_issues += 1
                    issue_rows.append(
                        {
                            "import_id": imp.id, "row_number": row["r"], "status": ROW_DUPLICATE, "duplicate_of": "existing",
                            "normalized_phone": row["m"], "contact_id": hit[0], "errors": ["Mobile number already exists in contacts."],
                            "data": _row_data(row),
                        }
                    )
                continue
            if hit:  # it was deleted once: the import brings it back
                row["u"] = hit[0]
                restored += 1
            if row.get("a"):
                explicit += 1
                explicit_by_employee[row["a"]] += 1
            else:
                row["x"] = next_index  # the number that decides, with the plan, who receives this contact
                next_index += 1
            new_rows += 1
            handle_valid.write(_json_line(row) + "\n")
            if len(sample) < VALID_SAMPLE:
                sample.append({"import_id": imp.id, "row_number": row["r"], "status": ROW_VALID, "normalized_phone": row["m"], "data": _row_data(row)})
        batch.clear()

    final_valid = folder / "valid.next"
    with open(final_valid, "w", encoding="utf-8", newline="\n") as handle_valid, open(folder / EXISTING, "w", encoding="utf-8", newline="\n") as handle_existing, open(
        folder / ISSUES, "a", encoding="utf-8", newline=""
    ) as issues_file:
        issues = csv.writer(issues_file)
        done = 0
        with closing(_read_lines(folder / VALID)) as rows:
            for row in rows:
                batch.append(row)
                if len(batch) >= LOOKUP_BATCH:
                    flush(handle_valid, handle_existing, issues)
                    done += LOOKUP_BATCH
                    if issue_rows:
                        db.execute(insert(ImportRow), issue_rows)
                        issue_rows = []
                    _beat(db, imp.id, owner, IMPORT_VALIDATING, result={"stage": "comparing", "compared": done})
        flush(handle_valid, handle_existing, issues)
    os.replace(final_valid, folder / VALID)
    if issue_rows:
        db.execute(insert(ImportRow), issue_rows)
    if sample:
        db.execute(insert(ImportRow), sample)
    db.commit()
    counts.update(
        valid=new_rows, existing=existing_rows, restored=restored, explicit=explicit, to_distribute=next_index,
        explicit_by_employee={str(k): v for k, v in explicit_by_employee.items()},
    )


def _row_data(row: dict[str, Any]) -> dict[str, Any]:
    """A row of valid.jsonl / existing.jsonl as the contact fields it stands for."""
    return {
        "name": row.get("n"), "phone_raw": row.get("p"), "email": row.get("e"), "location": row.get("l"), "category": row.get("c"),
        "priority": row.get("pr", 2), "tags": row.get("t") or [], "custom_fields": row.get("cf") or {}, "assigned_employee_id": row.get("a"),
    }


def run_validation(import_id: int) -> None:
    """Background job: check the sheet and leave the import `previewed` (or `failed`, with the reason)."""
    key = ("check", import_id)
    with _queued_lock:
        if key in _queued:
            return
        _queued.add(key)
    owner = _new_owner()
    db = new_session()
    try:
        with _heavy:
            if not _claim(db, import_id, IMPORT_VALIDATING, owner):
                return
            try:
                _validate(db, import_id, owner)
            except (_Lost, _Stopped):
                db.rollback()
                _cancelled_while_running(db, import_id)
            except SheetError as exc:
                log.info("Import %s cannot be read: %s", import_id, exc.message)
                _fail(db, import_id, exc.message)
            except Exception as exc:  # noqa: BLE001
                log.exception("Checking import %s failed", import_id)
                _fail(db, import_id, f"The check stopped because of a problem on the server ({exc.__class__.__name__}). Upload the file again; if it happens again, tell the person who runs the server.")
    finally:
        db.close()
        with _queued_lock:
            _queued.discard(key)


def _cancelled_while_running(db: Session, import_id: int) -> None:
    imp = db.get(Import, import_id)
    if imp is not None and imp.status == IMPORT_CANCELLED:
        remove_files(imp)


def _validate(db: Session, import_id: int, owner: str) -> None:
    imp = db.get(Import, import_id)
    if imp is None:
        return
    started = time.monotonic()
    counts = _scan(db, imp, owner)
    _beat(db, imp.id, owner, IMPORT_VALIDATING, scanned_rows=counts["total"], progress_percent=100, result={"stage": "comparing", "compared": 0})
    _compare(db, imp, owner, counts, counts["headers"])
    seconds = round(time.monotonic() - started, 1)
    done = db.execute(
        update(Import)
        .where(Import.id == imp.id, Import.lease_owner == owner, Import.status == IMPORT_VALIDATING)
        .values(
            status=IMPORT_PREVIEWED, error_message=None, lease_owner=None, heartbeat_at=utcnow(), progress_percent=100,
            total_rows=counts["total"], scanned_rows=counts["total"], valid_rows=counts["valid"], invalid_rows=counts["invalid"],
            file_duplicate_rows=counts["file_duplicates"], existing_rows=counts["existing"], explicit_rows=counts["explicit"],
            duplicate_rows=counts["file_duplicates"] + counts["existing"],
            result={
                "stage": "ready", "to_distribute": counts["to_distribute"], "restored": counts["restored"],
                "explicit_by_employee": counts["explicit_by_employee"], "check_seconds": seconds,
            },
        ),
        execution_options={"synchronize_session": False},
    )
    if not done.rowcount:
        db.rollback()
        raise _Lost()
    db.commit()
    log.info("Import %s checked: %s rows in %.1fs (%s new, %s existing, %s invalid, %s repeated)", imp.id, counts["total"], seconds, counts["valid"], counts["existing"], counts["invalid"], counts["file_duplicates"])


# --------------------------------------------------------------------------------------------------------- reading
def get_import(db: Session, import_id: int) -> Import:
    imp = db.get(Import, import_id)
    if imp is None:
        raise NotFound("Import not found.")
    return imp


def list_imports(db: Session, *, page: int, page_size: int) -> tuple[list[Import], int]:
    total = db.scalar(select(func.count(Import.id))) or 0
    rows = db.scalars(select(Import).order_by(Import.created_at.desc(), Import.id.desc()).limit(page_size).offset((page - 1) * page_size)).all()
    return list(rows), total


def list_rows(db: Session, import_id: int, *, status: str | None, page: int, page_size: int) -> tuple[list[ImportRow], int]:
    stmt = select(ImportRow).where(ImportRow.import_id == import_id)
    if status:
        stmt = stmt.where(ImportRow.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(ImportRow.row_number).limit(page_size).offset((page - 1) * page_size)).all()
    return list(rows), total


def issues_file(imp: Import) -> Path | None:
    path = _file(imp, ISSUES)
    return path if path.is_file() and _inside_root(path) else None


def export_issues_csv(db: Session, imp: Import) -> str:
    """The problem rows kept in the database (what an import of the first version, whose file is gone, has)."""
    import io

    out = io.StringIO()
    writer = csv.writer(out)
    rows = db.scalars(
        select(ImportRow).where(ImportRow.import_id == imp.id, ImportRow.status.in_((ROW_INVALID, ROW_DUPLICATE))).order_by(ImportRow.row_number)
    ).all()
    columns: list[str] = []
    for r in rows:
        for key in r.data or {}:
            if key not in columns and key not in ("assigned_employee_id", "existing_contact_id", "restore_contact_id"):
                columns.append(key)
    writer.writerow(["row_number", "status", "problem", *columns])
    for r in rows:
        writer.writerow([r.row_number, r.status, _csv_safe("; ".join(r.errors or [])), *[_csv_safe((r.data or {}).get(c)) for c in columns]])
    return out.getvalue()


# ----------------------------------------------------------------------------------------------------- the plan
def build_plan(
    db: Session, imp: Import, *, employee_ids: list[int] | None, strategy: str, order: str, leave_unassigned: bool = False
) -> ImportPlanOut:
    """Who would receive how many. The same numbers are frozen when the import is confirmed."""
    if strategy not in STRATEGIES:
        raise ValidationFailed("strategy must be 'equal' or 'balance_total'.", code="bad_strategy")
    if order not in ORDERS:
        raise ValidationFailed("order must be 'interleave' or 'blocks'.", code="bad_order")
    result = imp.result or {}
    to_distribute = int(result.get("to_distribute", max(0, imp.valid_rows - imp.explicit_rows)))
    explicit_by_employee = {int(k): int(v) for k, v in (result.get("explicit_by_employee") or {}).items()}
    everybody = activity.employee_states(db, role=None, with_counts=True)  # (an administrator may also choose a manager by name)
    chosen = set(employee_ids or [])
    unknown = chosen - {s.employee_id for s in everybody}
    if unknown:
        raise ValidationFailed(f"Unknown employee id(s): {sorted(unknown)[:5]}.", code="unknown_employee")
    # the screen lists every employee, so it can show who is left out and why; nobody chosen means all of them
    states = [s for s in everybody if s.role == ROLE_EMPLOYEE or s.employee_id in chosen]
    selected = [s for s in states if not chosen or s.employee_id in chosen]
    receiving = [] if leave_unassigned else [s for s in selected if s.working]
    loads = {s.employee_id: s.assigned for s in receiving}
    pending: dict[int, int] = {}
    if strategy == "balance_total" and receiving:
        pending = workload.pending_counts(db, [s.employee_id for s in receiving])
        loads = pending
    planned: dict[int, int] = {}
    if receiving and to_distribute:
        planned = quotas(strategy, to_distribute, [Recipient(s.employee_id, loads.get(s.employee_id, 0)) for s in receiving])
    warnings: list[str] = []
    if leave_unassigned and to_distribute:
        warnings.append(f"{to_distribute:,} contacts will be added without an owner.")
    elif to_distribute and not receiving:
        warnings.append("Nobody is working right now, so nobody can receive the contacts. Wait until somebody has signed in, or choose to leave them unassigned.")
    left_out = [s for s in selected if not s.working]
    if left_out and not leave_unassigned:
        names = ", ".join(f"{s.full_name} ({s.reason.rstrip('.').lower()})" for s in left_out[:5]) + (f" and {len(left_out) - 5} more" if len(left_out) > 5 else "")
        warnings.append(f"{len(left_out)} employee{'s are' if len(left_out) != 1 else ' is'} not working and get{'' if len(left_out) != 1 else 's'} nothing: {names}.")
    not_working_named = [s for s in states if not s.working and explicit_by_employee.get(s.employee_id)]
    for s in not_working_named:
        warnings.append(f"{explicit_by_employee[s.employee_id]:,} rows name {s.full_name}, who is not working ({s.reason.rstrip('.')}). They keep what the sheet says; the rebalancing moves it later.")
    employees = [
        PlanEmployee(
            employee_id=s.employee_id, employee_code=s.employee_code, full_name=s.full_name, team_name=s.team_name, state=s.state,
            reason=s.reason, last_active_at=s.last_active_at, assigned=s.assigned, pending=pending.get(s.employee_id),
            selected=s in selected, receives=s in receiving, planned=planned.get(s.employee_id, 0), explicit=explicit_by_employee.get(s.employee_id, 0),
        )
        for s in states
    ]
    return ImportPlanOut(
        import_id=imp.id, strategy=strategy, order=order, to_distribute=to_distribute, explicit=imp.explicit_rows,
        inactive_after_days=activity.inactive_after_days(db), working=len(receiving), left_out=len(left_out), leave_unassigned=leave_unassigned,
        employees=employees, warnings=warnings, can_confirm=bool(leave_unassigned or not to_distribute or receiving),
    )


# ---------------------------------------------------------------------------------------------------- confirm
def _choose_distribution(imp: Import, distribution: DistributionIn | None) -> DistributionIn:
    if distribution is not None:
        return distribution
    options = imp.options or {}
    return DistributionIn(strategy=options.get("assign_strategy", "equal"), employee_ids=options.get("assign_employee_ids") or None)


def begin_apply(db: Session, imp: Import, actor: Employee, mode: str | None, request: Request, distribution: DistributionIn | None = None) -> Import:
    if mode is not None and mode not in ("skip", "update"):
        raise ValidationFailed("mode must be 'skip' or 'update'.", code="bad_mode")
    if imp.status != IMPORT_PREVIEWED:
        raise Conflict(f"Only a previewed import can be confirmed (current status: {imp.status}).", code="bad_import_state")
    chosen = _choose_distribution(imp, distribution)
    plan = build_plan(db, imp, employee_ids=chosen.employee_ids, strategy=chosen.strategy, order=chosen.order, leave_unassigned=chosen.leave_unassigned)
    if not plan.can_confirm:
        raise ValidationFailed(plan.warnings[0] if plan.warnings else "Nobody can receive the contacts.", code="no_working_employees")
    frozen = {
        "strategy": chosen.strategy, "order": chosen.order, "leave_unassigned": chosen.leave_unassigned,
        "total": plan.to_distribute if plan.working else 0,
        "quotas": {str(e.employee_id): e.planned for e in plan.employees if e.receives and e.planned > 0},
        "recipients": [e.employee_id for e in plan.employees if e.receives],
    }
    options = dict(imp.options or {})
    options.update(distribution=frozen, confirmed_by=actor.id)
    claimed = db.execute(
        update(Import)
        .where(Import.id == imp.id, Import.status == IMPORT_PREVIEWED)
        .values(
            status=IMPORT_APPLYING, confirmed_at=utcnow(), mode=mode or imp.mode, options=options, applied_rows=0, applied_existing=0,
            distributed_rows=0, inserted_rows=0, updated_rows=0, skipped_rows=0, assigned_rows=0, attempts=0, cancel_requested=False,
            lease_owner=None, heartbeat_at=None, error_message=None, result={"stage": "applying", "per_employee": {}, "skipped_existing_owner": 0},
        ),
        execution_options={"synchronize_session": False},
    )
    if not claimed.rowcount:
        db.rollback()
        raise Conflict("This import is already being processed.", code="bad_import_state")
    busy = db.scalar(select(Import.id).where(Import.status == IMPORT_APPLYING, Import.id != imp.id).limit(1))
    if busy is not None:
        db.rollback()
        raise Conflict(f"Import {busy} is being added right now. Wait until it is finished, then confirm this one.", code="import_busy")
    audit_service.record(
        db, action="import.confirm", actor=actor, entity_type="import", entity_id=imp.id, request=request,
        details={
            "mode": mode or imp.mode, "strategy": chosen.strategy, "order": chosen.order, "leave_unassigned": chosen.leave_unassigned,
            "receivers": len(frozen["recipients"]), "to_distribute": plan.to_distribute, "quotas": frozen["quotas"],
        },
    )
    db.commit()
    db.refresh(imp)
    return imp


def retry_apply(db: Session, imp: Import, actor: Employee, request: Request) -> Import:
    """Carry on with an import that stopped half way (the contacts already added stay; the rest follows)."""
    if imp.status != IMPORT_FAILED or imp.confirmed_at is None or not _file(imp, VALID).is_file():
        raise Conflict("Only an import that stopped while adding the contacts can be continued.", code="bad_import_state")
    busy = db.scalar(select(Import.id).where(Import.status == IMPORT_APPLYING, Import.id != imp.id).limit(1))
    if busy is not None:
        raise Conflict(f"Import {busy} is being added right now. Wait until it is finished.", code="import_busy")
    db.execute(
        update(Import).where(Import.id == imp.id, Import.status == IMPORT_FAILED).values(
            status=IMPORT_APPLYING, error_message=None, attempts=0, cancel_requested=False, lease_owner=None, heartbeat_at=None
        ),
        execution_options={"synchronize_session": False},
    )
    audit_service.record(db, action="import.retry", actor=actor, entity_type="import", entity_id=imp.id, request=request, details={"applied_rows": imp.applied_rows})
    db.commit()
    db.refresh(imp)
    return imp


def cancel_import(db: Session, imp: Import, actor: Employee, request: Request) -> Import:
    if imp.status == IMPORT_APPLYING:
        # the runner stops after the step it is in; what is already added stays
        imp.cancel_requested = True
        audit_service.record(db, action="import.cancel_requested", actor=actor, entity_type="import", entity_id=imp.id, request=request, details={"applied_rows": imp.applied_rows})
        db.commit()
        return imp
    if imp.status not in (IMPORT_PREVIEWED, IMPORT_VALIDATING, IMPORT_FAILED):
        raise Conflict(f"An import in status '{imp.status}' cannot be cancelled.", code="bad_import_state")
    imp.status = IMPORT_CANCELLED
    imp.cancel_requested = True
    imp.lease_owner = None
    audit_service.record(db, action="import.cancel", actor=actor, entity_type="import", entity_id=imp.id, request=request)
    db.commit()
    remove_files(imp)
    return imp


# ------------------------------------------------------------------------------------------------------- apply
def _contact_row(imp: Import, row: dict[str, Any], created_by: int | None, now: Any) -> dict[str, Any]:
    data = _row_data(row)
    return {
        "name": data["name"], "phone_raw": data["phone_raw"], "normalized_phone": row["m"], "email": data["email"],
        "location": data["location"], "category": data["category"], "priority": data["priority"], "tags": data["tags"],
        "custom_fields": data["custom_fields"],
        "search_text": build_search_text(
            name=data["name"], phone_raw=data["phone_raw"], normalized_phone=row["m"], email=data["email"], location=data["location"],
            category=data["category"], tags=data["tags"], custom_fields=data["custom_fields"],
        ),
        "status": "new", "source": "import", "import_id": imp.id, "call_count": 0, "failed_attempts": 0,
        "created_by": created_by, "created_at": now, "updated_at": now,
    }


def _apply_fields(contact: Contact, data: dict[str, Any], *, reset: bool) -> None:
    contact.name = data["name"]
    contact.phone_raw = data["phone_raw"]
    for key in ("email", "location", "category"):
        if data.get(key):
            setattr(contact, key, data[key])
    if data.get("priority"):
        contact.priority = data["priority"]
    if data.get("tags"):
        merged = list(contact.tags or [])
        for tag in data["tags"]:
            if tag.lower() not in (t.lower() for t in merged):
                merged.append(tag)
        contact.tags = merged[:20]
    if data.get("custom_fields"):
        merged_cf = dict(contact.custom_fields or {})
        merged_cf.update(data["custom_fields"])
        contact.custom_fields = merged_cf
    if reset:
        contact.deleted_at = None
        contact.status = "new"
        contact.failed_attempts = 0
        contact.next_eligible_at = None
    refresh_search_text(contact)


def _schedule(imp: Import) -> Schedule | None:
    dist = (imp.options or {}).get("distribution") or {}
    quota_pairs = [(int(k), int(v)) for k, v in (dist.get("quotas") or {}).items()]
    return Schedule(sorted(quota_pairs), dist.get("order", "interleave")) if quota_pairs else None


def _add_chunk(
    db: Session, imp: Import, owner: str, lines: list[dict[str, Any]], offset_after: int, schedule: Schedule | None, so_far: Counter[int]
) -> Counter[int]:
    """One transaction: contacts, owners, campaign, and the resume point. Returns who received how many in this step.

    The resume point is written as an absolute number (`offset_after`), never as "+ this many": a step that is repeated because the
    answer of its commit got lost on the way is then harmless - the contacts are in already (the unique number decides) and the
    resume point is the same."""
    now = utcnow()
    options = imp.options or {}
    created_by = options.get("confirmed_by")
    gave: Counter[int] = Counter()
    db.info[QUIET] = True  # the queues of the people who receive something are cleared once per step, below
    fresh = [row for row in lines if not row.get("u")]
    revived = [row for row in lines if row.get("u")]
    insert_ignore(db, Contact.__table__, [_contact_row(imp, row, created_by, now) for row in fresh], conflict_column="normalized_phone")
    if revived:
        contacts = {c.id: c for c in db.scalars(select(Contact).where(Contact.id.in_([row["u"] for row in revived])))}
        for row in revived:
            contact = contacts.get(row["u"])
            if contact is not None and contact.deleted_at is not None:
                _apply_fields(contact, _row_data(row), reset=True)
                contact.import_id = imp.id
                contact.source = "import"
    db.flush()
    owned = {
        phone: contact_id
        for contact_id, phone in db.execute(
            select(Contact.id, Contact.normalized_phone).where(
                Contact.normalized_phone.in_([row["m"] for row in lines]), Contact.import_id == imp.id, Contact.deleted_at.is_(None)
            )
        )
    }
    mine = [(owned[row["m"]], row) for row in lines if row["m"] in owned]
    assigned = 0
    taken_by_someone = 0
    if mine:
        already = set(db.scalars(select(ContactAssignment.contact_id).where(ContactAssignment.contact_id.in_([cid for cid, _ in mine]), ContactAssignment.status == "active")))
        rows = []
        for contact_id, row in mine:
            employee_id = row.get("a") or (schedule.employee_at(row["x"]) if schedule is not None and "x" in row else None)
            if employee_id is None:
                continue  # left unassigned on purpose
            if contact_id in already:
                taken_by_someone += 1
                continue
            rows.append(
                {
                    "contact_id": contact_id, "employee_id": employee_id, "campaign_id": imp.campaign_id, "status": "active",
                    "active_contact_id": contact_id, "assigned_by": created_by, "assigned_at": now,
                }
            )
            gave[employee_id] += 1
        insert_ignore(db, ContactAssignment.__table__, rows, conflict_column="active_contact_id")
        assigned = len(rows)
        if imp.campaign_id is not None:
            insert_ignore(
                db, CampaignContact.__table__,
                [{"campaign_id": imp.campaign_id, "contact_id": cid, "status": "pending", "attempts": 0, "added_at": now} for cid, _ in mine],
                conflict_column=("campaign_id", "contact_id"),
            )
    inserted = len(mine)
    skipped = len(lines) - inserted
    total = Counter(so_far)
    total.update(gave)
    previous = dict(imp.result or {})
    result = {**previous, "stage": "applying", "per_employee": {str(k): v for k, v in total.items()}}
    result["skipped_existing_owner"] = int(previous.get("skipped_existing_owner", 0)) + taken_by_someone
    updated = db.execute(
        update(Import)
        .where(Import.id == imp.id, Import.lease_owner == owner, Import.status == IMPORT_APPLYING)
        .values(
            applied_rows=offset_after, inserted_rows=Import.inserted_rows + inserted, skipped_rows=Import.skipped_rows + skipped,
            assigned_rows=Import.assigned_rows + assigned, distributed_rows=Import.distributed_rows + assigned, heartbeat_at=now, result=result,
        ),
        execution_options={"synchronize_session": False},
    )
    if not updated.rowcount:
        db.rollback()
        raise _Lost()
    db.commit()
    imp.result = result  # (the in-memory copy follows what was committed)
    return gave


def _update_chunk(db: Session, imp: Import, owner: str, lines: list[dict[str, Any]], offset_after: int, before: tuple[int, int]) -> tuple[int, int]:
    """Update mode: the contacts of the sheet that were there already get the data of the sheet. Returns (updated, skipped) in total.
    (`before` is what the earlier steps counted: the totals are written as absolute numbers, like the resume point.)"""
    db.info[QUIET] = True
    contacts = {c.id: c for c in db.scalars(select(Contact).where(Contact.id.in_([row["id"] for row in lines]), Contact.deleted_at.is_(None)))}
    updated = skipped = 0
    for row in lines:
        contact = contacts.get(row["id"])
        if contact is None:
            skipped += 1
            continue
        _apply_fields(contact, _row_data(row), reset=False)
        updated += 1
    db.flush()
    totals = (before[0] + updated, before[1] + skipped)
    moved = db.execute(
        update(Import)
        .where(Import.id == imp.id, Import.lease_owner == owner, Import.status == IMPORT_APPLYING)
        .values(applied_existing=offset_after, updated_rows=totals[0], skipped_rows=totals[1], heartbeat_at=utcnow()),
        execution_options={"synchronize_session": False},
    )
    if not moved.rowcount:
        db.rollback()
        raise _Lost()
    db.commit()
    return totals


def _pause(started: float) -> None:
    settings = get_settings()
    took = time.monotonic() - started
    pause = settings.import_chunk_pause_ms / 1000
    if took > 1.0:  # the database is struggling (or busy with other work): give it room in proportion
        pause = max(pause, min(took * 0.5, 5.0))
    if pause > 0:
        time.sleep(pause)


def _wake_queues(employee_ids: list[int]) -> None:
    cache.bump_now(*[employee_epoch(e) for e in employee_ids])


def run_apply(import_id: int, _actor_id: int | None = None) -> None:
    """Background job: add the contacts and give them out, in small steps that can be resumed. (Who confirmed is kept in the
    import's options - the second argument is only there for callers of the first version.)"""
    key = ("apply", import_id)
    with _queued_lock:
        if key in _queued:
            return
        _queued.add(key)
    from app import jobs

    owner = _new_owner()
    db = new_session()
    try:
        with jobs.writer_slot():  # (waited for before the lease is taken: a lease is only kept by an import that is really running)
            if not _claim(db, import_id, IMPORT_APPLYING, owner):
                return
            _run_claimed(db, import_id, owner)
    finally:
        db.close()
        with _queued_lock:
            _queued.discard(key)


def _run_claimed(db: Session, import_id: int, owner: str) -> None:
    try:
        _apply(db, import_id, owner)
    except _Lost:
        db.rollback()
        log.info("Import %s was taken over by another runner", import_id)
    except _Stopped:
        db.rollback()
        _stop_import(db, import_id)
    except Exception as exc:  # noqa: BLE001
        log.exception("Import %s stopped while adding the contacts", import_id)
        imp = db.get(Import, import_id)
        done = imp.applied_rows if imp is not None else 0
        total = imp.valid_rows if imp is not None else 0
        _fail(
            db, import_id,
            f"Stopped after {done:,} of {total:,} contacts because of a problem on the server ({exc.__class__.__name__}). "
            "What was added is kept - press Continue to do the rest.",
            keep_files=True,
        )


def _apply(db: Session, import_id: int, owner: str) -> None:
    settings = get_settings()
    imp = db.get(Import, import_id)
    if imp is None:
        return
    db.refresh(imp)
    schedule = _schedule(imp)
    per_employee: Counter[int] = Counter({int(k): int(v) for k, v in ((imp.result or {}).get("per_employee") or {}).items()})
    chunk = max(100, settings.import_chunk_rows)
    receivers = list((imp.options or {}).get("distribution", {}).get("recipients") or [])
    last_wake = time.monotonic()

    offset = imp.applied_rows
    with closing(_read_lines(_file(imp, VALID), skip=offset)) as lines:
        while True:
            batch = list(islice(lines, chunk))
            if not batch:
                break
            started = time.monotonic()
            _beat(db, imp.id, owner, IMPORT_APPLYING)  # (stops here when somebody asked to stop, or the import was taken over)
            after = offset + len(batch)
            gave = retry_transient(db, lambda: _add_chunk(db, imp, owner, batch, after, schedule, per_employee))
            per_employee.update(gave)
            offset = after
            if time.monotonic() - last_wake > 20 and receivers:  # the people who receive are shown what they got so far
                last_wake = time.monotonic()
                _wake_queues(receivers)
            _pause(started)

    db.refresh(imp)
    if imp.mode == "update":
        offset = imp.applied_existing
        totals = (imp.updated_rows, imp.skipped_rows)
        with closing(_read_lines(_file(imp, EXISTING), skip=offset)) as lines:
            while True:
                batch = list(islice(lines, chunk))
                if not batch:
                    break
                started = time.monotonic()
                _beat(db, imp.id, owner, IMPORT_APPLYING)
                after = offset + len(batch)
                totals = retry_transient(db, lambda: _update_chunk(db, imp, owner, batch, after, totals))
                offset = after
                _pause(started)
    _finish(db, imp, owner, per_employee, receivers)


def _finish(db: Session, imp: Import, owner: str, per_employee: Counter[int], receivers: list[int]) -> None:
    db.refresh(imp)
    now = utcnow()
    skipped_total = imp.skipped_rows + imp.file_duplicate_rows + (imp.existing_rows if imp.mode == "skip" else 0)
    names = {e.id: (e.employee_code, e.full_name) for e in db.scalars(select(Employee).where(Employee.id.in_(list(per_employee) or [0])))}
    summary = [
        {"employee_id": eid, "employee_code": names.get(eid, ("", ""))[0], "full_name": names.get(eid, ("", f"#{eid}"))[1], "count": count}
        for eid, count in sorted(per_employee.items(), key=lambda item: (-item[1], item[0]))
    ]
    result = {**(imp.result or {}), "stage": "done", "employees": summary, "per_employee": {str(k): v for k, v in per_employee.items()}}
    done = db.execute(
        update(Import)
        .where(Import.id == imp.id, Import.lease_owner == owner, Import.status == IMPORT_APPLYING)
        .values(status=IMPORT_COMPLETED, completed_at=now, lease_owner=None, heartbeat_at=now, skipped_rows=skipped_total, error_message=None, result=result),
        execution_options={"synchronize_session": False},
    )
    if not done.rowcount:
        db.rollback()
        raise _Lost()
    db.expire(imp)
    for employee_id, count in per_employee.items():
        notify(
            db, employee_id, type="assignment", title=f"{count} new contact{'s' if count != 1 else ''} assigned",
            body="Open your queue to start calling.", data={"count": count, "import_id": imp.id},
        )
    actor = db.get(Employee, (imp.options or {}).get("confirmed_by")) if (imp.options or {}).get("confirmed_by") else None
    audit_service.record(
        db, action="import.completed", actor=actor, entity_type="import", entity_id=imp.id,
        details={
            "inserted": imp.inserted_rows, "updated": imp.updated_rows, "skipped": skipped_total, "assigned": imp.assigned_rows,
            "invalid": imp.invalid_rows, "employees": len(per_employee), "per_employee": {str(k): v for k, v in per_employee.items()} if len(per_employee) <= 50 else None,
        },
    )
    cache.bump(db, EVERYONE)
    db.commit()
    remove_files(imp, keep_issues=True)
    _wake_queues(receivers)


def _stop_import(db: Session, import_id: int) -> None:
    """An administrator stopped an import that was adding contacts: what is added stays, the rest is not added."""
    imp = db.get(Import, import_id)
    if imp is None:
        return
    db.refresh(imp)
    per_employee = Counter({int(k): int(v) for k, v in ((imp.result or {}).get("per_employee") or {}).items()})
    imp.status = IMPORT_CANCELLED
    imp.lease_owner = None
    imp.error_message = f"Stopped by an administrator after {imp.applied_rows:,} of {imp.valid_rows:,} contacts. What was added stays."
    imp.result = {**(imp.result or {}), "stage": "stopped"}
    for employee_id, count in per_employee.items():
        notify(db, employee_id, type="assignment", title=f"{count} new contact{'s' if count != 1 else ''} assigned", body="Open your queue to start calling.", data={"count": count, "import_id": imp.id})
    cache.bump(db, EVERYONE)
    db.commit()
    remove_files(imp, keep_issues=True)


# ---------------------------------------------------------------------------------------------------- recovery
def _start(kind: str, import_id: int) -> None:
    from app import jobs

    if kind == IMPORT_VALIDATING:
        jobs.submit("import-check", run_validation, import_id)
    else:
        jobs.submit("import-apply", run_apply, import_id)


def recover_stuck_imports() -> int:
    """Imports whose runner has disappeared (a restart, a crash) are handed to a new one - it goes on where the last one stopped."""
    db = new_session()
    started = 0
    try:
        stale = utcnow() - timedelta(seconds=get_settings().import_lease_seconds)
        last_sign = func.coalesce(Import.heartbeat_at, Import.confirmed_at, Import.created_at)
        stuck = db.execute(
            select(Import.id, Import.status, Import.attempts).where(Import.status.in_((IMPORT_VALIDATING, IMPORT_APPLYING)), last_sign < stale)
        ).all()
        for import_id, status, attempts in stuck:
            if attempts >= MAX_ATTEMPTS:
                _fail(db, import_id, "The import kept stopping and was given up. Upload the file again.", keep_files=status == IMPORT_APPLYING)
                continue
            with _queued_lock:
                busy = ("check" if status == IMPORT_VALIDATING else "apply", import_id) in _queued
            if not busy:
                _start(status, import_id)
                started += 1
    finally:
        db.close()
    return started


def expire_unconfirmed(db: Session) -> int:
    """An upload nobody confirmed (or that failed) is removed after a few days, with the personal data in it."""
    cutoff = utcnow() - timedelta(days=get_settings().import_keep_days)
    stale = list(db.scalars(select(Import).where(Import.status.in_((IMPORT_PREVIEWED, IMPORT_FAILED, IMPORT_VALIDATING)), Import.created_at < cutoff)))
    for imp in stale:
        imp.status = IMPORT_CANCELLED
        imp.error_message = imp.error_message or f"Removed: not confirmed within {get_settings().import_keep_days} days."
        imp.lease_owner = None
        remove_files(imp)
    if stale:
        db.commit()
    return len(stale)


def purge_old_imports(db: Session, *, older_than_days: int = 30) -> int:
    """Retention: drop row-level import data (contains personal data) after N days, and the report files after a few."""
    cutoff = utcnow() - timedelta(days=older_than_days)
    old_ids = list(db.scalars(select(Import.id).where(Import.created_at < cutoff)))
    if old_ids:
        db.execute(ImportRow.__table__.delete().where(ImportRow.import_id.in_(old_ids)))
        db.commit()
    report_cutoff = utcnow() - timedelta(days=get_settings().import_keep_days)
    for imp in db.scalars(select(Import).where(Import.status.in_((IMPORT_COMPLETED, IMPORT_CANCELLED)), Import.created_at < report_cutoff)):
        remove_files(imp)
    return len(old_ids)
