"""Call recordings: metadata, private upload, signed playback and access logging (section 7.7)."""

from __future__ import annotations

import uuid
from datetime import timedelta

from fastapi import Request, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from app.core.rate_limit import client_ip
from app.core.security import sign_playback
from app.core.timeutils import utcnow
from app.models.call import Call
from app.models.employee import Employee
from app.models.recording import (
    REC_AVAILABLE,
    REC_FAILED,
    REC_PENDING,
    REC_UPLOADING,
    Recording,
    RecordingAccessLog,
)
from app.schemas.misc import PlaybackUrlOut, RecordingCreate
from app.services import audit_service
from app.services.scope import is_admin, visible_employee_ids
from app.services.settings_service import get_recording_config
from app.services.storage import get_storage, looks_like_audio

EXT_BY_TYPE = {
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/aac": "aac",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/ogg": "ogg",
    "audio/amr": "amr",
    "audio/3gpp": "3gp",
    "audio/webm": "webm",
    "audio/flac": "flac",
}


def recording_key(call: Call, content_type: str) -> str:
    started = call.started_at
    ext = EXT_BY_TYPE.get(content_type, "bin")
    return f"recordings/{started:%Y}/{started:%m}/{call.employee_id}/{call.id}.{ext}"


def get_recording_for(db: Session, user: Employee, recording_id: int) -> Recording:
    rec = db.get(Recording, recording_id)
    if rec is None:
        raise NotFound("Recording not found.")
    visible = visible_employee_ids(db, user)
    if visible is not None and rec.employee_id not in visible:
        raise NotFound("Recording not found.")
    return rec


def create_recording(db: Session, *, user: Employee, call: Call, data: RecordingCreate) -> tuple[Recording, bool]:
    settings = get_settings()
    config = get_recording_config(db)
    if not config.get("enabled"):
        raise Forbidden("Call recording is not enabled for this organisation.", code="recording_disabled")
    if call.employee_id != user.id and not is_admin(user):
        raise NotFound("Call not found.")

    content_type = data.content_type.lower().split(";")[0].strip()
    if content_type not in settings.allowed_recording_type_set:
        raise ValidationFailed("This audio format is not supported.", code="unsupported_media_type")
    limit = settings.max_recording_mb * 1024 * 1024
    if data.size_bytes > limit:
        raise ValidationFailed(f"Recording is larger than {settings.max_recording_mb} MB.", code="file_too_large")

    existing = db.scalars(select(Recording).where(Recording.call_id == call.id)).first()
    if existing is not None:
        if existing.upload_status != REC_AVAILABLE:
            existing.content_type = content_type
            existing.declared_size_bytes = data.size_bytes
            existing.duration_seconds = data.duration_seconds
            existing.checksum_sha256 = data.sha256.lower() if data.sha256 else None
            existing.upload_status = REC_PENDING
            existing.failure_reason = None
            db.commit()
        return existing, False

    rec = Recording(
        uid=str(uuid.uuid4()),
        call_id=call.id,
        employee_id=call.employee_id,
        storage_backend=get_storage().name,
        storage_key=recording_key(call, content_type),
        content_type=content_type,
        declared_size_bytes=data.size_bytes,
        size_bytes=0,
        duration_seconds=data.duration_seconds,
        checksum_sha256=data.sha256.lower() if data.sha256 else None,
        upload_status=REC_PENDING,
    )
    db.add(rec)
    db.commit()
    return rec, True


def mark_failed(db: Session, rec: Recording, reason: str) -> None:
    rec.upload_status = REC_FAILED
    rec.failure_reason = reason[:255]
    db.commit()


def upload_content(db: Session, *, user: Employee, rec: Recording, upload: UploadFile) -> Recording:
    settings = get_settings()
    if rec.employee_id != user.id and not is_admin(user):
        raise NotFound("Recording not found.")
    if rec.upload_status == REC_AVAILABLE:
        raise Conflict("This recording has already been uploaded.", code="already_uploaded")

    header = upload.file.read(16)
    upload.file.seek(0)
    if not looks_like_audio(header):
        mark_failed(db, rec, "File content is not recognised audio")
        raise ValidationFailed("The file is not a supported audio recording.", code="unsupported_media_type")

    rec.upload_status = REC_UPLOADING
    db.commit()

    storage = get_storage()
    try:
        size, digest = storage.save(rec.storage_key, upload.file, rec.content_type, settings.max_recording_mb * 1024 * 1024)
    except Exception as exc:
        mark_failed(db, rec, f"Storage error: {exc.__class__.__name__}")
        raise

    if rec.checksum_sha256 and rec.checksum_sha256 != digest:
        storage.delete(rec.storage_key)
        mark_failed(db, rec, "Checksum mismatch")
        raise ValidationFailed("The uploaded file is corrupted (checksum mismatch). Please retry.", code="checksum_mismatch")

    rec.size_bytes = size
    rec.checksum_sha256 = digest
    rec.upload_status = REC_AVAILABLE
    rec.uploaded_at = utcnow()
    rec.failure_reason = None
    db.commit()
    return rec


def log_access(db: Session, rec: Recording, actor: Employee, action: str, request: Request | None) -> None:
    db.add(
        RecordingAccessLog(
            recording_id=rec.id,
            actor_id=actor.id,
            action=action,
            ip=client_ip(request) if request else None,
            user_agent=(request.headers.get("user-agent", "")[:255] if request else None) or None,
        )
    )


def issue_playback_url(db: Session, *, user: Employee, rec: Recording, mode: str, request: Request) -> PlaybackUrlOut:
    settings = get_settings()
    if rec.upload_status != REC_AVAILABLE:
        raise Conflict("The recording is not available yet.", code="recording_not_available")
    if mode == "download" and not is_admin(user):
        raise Forbidden("You do not have permission to download recordings.", code="download_forbidden")

    ttl = settings.recording_url_ttl_seconds
    expires = utcnow() + timedelta(seconds=ttl)
    storage = get_storage()
    ext = EXT_BY_TYPE.get(rec.content_type, "bin")
    signed = storage.presigned_url(
        rec.storage_key, ttl, content_type=rec.content_type, filename=f"recording-{rec.call_id}.{ext}", download=mode == "download"
    )
    if signed is None:
        exp = int(expires.timestamp())
        sig = sign_playback(rec.id, user.id, exp, mode)
        signed = f"/api/v1/recordings/{rec.id}/stream?exp={exp}&u={user.id}&m={mode}&sig={sig}"

    log_access(db, rec, user, "download_url" if mode == "download" else "playback_url", request)
    audit_service.record(
        db, action="recording.access", actor=user, entity_type="recording", entity_id=rec.id, request=request, details={"mode": mode}
    )
    db.commit()
    return PlaybackUrlOut(url=signed, expires_at=expires, mode=mode)  # type: ignore[arg-type]


def delete_recording(db: Session, *, rec: Recording, actor: Employee, request: Request) -> None:
    try:
        get_storage().delete(rec.storage_key)
    except Exception:  # object already gone; still remove the metadata
        pass
    audit_service.record(
        db, action="recording.delete", actor=actor, entity_type="recording", entity_id=rec.id, request=request, details={"call_id": rec.call_id}
    )
    db.delete(rec)
    db.commit()
