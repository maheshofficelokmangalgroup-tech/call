"""Administrator / manager analytics: range based overview, per-employee figures, the live view and CSV exports.

Managers only ever see their own team (the same scoping as every other endpoint); administrators see everyone.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.api.deps import DbSession, Paging, StaffUser
from app.core import cache
from app.core.config import get_settings
from app.core.errors import NotFound
from app.models.cache_events import ROSTER
from app.models.employee import ROLE_ADMIN
from app.schemas.analytics import EmployeeDetailOut, EmployeeStatsOut, LiveOut, OverviewOut
from app.schemas.common import Page
from app.schemas.followups import ConversationOut, FollowupItemOut, FollowupSummaryOut, TimelineOut
from app.services import analytics_service, audit_service, followup_service
from app.services.settings_service import EPOCH as SETTINGS_EPOCH

router = APIRouter()


def _cached(user, name: str, params: dict, compute) -> JSONResponse:
    """The admin panel asks for the same figures every few seconds from every open tab. They are worked out once per few seconds
    for everybody who may see the same people (all administrators share one answer; a manager's is for their own team)."""
    scope = "org" if user.role_name == ROLE_ADMIN else f"team:{user.team_id}:{user.id}"
    key = f"analytics:{name}:{scope}:{cache.digest(sorted(params.items()))}"
    # (the figures are a few seconds old at most - and never older than the last change of a person, a team or a setting)
    return JSONResponse(
        cache.single_flight(
            key, get_settings().analytics_cache_seconds, lambda: compute().model_dump(mode="json", by_alias=True), epoch_names=(ROSTER, SETTINGS_EPOCH)
        )
    )


DateFrom = Annotated[date | None, Query(description="First business day (inclusive), YYYY-MM-DD. Default: 6 days before date_to.")]
DateTo = Annotated[date | None, Query(description="Last business day (inclusive), YYYY-MM-DD. Default: today.")]


@router.get("/overview", response_model=OverviewOut)
def overview(
    db: DbSession,
    user: StaffUser,
    date_from: DateFrom = None,
    date_to: DateTo = None,
    employee_id: int | None = None,
    team_id: int | None = None,
):
    """Totals (with the previous period for comparison), day / hour series, outcomes, recording coverage and the leaderboard."""
    rng = analytics_service.resolve_range(date_from, date_to)
    return _cached(user, "overview", {"from": rng.first, "to": rng.last, "e": employee_id, "t": team_id}, lambda: analytics_service.overview(db, user, rng, employee_id=employee_id, team_id=team_id))


@router.get("/employees", response_model=EmployeeStatsOut)
def employees(
    db: DbSession,
    user: StaffUser,
    date_from: DateFrom = None,
    date_to: DateTo = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    team_id: int | None = None,
    role: Annotated[str | None, Query(pattern="^(admin|manager|employee)$")] = None,
    state: Annotated[str, Query(pattern="^(all|active|inactive)$")] = "all",
    presence: Annotated[str | None, Query(pattern="^(on_call|online|idle|offline|inactive)$")] = None,
    sort: Annotated[str, Query(pattern="^(calls|connected|answer_rate|talk|avg_talk|contacts|recordings|last_seen|name)$")] = "calls",
    order: Annotated[str, Query(pattern="^(asc|desc)$")] = "desc",
):
    """Every employee the caller may see, with the figures of the period (calls, answer rate, talk time, contacts ...)."""
    rng = analytics_service.resolve_range(date_from, date_to)
    return _cached(
        user,
        "employees",
        {"from": rng.first, "to": rng.last, "q": q, "t": team_id, "r": role, "s": state, "p": presence, "o": sort, "d": order},
        lambda: analytics_service.employee_stats(
            db, user, rng, q=q, team_id=team_id, role=role, state=state, presence=presence, sort=sort, descending=order == "desc"
        ),
    )


@router.get("/employees.csv")
def employees_export(
    request: Request,
    db: DbSession,
    user: StaffUser,
    date_from: DateFrom = None,
    date_to: DateTo = None,
    team_id: int | None = None,
    state: Annotated[str, Query(pattern="^(all|active|inactive)$")] = "all",
):
    rng = analytics_service.resolve_range(date_from, date_to)
    stats = analytics_service.employee_stats(db, user, rng, team_id=team_id, state=state)
    audit_service.record(db, action="report.export", actor=user, entity_type="employees", request=request, details={"from": rng.first.isoformat(), "to": rng.last.isoformat(), "rows": stats.total})
    db.commit()
    name = f"employees-{rng.first.isoformat()}-{rng.last.isoformat()}.csv"
    return StreamingResponse(
        analytics_service.employees_csv(stats.items),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.get("/employees/{employee_id}", response_model=EmployeeDetailOut)
def employee_detail(employee_id: int, db: DbSession, user: StaffUser, date_from: DateFrom = None, date_to: DateTo = None):
    """One employee: figures, daily / hourly pattern, outcomes, the contacts they called most, recent calls and devices."""
    rng = analytics_service.resolve_range(date_from, date_to, default_days=30)
    detail = analytics_service.employee_detail(db, user, employee_id, rng)
    if detail is None:
        raise NotFound("Employee not found.")
    return detail


# ------------------------------------------------------------------------------------------------- follow-ups and responses
@router.get("/followups", response_model=FollowupSummaryOut)
def followups_summary(
    db: DbSession,
    user: StaffUser,
    date_from: DateFrom = None,
    date_to: DateTo = None,
    employee_id: int | None = None,
    team_id: int | None = None,
):
    """The follow-up dashboard: how many people were spoken to and what came of it (by each person's latest response), the follow-ups
    that are due, and the same for every employee."""
    rng = analytics_service.resolve_range(date_from, date_to)
    return _cached(
        user,
        "followups",
        {"from": rng.first, "to": rng.last, "e": employee_id, "t": team_id},
        lambda: followup_service.summary(db, user, rng, employee_id=employee_id, team_id=team_id),
    )


@router.get("/followups/list", response_model=Page[FollowupItemOut])
def followups_list(
    db: DbSession,
    user: StaffUser,
    paging: Paging,
    state: Annotated[str, Query(pattern="^(overdue|today|upcoming|pending|closed)$", description="pending = overdue + today + upcoming; closed = done or cancelled in the period")] = "pending",
    date_from: DateFrom = None,
    date_to: DateTo = None,
    employee_id: int | None = None,
    team_id: int | None = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
):
    """Scheduled callbacks, the longest-waiting first, each with the person, the employee, and what was said before."""
    rng = analytics_service.resolve_range(date_from, date_to, default_days=30)

    def compute() -> Page[FollowupItemOut]:
        items, total = followup_service.followup_items(
            db, user, rng, state=state, employee_id=employee_id, team_id=team_id, q=q, page=paging.page, page_size=paging.page_size
        )
        return Page[FollowupItemOut](items=items, total=total, page=paging.page, page_size=paging.page_size)

    return _cached(user, "followups-list", {"s": state, "from": rng.first, "to": rng.last, "e": employee_id, "t": team_id, "q": q, "p": paging.page, "n": paging.page_size}, compute)


@router.get("/conversations", response_model=Page[ConversationOut])
def conversations(
    db: DbSession,
    user: StaffUser,
    paging: Paging,
    date_from: DateFrom = None,
    date_to: DateTo = None,
    employee_id: int | None = None,
    team_id: int | None = None,
    response: Annotated[str | None, Query(pattern="^[A-Z_]+(,[A-Z_]+)*$", max_length=200, description="Outcome codes, comma separated; NONE = no outcome chosen yet")] = None,
    followup: Annotated[str | None, Query(pattern="^(pending|overdue)$", description="Only people with a pending (or late) follow-up")] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
):
    """Who each employee spoke to in the period - one row per employee and phone number, newest first - with the latest response, the
    last note, the next follow-up, and the latest calls."""
    rng = analytics_service.resolve_range(date_from, date_to)
    codes = [c for c in (response or "").split(",") if c]

    def compute() -> Page[ConversationOut]:
        items, total = followup_service.conversations(
            db, user, rng, employee_id=employee_id, team_id=team_id, responses=codes or None, q=q, followup=followup, page=paging.page, page_size=paging.page_size
        )
        return Page[ConversationOut](items=items, total=total, page=paging.page, page_size=paging.page_size)

    return _cached(
        user,
        "conversations",
        {"from": rng.first, "to": rng.last, "e": employee_id, "t": team_id, "r": ",".join(codes), "f": followup, "q": q, "p": paging.page, "n": paging.page_size},
        compute,
    )


@router.get("/conversations/timeline", response_model=TimelineOut)
def conversation_timeline(
    db: DbSession,
    user: StaffUser,
    employee_id: int,
    phone: Annotated[str, Query(min_length=3, max_length=32)],
):
    """Everything between one employee and one phone number: every call with its outcome and notes, the follow-ups, the recordings."""
    timeline = followup_service.timeline(db, user, employee_id, phone)
    if timeline is None:
        raise NotFound("No calls from this employee to this number.")
    return timeline


@router.get("/live", response_model=LiveOut)
def live(db: DbSession, user: StaffUser):
    """Who is on a call right now, the latest calls and how many people are online - meant to be polled every few seconds."""
    return _cached(user, "live", {}, lambda: analytics_service.live(db, user))
