"""Administrator analytics: range based numbers for the web panel (sections 8.1, 8.2, 8.5 and 21).

Every figure is computed from raw call rows, so totals always reconcile with the call list. Days and hours are business
timezone (APP_TIMEZONE) values; the database stores UTC, so day/hour buckets are computed with integer arithmetic on the epoch
seconds plus the timezone's UTC offset - the same SQL works on SQLite (development, tests) and MySQL (production).

Definitions (section 21):
  calls            call attempts that started in the period
  connected        attempts that were answered (status connected / completed)
  answer_rate      connected / calls
  talk_seconds     sum of the duration of connected attempts;  avg_talk = talk / connected
  avg_ring         seconds between dialing and the other side picking up (connected attempts)
"""

from __future__ import annotations

import csv
import io
from collections import defaultdict
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from sqlalchemy import Integer, and_, case, func, literal_column, select
from sqlalchemy.orm import Session

from app.core.errors import ValidationFailed
from app.core.timeutils import business_date, business_tz, day_bounds_utc, utcnow
from app.models.call import (
    CALL_ANSWERED_STATUSES,
    CALL_IN_PROGRESS_STATUSES,
    CALL_NO_ANSWER,
    Call,
    CallDisposition,
    CallEvent,
    Callback,
)
from app.models.employee import Employee, EmployeeDevice, EmployeeSession, Role, Team
from app.models.recording import REC_AVAILABLE, Recording
from app.schemas.analytics import (
    ContactStat,
    DayPoint,
    DeviceStatus,
    EmployeeCounts,
    EmployeeDetailOut,
    EmployeeMetrics,
    EmployeeStatsOut,
    HourPoint,
    LiveCall,
    LiveOut,
    LiveToday,
    NotRecordedReason,
    OutcomeCount,
    OverviewOut,
    PeriodOut,
    PresenceCounts,
    RecentCall,
    RecordingInsight,
    StatusCount,
    Totals,
)
from app.services import call_service, heartbeat_service
from app.services.scope import visible_employee_ids
from app.services.settings_service import get_recording_config

MAX_RANGE_DAYS = 366
LIVE_WINDOW = timedelta(hours=2)  # a call that never reported its end stops counting as "on a call" after this long
ONLINE_WINDOW = timedelta(minutes=5)
IDLE_WINDOW = timedelta(hours=1)
LEADERBOARD_SIZE = 8

ANSWERED = sorted(CALL_ANSWERED_STATUSES)
IN_PROGRESS = sorted(CALL_IN_PROGRESS_STATUSES)

NOT_RECORDED_LABELS = {
    "silent": "The phone gave only silence",
    "no_permission": "Microphone permission is off",
    "failed": "The recorder could not run",
    "saved": "Saved on the phone, upload pending",
    "unreported": "No report (older app or the phone's own dialer)",
}


# ------------------------------------------------------------------------------------------------- date ranges
@dataclass(frozen=True)
class DateRange:
    first: date  # first business day (inclusive)
    last: date  # last business day (inclusive)
    start: datetime  # UTC instant the period starts
    end: datetime  # UTC instant the period ends (exclusive)
    offset_minutes: int  # business timezone offset from UTC used for day/hour buckets

    @property
    def days(self) -> int:
        return (self.last - self.first).days + 1


