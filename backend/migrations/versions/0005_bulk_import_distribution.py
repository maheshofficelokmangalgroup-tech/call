"""big imports that can be resumed, the log of rebalancing runs, and the stored first passwords

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-02 20:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.core.types import BigIntPK, UTCDateTime

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON = sa.JSON(none_as_null=True)
MYSQL = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"}

IMPORT_COUNTERS = (
    "scanned_rows",
    "progress_percent",
    "file_duplicate_rows",
    "existing_rows",
    "explicit_rows",
    "applied_rows",
    "applied_existing",
    "distributed_rows",
    "attempts",
)


def upgrade() -> None:
    with op.batch_alter_table("imports") as batch:
        for name in IMPORT_COUNTERS:
            batch.add_column(sa.Column(name, sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("cancel_requested", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("heartbeat_at", UTCDateTime(), nullable=True))
        batch.add_column(sa.Column("lease_owner", sa.String(64), nullable=True))
        batch.add_column(sa.Column("result", JSON, nullable=True))

    op.create_table(
        "distribution_runs",
        sa.Column("id", BigIntPK, primary_key=True, autoincrement=True),
        sa.Column("kind", sa.String(16), nullable=False, server_default="rebalance"),
        sa.Column("trigger", sa.String(16), nullable=False, server_default="manual"),
        sa.Column("status", sa.String(16), nullable=False, server_default="running"),
        sa.Column("created_by", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), sa.ForeignKey("employees.id", ondelete="SET NULL", name="fk_distribution_runs_created_by_employees"), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("finished_at", UTCDateTime(), nullable=True),
        sa.Column("heartbeat_at", UTCDateTime(), nullable=True),
        sa.Column("planned", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("moved", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("details", JSON, nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        **MYSQL,
    )
    op.create_index("ix_distribution_runs_created", "distribution_runs", ["created_at"])

    op.create_table(
        "employee_credentials",
        sa.Column("employee_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), sa.ForeignKey("employees.id", ondelete="CASCADE", name="fk_employee_credentials_employee_id_employees"), primary_key=True),
        sa.Column("ciphertext", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False, server_default="generated"),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("created_by", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), sa.ForeignKey("employees.id", ondelete="SET NULL", name="fk_employee_credentials_created_by_employees"), nullable=True),
        sa.Column("last_viewed_at", UTCDateTime(), nullable=True),
        sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"),
        **MYSQL,
    )

    # With a million contacts the list of contacts has to be shown newest first (or by name) and counted per status without reading
    # every contact: the newest / the first by name are the first entries of an index, and a count by status is read from one.
    op.drop_index("ix_contacts_status", table_name="contacts")
    op.create_index("ix_contacts_status", "contacts", ["status", "deleted_at"])
    op.create_index("ix_contacts_created", "contacts", ["created_at"])
    op.create_index("ix_contacts_name", "contacts", ["name"])


def downgrade() -> None:
    op.drop_index("ix_contacts_name", table_name="contacts")
    op.drop_index("ix_contacts_created", table_name="contacts")
    op.drop_index("ix_contacts_status", table_name="contacts")
    op.create_index("ix_contacts_status", "contacts", ["status"])
    op.drop_table("employee_credentials")
    op.drop_index("ix_distribution_runs_created", table_name="distribution_runs")
    op.drop_table("distribution_runs")
    with op.batch_alter_table("imports") as batch:
        for name in ("result", "lease_owner", "heartbeat_at", "cancel_requested", *reversed(IMPORT_COUNTERS)):
            batch.drop_column(name)
