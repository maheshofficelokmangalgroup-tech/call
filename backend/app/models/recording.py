from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timeutils import utcnow
from app.core.types import BigIntPK, UTCDateTime
from app.models.base import TABLE_OPTS, Base

REC_PENDING = "pending"
REC_UPLOADING = "uploading"
REC_AVAILABLE = "available"
REC_FAILED = "failed"
REC_STATUSES = {REC_PENDING, REC_UPLOADING, REC_AVAILABLE, REC_FAILED}


class Recording(Base):
    """Private call-recording metadata. The audio itself lives in private object storage."""

    __tablename__ = "recordings"
    __table_args__ = (
        UniqueConstraint("call_id", name="uq_recordings_call"),
        UniqueConstraint("uid", name="uq_recordings_uid"),
        Index("ix_recordings_employee_created", "employee_id", "created_at"),
        TABLE_OPTS,
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    uid: Mapped[str] = mapped_column(String(36), nullable=False)
    call_id: Mapped[int] = mapped_column(ForeignKey("calls.id", ondelete="CASCADE"), nullable=False)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"), nullable=False)
    storage_backend: Mapped[str] = mapped_column(String(16), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    content_type: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    declared_size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    checksum_sha256: Mapped[str | None] = mapped_column(String(64))
    upload_status: Mapped[str] = mapped_column(String(16), default=REC_PENDING, nullable=False)
    failure_reason: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    uploaded_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class RecordingAccessLog(Base):
    __tablename__ = "recording_access_logs"
    __table_args__ = (Index("ix_recording_access_logs_recording_created", "recording_id", "created_at"), TABLE_OPTS)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    recording_id: Mapped[int] = mapped_column(ForeignKey("recordings.id", ondelete="CASCADE"), nullable=False)
    actor_id: Mapped[int] = mapped_column(ForeignKey("employees.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(24), nullable=False)  # playback_url | stream | download
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
