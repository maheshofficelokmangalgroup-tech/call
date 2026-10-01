"""Load DEMO data so the employee app has something to work with.

    python -m scripts.seed_demo                # 10 employees, ~400 contacts, campaigns, some call history
    python -m scripts.seed_demo --contacts 2000

NEVER run this against a production database: it creates accounts with well-known passwords.

Phone numbers: by default the demo contacts use reserved *fictional* numbers (+1 xxx 555-01xx), so pressing
"Call" on a real SIM cannot ring a stranger. Use --numbers india only if you understand that randomly generated
Indian numbers may belong to real people.
"""

from __future__ import annotations

import argparse
import random
import sys
from datetime import timedelta

from sqlalchemy import select

from app.core.database import new_session
from app.core.security import hash_password
from app.core.timeutils import day_bounds_utc, utcnow
from app.models.contact import Campaign, CampaignContact, Contact, ContactAssignment
from app.models.employee import Employee, Role, Team
from app.schemas.call import CallCreate, DispositionIn
from app.services import call_service, callback_service
from app.services.contact_service import build_search_text
from app.services.phone import normalize_phone
from app.services.reference_data import ensure_reference_data
from app.services.settings_service import set_setting

ADMIN = ("ADMIN", "admin@example.com", "Admin@12345", "Demo Admin")
MANAGER = ("MGR01", "manager@example.com", "Manager@12345", "Demo Manager")
EMPLOYEE_PASSWORD = "Employee@123"

LATIN_FIRST = ["Aarav", "Vivaan", "Aditya", "Sai", "Arjun", "Rohan", "Sneha", "Priya", "Ananya", "Kavya", "Neha", "Pooja", "Amit", "Rahul", "Sunil", "Meera"]
LATIN_LAST = ["Patil", "Deshmukh", "Kulkarni", "Joshi", "Shinde", "Jadhav", "More", "Pawar", "Gaikwad", "Kale", "Sharma", "Verma", "Mehta", "Shah"]
DEVANAGARI = [
    "राहुल शर्मा", "प्रिया देशमुख", "सचिन पाटील", "स्नेहा कुलकर्णी", "अमित जोशी", "पूजा शिंदे",
    "विकास जाधव", "मीरा पवार", "रोहित मोरे", "कविता गायकवाड", "सुनील काळे", "अनिता भोसले",
]
CITIES = ["Pune", "Mumbai", "Nashik", "Nagpur", "Kolhapur", "Aurangabad", "Thane", "Solapur", "Satara", "Sangli"]
CATEGORIES = ["Retail", "Wholesale", "Distributor", "Corporate", "Individual"]
COMPANIES = ["Sahyadri Traders", "Omkar Enterprises", "Shree Ganesh Stores", "Jai Malhar Agro", "Nisarg Foods", "Vighnaharta Logistics"]
INTERESTS = ["Insurance", "Mutual funds", "Home loan", "Gold loan", "Fixed deposit", "Credit card"]
FICTIONAL_AREAS = [202, 212, 213, 214, 305, 312, 404, 415, 512, 602, 617, 702, 713, 808, 917, 206, 303, 314, 407, 206]


