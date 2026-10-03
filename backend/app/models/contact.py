from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Date,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy import event, insert
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timeutils import utcnow
from app.core.types import BigIntPK, UTCDateTime
from app.models.base import TABLE_OPTS, Base, JSONType, TimestampMixin

# Contact status values (Contact.status)
CONTACT_NEW = "new"
CONTACT_IN_PROGRESS = "in_progress"
CONTACT_CALLBACK = "callback"
CONTACT_FOLLOW_UP = "follow_up"
CONTACT_INTERESTED = "interested"
CONTACT_NOT_INTERESTED = "not_interested"
CONTACT_COMPLETED = "completed"
CONTACT_INVALID = "invalid"
CONTACT_UNREACHABLE = "unreachable"
CONTACT_DNC = "do_not_contact"

CONTACT_STATUSES = {
    CONTACT_NEW,
    CONTACT_IN_PROGRESS,
    CONTACT_CALLBACK,
    CONTACT_FOLLOW_UP,
    CONTACT_INTERESTED,
    CONTACT_NOT_INTERESTED,
    CONTACT_COMPLETED,
    CONTACT_INVALID,
    CONTACT_UNREACHABLE,
    CONTACT_DNC,
}

# Contacts in these states never appear in the calling queue.
QUEUE_EXCLUDED_STATUSES = {
    CONTACT_INTERESTED,
    CONTACT_NOT_INTERESTED,
    CONTACT_COMPLETED,
    CONTACT_INVALID,
    CONTACT_UNREACHABLE,
    CONTACT_DNC,
}

PRIORITY_HIGH, PRIORITY_MEDIUM, PRIORITY_LOW = 1, 2, 3


