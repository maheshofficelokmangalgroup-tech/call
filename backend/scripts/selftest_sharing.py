"""Prove, on the real database of a running server, that a sheet is shared equally and that nothing gets in twice - and leave no trace.

    docker compose exec api python -m scripts.selftest_sharing --really            # (on the server, inside the API container)

It makes up its own administrator, ten employees, some tens of thousands of contacts and a small voter list (one row per number: one contact
per person with all their numbers), all marked ZZSELFTEST; talks to the API of
this server over plain HTTP (127.0.0.1) exactly as the panel does; checks the result in the database; and then deletes every row and
file it created (and puts back every setting it changed). Nothing that belongs to somebody else is read or written: the people who
receive contacts are always named explicitly, so real employees are never given anything, and the automatic sharing is switched off
for the few minutes it runs (and switched on again at the end, whatever happens).

Needs nothing but what the API image has (urllib - no extra packages).
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import secrets
import shutil
import sys
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from datetime import timedelta
from pathlib import Path

TAG = "ZZSELFTEST"
BASE_NUMBER = 6_000_000_000  # every number from here on is a valid mobile number


class Http:
    def __init__(self, base: str) -> None:
        # the test signs in with passwords it makes up and handles plain-http tokens: only ever to this machine
        if not base.startswith(("http://127.0.0.1", "http://localhost", "http://[::1]")):
            raise SystemExit("--base must be a local address (http://127.0.0.1:8000): this test does not send anything over a network.")
        self.base = base.rstrip("/")
        self.token: str | None = None

    def call(self, method: str, path: str, body: dict | None = None, *, raw: bytes | None = None, content_type: str | None = None, expect: tuple[int, ...] = (200, 201, 202)):
        headers = {"accept": "application/json"}
        data = raw
        if body is not None:
            data = json.dumps(body).encode()
            headers["content-type"] = "application/json"
        if content_type:
            headers["content-type"] = content_type
        if self.token:
            headers["authorization"] = f"Bearer {self.token}"
        request = urllib.request.Request(f"{self.base}/api/v1/{path.lstrip('/')}", data=data, method=method, headers=headers)  # nosec B310
        try:
            with urllib.request.urlopen(request, timeout=300) as response:  # nosec B310
                payload, status, kind = response.read(), response.status, response.headers.get("content-type", "")
        except urllib.error.HTTPError as exc:
            payload, status, kind = exc.read(), exc.code, exc.headers.get("content-type", "")
        if status not in expect:
            raise RuntimeError(f"{method} {path} answered {status}: {payload[:300]!r}")
        return (json.loads(payload) if "json" in kind and payload else payload), status

    def upload(self, path: str, filename: str, content: bytes, fields: dict[str, str]):
        boundary = uuid.uuid4().hex
        parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in fields.items()]
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: text/csv\r\n\r\n'.encode() + content + b"\r\n")
        parts.append(f"--{boundary}--\r\n".encode())
        return self.call("POST", path, raw=b"".join(parts), content_type=f"multipart/form-data; boundary={boundary}")[0]


class Report:
    def __init__(self) -> None:
        self.failures: list[str] = []

    def say(self, text: str = "") -> None:
        print(text, flush=True)

    def check(self, ok: bool, text: str) -> None:
        self.say(f"  {'ok  ' if ok else 'FAIL'} {text}")
        if not ok:
            self.failures.append(text)


def csv_of(rows: list[list[str]]) -> bytes:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Name", "Mobile", "City", "Tags"])
    writer.writerows(rows)
    return out.getvalue().encode()


def main_sheet(count: int, invalid: int, repeats: int) -> tuple[bytes, dict[str, int]]:
    """`count` lines: the first `invalid` have a bad number, the last `repeats` repeat the number of an earlier good line (written
    another way), the ones between are good and different from each other."""
    rows = []
    for i in range(count):
        if i < invalid:
            rows.append([f"{TAG} bad {i}", "12345", "Pune", ""])
        elif i >= count - repeats:
            earlier = invalid + (i - (count - repeats))  # a good line, as `repeats` is far smaller than what is good
            digits = str(BASE_NUMBER + earlier)
            rows.append([f"{TAG} again {i}", f"+91 {digits[:5]} {digits[5:]}", "Pune", ""])
        else:
            rows.append([f"{TAG} a{i}", str(BASE_NUMBER + i), "Pune", "selftest"])
    return csv_of(rows), {"rows": count, "invalid": invalid, "repeats": repeats, "unique": count - invalid - repeats}


def numbers_sheet(numbers: list[int], label: str) -> bytes:
    return csv_of([[f"{TAG} {label}{n}", str(BASE_NUMBER + n), "Pune", "selftest"] for n in numbers])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--really", action="store_true", help="yes, make and delete test data in the database this process is connected to")
    parser.add_argument("--base", default="http://127.0.0.1:8000", help="the API of this server (plain http, from inside the container)")
    parser.add_argument("--rows", type=int, default=20_000, help="size of the main sheet")
    parser.add_argument("--people-rows", type=int, default=3_000, help="lines of the voter list (one row per number); 0 leaves that part out")
    parser.add_argument("--keep", action="store_true", help="do not clean up (for looking at the data by hand)")
    args = parser.parse_args(argv)
    if not args.really:
        raise SystemExit("This writes (and deletes) test data in the database of this server. Run it again with --really.")

    from sqlalchemy import func, select, update

    from app.core.database import get_engine, new_session
    from app.core.security import hash_password
    from app.core.timeutils import utcnow
    from app.models.contact import Contact, ContactAssignment, ContactPhone
    from app.models.distribution import DistributionRun, EmployeeCredential
    from app.models.employee import Employee, Role
    from app.models.imports import Import
    from app.models.system import Notification, Setting
    from app.services import activity
    from app.services.settings_service import get_setting

    report = Report()
    run_id = secrets.token_hex(3)
    db = new_session()
    http = Http(args.base)
    report.say(f"Self-test {run_id} on database '{get_engine().url.database}' ({get_engine().dialect.name}) through {args.base}")

    def snapshot() -> dict[str, int]:
        db.rollback()
        return {
            "employees": db.scalar(select(func.count(Employee.id))) or 0,
            "contacts": db.scalar(select(func.count(Contact.id))) or 0,
            "numbers": db.scalar(select(func.count(ContactPhone.id))) or 0,
            "assignments": db.scalar(select(func.count(ContactAssignment.id))) or 0,
            "imports": db.scalar(select(func.count(Import.id))) or 0,
            "runs": db.scalar(select(func.count(DistributionRun.id))) or 0,
            "credentials": db.scalar(select(func.count(EmployeeCredential.employee_id))) or 0,
            "notifications": db.scalar(select(func.count(Notification.id))) or 0,
        }

    before = snapshot()
    report.say(f"Before: {before}")
    previous_auto = db.get(Setting, "auto_rebalance")
    previous_auto_value = previous_auto.value if previous_auto else None
    db.rollback()
    auto_seen_before = bool(get_setting(db, "auto_rebalance"))  # what the server's workers read (through the settings they remember)
    db.rollback()
    admin_password = secrets.token_urlsafe(18) + "aA1!"
    admin_email = f"zz-selftest-{run_id}@example.com"
    test_employee_ids: list[int] = []
    import_ids: list[int] = []
    started_all = time.perf_counter()
    try:
        # ---------------------------------------------------------------------------------------- a temporary administrator
        role_admin = db.scalars(select(Role).where(Role.name == "admin")).one()
        db.add(
            Employee(
                employee_code=f"ZZADM{run_id}".upper(), email=admin_email, full_name=f"{TAG} administrator", password_hash=hash_password(admin_password),
                role_id=role_admin.id, daily_target=0, must_change_password=False, password_changed_at=utcnow(),
            )
        )
        db.commit()
        login, _ = http.call("POST", "auth/login", {"identifier": admin_email, "password": admin_password, "device": {"device_uid": f"selftest-{run_id}", "name": TAG, "platform": "android"}})
        http.token = login["access_token"]
        report.check(True, "a temporary administrator signed in")
        http.call("PUT", "settings/auto_rebalance", {"value": False})  # the automatic sharing would also look at the real employees

        # ---------------------------------------------------------------------------------------- ten employees
        creds: dict[int, str] = {}
        for n in range(1, 11):
            created, _ = http.call(
                "POST", "employees",
                {"full_name": f"{TAG} {run_id} {n:02d}", "email": f"zz-selftest-{run_id}-{n:02d}@example.com", "role": "employee", "daily_target": 50, "device_binding_enabled": False, "must_change_password": True},
            )
            test_employee_ids.append(created["employee"]["id"])
            creds[created["employee"]["id"]] = created["temporary_password"]
        report.check(len(test_employee_ids) == 10, "ten test employees were created")

        # ---------------------------------------------------------------------------------------- the passwords handed out
        first = test_employee_ids[0]
        shown, _ = http.call("GET", f"employees/{first}/credentials")
        report.check(shown["available"] and shown["password"] == creds[first], "the administrator can look at the password that was handed out, and it is the right one")
        sheet_bytes, _ = http.call("GET", f"employees/credentials.xlsx?ids={','.join(map(str, test_employee_ids))}")
        report.check(bytes(sheet_bytes)[:2] == b"PK" and shown["employee_code"].encode() in _read_xlsx(bytes(sheet_bytes)), "the login sheet is an Excel file that has the employee ids")
        stored = db.scalar(select(EmployeeCredential.ciphertext).where(EmployeeCredential.employee_id == first)) or ""
        report.check(creds[first] not in stored and stored.startswith("gAAAA"), "in the database the password is encrypted, not readable")

        # ---------------------------------------------------------------------------------------- sheet A: the example of the task, scaled
        rows = args.rows
        invalid, repeats = rows // 100, rows // 50
        content, expected = main_sheet(rows, invalid, repeats)
        report.say(f"\nSheet A: {rows:,} lines = {expected['unique']:,} good numbers + {invalid:,} bad lines + {repeats:,} lines that repeat a number")
        started = time.perf_counter()
        import_a = http.upload("contacts/import", "selftest-a.csv", content, {"mode": "skip", "default_priority": "2"})["id"]
        import_ids.append(import_a)
        job = _wait(http, import_a, ("previewed", "failed"))
        checked = time.perf_counter() - started
        report.say(f"  checked in {checked:.1f} s ({rows / checked:,.0f} lines/s)")
        report.check(job["status"] == "previewed", f"the sheet was checked ({job.get('error_message') or 'previewed'})")
        report.check(
            job["total_rows"] == rows and job["invalid_rows"] == invalid and job["file_duplicate_rows"] == repeats and job["valid_rows"] == expected["unique"],
            f"every line is accounted for: {job['valid_rows']:,} new + {job['invalid_rows']:,} bad + {job['file_duplicate_rows']:,} repeated = {rows:,}",
        )
        ids_param = ",".join(map(str, test_employee_ids))
        plan, _ = http.call("GET", f"contacts/import/{import_a}/plan?employee_ids={ids_param}&strategy=equal&order=interleave")
        planned = sorted(e["planned"] for e in plan["employees"] if e["receives"])
        report.check(len(planned) == 10 and sum(planned) == expected["unique"] and planned[-1] - planned[0] <= 1, f"the plan: 10 employees, {planned[0]:,} to {planned[-1]:,} each")
        started = time.perf_counter()
        choice = {"strategy": "equal", "order": "interleave", "employee_ids": test_employee_ids, "leave_unassigned": False}
        http.call("POST", f"contacts/import/{import_a}/confirm", {"mode": "skip", "distribution": choice})
        job = _wait(http, import_a, ("completed", "failed", "cancelled"))
        added = time.perf_counter() - started
        report.say(f"  added in {added:.1f} s ({expected['unique'] / added:,.0f} contacts/s)")
        report.check(job["status"] == "completed", f"the contacts were added ({job.get('error_message') or 'completed'})")
        per = _owned(db, test_employee_ids)
        report.say(f"  each employee now has: {sorted(per.values())}")
        report.check(sum(per.values()) == expected["unique"] and max(per.values()) - min(per.values()) <= 1, f"shared equally: {min(per.values()):,} to {max(per.values()):,} each, {sum(per.values()):,} in all")
        in_db = db.scalar(select(func.count(Contact.id)).where(Contact.import_id == import_a)) or 0
        distinct = db.scalar(select(func.count(func.distinct(Contact.normalized_phone))).where(Contact.import_id == import_a)) or 0
        report.check(in_db == expected["unique"] == distinct, f"no number twice: {in_db:,} contacts, {distinct:,} different numbers")
        report.check(
            (db.scalar(select(func.count(Contact.id)).where(Contact.name.like(f"{TAG} bad%"))) or 0) == 0 and (db.scalar(select(func.count(Contact.id)).where(Contact.name.like(f"{TAG} again%"))) or 0) == 0,
            "no bad line and no repeat was added",
        )

        # ---------------------------------------------------------------------------------------- sheet B: numbers that are contacts already
        overlap = 3_000
        known = list(range(rows - repeats - overlap, rows - repeats))  # the last good numbers of sheet A
        fresh = list(range(100_000, 104_000))
        report.say(f"\nSheet B: {overlap:,} numbers that are contacts already + {len(fresh):,} new")
        import_b = http.upload("contacts/import", "selftest-b.csv", numbers_sheet(known + fresh, "b"), {"mode": "skip", "default_priority": "2"})["id"]
        import_ids.append(import_b)
        job = _wait(http, import_b, ("previewed", "failed"))
        report.check(job["status"] == "previewed" and job["existing_rows"] == overlap and job["valid_rows"] == len(fresh), f"{job['existing_rows']:,} are contacts already, {job['valid_rows']:,} are new")
        http.call("POST", f"contacts/import/{import_b}/confirm", {"mode": "skip", "distribution": choice})
        job = _wait(http, import_b, ("completed", "failed", "cancelled"))
        per_b = _owned(db, test_employee_ids)
        report.check(job["status"] == "completed" and job["inserted_rows"] == len(fresh) and job["skipped_rows"] == overlap, f"added {job['inserted_rows']:,}, left out {job['skipped_rows']:,} that were there")
        report.check(max(per_b.values()) - min(per_b.values()) <= 1 and sum(per_b.values()) == expected["unique"] + len(fresh), f"still equal after the second sheet: {min(per_b.values()):,} to {max(per_b.values()):,}")
        total_numbers = db.scalar(select(func.count(Contact.id)).where(Contact.name.like(f"{TAG} %"))) or 0
        distinct_numbers = db.scalar(select(func.count(func.distinct(Contact.normalized_phone))).where(Contact.name.like(f"{TAG} %"))) or 0
        report.check(total_numbers == distinct_numbers == expected["unique"] + len(fresh), f"{total_numbers:,} contacts, {distinct_numbers:,} different numbers")

        # ---------------------------------------------------------------------------------------- somebody stops working
        gone = test_employee_ids[-1]
        long_ago = utcnow() - timedelta(days=10)
        db.execute(update(Employee).where(Employee.id == gone).values(created_at=long_ago, last_login_at=long_ago))
        db.commit()
        states = {s.employee_id: s.state for s in activity.employee_states(db, employee_ids=test_employee_ids)}
        report.check(states[gone] == "inactive" and sum(1 for s in states.values() if s in ("active", "new")) == 9, "one test employee is now 'not working' (not seen for days); nine are working")
        import_c = http.upload("contacts/import", "selftest-c.csv", numbers_sheet(list(range(200_000, 209_000)), "c"), {"mode": "skip", "default_priority": "2"})["id"]
        import_ids.append(import_c)
        _wait(http, import_c, ("previewed", "failed"))
        before_c = _owned(db, test_employee_ids)
        plan, _ = http.call("GET", f"contacts/import/{import_c}/plan?employee_ids={ids_param}&strategy=equal&order=interleave")
        gone_row = next(e for e in plan["employees"] if e["employee_id"] == gone)
        report.check(not gone_row["receives"] and gone_row["state"] == "inactive" and plan["working"] == 9, f"the plan gives nothing to the one who stopped ({gone_row['reason']})")
        http.call("POST", f"contacts/import/{import_c}/confirm", {"mode": "skip", "distribution": choice})
        job = _wait(http, import_c, ("completed", "failed", "cancelled"))
        after_c = _owned(db, test_employee_ids)
        gained = {e: after_c[e] - before_c[e] for e in test_employee_ids}
        report.check(job["status"] == "completed" and gained[gone] == 0, "the employee who stopped working got nothing from the new sheet")
        others = [v for e, v in gained.items() if e != gone]
        report.check(sum(others) == 9_000 and max(others) == min(others) == 1_000, f"the nine who are working got {min(others):,} each (9,000 / 9)")

        # ---------------------------------------------------------------------------------------- what was waiting with him is shared out again
        holding = after_c[gone]
        working = [e for e in test_employee_ids if e != gone]
        request = {"from_employee_ids": [gone], "to_employee_ids": working, "strategy": "equal", "order": "interleave"}
        preview, _ = http.call("POST", "distribution/rebalance/preview", request)
        report.check(preview["total_movable"] == holding and preview["working"] == 9, f"the rebalancing preview sees {preview['total_movable']:,} contacts waiting with the one who stopped")
        before_r = _owned(db, test_employee_ids)
        run_started = time.perf_counter()
        run, _ = http.call("POST", "distribution/rebalance", request)
        for _ in range(900):
            run, _ = http.call("GET", f"distribution/runs/{run['id']}")
            if run["status"] != "running":
                break
            time.sleep(1)
        moved_in = time.perf_counter() - run_started
        after_r = _owned(db, test_employee_ids)
        report.check(run["status"] == "completed" and run["moved"] == holding, f"{run['moved']:,} contacts moved in {moved_in:.1f} s")
        report.check(after_r[gone] == 0, "the employee who stopped working has none left")
        got = [after_r[e] - before_r[e] for e in working]
        report.check(sum(got) == holding and max(got) - min(got) <= 1, f"the nine who are working got {min(got):,} to {max(got):,} each of those")
        again = http.call("POST", "distribution/rebalance", {"from_employee_ids": [gone]}, expect=(422,))[0]
        report.check(again["error"]["code"] == "nothing_to_rebalance", "doing it again moves nothing")
        final = _owned(db, test_employee_ids)
        report.check(max(final[e] for e in working) - min(final[e] for e in working) <= 1, f"in the end everybody who is working has {min(final[e] for e in working):,} or {max(final[e] for e in working):,}")

        # ---------------------------------------------------------------------------------------- stopping an import half way
        import_d = http.upload("contacts/import", "selftest-d.csv", numbers_sheet(list(range(300_000, 306_000)), "d"), {"mode": "skip", "default_priority": "2"})["id"]
        import_ids.append(import_d)
        _wait(http, import_d, ("previewed", "failed"))
        http.call("POST", f"contacts/import/{import_d}/confirm", {"mode": "skip", "distribution": {**choice, "employee_ids": working[:3]}})
        for _ in range(300):
            job, _ = http.call("GET", f"contacts/import/{import_d}")
            if job["applied_rows"] > 0 or job["status"] != "applying":
                break
            time.sleep(0.05)
        http.call("POST", f"contacts/import/{import_d}/cancel", expect=(200, 409))
        job = _wait(http, import_d, ("cancelled", "completed", "failed"))
        added_d = db.scalar(select(func.count(Contact.id)).where(Contact.import_id == import_d)) or 0
        owned_d = db.scalar(select(func.count(ContactAssignment.id)).join(Contact, Contact.id == ContactAssignment.contact_id).where(Contact.import_id == import_d, ContactAssignment.status == "active")) or 0
        report.check(job["status"] in ("cancelled", "completed") and added_d == job["applied_rows"] and owned_d == added_d, f"{job['status']}: {added_d:,} added, every one with an owner, {job['applied_rows']:,} counted")

        # ---------------------------------------------------------------------------------------- a voter list: one row per number, one contact per person
        if args.people_rows > 0:
            _people_phase(db, http, report, run_id, import_ids, choice, ids_param, args.people_rows, BASE_NUMBER + 400_000)

        # ---------------------------------------------------------------------------------------- the employee chooses their own password
        who = working[0]
        email = db.scalar(select(Employee.email).where(Employee.id == who))
        tokens, _ = http.call("POST", "auth/login", {"identifier": email, "password": creds[who], "device": {"device_uid": f"selftest-emp-{run_id}", "name": TAG, "platform": "android"}})
        mine = Http(args.base)
        mine.token = tokens["access_token"]
        mine.call("POST", "auth/change-password", {"current_password": creds[who], "new_password": secrets.token_urlsafe(16) + "bB2#"})
        gone_view, _ = http.call("GET", f"employees/{who}/credentials")
        report.check(not gone_view["available"] and gone_view["password"] is None, "when the employee chose their own password, nobody can see it any more")
        queue, _ = mine.call("GET", "queue?limit=5")
        report.check(queue["total"] > 0 and len(queue["items"]) > 0, f"the employee's calling queue has their contacts ({queue['total']:,})")

        report.say(f"\nWhole run: {time.perf_counter() - started_all:.1f} s")
    except Exception as exc:  # noqa: BLE001
        report.check(False, f"the self-test stopped: {exc!r}")
    finally:
        if args.keep:
            report.say("--keep: the test data is still there")
        else:
            _clean(db, report, run_id, admin_email, test_employee_ids, import_ids, previous_auto_value)
        after = snapshot()
        report.say(f"After:  {after}")
        report.check(after == before or args.keep, "the database is as it was (employees, contacts, assignments, imports, runs, credentials, notifications)")
        if not args.keep:
            seen_after = bool(get_setting(db, "auto_rebalance"))
            db.rollback()
            report.check(seen_after == auto_seen_before, f"the automatic sharing reads {auto_seen_before} again, also in the settings the workers remember (it reads {seen_after})")
        db.close()
    if report.failures:
        report.say(f"\n{len(report.failures)} CHECK(S) FAILED")
        for failure in report.failures:
            report.say(f"  - {failure}")
        return 1
    report.say("\nAll checks passed.")
    return 0


def _people_phase(db, http: Http, report: Report, run_id: str, import_ids: list[int], choice: dict, ids_param: str, lines: int, first_number: int) -> None:
    """A voter list at a small size: the lines of one person become ONE contact with ALL their numbers, a number is never in two contacts, every
    line is accounted for, and the same list again adds nobody. The numbers are moved into a block of their own (next to the other sheets'),
    and nothing is added if anybody already has a number in that block - the made-up people can never become part of somebody's real contact."""
    from sqlalchemy import func, select

    from app.models.contact import Contact, ContactPhone
    from scripts.make_voter_sheet import HEADER, expected_of, make_rows

    last_number = first_number + max(20_000, lines)
    taken = db.scalar(select(func.count(ContactPhone.id)).where(ContactPhone.normalized_phone.between(f"+91{first_number}", f"+91{last_number}"))) or 0
    db.rollback()
    if taken:
        report.say(f"\nSheet P (a voter list): left out - {taken:,} numbers of the block it uses belong to somebody already")
        return
    rows = make_rows(lines, seed=int(run_id, 16))
    moved: dict[str, str] = {}
    for row in rows:
        number = row[0]
        if number.isdigit() and len(number) == 10 and number[0] in "6789" and len(set(number)) > 1:  # (a bad line stays bad)
            row[0] = moved.setdefault(number, str(first_number + len(moved)))
        row[1] = f"{TAG} {row[1]}"
    expected = expected_of(rows)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(HEADER)
    writer.writerows(rows)
    content = out.getvalue().encode()
    report.say(f"\nSheet P: a voter list of {lines:,} lines = {expected['people']:,} people with {expected['numbers']:,} numbers, {expected['invalid']:,} bad lines, {expected['repeated']:,} repeated numbers")
    started = time.perf_counter()
    import_p = http.upload("contacts/import", "selftest-p.csv", content, {"mode": "skip", "default_priority": "2"})["id"]
    import_ids.append(import_p)
    job = _wait(http, import_p, ("previewed", "failed"))
    result = job.get("result") or {}
    report.say(f"  checked in {time.perf_counter() - started:.1f} s")
    report.check(job["status"] == "previewed", f"the voter list was checked ({job.get('error_message') or 'previewed'})")
    report.check(
        job["total_rows"] == lines and job["invalid_rows"] == expected["invalid"] and job["file_duplicate_rows"] == expected["repeated"] and job["valid_rows"] == expected["people"],
        f"every line is accounted for: {job['invalid_rows']:,} bad + {job['file_duplicate_rows']:,} repeated + {expected['numbers']:,} numbers of people = {lines:,}",
    )
    report.check(
        result.get("sheet_people") == expected["people"] and result.get("sheet_numbers") == expected["numbers"] and result.get("merged_rows") == expected["merged_rows"],
        f"the lines became {result.get('sheet_people'):,} people with {result.get('sheet_numbers'):,} numbers ({result.get('merged_rows'):,} lines joined a person who was on an earlier line)",
    )
    started = time.perf_counter()
    http.call("POST", f"contacts/import/{import_p}/confirm", {"mode": "skip", "distribution": choice})
    job = _wait(http, import_p, ("completed", "failed", "cancelled"))
    report.say(f"  added in {time.perf_counter() - started:.1f} s")
    report.check(job["status"] == "completed" and job["inserted_rows"] == expected["people"], f"the people were added ({job.get('error_message') or 'completed'}): {job['inserted_rows']:,}")
    people = db.scalar(select(func.count(Contact.id)).where(Contact.import_id == import_p)) or 0
    numbers = db.scalar(select(func.count(ContactPhone.id)).join(Contact, Contact.id == ContactPhone.contact_id).where(Contact.import_id == import_p)) or 0
    distinct = db.scalar(select(func.count(func.distinct(ContactPhone.normalized_phone))).join(Contact, Contact.id == ContactPhone.contact_id).where(Contact.import_id == import_p)) or 0
    report.check(people == expected["people"] and numbers == expected["numbers"] == distinct, f"{people:,} contacts hold {numbers:,} numbers, {distinct:,} of them different - no number is in two contacts")
    wrong = 0
    for person in list(expected["_people"].values())[:40]:  # (people looked up through the API by their LAST number, as the panel does)
        found, _ = http.call("GET", f"contacts?q={person[-1][3:] if person[-1].startswith('+91') else person[-1]}&page_size=5")
        if found["total"] != 1 or found["items"][0]["phone_count"] != len(person):
            wrong += 1
    report.check(wrong == 0, "40 people looked up one by one: each is one contact with exactly their numbers")
    # the same list again: everybody is there already
    again = http.upload("contacts/import", "selftest-p2.csv", content, {"mode": "skip", "default_priority": "2"})["id"]
    import_ids.append(again)
    job = _wait(http, again, ("previewed", "failed"))
    report.check(job["status"] == "previewed" and job["valid_rows"] == 0 and job["existing_rows"] == expected["people"], f"the same list again adds nobody: {job['valid_rows']:,} new, {job['existing_rows']:,} are there already")
    http.call("POST", f"contacts/import/{again}/cancel", expect=(200, 409))


def _wait(http: Http, import_id: int, done: tuple[str, ...], seconds: int = 1800):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        job, _ = http.call("GET", f"contacts/import/{import_id}")
        if job["status"] in done:
            return job
        time.sleep(1)
    raise RuntimeError(f"import {import_id} did not reach {done} in {seconds} s")


def _owned(db, employee_ids: list[int]) -> dict[int, int]:
    from sqlalchemy import func, select

    from app.models.contact import ContactAssignment

    db.rollback()
    rows = dict(
        db.execute(
            select(ContactAssignment.employee_id, func.count(ContactAssignment.id))
            .where(ContactAssignment.status == "active", ContactAssignment.employee_id.in_(employee_ids))
            .group_by(ContactAssignment.employee_id)
        ).all()
    )
    return {e: int(rows.get(e, 0)) for e in employee_ids}


def _read_xlsx(data: bytes) -> bytes:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return b"".join(archive.read(name) for name in archive.namelist() if name.startswith("xl/") and name.endswith(".xml"))


def _clean(db, report: Report, run_id: str, admin_email: str, employee_ids: list[int], import_ids: list[int], previous_auto_value) -> None:
    """Remove every row and file this run made, in an order the foreign keys allow, and put the setting back."""
    from sqlalchemy import delete, or_, select, update

    from app.core import cache
    from app.core.config import get_settings
    from app.models.contact import Contact, ContactAssignment
    from app.models.distribution import DistributionRun, EmployeeCredential
    from app.models.employee import Employee
    from app.models.imports import Import, ImportRow
    from app.models.system import AuditLog, Notification, Setting
    from app.services.settings_service import EPOCH as SETTINGS_EPOCH

    db.rollback()
    people = set(employee_ids) | set(db.scalars(select(Employee.id).where(Employee.email == admin_email)))
    people |= set(db.scalars(select(Employee.id).where(Employee.email.like(f"zz-selftest-{run_id}-%@example.com"))))  # (made before an error stopped the run)
    people_list = sorted(people) or [0]
    imports = sorted(set(import_ids) | set(db.scalars(select(Import.id).where(Import.created_by.in_(people_list)))))
    imports_list = imports or [0]
    folders = {Path(p).parent for p in db.scalars(select(Import.file_path).where(Import.id.in_(imports_list)))}
    # (the ids first, then in batches: MySQL does not allow deleting from a table while selecting from it)
    mine = list(db.scalars(select(Contact.id).where(or_(Contact.import_id.in_(imports_list), Contact.name.like(f"{TAG} %")))))
    for start in range(0, len(mine), 5000):
        batch = mine[start : start + 5000]
        db.execute(delete(ContactAssignment).where(ContactAssignment.contact_id.in_(batch)))
        db.execute(delete(Contact).where(Contact.id.in_(batch)))
    db.execute(delete(ContactAssignment).where(ContactAssignment.employee_id.in_(people_list)))
    db.execute(delete(ImportRow).where(ImportRow.import_id.in_(imports_list)))
    db.execute(delete(Import).where(Import.id.in_(imports_list)))
    db.execute(delete(DistributionRun).where(DistributionRun.created_by.in_(people_list)))
    db.execute(delete(Notification).where(Notification.employee_id.in_(people_list)))
    db.execute(delete(EmployeeCredential).where(EmployeeCredential.employee_id.in_(people_list)))
    db.execute(update(Setting).where(Setting.updated_by.in_(people_list)).values(updated_by=None))
    db.execute(update(AuditLog).where(AuditLog.actor_id.in_(people_list)).values(actor_id=None))
    db.execute(delete(Employee).where(Employee.id.in_(people_list)))
    row = db.get(Setting, "auto_rebalance")  # the setting that was switched off while the test ran
    if previous_auto_value is None:
        if row is not None:
            db.delete(row)
    elif row is not None:
        row.value = previous_auto_value
        row.updated_by = None
    cache.bump(db, SETTINGS_EPOCH)  # (written here and not through the settings service: the copy every worker remembers must be thrown away too)
    db.commit()
    root = Path(get_settings().import_storage_path).resolve()
    for folder in folders:
        if folder.resolve() != root and root in folder.resolve().parents:
            shutil.rmtree(folder, ignore_errors=True)
    report.say(f"Cleaned up: {len(people)} employees, {len(imports)} imports, all their contacts and files; auto_rebalance is back to {previous_auto_value!r}")


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
