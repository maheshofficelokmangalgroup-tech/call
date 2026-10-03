"""Contacts moved between employees by the system (a log of every rebalancing run) and the stored first passwords."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timeutils import utcnow
from app.core.types import BigIntPK, UTCDateTime
from app.models.base import TABLE_OPTS, Base, JSONType

RUN_RUNNING = "running"
RUN_COMPLETED = "completed"
RUN_FAILED = "failed"


class DistributionRun(Base):
    """One rebalancing: the contacts of employees who are no longer working are given to the ones who are."""

    __tablename__ = "distribution_runs"
    __table_args__ = (Index("ix_distribution_runs_created", "created_at"), TABLE_OPTS)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(16), default="rebalance", nullable=False)
    trigger: Mapped[str] = mapped_column(String(16), default="manual", nullable=False)  # manual | auto
    status: Mapped[str] = mapped_column(String(16), default=RUN_RUNNING, nullable=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    heartbeat_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    planned: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    moved: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    details: Mapped[dict | None] = mapped_column(JSONType)  # who gave how many to whom
    error_message: Mapped[str | None] = mapped_column(Text)


class EmployeeCredential(Base):
    """The password an administrator handed out (generated, or typed by the administrator), kept ENCRYPTED until the employee chooses
    their own: then this row is deleted and nobody can ever see the password again. Every viewing is audited."""

    __tablename__ = "employee_credentials"
    __table_args__ = (TABLE_OPTS,)

    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), primary_key=True)
    ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), default="generated", nullable=False)  # generated | admin_set
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"))
    last_viewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    view_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