def phone_source(mode: str, rng: random.Random):
    used: set[str] = set()
    fictional = [f"+1{area}555{n:04d}" for area in dict.fromkeys(FICTIONAL_AREAS) for n in range(100, 200)]
    rng.shuffle(fictional)
    it = iter(fictional)

    def next_phone() -> str:
        if mode == "fictional":
            try:
                return next(it)
            except StopIteration:
                raise SystemExit("Not enough reserved fictional numbers for that many contacts; use --numbers india") from None
        while True:
            candidate = f"9{rng.randint(100000000, 999999999)}"
            normalized = normalize_phone(candidate)
            if normalized and normalized not in used:
                used.add(normalized)
                return candidate

    return next_phone


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--contacts", type=int, default=400)
    parser.add_argument("--employees", type=int, default=10)
    parser.add_argument("--numbers", choices=["fictional", "india"], default="fictional")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    db = new_session()
    try:
        ensure_reference_data(db)
        if db.scalars(select(Employee.id).where(Employee.email == ADMIN[1])).first():
            print("Demo data already present (admin@example.com exists). Nothing to do.")
            return 0

        roles = {r.name: r.id for r in db.scalars(select(Role))}
        team_a, team_b = Team(name="Sales Team A"), Team(name="Sales Team B")
        db.add_all([team_a, team_b])
        db.flush()

        def person(code, email, password, name, role, team=None, target=30):
            emp = Employee(
                employee_code=code, email=email, full_name=name, password_hash=hash_password(password),
                role_id=roles[role], team_id=team.id if team else None, daily_target=target, password_changed_at=utcnow(),
            )
            db.add(emp)
            return emp

        person(*ADMIN, "admin", target=0)
        person(*MANAGER, "manager", team_a, target=0)
        employees: list[Employee] = []
        for i in range(1, args.employees + 1):
            team = team_a if i <= args.employees // 2 else team_b
            employees.append(person(f"EMP{i:03d}", f"emp{i:03d}@example.com", EMPLOYEE_PASSWORD, f"Employee {i:03d}", "employee", team))
        db.flush()

        set_setting(db, "recording", {"enabled": True, "notice_text": "Calls made through this app are recorded for quality and training purposes."})

        campaigns = [
            Campaign(name="Diwali Offer 2026", status="active", priority=1, description="Festival season outreach", target_calls=2000),
            Campaign(name="Insurance Renewals", status="active", priority=2, description="Policies due in 30 days", target_calls=1500),
            Campaign(name="Old Leads (paused)", status="paused", priority=3, description="Parked until further notice"),
        ]
        db.add_all(campaigns)
        db.flush()

        next_phone = phone_source(args.numbers, rng)
        contacts: list[Contact] = []
        for i in range(args.contacts):
            name = rng.choice(DEVANAGARI) if i % 6 == 0 else f"{rng.choice(LATIN_FIRST)} {rng.choice(LATIN_LAST)}"
            raw = next_phone()
            normalized = normalize_phone(raw)
            assert normalized, raw
            city, category = rng.choice(CITIES), rng.choice(CATEGORIES)
            tags = rng.sample(["vip", "hot-lead", "repeat", "referral", "festival"], k=rng.randint(0, 2))
            custom = {"Company": rng.choice(COMPANIES), "Interest": rng.choice(INTERESTS)}
            contacts.append(
                Contact(
                    name=name, phone_raw=raw, normalized_phone=normalized, location=city, category=category,
                    priority=rng.choices([1, 2, 3], weights=[2, 5, 3])[0], tags=tags, custom_fields=custom,
                    search_text=build_search_text(name=name, phone_raw=raw, normalized_phone=normalized, email=None, location=city, category=category, tags=tags, custom_fields=custom),
                    status="new", source="demo",
                )
            )
        db.add_all(contacts)
        db.flush()

        for i, contact in enumerate(contacts):
            owner = employees[i % len(employees)]
            roll = rng.random()
            campaign = campaigns[0] if roll < 0.5 else campaigns[1] if roll < 0.85 else (campaigns[2] if roll < 0.92 else None)
            db.add(
                ContactAssignment(
                    contact_id=contact.id, employee_id=owner.id, campaign_id=campaign.id if campaign else None,
                    status="active", active_contact_id=contact.id,
                )
            )
            if campaign:
                db.add(CampaignContact(campaign_id=campaign.id, contact_id=contact.id))
        db.commit()

        # A little history so dashboards and the call log are not empty on the first launch.
        start_today, end_today = day_bounds_utc()
        now = utcnow()
        outcomes = ["CONNECTED", "NO_ANSWER", "BUSY", "INTERESTED", "NOT_INTERESTED", "COMPLETED", "SWITCHED_OFF"]
        made = 0
        for emp in employees[:3]:
            mine = db.scalars(
                select(Contact).join(ContactAssignment, ContactAssignment.contact_id == Contact.id)
                .where(ContactAssignment.employee_id == emp.id, ContactAssignment.campaign_id.is_not(None))
                .order_by(Contact.id).limit(8)
            ).all()
            for n, contact in enumerate(mine):
                started = max(start_today + timedelta(minutes=5), now - timedelta(minutes=rng.randint(20, 400)))
                call, _ = call_service.create_call(
                    db, employee=emp, device_id=None,
                    data=CallCreate(client_call_id=f"demo-{emp.id}-{n}-{rng.randint(1000, 9999)}", contact_id=contact.id, started_at=started),
                )
                code = rng.choice(outcomes)
                duration = rng.randint(25, 240) if code in ("CONNECTED", "INTERESTED", "NOT_INTERESTED", "COMPLETED") else 0
                call.ended_at = started + timedelta(seconds=duration + rng.randint(8, 30))
                call.duration_seconds = duration
                call.answered_at = call.ended_at - timedelta(seconds=duration) if duration else None
                call.status = "completed" if duration else "no_answer"
                db.commit()
                call_service.set_disposition(db, user=emp, call=call, data=DispositionIn(disposition_code=code, notes="Demo call" if duration else None))
                made += 1

        for emp, offset_minutes in ((employees[0], -3), (employees[0], 90), (employees[1], -10)):
            contact = db.scalars(
                select(Contact).join(ContactAssignment, ContactAssignment.contact_id == Contact.id)
                .where(ContactAssignment.employee_id == emp.id, Contact.status == "new").order_by(Contact.id.desc()).limit(1)
            ).first()
            if contact:
                when = min(now + timedelta(minutes=offset_minutes), end_today - timedelta(minutes=5))
                callback_service.schedule(db, employee_id=emp.id, contact=contact, when=when, note="Asked to call back")
        db.commit()

        print("\nDemo data created.\n")
        print(f"  Contacts: {len(contacts)}   Employees: {len(employees)}   Campaigns: {len(campaigns)}   Calls: {made}")
        print("\n  Logins (DEMO ONLY - change or delete before any real use):")
        print(f"    Admin     {ADMIN[1]:<24} {ADMIN[2]}")
        print(f"    Manager   {MANAGER[1]:<24} {MANAGER[2]}")
        print(f"    Employee  EMP001 or emp001@example.com ... EMP{args.employees:03d}   {EMPLOYEE_PASSWORD}")
        if args.numbers == "fictional":
            print("\n  Contact numbers are reserved fictional numbers (+1 xxx 555-01xx): calling them cannot reach real people.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
