"""Administrator / manager analytics: range based overview, per-employee figures, the live view and CSV exports.

Managers only ever see their own team (the same scoping as every other endpoint); administrators see everyone.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from app.api.deps import DbSession, StaffUser
from app.core.errors import NotFound
from app.schemas.analytics import EmployeeDetailOut, EmployeeStatsOut, LiveOut, OverviewOut
from app.services import analytics_service, audit_service

router = APIRouter()

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
    return analytics_service.overview(db, user, rng, employee_id=employee_id, team_id=team_id)


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
    return analytics_service.employee_stats(
        db, user, rng, q=q, team_id=team_id, role=role, state=state, presence=presence, sort=sort, descending=order == "desc"
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


@router.get("/live", response_model=LiveOut)
def live(db: DbSession, user: StaffUser):
    """Who is on a call right now, the latest calls and how many people are online - meant to be polled every few seconds."""
    return analytics_service.live(db, user)
