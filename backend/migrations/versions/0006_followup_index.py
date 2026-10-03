"""index callbacks by (status, time): the follow-up dashboard lists what is pending and due without reading every callback ever made

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-03 14:00:00
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_callbacks_status_scheduled", "callbacks", ["status", "scheduled_at"])


def downgrade() -> None:
    op.drop_index("ix_callbacks_status_scheduled", table_name="callbacks")
