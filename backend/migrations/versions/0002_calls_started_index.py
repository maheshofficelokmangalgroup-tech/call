"""index calls.started_at for organisation-wide range reports

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-01 18:00:00
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_calls_started", "calls", ["started_at"])


def downgrade() -> None:
    op.drop_index("ix_calls_started", table_name="calls")
