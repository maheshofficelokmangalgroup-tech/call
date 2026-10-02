from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response, status
from fastapi.responses import StreamingResponse

from app.api.deps import CurrentEmployee, DbSession, Paging, StaffUser
from app.core.timeutils import business_date, day_bounds_utc, ensure_aware
from app.schemas.call import CallCreate, CallEventsIn, CallOut, CallUpdate, DispositionIn, RecordingOut
from app.schemas.common import Page
from app.schemas.misc import RecordingCreate
from app.services import analytics_service, audit_service, call_service, recording_service

router = APIRouter()


@router.post("", response_model=CallOut, status_code=status.HTTP_201_CREATED)
def create_call(payload: CallCreate, request: Request, response: Response, db: DbSession, user: CurrentEmployee):
    """Register a call attempt. Idempotent on `client_call_id`: a replay returns the original record (HTTP 200)."""
    call, created = call_service.create_call(db, employee=user, data=payload, device_id=getattr(request.state, "device_id", None))
    if not created:
        response.status_code = status.HTTP_200_OK
    return call_service.to_out(db, call)


def _day_range(day: date | None, from_day: date | None, to_day: date | None, date_from: datetime | None, date_to: datetime | None):
    """A business-timezone day or day range wins over raw timestamps."""
    if day is not None:
        return day_bounds_utc(day)
    if from_day is not None or to_day is not None:
        start = day_bounds_utc(from_day)[0] if from_day else None
        end = day_bounds_utc(to_day)[1] if to_day else None
        return start, end
    return (ensure_aware(date_from) if date_from else None, ensure_aware(date_to) if date_to else None)


@router.get("", response_model=Page[CallOut])
def list_calls(
    db: DbSession,
    user: CurrentEmployee,
    paging: Paging,
    employee_id: int | None = None,
    contact_id: int | None = None,
    campaign_id: int | None = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    disposition: Annotated[str | None, Query(max_length=32)] = None,
    needs_disposition: bool | None = None,
    has_recording: bool | None = None,
    min_duration: Annotated[int | None, Query(ge=0, le=6 * 3600, description="Only calls with at least this many seconds of talk time")] = None,
    day: Annotated[date | None, Query(description="Business-timezone calendar day")] = None,
    from_day: Annotated[date | None, Query(description="First business day of a range (inclusive)")] = None,
    to_day: Annotated[date | None, Query(description="Last business day of a range (inclusive)")] = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    sort: Annotated[str, Query(pattern="^(newest|oldest|longest)$")] = "newest",
):
    start, end = _day_range(day, from_day, to_day, date_from, date_to)
    items, total = call_service.list_calls(
        db,
        user,
        employee_id=employee_id,
        contact_id=contact_id,
        campaign_id=campaign_id,
        status=status_filter,
        disposition=disposition,
        needs_disposition=needs_disposition,
        has_recording=has_recording,
        min_duration=min_duration,
        date_from=start,
        date_to=end,
        q=q,
        sort=sort,
        page=paging.page,
        page_size=paging.page_size,
    )
    return Page[CallOut](items=items, total=total, page=paging.page, page_size=paging.page_size)


@router.get("/export.csv")
def export_calls(
    request: Request,
    db: DbSession,
    user: StaffUser,
    employee_id: int | None = None,
    campaign_id: int | None = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    disposition: Annotated[str | None, Query(max_length=32)] = None,
    has_recording: bool | None = None,
    min_duration: Annotated[int | None, Query(ge=0, le=6 * 3600)] = None,
    day: date | None = None,
    from_day: date | None = None,
    to_day: date | None = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
):
    """Spreadsheet of the calls matching the filters (at most 20,000 rows). Managers only get their own team's calls."""
    start, end = _day_range(day, from_day, to_day, None, None)
    filters = dict(
        employee_id=employee_id, campaign_id=campaign_id, status=status_filter, disposition=disposition, has_recording=has_recording,
        min_duration=min_duration, date_from=start, date_to=end, q=q,
    )
    audit_service.record(
        db, action="report.export", actor=user, entity_type="calls", request=request,
        details={k: str(v) for k, v in filters.items() if v is not None},
    )
    db.commit()
    stamp = (from_day or day or business_date()).isoformat()
    return StreamingResponse(
        analytics_service.calls_csv(db, user, **filters),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="calls-{stamp}.csv"'},
    )


@router.get("/{call_id}", response_model=CallOut)
def get_call(call_id: int, db: DbSession, user: CurrentEmployee):
    call = call_service.get_call_for(db, user, call_id)
    return call_service.to_out(db, call, detail=True)


@router.patch("/{call_id}", response_model=CallOut)
def update_call(call_id: int, payload: CallUpdate, db: DbSession, user: CurrentEmployee):
    """Sync device-measured metadata (answered/ended time, duration, final status)."""
    call = call_service.get_call_for(db, user, call_id, owner_only=True)
    call = call_service.update_call(db, user=user, call=call, data=payload)
    return call_service.to_out(db, call)


@router.post("/{call_id}/events")
def add_events(call_id: int, payload: CallEventsIn, db: DbSession, user: CurrentEmployee):
    """Append lifecycle events (dialing, ringing, connected, ended, failed). Safe to replay."""
    call = call_service.get_call_for(db, user, call_id, owner_only=True)
    added = call_service.add_events(db, user=user, call=call, events=payload.events)
    return {"added": added}


@router.post("/{call_id}/disposition", response_model=CallOut)
def set_disposition(call_id: int, payload: DispositionIn, db: DbSession, user: CurrentEmployee):
    """Record the outcome of a call. Replaying the same outcome is a no-op; a different one returns 409."""
    call = call_service.get_call_for(db, user, call_id, owner_only=True)
    call = call_service.set_disposition(db, user=user, call=call, data=payload)
    return call_service.to_out(db, call, detail=True)


@router.post("/{call_id}/recording", response_model=RecordingOut, status_code=status.HTTP_201_CREATED)
def create_recording(call_id: int, payload: RecordingCreate, response: Response, db: DbSession, user: CurrentEmployee):
    """Create recording metadata. Only call this when a recording file really exists on the device."""
    call = call_service.get_call_for(db, user, call_id, owner_only=True)
    rec, created = recording_service.create_recording(db, user=user, call=call, data=payload)
    if not created:
        response.status_code = status.HTTP_200_OK
    return RecordingOut.model_validate(rec)
