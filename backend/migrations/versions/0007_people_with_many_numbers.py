"""a contact is a person with many numbers: every number in contact_phones, and the voter-list columns on the contact

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-03 16:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.core.types import BigIntPK, UTCDateTime

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MYSQL = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"}


def upgrade() -> None:
    with op.batch_alter_table("contacts") as batch:
        batch.add_column(sa.Column("relative_name", sa.String(255), nullable=True))
        batch.add_column(sa.Column("age", sa.SmallInteger(), nullable=True))
        batch.add_column(sa.Column("gender", sa.String(8), nullable=True))
        batch.add_column(sa.Column("epic_no", sa.String(32), nullable=True))
        batch.add_column(sa.Column("pincode", sa.String(10), nullable=True))
        batch.add_column(sa.Column("address", sa.Text(), nullable=True))
        batch.add_column(sa.Column("person_key", sa.String(24), nullable=True))
        batch.create_index("ix_contacts_person_key", ["person_key"])
        batch.create_index("ix_contacts_pincode", ["pincode"])
        batch.create_index("ix_contacts_epic_no", ["epic_no"])
    op.create_table(
        "contact_phones",
        sa.Column("id", BigIntPK, primary_key=True, autoincrement=True),
        sa.Column("contact_id", sa.BigInteger().with_variant(sa.Integer, "sqlite"), sa.ForeignKey("contacts.id", ondelete="CASCADE", name="fk_contact_phones_contact_id_contacts"), nullable=False),
        sa.Column("phone_raw", sa.String(64), nullable=False),
        sa.Column("normalized_phone", sa.String(20), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.UniqueConstraint("normalized_phone", name="uq_contact_phones_normalized_phone"),
        **MYSQL,
    )
    op.create_index("ix_contact_phones_contact", "contact_phones", ["contact_id", "position"])
    # the number every contact has today becomes its first number
    op.execute(
        "INSERT INTO contact_phones (contact_id, phone_raw, normalized_phone, position, created_at) "
        "SELECT id, phone_raw, normalized_phone, 0, created_at FROM contacts"
    )


def downgrade() -> None:
    op.drop_index("ix_contact_phones_contact", table_name="contact_phones")
    op.drop_table("contact_phones")
    with op.batch_alter_table("contacts") as batch:
        batch.drop_index("ix_contacts_epic_no")
        batch.drop_index("ix_contacts_pincode")
        batch.drop_index("ix_contacts_person_key")
        for name in ("person_key", "address", "pincode", "epic_no", "gender", "age", "relative_name"):
            batch.drop_column(name)
