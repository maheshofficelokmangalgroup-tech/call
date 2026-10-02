"""Add a believable calling HISTORY to a DEMO database, so the admin panel has something to show.

    python -m scripts.seed_demo                       # employees, contacts, campaigns (once)
    python -m scripts.seed_history --days 30          # a month of calls, outcomes, notes, recordings, devices and live calls
    python -m scripts.seed_history --rename           # also give the demo employees realistic names

NEVER run this against a production database: it writes thousands of invented calls.
The generated recordings are short synthetic clips (tones that sound like two people taking turns), not real speech.
"""

from __future__ import annotations

import argparse
import io
import math
import random
import sys
import uuid
import wave
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.database import get_engine, new_session
from app.core.timeutils import UTC, business_date, business_tz, utcnow
from app.models.call import Call, CallDisposition, CallEvent, CallNote
from app.models.contact import Contact, ContactAssignment
from app.models.employee import Employee, EmployeeDevice, EmployeeSession, Role
from app.models.recording import REC_AVAILABLE, REC_FAILED, REC_UPLOADING, Recording
from app.services.recording_service import recording_key
from app.services.storage import get_storage

NAMES = [
    ("Aarav Patil", "Samsung Galaxy M34", "14"),
    ("Sneha Kulkarni", "Redmi Note 12", "13"),
    ("Rohan Deshmukh", "Realme 11x 5G", "14"),
    ("Priya Joshi", "Vivo T2x", "13"),
    ("Amit Shinde", "OnePlus Nord CE 3", "14"),
    ("Pooja Jadhav", "Samsung Galaxy A14", "13"),
    ("Vikas More", "Redmi 12 5G", "13"),
    ("Meera Pawar", "Motorola G54", "14"),
    ("Sachin Gaikwad", "Realme Narzo 60", "13"),
    ("Anita Bhosale", "Infinix Note 30", "12"),
    ("Kunal Sharma", "Poco M6 Pro", "14"),
    ("Neha Mehta", "Samsung Galaxy F14", "13"),
]
NOTES = [
    "Interested in the festival offer. Asked to send details on WhatsApp.",
    "Will discuss with the family and call back tomorrow.",
    "Wants a quote for 50 units. Share the price list.",
    "Already has a policy elsewhere, renewal in March.",
    "Busy right now - asked to call after 6 PM.",
    "Needs the revised rate card before deciding.",
    "Not the decision maker. Owner is Mr. Joshi, available on weekends.",
    "Positive response. Visit scheduled for Saturday.",
]
HOUR_WEIGHT = {9: 0.6, 10: 1.0, 11: 1.15, 12: 0.9, 13: 0.2, 14: 0.8, 15: 1.0, 16: 1.05, 17: 0.85, 18: 0.4}

ANSWERED_OUTCOMES = [("CONNECTED", 34), ("INTERESTED", 22), ("NOT_INTERESTED", 16), ("CALLBACK", 10), ("FOLLOW_UP", 6), ("COMPLETED", 11), ("DO_NOT_CONTACT", 1)]
UNANSWERED_OUTCOMES = [("NO_ANSWER", 62), ("BUSY", 18), ("SWITCHED_OFF", 15), ("INVALID_NUMBER", 5)]


@dataclass
class Profile:
    per_day: int
    answer_rate: float
    talk_mean: int
    attendance: float = 0.95
    first_day_offset: int = 0  # days after the start of the period when the person joined
    last_day_offset: int = 0  # days before today when the person stopped (deactivated)


PROFILES = [
    Profile(68, 0.62, 128),
    Profile(60, 0.56, 104),
    Profile(52, 0.50, 96),
    Profile(48, 0.47, 88, attendance=0.9),
    Profile(44, 0.52, 150),
    Profile(40, 0.44, 70),
    Profile(36, 0.41, 64, attendance=0.88),
    Profile(32, 0.46, 82, first_day_offset=21),  # joined three weeks into the period
    Profile(26, 0.36, 52, attendance=0.75),
    Profile(30, 0.40, 60, last_day_offset=11),  # left eleven days ago
]


def weighted(rng: random.Random, options: list[tuple[str, int]]) -> str:
    return rng.choices([o[0] for o in options], weights=[o[1] for o in options])[0]