class Contact(Base, TimestampMixin):
    __tablename__ = "contacts"
    __table_args__ = (
        Index("ix_contacts_status", "status", "deleted_at"),  # counts per status are read from this index alone
        Index("ix_contacts_created", "created_at"),  # "recently added" is the first page of this index, read backwards
        Index("ix_contacts_name", "name"),  # "A to Z" is the first page of this index
        Index("ix_contacts_category", "category"),
        Index("ix_contacts_next_eligible_at", "next_eligible_at"),
        Index("ix_contacts_pincode", "pincode"),
        Index("ix_contacts_epic_no", "epic_no"),
        Index("ix_contacts_person_key", "person_key"),
        UniqueConstraint("normalized_phone", name="uq_contacts_normalized_phone"),
        TABLE_OPTS,
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone_raw: Mapped[str] = mapped_column(String(64), nullable=False)
    normalized_phone: Mapped[str] = mapped_column(String(20), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255))
    location: Mapped[str | None] = mapped_column(String(255))
    category: Mapped[str | None] = mapped_column(String(100))
    # the person (a voter list gives these): the numbers of the person are in contact_phones, `normalized_phone` above is the first one
    relative_name: Mapped[str | None] = mapped_column(String(255))
    age: Mapped[int | None] = mapped_column(SmallInteger)
    gender: Mapped[str | None] = mapped_column(String(8))  # M | F | O
    epic_no: Mapped[str | None] = mapped_column(String(32))  # the voter card number
    pincode: Mapped[str | None] = mapped_column(String(10))
    address: Mapped[str | None] = mapped_column(Text)
    person_key: Mapped[str | None] = mapped_column(String(24))  # who this is (name, relative, age, gender, pincode, address): see import_rows.person_key
    priority: Mapped[int] = mapped_column(SmallInteger, default=PRIORITY_MEDIUM, nullable=False)
    tags: Mapped[list] = mapped_column(JSONType, default=list, nullable=False)
    custom_fields: Mapped[dict] = mapped_column(JSONType, default=dict, nullable=False)
    search_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default=CONTACT_NEW, nullable=False)
    source: Mapped[str | None] = mapped_column(String(32))
    import_id: Mapped[int | None] = mapped_column(ForeignKey("imports.id", ondelete="SET NULL"))
    call_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_called_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_disposition_code: Mapped[str | None] = mapped_column(String(32))
    next_eligible_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"))
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class ContactPhone(Base):
    """Every number of a contact. A person can have many; a number belongs to ONE person (the unique index is the last word, so no
    number can ever be in two contacts, whatever else is going on). The first number (position 0) is also in `contacts`."""

    __tablename__ = "contact_phones"
    __table_args__ = (
        UniqueConstraint("normalized_phone", name="uq_contact_phones_normalized_phone"),
        Index("ix_contact_phones_contact", "contact_id", "position"),
        TABLE_OPTS,
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    contact_id: Mapped[int] = mapped_column(ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False)
    phone_raw: Mapped[str] = mapped_column(String(64), nullable=False)
    normalized_phone: Mapped[str] = mapped_column(String(20), nullable=False)
    position: Mapped[int] = mapped_column(SmallInteger, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)


class ContactAssignment(Base):
    """Which employee owns which contact.

    `active_contact_id` equals `contact_id` while the assignment is active and NULL afterwards.
    Its UNIQUE index guarantees at most one active owner per contact at the database level
    (NULLs are allowed to repeat), without needing partial indexes (unsupported on MySQL).
    """

    __tablename__ = "contact_assignments"
    __table_args__ = (
        Index("ix_contact_assignments_employee_status", "employee_id", "status"),
        Index("ix_contact_assignments_contact", "contact_id"),
        Index("ix_contact_assignments_campaign", "campaign_id"),
        UniqueConstraint("active_contact_id", name="uq_contact_assignments_active_contact"),
        TABLE_OPTS,
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    contact_id: Mapped[int] = mapped_column(ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"), nullable=False)
    campaign_id: Mapped[int | None] = mapped_column(ForeignKey("campaigns.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)  # active | released
    active_contact_id: Mapped[int | None] = mapped_column(BigInteger)
    assigned_by: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"))
    assigned_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    released_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


CAMPAIGN_DRAFT = "draft"
CAMPAIGN_ACTIVE = "active"
CAMPAIGN_PAUSED = "paused"
CAMPAIGN_COMPLETED = "completed"
CAMPAIGN_ARCHIVED = "archived"
CAMPAIGN_STATUSES = {CAMPAIGN_DRAFT, CAMPAIGN_ACTIVE, CAMPAIGN_PAUSED, CAMPAIGN_COMPLETED, CAMPAIGN_ARCHIVED}


class Campaign(Base, TimestampMixin):
    __tablename__ = "campaigns"
    __table_args__ = (Index("ix_campaigns_status", "status"), TABLE_OPTS)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default=CAMPAIGN_DRAFT, nullable=False)
    priority: Mapped[int] = mapped_column(SmallInteger, default=2, nullable=False)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    target_calls: Mapped[int | None] = mapped_column(Integer)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"))


class CampaignContact(Base):
    __tablename__ = "campaign_contacts"
    __table_args__ = (
        UniqueConstraint("campaign_id", "contact_id", name="uq_campaign_contacts_campaign_contact"),
        Index("ix_campaign_contacts_contact", "contact_id"),
        Index("ix_campaign_contacts_campaign_status", "campaign_id", "status"),
        TABLE_OPTS,
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    contact_id: Mapped[int] = mapped_column(ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)  # pending|in_progress|completed
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_attempt_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    added_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)


class CampaignAssignee(Base):
    __tablename__ = "campaign_assignees"
    __table_args__ = (
        UniqueConstraint("campaign_id", "employee_id", name="uq_campaign_assignees_campaign_employee"),
        TABLE_OPTS,
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), nullable=False)
    added_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)


@event.listens_for(Contact, "after_insert")
def _first_number(_mapper, connection, contact: Contact) -> None:
    """A contact made through the ORM (a person typed in, a seed script, a test) gets its first number in contact_phones, so the
    table always holds every number of every contact. (The import writes both tables itself.)"""
    connection.execute(
        insert(ContactPhone.__table__).values(
            contact_id=contact.id, phone_raw=contact.phone_raw, normalized_phone=contact.normalized_phone, position=0, created_at=utcnow()
        )
    )