def _offset_minutes(day: date) -> int:
    offset = datetime.combine(day, time(12), tzinfo=business_tz()).utcoffset()
    return int(offset.total_seconds() // 60) if offset else 0


def _range_of(first: date, last: date) -> DateRange:
    mid = first + timedelta(days=(last - first).days // 2)
    return DateRange(first=first, last=last, start=day_bounds_utc(first)[0], end=day_bounds_utc(last)[1], offset_minutes=_offset_minutes(mid))


def resolve_range(date_from: date | None, date_to: date | None, *, default_days: int = 7) -> DateRange:
    """Business-day range [date_from, date_to]; defaults to the last `default_days` days including today."""
    last = date_to or business_date()
    first = date_from or (last - timedelta(days=default_days - 1))
    if first > last:
        raise ValidationFailed("The start date must not be after the end date.", code="bad_range")
    if (last - first).days + 1 > MAX_RANGE_DAYS:
        raise ValidationFailed(f"Choose a period of at most {MAX_RANGE_DAYS} days.", code="range_too_long")
    return _range_of(first, last)


def previous_range(rng: DateRange) -> DateRange:
    length = rng.days
    return _range_of(rng.first - timedelta(days=length), rng.first - timedelta(days=1))


def period_out(rng: DateRange) -> PeriodOut:
    prev = previous_range(rng)
    return PeriodOut(
        date_from=rng.first,
        date_to=rng.last,
        days=rng.days,
        timezone=str(business_tz()),
        previous_from=prev.first,
        previous_to=prev.last,
    )


# ------------------------------------------------------------------------------------------------- SQL helpers
def _dialect(db: Session) -> str:
    return db.get_bind().dialect.name


def _epoch(db: Session, column):
    """Seconds since 1970-01-01 of a UTC DATETIME column, identical on SQLite and MySQL."""
    if _dialect(db) == "sqlite":
        return func.cast(func.strftime("%s", column), Integer)
    return func.timestampdiff(literal_column("SECOND"), literal_column("'1970-01-01 00:00:00'"), column)


def _local_second(db: Session, column, offset_minutes: int):
    """Seconds since local midnight of 1970-01-01 (business timezone) - divide by 86400 for the day, mod for the time."""
    return _epoch(db, column) + literal_column(str(offset_minutes * 60), Integer)


def _day_hour(db: Session, rng: DateRange, column=Call.started_at):
    local = _local_second(db, column, rng.offset_minutes)
    day = (local // literal_column("86400", Integer)).label("d")
    hour = ((local % literal_column("86400", Integer)) // literal_column("3600", Integer)).label("h")
    return day, hour


def _epoch_day(index: int) -> date:
    return date(1970, 1, 1) + timedelta(days=int(index))


def _answered_expr():
    return case((Call.status.in_(ANSWERED), 1), else_=0)


def _talk_expr():
    return case((Call.status.in_(ANSWERED), Call.duration_seconds), else_=0)


# ------------------------------------------------------------------------------------------------- scoping
def resolve_scope(db: Session, user: Employee, employee_id: int | None = None, team_id: int | None = None) -> tuple[str, list[int] | None]:
    """Which employees' calls the caller may look at. `None` means everyone (administrators without a filter)."""
    visible = visible_employee_ids(db, user)
    if employee_id is not None:
        if visible is not None and employee_id not in visible:
            return "employee", []
        return "employee", [employee_id]
    if team_id is not None:
        ids = list(db.scalars(select(Employee.id).where(Employee.team_id == team_id)))
        if visible is not None:
            ids = [i for i in ids if i in visible]
        return "team", ids
    if visible is None:
        return "organization", None
    return ("employee" if len(visible) == 1 else "team"), visible


def _call_conditions(scope: list[int] | None, start: datetime, end: datetime) -> list:
    conditions = [Call.started_at >= start, Call.started_at < end]
    if scope is not None:
        conditions.append(Call.employee_id.in_(scope))
    return conditions


# ------------------------------------------------------------------------------------------------- totals
def _totals(db: Session, scope: list[int] | None, rng: DateRange) -> Totals:
    conds = _call_conditions(scope, rng.start, rng.end)
    answered, talk = _answered_expr(), _talk_expr()
    ring_seconds = _epoch(db, Call.answered_at) - _epoch(db, Call.started_at)
    ring = case((and_(Call.status.in_(ANSWERED), Call.answered_at.is_not(None), ring_seconds >= 0, ring_seconds <= 900), ring_seconds), else_=None)
    row = db.execute(
        select(
            func.count(Call.id),
            func.coalesce(func.sum(answered), 0),
            func.coalesce(func.sum(case((Call.status == CALL_NO_ANSWER, 1), else_=0)), 0),
            func.coalesce(func.sum(case((Call.status == "failed", 1), else_=0)), 0),
            func.coalesce(func.sum(talk), 0),
            func.coalesce(func.max(talk), 0),
            func.avg(ring),
            func.count(Call.phone_number_snapshot.distinct()),
            func.count(Call.employee_id.distinct()),
            func.coalesce(func.sum(case((and_(Call.disposition_id.is_(None), Call.status.not_in(IN_PROGRESS)), 1), else_=0)), 0),
        ).where(*conds)
    ).one()
    calls, connected, no_answer, failed, talk_total, longest, avg_ring, contacts, employees, pending = row
    calls, connected, talk_total = int(calls), int(connected), int(talk_total)
    recordings = db.scalar(
        select(func.count(Recording.id)).join(Call, Call.id == Recording.call_id).where(*conds, Recording.upload_status == REC_AVAILABLE)
    )
    callback_stmt = select(func.count(Callback.id)).where(Callback.created_at >= rng.start, Callback.created_at < rng.end)
    if scope is not None:
        callback_stmt = callback_stmt.where(Callback.employee_id.in_(scope))
    return Totals(
        calls=calls,
        connected=connected,
        no_answer=int(no_answer),
        failed=int(failed),
        answer_rate=round(100.0 * connected / calls, 1) if calls else 0.0,
        talk_seconds=talk_total,
        avg_talk_seconds=int(talk_total / connected) if connected else 0,
        longest_call_seconds=int(longest),
        avg_ring_seconds=int(round(float(avg_ring))) if avg_ring is not None else 0,
        unique_contacts=int(contacts),
        active_employees=int(employees),
        pending_wrapup=int(pending),
        recordings=int(recordings or 0),
        callbacks_created=int(db.scalar(callback_stmt) or 0),
    )


# ------------------------------------------------------------------------------------------------- time series
def _time_buckets(db: Session, scope: list[int] | None, rng: DateRange) -> tuple[list[DayPoint], list[HourPoint], list[list[int]]]:
    """Calls per day (gap filled), per hour of day, and per weekday x hour - from one grouped query."""
    day, hour = _day_hour(db, rng)
    rows = db.execute(
        select(day, hour, func.count(Call.id), func.sum(_answered_expr()), func.sum(_talk_expr()))
        .where(*_call_conditions(scope, rng.start, rng.end))
        .group_by("d", "h")
    ).all()
    per_day: dict[date, list[int]] = {rng.first + timedelta(days=i): [0, 0, 0] for i in range(rng.days)}
    hourly = [[0, 0] for _ in range(24)]
    heatmap = [[0] * 24 for _ in range(7)]
    for d_idx, h_idx, calls, connected, talk in rows:
        local_day, h = _epoch_day(d_idx), int(h_idx)
        bucket = per_day.get(local_day)
        if bucket is None:  # a call right at the edge of the range (offset rounding): ignore
            continue
        bucket[0] += int(calls)
        bucket[1] += int(connected or 0)
        bucket[2] += int(talk or 0)
        hourly[h][0] += int(calls)
        hourly[h][1] += int(connected or 0)
        heatmap[local_day.weekday()][h] += int(calls)
    series = [DayPoint(date=d, calls=v[0], connected=v[1], talk_seconds=v[2]) for d, v in sorted(per_day.items())]
    return series, [HourPoint(hour=h, calls=v[0], connected=v[1]) for h, v in enumerate(hourly)], heatmap


def _outcomes(db: Session, scope: list[int] | None, rng: DateRange) -> list[OutcomeCount]:
    rows = db.execute(
        select(CallDisposition.code, CallDisposition.label, CallDisposition.category, func.count(Call.id))
        .select_from(Call)
        .outerjoin(CallDisposition, CallDisposition.id == Call.disposition_id)
        .where(*_call_conditions(scope, rng.start, rng.end))
        .group_by(CallDisposition.code, CallDisposition.label, CallDisposition.category)
    ).all()
    result = [OutcomeCount(code=code, label=label or "No outcome yet", category=category, count=int(count)) for code, label, category, count in rows]
    return sorted(result, key=lambda o: (-o.count, o.label))


def _statuses(db: Session, scope: list[int] | None, rng: DateRange) -> list[StatusCount]:
    rows = db.execute(select(Call.status, func.count(Call.id)).where(*_call_conditions(scope, rng.start, rng.end)).group_by(Call.status)).all()
    return sorted((StatusCount(status=s, count=int(c)) for s, c in rows), key=lambda s: -s.count)


# ------------------------------------------------------------------------------------------------- recordings
def _recording_insight(db: Session, scope: list[int] | None, rng: DateRange, totals: Totals) -> RecordingInsight:
    """How many answered calls have a recording, and - from what the phones reported - why the others do not."""
    conds = _call_conditions(scope, rng.start, rng.end)
    reason = CallEvent.payload["recording"].as_string().label("reason")
    rows = db.execute(
        select(reason, func.count(Call.id.distinct()))
        .select_from(CallEvent)
        .join(Call, Call.id == CallEvent.call_id)
        .outerjoin(Recording, Recording.call_id == Call.id)
        .where(*conds, Call.status.in_(ANSWERED), CallEvent.event_type == "ended", Recording.id.is_(None))
        .group_by("reason")
    ).all()
    counts: dict[str, int] = defaultdict(int)
    for value, count in rows:
        key = value if value in NOT_RECORDED_LABELS else "unreported"
        counts[key] += int(count)
    answered = totals.connected
    recorded = totals.recordings
    # answered calls without a recording whose end was never reported are "unreported" as well
    unaccounted = max(0, answered - recorded - sum(counts.values()))
    if unaccounted:
        counts["unreported"] += unaccounted
    reasons = [NotRecordedReason(reason=k, label=NOT_RECORDED_LABELS[k], count=v) for k, v in counts.items() if v]
    reasons.sort(key=lambda r: -r.count)
    return RecordingInsight(
        enabled=bool(get_recording_config(db).get("enabled")),
        answered_calls=answered,
        recorded_calls=recorded,
        coverage_percent=round(100.0 * recorded / answered, 1) if answered else 0.0,
        not_recorded=reasons,
    )


# ------------------------------------------------------------------------------------------------- employees
def _presence(is_active: bool, on_call: bool, last_seen: datetime | None, now: datetime) -> str:
    if not is_active:
        return "inactive"
    if on_call:
        return "on_call"
    if last_seen is not None:
        age = now - last_seen
        if age <= ONLINE_WINDOW:
            return "online"
        if age <= IDLE_WINDOW:
            return "idle"
    return "offline"


def _device_status(device: EmployeeDevice | None, fresh: dict | None) -> DeviceStatus | None:
    """The phone's own report: the live one from Redis if the app is open, else the last one that was saved on the device's row."""
    if fresh:
        return DeviceStatus(
            live=True,
            last_heartbeat_at=datetime.fromisoformat(fresh["at"]),
            app_state=fresh.get("app_state"),
            battery_percent=fresh.get("battery_percent"),
            charging=fresh.get("charging"),
            network=fresh.get("network"),
            permissions_ok=fresh.get("permissions_ok"),
            missing_permissions=list(fresh.get("missing_permissions") or []),
            pending_sync=fresh.get("pending_sync"),
            clock_skew_seconds=fresh.get("clock_skew_seconds"),
        )
    if device is not None and device.last_heartbeat_at is not None:
        return DeviceStatus(
            live=False,
            last_heartbeat_at=device.last_heartbeat_at,
            app_state=device.app_state,
            battery_percent=device.battery_percent,
            charging=device.charging,
            network=device.network_type,
            permissions_ok=device.permissions_ok,
            missing_permissions=[p for p in (device.missing_permissions or "").split(",") if p],
            pending_sync=device.pending_sync,
            clock_skew_seconds=device.clock_skew_seconds,
        )
    return None


def _on_call_employee_ids(db: Session, ids: list[int] | None, now: datetime) -> set[int]:
    stmt = select(Call.employee_id).where(Call.ended_at.is_(None), Call.status.in_(IN_PROGRESS), Call.started_at >= now - LIVE_WINDOW).distinct()
    if ids is not None:
        stmt = stmt.where(Call.employee_id.in_(ids))
    return set(db.scalars(stmt))


def _employee_rows(
    db: Session,
    user: Employee,
    rng: DateRange,
    *,
    only_ids: list[int] | None = None,
    q: str | None = None,
    team_id: int | None = None,
    role: str | None = None,
    state: str = "all",
) -> list[EmployeeMetrics]:
    """Profile + figures of the period for every employee the caller may see."""
    now = utcnow()
    visible = visible_employee_ids(db, user)
    stmt = select(Employee).join(Role, Role.id == Employee.role_id)
    if visible is not None:
        stmt = stmt.where(Employee.id.in_(visible))
    if only_ids is not None:
        stmt = stmt.where(Employee.id.in_(only_ids))
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            func.lower(Employee.full_name).like(like) | func.lower(Employee.email).like(like) | func.lower(Employee.employee_code).like(like)
        )
    if team_id is not None:
        stmt = stmt.where(Employee.team_id == team_id)
    if role:
        stmt = stmt.where(Role.name == role)
    if state == "active":
        stmt = stmt.where(Employee.is_active.is_(True))
    elif state == "inactive":
        stmt = stmt.where(Employee.is_active.is_(False))
    employees = list(db.scalars(stmt.order_by(Employee.full_name, Employee.id)).unique())
    if not employees:
        return []
    ids = [e.id for e in employees]

    # figures of the period
    local = _local_second(db, Call.started_at, rng.offset_minutes)
    answered, talk = _answered_expr(), _talk_expr()
    figures = {
        row[0]: row
        for row in db.execute(
            select(
                Call.employee_id,
                func.count(Call.id),
                func.coalesce(func.sum(answered), 0),
                func.coalesce(func.sum(case((Call.status == CALL_NO_ANSWER, 1), else_=0)), 0),
                func.coalesce(func.sum(talk), 0),
                func.coalesce(func.max(talk), 0),
                func.min(Call.started_at),
                func.max(Call.started_at),
                func.count(Call.phone_number_snapshot.distinct()),
                func.count((local // literal_column("86400", Integer)).distinct()),
            )
            .where(*_call_conditions(ids, rng.start, rng.end))
            .group_by(Call.employee_id)
        )
    }
    outcomes: dict[int, dict[str, int]] = defaultdict(dict)
    for emp_id, code, count in db.execute(
        select(Call.employee_id, CallDisposition.code, func.count(Call.id))
        .join(CallDisposition, CallDisposition.id == Call.disposition_id)
        .where(*_call_conditions(ids, rng.start, rng.end))
        .group_by(Call.employee_id, CallDisposition.code)
    ):
        outcomes[emp_id][code] = int(count)
    recordings = dict(
        db.execute(
            select(Call.employee_id, func.count(Recording.id))
            .join(Call, Call.id == Recording.call_id)
            .where(*_call_conditions(ids, rng.start, rng.end), Recording.upload_status == REC_AVAILABLE)
            .group_by(Call.employee_id)
        ).all()
    )

    # typical working hours: average minute of the first / last call of each active day
    day_expr, _hour = _day_hour(db, rng)
    second_of_day = (local % literal_column("86400", Integer)).label("sod")
    per_day = (
        select(Call.employee_id.label("e"), day_expr, func.min(second_of_day).label("first_s"), func.max(second_of_day).label("last_s"))
        .where(*_call_conditions(ids, rng.start, rng.end))
        .group_by(Call.employee_id, "d")
        .subquery()
    )
    hours = {e: (first, last) for e, first, last in db.execute(select(per_day.c.e, func.avg(per_day.c.first_s), func.avg(per_day.c.last_s)).group_by(per_day.c.e))}

    # today
    today_start, today_end = day_bounds_utc()
    today = dict(
        db.execute(
            select(Call.employee_id, func.count(Call.id)).where(*_call_conditions(ids, today_start, today_end)).group_by(Call.employee_id)
        ).all()
    )

    # presence: the freshest sign of life (an authenticated request, a login or a refresh) and the latest device
    seen: dict[int, datetime] = {}
    for emp_id, last in db.execute(select(EmployeeSession.employee_id, func.max(EmployeeSession.last_used_at)).where(EmployeeSession.employee_id.in_(ids)).group_by(EmployeeSession.employee_id)):
        if last:
            seen[emp_id] = last
    latest_device: dict[int, EmployeeDevice] = {}
    for device in db.scalars(select(EmployeeDevice).where(EmployeeDevice.employee_id.in_(ids)).order_by(EmployeeDevice.last_seen_at.desc())):
        latest_device.setdefault(device.employee_id, device)
        if device.last_seen_at and (device.employee_id not in seen or device.last_seen_at > seen[device.employee_id]):
            seen[device.employee_id] = device.last_seen_at
    reports = heartbeat_service.latest(ids)  # what the open apps said in the last minutes (Redis: no database work)
    for emp_id, report in reports.items():
        reported_at = datetime.fromisoformat(report["at"])
        if emp_id not in seen or reported_at > seen[emp_id]:
            seen[emp_id] = reported_at
    on_call = _on_call_employee_ids(db, ids, now)

    result: list[EmployeeMetrics] = []
    for e in employees:
        f = figures.get(e.id)
        calls = int(f[1]) if f else 0
        connected = int(f[2]) if f else 0
        device = latest_device.get(e.id)
        first_s, last_s = hours.get(e.id, (None, None))
        todays = int(today.get(e.id, 0))
        result.append(
            EmployeeMetrics(
                id=e.id,
                employee_code=e.employee_code,
                full_name=e.full_name,
                email=e.email,
                phone=e.phone,
                role=e.role_name,
                team_id=e.team_id,
                team_name=e.team_name,
                is_active=e.is_active,
                daily_target=e.daily_target,
                device_binding_enabled=e.device_binding_enabled,
                must_change_password=e.must_change_password,
                created_at=e.created_at,
                last_login_at=e.last_login_at,
                last_seen_at=seen.get(e.id),
                presence=_presence(e.is_active, e.id in on_call, seen.get(e.id), now),  # type: ignore[arg-type]
                device_name=device.device_name if device else None,
                device_os=device.os_version if device else None,
                app_version=device.app_version if device else None,
                device_status=_device_status(device, reports.get(e.id)),
                calls=calls,
                connected=connected,
                no_answer=int(f[3]) if f else 0,
                answer_rate=round(100.0 * connected / calls, 1) if calls else 0.0,
                talk_seconds=int(f[4]) if f else 0,
                avg_talk_seconds=int(int(f[4]) / connected) if f and connected else 0,
                longest_call_seconds=int(f[5]) if f else 0,
                unique_contacts=int(f[8]) if f else 0,
                active_days=int(f[9]) if f else 0,
                first_call_at=f[6] if f else None,
                last_call_at=f[7] if f else None,
                avg_first_call_minute=int(float(first_s) // 60) if first_s is not None else None,
                avg_last_call_minute=int(float(last_s) // 60) if last_s is not None else None,
                recordings=int(recordings.get(e.id, 0)),
                outcomes=dict(outcomes.get(e.id, {})),
                today_calls=todays,
                today_target_percent=round(100.0 * todays / e.daily_target, 1) if e.daily_target else 0.0,
            )
        )
    return result


SORTS = {
    "calls": lambda m: m.calls,
    "connected": lambda m: m.connected,
    "answer_rate": lambda m: m.answer_rate,
    "talk": lambda m: m.talk_seconds,
    "avg_talk": lambda m: m.avg_talk_seconds,
    "contacts": lambda m: m.unique_contacts,
    "recordings": lambda m: m.recordings,
    "last_seen": lambda m: m.last_seen_at.timestamp() if m.last_seen_at else 0,
    "name": lambda m: m.full_name.lower(),
}


def employee_stats(
    db: Session,
    user: Employee,
    rng: DateRange,
    *,
    q: str | None = None,
    team_id: int | None = None,
    role: str | None = None,
    state: str = "all",
    presence: str | None = None,
    sort: str = "calls",
    descending: bool = True,
) -> EmployeeStatsOut:
    rows = _employee_rows(db, user, rng, q=q, team_id=team_id, role=role, state=state)
    if presence:
        rows = [r for r in rows if r.presence == presence]
    key = SORTS.get(sort, SORTS["calls"])
    if sort == "name":
        rows.sort(key=key, reverse=descending)
    else:  # numeric sorts: ties fall back to the name so the order is stable
        rows.sort(key=lambda m: (key(m), m.full_name.lower()), reverse=descending)
    return EmployeeStatsOut(period=period_out(rng), total=len(rows), items=rows)


# ------------------------------------------------------------------------------------------------- overview
def overview(db: Session, user: Employee, rng: DateRange, *, employee_id: int | None = None, team_id: int | None = None) -> OverviewOut:
    scope_name, scope = resolve_scope(db, user, employee_id, team_id)
    totals = _totals(db, scope, rng)
    previous = _totals(db, scope, previous_range(rng))
    series, hourly, heatmap = _time_buckets(db, scope, rng)

    people = _employee_rows(db, user, rng, only_ids=scope, state="all")
    board = sorted((p for p in people if p.calls), key=lambda m: (-m.calls, -m.talk_seconds, m.full_name.lower()))[:LEADERBOARD_SIZE]
    return OverviewOut(
        period=period_out(rng),
        scope=scope_name,  # type: ignore[arg-type]
        totals=totals,
        previous=previous,
        series=series,
        hourly=hourly,
        heatmap=heatmap,
        outcomes=_outcomes(db, scope, rng),
        statuses=_statuses(db, scope, rng),
        recording=_recording_insight(db, scope, rng, totals),
        employees=EmployeeCounts(total=len(people), active=sum(1 for p in people if p.is_active), with_calls=sum(1 for p in people if p.calls)),
        leaderboard=board,
        generated_at=utcnow(),
    )


# ------------------------------------------------------------------------------------------------- one employee
def _top_contacts(db: Session, employee_id: int, rng: DateRange, limit: int = 20) -> list[ContactStat]:
    """The numbers this employee called most in the period (a manually dialed number counts like a contact)."""
    rows = db.execute(
        select(
            Call.phone_number_snapshot,
            func.max(Call.contact_id),
            func.max(Call.contact_name_snapshot),
            func.count(Call.id),
            func.coalesce(func.sum(_answered_expr()), 0),
            func.coalesce(func.sum(_talk_expr()), 0),
            func.max(Call.started_at),
        )
        .where(*_call_conditions([employee_id], rng.start, rng.end))
        .group_by(Call.phone_number_snapshot)
        .order_by(func.count(Call.id).desc(), func.max(Call.started_at).desc())
        .limit(limit)
    ).all()
    result: list[ContactStat] = []
    for phone, contact_id, name, calls, connected, talk, last in rows:
        last_outcome = db.scalar(
            select(CallDisposition.label)
            .select_from(Call)
            .join(CallDisposition, CallDisposition.id == Call.disposition_id)
            .where(Call.employee_id == employee_id, Call.phone_number_snapshot == phone)
            .order_by(Call.started_at.desc(), Call.id.desc())
            .limit(1)
        )
        result.append(
            ContactStat(contact_id=contact_id, name=name, phone=phone, calls=int(calls), connected=int(connected), talk_seconds=int(talk), last_call_at=last, last_outcome=last_outcome)
        )
    return result


def employee_detail(db: Session, user: Employee, employee_id: int, rng: DateRange) -> EmployeeDetailOut | None:
    rows = _employee_rows(db, user, rng, only_ids=[employee_id])
    if not rows:
        return None
    metrics = rows[0]
    series, hourly, heatmap = _time_buckets(db, [employee_id], rng)
    totals = Totals(calls=metrics.calls, connected=metrics.connected, recordings=metrics.recordings)
    recent, _total = call_service.list_calls(db, user, employee_id=employee_id, page=1, page_size=10)
    devices = list(db.scalars(select(EmployeeDevice).where(EmployeeDevice.employee_id == employee_id).order_by(EmployeeDevice.last_seen_at.desc())))
    from app.schemas.employee import DeviceOut  # local import keeps the module header short

    return EmployeeDetailOut(
        period=period_out(rng),
        employee=metrics,
        series=series,
        hourly=hourly,
        heatmap=heatmap,
        outcomes=_outcomes(db, [employee_id], rng),
        statuses=_statuses(db, [employee_id], rng),
        top_contacts=_top_contacts(db, employee_id, rng),
        recent_calls=recent,
        devices=[DeviceOut.model_validate(d) for d in devices],
        recording=_recording_insight(db, [employee_id], rng, totals),
    )


# ------------------------------------------------------------------------------------------------- live view
def live(db: Session, user: Employee) -> LiveOut:
    now = utcnow()
    visible = visible_employee_ids(db, user)
    scope_conds = [] if visible is None else [Call.employee_id.in_(visible)]

    on_call_rows = db.execute(
        select(Call, Employee.full_name, Employee.employee_code, Team.name)
        .join(Employee, Employee.id == Call.employee_id)
        .outerjoin(Team, Team.id == Employee.team_id)
        .where(Call.ended_at.is_(None), Call.status.in_(IN_PROGRESS), Call.started_at >= now - LIVE_WINDOW, *scope_conds)
        .order_by(Call.started_at.desc())
    ).unique().all()
    on_call = [
        LiveCall(
            call_id=c.id,
            employee_id=c.employee_id,
            employee_name=name,
            employee_code=code,
            team_name=team,
            contact_id=c.contact_id,
            contact_name=c.contact_name_snapshot,
            phone_number=c.phone_number_snapshot,
            status=c.status,
            started_at=c.started_at,
            answered_at=c.answered_at,
        )
        for c, name, code, team in on_call_rows
    ]

    recent_rows = db.execute(
        select(Call, Employee.full_name, CallDisposition.label, Recording.id)
        .join(Employee, Employee.id == Call.employee_id)
        .outerjoin(CallDisposition, CallDisposition.id == Call.disposition_id)
        .outerjoin(Recording, Recording.call_id == Call.id)
        .where(*scope_conds)
        .order_by(Call.started_at.desc(), Call.id.desc())
        .limit(12)
    ).unique().all()
    recent = [
        RecentCall(
            call_id=c.id,
            employee_id=c.employee_id,
            employee_name=name,
            contact_name=c.contact_name_snapshot,
            phone_number=c.phone_number_snapshot,
            status=c.status,
            started_at=c.started_at,
            duration_seconds=c.duration_seconds,
            outcome=outcome,
            has_recording=rec_id is not None,
        )
        for c, name, outcome, rec_id in recent_rows
    ]

    today = _range_of(business_date(), business_date())
    people = _employee_rows(db, user, today)
    counts = PresenceCounts()
    for p in people:
        setattr(counts, p.presence, getattr(counts, p.presence) + 1)
    totals = _totals(db, visible, today)
    return LiveOut(
        generated_at=now,
        on_call=on_call,
        recent=recent,
        presence=counts,
        today=LiveToday(calls=totals.calls, connected=totals.connected, talk_seconds=totals.talk_seconds),
    )


# ------------------------------------------------------------------------------------------------- CSV
def csv_safe(value: object) -> str:
    """A spreadsheet treats a cell starting with = + - @ as a formula: neutralise it (CSV injection)."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def _fmt_local(value: datetime | None) -> str:
    return value.astimezone(business_tz()).strftime("%Y-%m-%d %H:%M:%S") if value else ""


def _csv_chunk(rows: list[list[object]]) -> str:
    buffer = io.StringIO()
    csv.writer(buffer).writerows([[csv_safe(c) for c in row] for row in rows])
    return buffer.getvalue()


def employees_csv(metrics: list[EmployeeMetrics]) -> Iterator[str]:
    yield "﻿"  # UTF-8 BOM so Excel opens Marathi / Hindi names correctly
    yield _csv_chunk(
        [
            [
                "Employee ID", "Name", "Email", "Phone", "Role", "Team", "Status", "Calls", "Connected", "Answer rate %", "No answer",
                "Talk time (s)", "Avg talk (s)", "Longest call (s)", "Unique contacts", "Active days", "First call", "Last call", "Recordings", "Last seen",
            ]
        ]
    )
    for m in metrics:
        yield _csv_chunk(
            [[m.employee_code, m.full_name, m.email, m.phone, m.role, m.team_name, "active" if m.is_active else "inactive", m.calls, m.connected, m.answer_rate,
              m.no_answer, m.talk_seconds, m.avg_talk_seconds, m.longest_call_seconds, m.unique_contacts, m.active_days, _fmt_local(m.first_call_at),
              _fmt_local(m.last_call_at), m.recordings, _fmt_local(m.last_seen_at)]]
        )


CSV_PAGE = 500


def calls_csv(db: Session, user: Employee, *, limit: int = 20_000, **filters) -> Iterator[str]:
    """Every call matching the call-list filters (newest first), with local times and the time-to-answer.

    The first page is read here, before a single byte is sent: a filter the database cannot take then fails as an ordinary error
    answer instead of cutting the download off in the middle (after the "200 OK" has already gone out).
    """
    first = call_service.calls_page(db, user, offset=0, page_size=min(CSV_PAGE, limit), **filters)
    return _calls_csv_rows(db, user, first, limit, filters)


def _calls_csv_rows(db: Session, user: Employee, batch: list, limit: int, filters: dict) -> Iterator[str]:
    yield "\ufeff"  # UTF-8 BOM so Excel opens Marathi / Hindi names correctly
    yield _csv_chunk(
        [["Call ID", "Employee ID", "Employee", "Contact", "Phone", "Direction", "Started", "Answered", "Ended", "Ring (s)", "Talk (s)", "Status", "Outcome", "Recording"]]
    )
    offset = 0
    while batch:
        employees = {
            e.id: e.employee_code for e in db.scalars(select(Employee).where(Employee.id.in_({c.employee_id for c in batch})))
        }
        rows = []
        for c in batch:
            ring = int((c.answered_at - c.started_at).total_seconds()) if c.answered_at else ""
            rows.append(
                [c.id, employees.get(c.employee_id, ""), c.employee_name, c.contact_name, c.phone_number, c.direction, _fmt_local(c.started_at),
                 _fmt_local(c.answered_at), _fmt_local(c.ended_at), ring, c.duration_seconds, c.status, c.disposition.label if c.disposition else "",
                 c.recording.upload_status if c.recording else ""]
            )
        yield _csv_chunk(rows)
        offset += len(batch)
        if len(batch) < CSV_PAGE or offset >= limit:
            break
        batch = call_service.calls_page(db, user, offset=offset, page_size=min(CSV_PAGE, limit - offset), **filters)