def synth_clip(seconds: int, rng: random.Random) -> bytes:
    """8 kHz mono 8-bit WAV of two 'voices' taking turns - plays in any browser, a few KB per second."""
    rate = 8000
    total = rate * seconds
    samples = bytearray([128]) * total
    pos, speaker = 0, 0
    while pos < total:
        turn_end = min(total, pos + int(rng.uniform(1.2, 3.5) * rate))
        base = 118 if speaker == 0 else 205
        while pos < turn_end:
            length = int(rng.uniform(0.12, 0.26) * rate)
            f0 = base * rng.uniform(0.9, 1.25)
            for i in range(min(length, total - pos)):
                envelope = math.sin(math.pi * i / length) ** 1.5
                x = 0.55 * math.sin(2 * math.pi * f0 * i / rate) + 0.25 * math.sin(4 * math.pi * f0 * i / rate) + 0.14 * math.sin(6 * math.pi * f0 * i / rate) + rng.uniform(-0.04, 0.04)
                samples[pos + i] = max(0, min(255, 128 + int(62 * envelope * x)))
            pos += length + int(rng.uniform(0.03, 0.11) * rate)
        pos += int(rng.uniform(0.1, 0.5) * rate)
        speaker ^= 1
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(1)
        w.setframerate(rate)
        w.writeframes(bytes(samples))
    return buffer.getvalue()


