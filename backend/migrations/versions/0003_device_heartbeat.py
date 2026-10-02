"""what a phone reports about itself while the app is open (battery, network, permissions, unsent work)

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-02 12:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.core.types import UTCDateTime

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("employee_devices") as batch:
        batch.add_column(sa.Column("battery_percent", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("charging", sa.Boolean(), nullable=True))
        batch.add_column(sa.Column("network_type", sa.String(16), nullable=True))
        batch.add_column(sa.Column("app_state", sa.String(16), nullable=True))
        batch.add_column(sa.Column("permissions_ok", sa.Boolean(), nullable=True))
        batch.add_column(sa.Column("missing_permissions", sa.String(255), nullable=True))
        batch.add_column(sa.Column("pending_sync", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("clock_skew_seconds", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("last_heartbeat_at", UTCDateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("employee_devices") as batch:
        for column in (
            "last_heartbeat_at",
            "clock_skew_seconds",
            "pending_sync",
            "missing_permissions",
            "permissions_ok",
            "app_state",
            "network_type",
            "charging",
            "battery_percent",
        ):
            batch.drop_column(column)
