"""Fill a TEST database with employees and contacts, to measure how the API behaves under load (see scripts/loadtest.py).

    python -m scripts.seed_load --employees 200 --contacts-per-employee 300

Every employee gets the password given by --password, the contacts are handed to them, nothing else is created. It refuses to run
against production or staging, and it only ever adds rows whose codes start with "LT" (it can be run again with more employees).
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import func, insert, select

from app.core.config import get_settings
from app.core.database import new_session
from app.core.security import hash_password
from app.models.contact import Contact, ContactAssignment, ContactPhone
from app.models.employee import Employee, Role, Team
from app.services.contact_service import build_search_text
from app.services.phone import normalize_phone
from app.services.reference_data import ensure_reference_data

CHUNK = 1000


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--employees", type=int, default=100)
    parser.add_argument("--contacts-per-employee", type=int, default=200)
    parser.add_argument("--teams", type=int, default=5)
    parser.add_argument("--password", default="LoadTest-9x7Qm")
    parser.add_argument("--admin-email", default="load-admin@example.com")
    parser.add_argument("--admin-password", default="LoadAdmin-4k8Zp")
    args = parser.parse_args()

    settings = get_settings()
    if settings.app_env in ("production", "staging"):
        print("Refusing to fill a production or staging database with test data.", file=sys.stderr)
        return 2

    db = new_session()
    try:
        ensure_reference_data(db)
        role = db.scalars(select(Role).where(Role.name == "employee")).one()
        teams = [db.scalars(select(Team).where(Team.name == f"Load team {n + 1}")).first() or Team(name=f"Load team {n + 1}") for n in range(args.teams)]
        db.add_all([t for t in teams if t.id is None])
        db.flush()

        first = (db.scalar(select(func.count(Employee.id)).where(Employee.employee_code.like("LT%"))) or 0) + 1
        password_hash = hash_password(args.password)  # one hash, shared: they are all the same test password
        employees = [
            Employee(
                employee_code=f"LT{n:05d}",
                email=f"lt{n:05d}@load.example.com",
                full_name=f"Load Tester {n}",
                password_hash=password_hash,
                role_id=role.id,
                team_id=teams[n % len(teams)].id,
                daily_target=0,
            )
            for n in range(first, first + args.employees)
        ]
        db.add_all(employees)
        admin_role = db.scalars(select(Role).where(Role.name == "admin")).one()
        if db.scalars(select(Employee.id).where(Employee.email == args.admin_email)).first() is None:
            db.add(Employee(employee_code="LTADMIN", email=args.admin_email, full_name="Load Administrator", password_hash=hash_password(args.admin_password), role_id=admin_role.id, daily_target=0))
        db.flush()

        base = (db.scalar(select(func.count(Contact.id))) or 0) + 1
        wanted = args.employees * args.contacts_per_employee
        for start in range(0, wanted, CHUNK):
            rows = []
            for k in range(start, min(wanted, start + CHUNK)):
                number = f"9{(base + k) % 1_000_000_000:09d}"
                normalized = normalize_phone(number) or number
                name = f"Lead {base + k}"
                rows.append(
                    dict(
                        name=name,
                        phone_raw=number,
                        normalized_phone=normalized,
                        priority=1 + (k % 3),
                        tags=[],
                        custom_fields={},
                        search_text=build_search_text(name=name, phone_raw=number, normalized_phone=normalized, email=None, location=None, category=None, tags=[], custom_fields={}),
                        status="new",
                    )
                )
            db.execute(insert(Contact), rows)
        db.flush()
        made = list(db.execute(select(Contact.id, Contact.phone_raw, Contact.normalized_phone).where(Contact.name.like("Lead %")).order_by(Contact.id.desc()).limit(wanted)))
        made.reverse()
        contact_ids = [row[0] for row in made]
        for start in range(0, len(made), CHUNK):  # (rows inserted in bulk skip what the model does for a new contact: its first number goes into the numbers table)
            db.execute(insert(ContactPhone), [dict(contact_id=cid, phone_raw=raw, normalized_phone=normalized, position=0) for cid, raw, normalized in made[start : start + CHUNK]])
        owners = [e.id for e in employees]
        for start in range(0, len(contact_ids), CHUNK):
            db.execute(
                insert(ContactAssignment),
                [
                    dict(contact_id=cid, employee_id=owners[(start + i) // args.contacts_per_employee % len(owners)], status="active", active_contact_id=cid)
                    for i, cid in enumerate(contact_ids[start : start + CHUNK])
                ],
            )
        db.commit()
        print(f"{args.employees} employees (LT{first:05d}...), {wanted} contacts handed out, password {args.password}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