def day_factor(day: date) -> float:
    return {5: 0.6, 6: 0.04}.get(day.weekday(), 1.0)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--recorded", type=float, default=0.30, help="share of answered calls that have a playable recording")
    parser.add_argument("--recording-days", type=int, default=10, help="only the most recent N days get recording files (keeps the disk small)")
    parser.add_argument("--rename", action="store_true", help="give the demo employees realistic names")
    args = parser.parse_args()

    settings = get_settings()
    if settings.app_env == "production":
        raise SystemExit("Refusing to add demo history to a production environment.")
    print(f"Database: {get_engine().url.render_as_string(hide_password=True)}")

    rng = random.Random(args.seed)
    db = new_session()
    try:
        staff_role = db.scalars(select(Role).where(Role.name == "employee")).one()
        employees = list(db.scalars(select(Employee).where(Employee.role_id == staff_role.id).order_by(Employee.id)))
        if not employees:
            raise SystemExit("There are no employees yet. Run `python -m scripts.seed_demo` first.")
        if db.scalar(select(func.count(Call.id)).where(Call.client_call_id.like("hist-%"))):
            print("History was already generated for this database. Nothing to do.")
            return 0
        dispositions = {d.code: d.id for d in db.scalars(select(CallDisposition))}
        tz = business_tz()
        today = business_date()
        now = utcnow()
        storage = get_storage()

        if args.rename:
            for emp, (name, _device, _os) in zip(employees, NAMES):
                emp.full_name = name
            db.commit()

        pool = [synth_clip(seconds, rng) for seconds in (6, 8, 9, 11, 12, 14, 16, 18)]
        pool_seconds = [6, 8, 9, 11, 12, 14, 16, 18]

        totals = {"calls": 0, "answered": 0, "recordings": 0}
        for index, emp in enumerate(employees):
            prof = PROFILES[index % len(PROFILES)]
            assigned = list(
                db.execute(
                    select(Contact, ContactAssignment.campaign_id)
                    .join(ContactAssignment, ContactAssignment.contact_id == Contact.id)
                    .where(ContactAssignment.employee_id == emp.id)
                ).all()
            )
            device = db.scalars(select(EmployeeDevice).where(EmployeeDevice.employee_id == emp.id)).first()
            if device is None:
                _name, model, os_version = NAMES[index % len(NAMES)]
                device = EmployeeDevice(
                    employee_id=emp.id, device_uid=f"demo-device-{emp.id}", device_name=model, os_version=f"Android {os_version}",
                    app_version="1.0.1", first_seen_at=now - timedelta(days=args.days), last_seen_at=now, last_ip=f"49.36.{rng.randint(10, 250)}.{rng.randint(2, 250)}",
                )
                db.add(device)
                db.flush()

            serial = 0
            for back in range(args.days - 1, -1, -1):
                day = today - timedelta(days=back)
                if (args.days - 1 - back) < prof.first_day_offset or back < prof.last_day_offset:
                    continue
                factor = day_factor(day)
                if factor < 0.1 and rng.random() > 0.05:
                    continue
                if rng.random() > prof.attendance * (1.0 if factor >= 1 else 0.8):
                    continue
                target = max(3, int(prof.per_day * factor * rng.uniform(0.72, 1.25)))
                t = datetime.combine(day, time(9, 20), tz) + timedelta(minutes=rng.randint(0, 28 + 6 * (index % 4)))
                work_end = datetime.combine(day, time(18, 35), tz) - timedelta(minutes=rng.randint(0, 45))
                slot = (work_end - t).total_seconds() * 0.88 / target
                rows: list[Call] = []
                plans: list[dict] = []
                while t < work_end and len(plans) < target:
                    if time(13, 0) <= t.timetz().replace(tzinfo=None) < time(14, 0):
                        t = datetime.combine(day, time(14, rng.randint(0, 12)), tz)
                        continue
                    answered = rng.random() < prof.answer_rate
                    ring = rng.randint(6, 26) if answered else rng.randint(18, 42)
                    talk = max(8, min(1100, int(rng.lognormvariate(math.log(prof.talk_mean), 0.65)))) if answered else 0
                    start_utc = t.astimezone(UTC)
                    end_utc = start_utc + timedelta(seconds=ring + talk)
                    if end_utc > now - timedelta(minutes=4):
                        break
                    plans.append({"start": start_utc, "ring": ring, "talk": talk, "answered": answered})
                    t = t + timedelta(seconds=ring + talk) + timedelta(seconds=max(8, rng.gauss(slot - (ring + talk), slot * 0.35)))
                if not plans:
                    continue

                for plan in plans:
                    serial += 1
                    contact, campaign_id = rng.choice(assigned) if assigned and rng.random() < 0.92 else (None, None)
                    phone = contact.normalized_phone if contact else f"+9198{rng.randint(10000000, 99999999)}"
                    started = plan["start"]
                    answered_at = started + timedelta(seconds=plan["ring"]) if plan["answered"] else None
                    ended = started + timedelta(seconds=plan["ring"] + plan["talk"])
                    code = weighted(rng, ANSWERED_OUTCOMES if plan["answered"] else UNANSWERED_OUTCOMES)
                    call = Call(
                        employee_id=emp.id, contact_id=contact.id if contact else None, campaign_id=campaign_id,
                        client_call_id=f"hist-{emp.id}-{serial}", phone_number_snapshot=phone,
                        contact_name_snapshot=contact.name if contact else None, direction="outgoing",
                        attempt_number=1, started_at=started, answered_at=answered_at, ended_at=ended,
                        duration_seconds=plan["talk"], status="completed" if plan["answered"] else "no_answer",
                        disposition_id=dispositions.get(code), disposition_at=ended + timedelta(seconds=rng.randint(12, 70)), device_id=device.id,
                    )
                    plan.update(call=call, code=code)
                    rows.append(call)
                db.add_all(rows)
                db.flush()

                recent = back < args.recording_days
                for plan in plans:
                    call: Call = plan["call"]
                    totals["calls"] += 1
                    report: dict[str, str] | None = None
                    if plan["answered"]:
                        totals["answered"] += 1
                        roll = rng.random()
                        if recent and roll < args.recorded:
                            report = {"recording": "saved"}
                            seconds = min(plan["talk"], 18)
                            idx = min(range(len(pool_seconds)), key=lambda i: abs(pool_seconds[i] - seconds))
                            data = pool[idx]
                            key = recording_key(call, "audio/wav")
                            size, digest = storage.save(key, io.BytesIO(data), "audio/wav", 50 * 1024 * 1024)
                            db.add(
                                Recording(
                                    uid=str(uuid.uuid4()), call_id=call.id, employee_id=emp.id, storage_backend=storage.name, storage_key=key,
                                    content_type="audio/wav", size_bytes=size, declared_size_bytes=size, duration_seconds=pool_seconds[idx],
                                    checksum_sha256=digest, upload_status=REC_AVAILABLE, uploaded_at=call.ended_at + timedelta(seconds=rng.randint(10, 90)),
                                    created_at=call.ended_at + timedelta(seconds=5),
                                )
                            )
                            totals["recordings"] += 1
                        elif roll < 0.80:
                            report = {"recording": "silent", "recording_detail": "The microphone delivered only silence while the call was on (Android blocks it)."}
                        elif roll < 0.87:
                            report = {"recording": "no_permission"}
                        elif roll < 0.91:
                            report = {"recording": "failed", "recording_detail": "MediaRecorder start failed: status=-38"}
                        elif roll < 0.94:
                            report = {"recording": "saved"}
                        # else: an older app version that reports nothing
                        if rng.random() < 0.12:
                            db.add(CallNote(call_id=call.id, contact_id=call.contact_id, author_id=emp.id, body=rng.choice(NOTES), created_at=call.ended_at + timedelta(seconds=rng.randint(15, 80))))

                    started = call.started_at
                    events = [("initiated", started, {"attempt": 1}), ("dialing", started + timedelta(seconds=1), None), ("ringing", started + timedelta(seconds=3), None)]
                    if call.answered_at:
                        events.append(("connected", call.answered_at, None))
                    events.append(("ended", call.ended_at, report))
                    if call.disposition_at:
                        events.append(("disposition", call.disposition_at, {"code": plan["code"]}))
                    for kind, at, payload in events:
                        db.add(CallEvent(call_id=call.id, event_type=kind, occurred_at=at, payload=payload))
                db.commit()

            emp.last_login_at = now - timedelta(hours=rng.randint(1, 9))
            db.commit()
            print(f"  {emp.employee_code} {emp.full_name:<18} done")

        # ---- people on a call right now, and a recording that is still uploading ------------------------------------
        live_people = [e for e in employees[:5]]
        live_calls: list[Call] = []
        for emp, minutes, answered in ((live_people[0], 4, True), (live_people[2], 1, False), (live_people[3], 7, True)):
            assigned = list(db.execute(select(Contact).join(ContactAssignment, ContactAssignment.contact_id == Contact.id).where(ContactAssignment.employee_id == emp.id).limit(30)).scalars())
            contact = rng.choice(assigned) if assigned else None
            started = now - timedelta(minutes=minutes)
            call = Call(
                employee_id=emp.id, contact_id=contact.id if contact else None, client_call_id=f"hist-live-{emp.id}",
                phone_number_snapshot=contact.normalized_phone if contact else "+919822012345", contact_name_snapshot=contact.name if contact else None,
                direction="outgoing", attempt_number=1, started_at=started, answered_at=started + timedelta(seconds=12) if answered else None,
                status="connected" if answered else "ringing",
            )
            db.add(call)
            live_calls.append(call)
        db.flush()
        for call in live_calls:
            db.add(CallEvent(call_id=call.id, event_type="initiated", occurred_at=call.started_at, payload={"attempt": 1}))
            db.add(CallEvent(call_id=call.id, event_type="ringing", occurred_at=call.started_at + timedelta(seconds=3), payload=None))
            if call.answered_at:
                db.add(CallEvent(call_id=call.id, event_type="connected", occurred_at=call.answered_at, payload=None))
        db.commit()

        latest = db.scalars(
            select(Call).outerjoin(Recording, Recording.call_id == Call.id).where(Recording.id.is_(None), Call.status == "completed").order_by(Call.started_at.desc()).limit(2)
        ).all()
        for call, state, reason in zip(latest, (REC_UPLOADING, REC_FAILED), (None, "Checksum mismatch")):
            db.add(
                Recording(
                    uid=str(uuid.uuid4()), call_id=call.id, employee_id=call.employee_id, storage_backend=storage.name, storage_key=recording_key(call, "audio/wav"),
                    content_type="audio/wav", size_bytes=0, declared_size_bytes=120_000, duration_seconds=min(call.duration_seconds, 18), upload_status=state, failure_reason=reason,
                )
            )
        db.commit()

        # ---- sessions: who has the app open ---------------------------------------------------------------------
        ages = [0.4, 1.5, 2, 3, 22, 41, 190, 600, 1500, 4000]  # minutes since each employee's app last talked to the server
        for emp, age in zip(employees, ages):
            if not emp.is_active:
                continue
            last_used = now - timedelta(minutes=age)
            device = db.scalars(select(EmployeeDevice).where(EmployeeDevice.employee_id == emp.id)).first()
            db.add(
                EmployeeSession(
                    id=str(uuid.uuid4()), employee_id=emp.id, device_id=device.id if device else None, refresh_hash=uuid.uuid4().hex + uuid.uuid4().hex,
                    created_at=now - timedelta(days=3), last_used_at=last_used, expires_at=now + timedelta(days=27), ip=device.last_ip if device else None,
                    user_agent="EmployeeCalling/1.0.1 (Android)",
                )
            )
            if device:
                device.last_seen_at = last_used
        # the employee who left is deactivated
        if len(employees) >= 10:
            employees[9].is_active = False
        db.commit()

        print(f"\nHistory created: {totals['calls']} calls ({totals['answered']} answered), {totals['recordings']} recordings, 3 calls in progress.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
