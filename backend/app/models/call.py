from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.timeutils import utcnow
from app.core.types import BigIntPK, UTCDateTime
from app.models.base import TABLE_OPTS, Base, JSONType, TimestampMixin

# Call.status values
CALL_INITIATED = "initiated"
CALL_DIALING = "dialing"
CALL_RINGING = "ringing"
CALL_CONNECTED = "connected"  # answered, still in progress
CALL_COMPLETED = "completed"  # answered and ended
CALL_NO_ANSWER = "no_answer"  # ended without being answered
CALL_FAILED = "failed"

CALL_STATUSES = {
    CALL_INITIATED,
    CALL_DIALING,
    CALL_RINGING,
    CALL_CONNECTED,
    CALL_COMPLETED,
    CALL_NO_ANSWER,
    CALL_FAILED,
}
CALL_ANSWERED_STATUSES = {CALL_CONNECTED, CALL_COMPLETED}
CALL_IN_PROGRESS_STATUSES = {CALL_INITIATED, CALL_DIALING, CALL_RINGING, CALL_CONNECTED}

# Lifecycle events accepted from the device (section 4: dialing, ringing, connected, ended, failed)
CALL_EVENT_TYPES = {"dialing", "ringing", "connected", "ended", "failed", "app_resumed", "reconciled", "note"}

CALLBACK_PENDING = "pending"
CALLBACK_DONE = "done"
CALLBACK_CANCELLED = "cancelled"


class CallDisposition(Base):
    """Lookup table of outcomes an employee selects after a call."""

    __tablename__ = "call_dispositions"
    __table_args__ = (TABLE_OPTS,)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(64), nullable=False)
    category: Mapped[str] = mapped_column(String(16), nullable=False)  # connected | not_connected | other
    requires_callback: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Call(Base, TimestampMixin):
    """One row per call attempt. Kept immutable/auditable: contact data may change, this does not."""

    __tablename__ = "calls"
    __table_args__ = (
        UniqueConstraint("employee_id", "client_call_id", name="uq_calls_employee_client_call"),
        Index("ix_calls_employee_started", "employee_id", "started_at"),
        Index("ix_calls_contact_started", "contact_id", "started_at"),
        Index("ix_calls_campaign_started", "campaign_id", "started_at"),
        Index("ix_calls_status_started", "status", "started_at"),
        Index("ix_calls_started", "started_at"),  # organisation-wide reports over a date range
        TABLE_OPTS,
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"), nullable=False)
    contact_id: Mapped[int | None] = mapped_column(ForeignKey("contacts.id", ondelete="SET NULL"))
    campaign_id: Mapped[int | None] = mapped_column(ForeignKey("campaigns.id", ondelete="SET NULL"))
    client_call_id: Mapped[str] = mapped_column(String(64), nullable=False)
    external_call_reference: Mapped[str | None] = mapped_column(String(128))
    phone_number_snapshot: Mapped[str] = mapped_column(String(32), nullable=False)
    contact_name_snapshot: Mapped[str | None] = mapped_column(String(255))
    direction: Mapped[str] = mapped_column(String(12), default="outgoing", nullable=False)
    attempt_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    answered_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default=CALL_INITIATED, nullable=False)
    disposition_id: Mapped[int | None] = mapped_column(ForeignKey("call_dispositions.id"))
    disposition_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    device_id: Mapped[int | None] = mapped_column(ForeignKey("employee_devices.id", ondelete="SET NULL"))

    disposition: Mapped[CallDisposition | None] = relationship(lazy="joined")


class CallEvent(Base):
    __tablename__ = "call_events"
    __table_args__ = (
        UniqueConstraint("call_id", "event_type", "occurred_at", name="uq_call_events_call_type_time"),
        Index("ix_call_events_call_time", "call_id", "occurred_at"),
        TABLE_OPTS,
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    call_id: Mapped[int] = mapped_column(ForeignKey("calls.id", ondelete="CASCADE"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    payload: Mapped[dict | None] = mapped_column(JSONType)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)


class CallNote(Base):
    __tablename__ = "call_notes"
    __table_args__ = (
        UniqueConstraint("author_id", "client_ref", name="uq_call_notes_author_client_ref"),
        Index("ix_call_notes_contact_created", "contact_id", "created_at"),
        Index("ix_call_notes_call", "call_id"),
        TABLE_OPTS,
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    call_id: Mapped[int | None] = mapped_column(ForeignKey("calls.id", ondelete="SET NULL"))
    contact_id: Mapped[int | None] = mapped_column(ForeignKey("contacts.id", ondelete="SET NULL"))
    author_id: Mapped[int] = mapped_column(ForeignKey("employees.id"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    client_ref: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)


class Callback(Base, TimestampMixin):
    __tablename__ = "callbacks"
    __table_args__ = (
        UniqueConstraint("employee_id", "client_ref", name="uq_callbacks_employee_client_ref"),
        Index("ix_callbacks_employee_scheduled_status", "employee_id", "scheduled_at", "status"),
        Index("ix_callbacks_contact", "contact_id"),
        Index("ix_callbacks_status_scheduled", "status", "scheduled_at"),  # the follow-up dashboard: what is pending, and when it is due
        TABLE_OPTS,
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"), nullable=False)
    contact_id: Mapped[int] = mapped_column(ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False)
    call_id: Mapped[int | None] = mapped_column(ForeignKey("calls.id", ondelete="SET NULL"))
    scheduled_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default=CALLBACK_PENDING, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500))
    client_ref: Mapped[str | None] = mapped_column(String(64))
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
