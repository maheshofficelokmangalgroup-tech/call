from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.types import BigIntPK, UTCDateTime
from app.models.base import TABLE_OPTS, Base, JSONType, TimestampMixin

IMPORT_VALIDATING = "validating"
IMPORT_PREVIEWED = "previewed"
IMPORT_APPLYING = "applying"
IMPORT_COMPLETED = "completed"
IMPORT_FAILED = "failed"
IMPORT_CANCELLED = "cancelled"

ROW_VALID = "valid"
ROW_INVALID = "invalid"
ROW_DUPLICATE = "duplicate"


class Import(Base, TimestampMixin):
    __tablename__ = "imports"
    __table_args__ = (Index("ix_imports_created_by_created", "created_by", "created_at"), TABLE_OPTS)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"))
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_type: Mapped[str] = mapped_column(String(8), nullable=False)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    mode: Mapped[str] = mapped_column(String(16), default="skip", nullable=False)  # skip | update
    status: Mapped[str] = mapped_column(String(16), default=IMPORT_VALIDATING, nullable=False)
    options: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)
    campaign_id: Mapped[int | None] = mapped_column(ForeignKey("campaigns.id", ondelete="SET NULL"))
    total_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    valid_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    invalid_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    duplicate_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    inserted_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    skipped_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    assigned_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
    confirmed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    # --- big sheets: the work is done in small steps that can be resumed after a restart ---------------------------------------
    scanned_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # rows read so far by the check
    progress_percent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # of the check, when the file size tells
    file_duplicate_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # same number twice in the sheet
    existing_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # number already in the contacts
    explicit_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # valid rows that name their employee themselves
    applied_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # valid rows already written (the resume point)
    applied_existing: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # existing contacts already updated
    distributed_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # contacts given out by the plan so far
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    heartbeat_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    lease_owner: Mapped[str | None] = mapped_column(String(64))
    result: Mapped[dict | None] = mapped_column(JSONType)  # how many went to whom


class ImportRow(Base):
    __tablename__ = "import_rows"
    __table_args__ = (
        Index("ix_import_rows_import_status", "import_id", "status"),
        Index("ix_import_rows_import_row", "import_id", "row_number"),
        TABLE_OPTS,
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    import_id: Mapped[int] = mapped_column(ForeignKey("imports.id", ondelete="CASCADE"), nullable=False)
    row_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)  # valid | invalid | duplicate
    duplicate_of: Mapped[str | None] = mapped_column(String(16))  # existing | file
    action: Mapped[str | None] = mapped_column(String(16))  # insert | update | skip
    normalized_phone: Mapped[str | None] = mapped_column(String(20))
    data: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)
    errors: Mapped[list | None] = mapped_column(JSONType)
    contact_id: Mapped[int | None] = mapped_column(ForeignKey("contacts.id", ondelete="SET NULL"))
