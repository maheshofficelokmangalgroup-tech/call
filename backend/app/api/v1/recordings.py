import re
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, File, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select

from app.api.deps import AdminUser, CurrentEmployee, DbSession, Paging
from app.core import rate_limit
from app.core.errors import Forbidden, NotFound
from app.core.protection import upload_slot
from app.core.security import verify_playback
from app.models.employee import Employee
from app.models.recording import REC_AVAILABLE, Recording, RecordingAccessLog
from app.schemas.call import RecordingOut
from app.schemas.common import ORMModel, Page
from app.schemas.misc import PlaybackUrlOut
from app.services import recording_service
from app.services.scope import is_admin, visible_employee_ids
from app.services.storage import get_storage

router = APIRouter()

_RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")


class AccessLogOut(ORMModel):
    id: int
    actor_id: int
    action: str
    ip: str | None
    created_at: datetime


@router.get("/{recording_id}", response_model=RecordingOut)
def get_recording(recording_id: int, db: DbSession, user: CurrentEmployee):
    return RecordingOut.model_validate(recording_service.get_recording_for(db, user, recording_id))


@router.post("/{recording_id}/upload", response_model=RecordingOut)
def upload_recording(
    recording_id: int,
    request: Request,
    db: DbSession,
    user: CurrentEmployee,
    file: Annotated[UploadFile, File(description="The audio file")],
):
    """Upload the audio for a recording created with POST /calls/{id}/recording."""
    rate_limit.enforce_sensitive(request, "recording_upload", user.id)
    rec = recording_service.get_recording_for(db, user, recording_id)
    with upload_slot():
        return RecordingOut.model_validate(recording_service.upload_content(db, user=user, rec=rec, upload=file))


@router.get("/{recording_id}/playback-url", response_model=PlaybackUrlOut)
def playback_url(
    recording_id: int,
    request: Request,
    db: DbSession,
    user: CurrentEmployee,
    mode: Annotated[str, Query(pattern="^(play|download)$")] = "play",
):
    """Short-lived signed URL for playing (or, for admins, downloading) a recording. Every issue is logged."""
    rate_limit.enforce_sensitive(request, "recording_url", user.id)
    rec = recording_service.get_recording_for(db, user, recording_id)
    return recording_service.issue_playback_url(db, user=user, rec=rec, mode=mode, request=request)


@router.get("/{recording_id}/stream", include_in_schema=False)
def stream_recording(
    recording_id: int,
    request: Request,
    db: DbSession,
    exp: int,
    u: int,
    m: str,
    sig: str,
):
    """Serves audio for a signed URL (no Authorization header: the signature is the credential)."""
    if not verify_playback(recording_id, u, exp, m, sig) or m not in ("play", "download"):
        raise Forbidden("This playback link is invalid or has expired.", code="invalid_signature")
    rec = db.get(Recording, recording_id)
    if rec is None or rec.upload_status != REC_AVAILABLE:
        raise NotFound("Recording not found.")
    actor = db.get(Employee, u)
    if actor is None or not actor.is_active:
        raise Forbidden("This playback link is invalid or has expired.", code="invalid_signature")
    visible = visible_employee_ids(db, actor)
    if visible is not None and rec.employee_id not in visible:
        raise Forbidden()
    if m == "download" and not is_admin(actor):
        raise Forbidden("You do not have permission to download recordings.", code="download_forbidden")

    storage = get_storage()
    total = storage.size(rec.storage_key)
    start, end, partial = 0, total - 1, False
    header = request.headers.get("range")
    if header:
        match = _RANGE_RE.match(header.strip())
        if match and (match.group(1) or match.group(2)):
            if match.group(1):
                start = int(match.group(1))
                end = int(match.group(2)) if match.group(2) else total - 1
            else:  # suffix range: last N bytes
                start = max(0, total - int(match.group(2)))
            end = min(end, total - 1)
            if start > end or start >= total:
                return StreamingResponse(iter(()), status_code=416, headers={"Content-Range": f"bytes */{total}"})
            partial = True

    if start == 0:  # log the playback once, not for every range request
        recording_service.log_access(db, rec, actor, "download" if m == "download" else "stream", request)
        db.commit()

    ext = recording_service.EXT_BY_TYPE.get(rec.content_type, "bin")
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(end - start + 1),
        "Cache-Control": "private, no-store",
        "Content-Disposition": f'{"attachment" if m == "download" else "inline"}; filename="recording-{rec.call_id}.{ext}"',
    }
    if partial:
        headers["Content-Range"] = f"bytes {start}-{end}/{total}"
    return StreamingResponse(
        storage.iter_range(rec.storage_key, start, end),
        status_code=status.HTTP_206_PARTIAL_CONTENT if partial else status.HTTP_200_OK,
        media_type=rec.content_type,
        headers=headers,
    )


@router.get("/{recording_id}/access-log", response_model=Page[AccessLogOut])
def access_log(recording_id: int, db: DbSession, _admin: AdminUser, paging: Paging):
    base = select(RecordingAccessLog).where(RecordingAccessLog.recording_id == recording_id)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(base.order_by(RecordingAccessLog.created_at.desc()).limit(paging.page_size).offset(paging.offset)).all()
    return Page[AccessLogOut](items=[AccessLogOut.model_validate(r) for r in rows], total=total, page=paging.page, page_size=paging.page_size)


@router.delete("/{recording_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recording(recording_id: int, request: Request, db: DbSession, admin: AdminUser):
    rec = recording_service.get_recording_for(db, admin, recording_id)
    recording_service.delete_recording(db, rec=rec, actor=admin, request=request)
