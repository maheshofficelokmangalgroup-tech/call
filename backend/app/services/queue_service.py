"""The employee calling queue (section 7.3).

Ordering:  1) callbacks that are due (oldest first)
           2) regular eligible contacts  (left over from earlier days first, then contact priority, campaign priority,
              never-called first)
           3) callbacks scheduled later today
Excluded: contacts in terminal states, contacts inside a retry cool-down, contacts of inactive/paused
campaigns, and contacts not actively assigned to the employee.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import Select, and_, case, func, literal, or_, select
from sqlalchemy.orm import Session

from app.core.timeutils import business_date, day_bounds_utc, utcnow
from app.models.call import CALLBACK_PENDING, Callback
from app.models.contact import (
    CAMPAIGN_ACTIVE,
    QUEUE_EXCLUDED_STATUSES,
    Campaign,
    Contact,
    ContactAssignment,
)
from app.schemas.call import CallbackOut, QueueItem, QueueOut
from app.schemas.contact import CampaignRef
from app.services import contact_numbers


def _base(employee_ids: Sequence[int] | None, now: datetime) -> tuple[Select, Any, Any]:
    """Queue query skeleton for one or many employees (None = everyone).

    Returns (select, callback_subquery, group_expression).
    """
    _, day_end = day_bounds_utc(now=now)
    today = business_date(now)

    cb_stmt = select(Callback.contact_id.label("cb_contact_id"), func.min(Callback.scheduled_at).label("cb_at")).where(
        Callback.status == CALLBACK_PENDING
    )
    if employee_ids is not None:
        cb_stmt = cb_stmt.where(Callback.employee_id.in_(employee_ids))
    cb = cb_stmt.group_by(Callback.contact_id).subquery("cb")

    group = case(
        (and_(cb.c.cb_at.is_not(None), cb.c.cb_at <= now), 0),
        (cb.c.cb_at.is_(None), 1),
        else_=2,
    )

    stmt = (
        select(Contact, ContactAssignment.campaign_id, Campaign.name, Campaign.priority, cb.c.cb_at, group.label("grp"))
        .join(
            ContactAssignment,
            and_(
                ContactAssignment.contact_id == Contact.id,
                ContactAssignment.status == "active",
                *([ContactAssignment.employee_id.in_(employee_ids)] if employee_ids is not None else []),
            ),
        )
        .outerjoin(Campaign, Campaign.id == ContactAssignment.campaign_id)
        .outerjoin(cb, cb.c.cb_contact_id == Contact.id)
        .where(Contact.deleted_at.is_(None), Contact.status.not_in(QUEUE_EXCLUDED_STATUSES))
        .where(
            or_(
                ContactAssignment.campaign_id.is_(None),
                and_(
                    Campaign.status == CAMPAIGN_ACTIVE,
                    or_(Campaign.start_date.is_(None), Campaign.start_date <= today),
                    or_(Campaign.end_date.is_(None), Campaign.end_date >= today),
                ),
            )
        )
        .where(
            or_(
                # regular contacts: not cooling down
                and_(cb.c.cb_at.is_(None), or_(Contact.next_eligible_at.is_(None), Contact.next_eligible_at <= now)),
                # contacts with a pending callback: show callbacks due now or later today
                and_(cb.c.cb_at.is_not(None), cb.c.cb_at < day_end),
            )
        )
    )
    return stmt, cb, group


def build_queue(db: Session, employee_id: int, *, limit: int = 100, offset: int = 0, now: datetime | None = None) -> QueueOut:
    now = now or utcnow()
    stmt, cb, group = _base([employee_id], now)

    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).with_only_columns(Contact.id).subquery())) or 0
    due_callbacks, _ = callback_counts(db, [employee_id], now)

    # Contacts still waiting from an earlier day (assigned or last called before today) are listed before today's.
    day_start, _ = day_bounds_utc(now=now)
    waiting_since = func.coalesce(Contact.last_called_at, ContactAssignment.assigned_at, Contact.created_at)
    carried_over = case((waiting_since < day_start, 0), else_=1)

    ordered = stmt.order_by(
        group,
        case((group == 1, literal(0)), else_=cb.c.cb_at),  # callbacks by time (NULL for regular rows)
        case((group == 1, carried_over), else_=literal(0)),  # regular contacts left over from earlier days first
        Contact.priority,
        func.coalesce(Campaign.priority, 2),
        Contact.last_called_at.is_not(None),  # never-called contacts first
        Contact.last_called_at,
        Contact.id,
    )
    rows = db.execute(ordered.limit(limit).offset(offset)).all()

    callback_ids: dict[int, Callback] = {}
    contact_ids = [r[0].id for r in rows if r[4] is not None]
    if contact_ids:
        for cbk in db.scalars(
            select(Callback)
            .where(Callback.employee_id == employee_id, Callback.status == CALLBACK_PENDING, Callback.contact_id.in_(contact_ids))
            .order_by(Callback.scheduled_at)
        ):
            callback_ids.setdefault(cbk.contact_id, cbk)

    briefs = {b.id: b for b in contact_numbers.brief_many(db, [r[0] for r in rows])}  # (every number of every person, with what happened on it)
    items: list[QueueItem] = []
    for contact, campaign_id, campaign_name, _prio, cb_at, _grp in rows:
        callback = callback_ids.get(contact.id)
        reason = "callback" if callback else ("retry" if contact.call_count > 0 else "new")
        items.append(
            QueueItem(
                contact=briefs[contact.id],
                reason=reason,
                callback=(
                    CallbackOut(
                        id=callback.id,
                        contact_id=callback.contact_id,
                        call_id=callback.call_id,
                        scheduled_at=callback.scheduled_at,
                        status=callback.status,
                        note=callback.note,
                        overdue=callback.scheduled_at <= now,
                        created_at=callback.created_at,
                    )
                    if callback
                    else None
                ),
                campaign=CampaignRef(id=campaign_id, name=campaign_name) if campaign_id and campaign_name else None,
                attempts=contact.call_count,
                last_called_at=contact.last_called_at,
                eligible_at=contact.next_eligible_at,
            )
        )
    return QueueOut(items=items, total=total, due_callbacks=due_callbacks, server_time=now)


def callback_counts(db: Session, employee_ids: Sequence[int] | None, now: datetime | None = None) -> tuple[int, int]:
    """Callbacks that are actually visible in the queue: (due right now, scheduled later today).

    Counted from the same filtered query as the queue itself so the badge can never disagree with the list
    (e.g. a callback whose campaign is paused is neither listed nor counted).
    """
    now = now or utcnow()
    stmt, _, group = _base(employee_ids, now)
    grouped = stmt.order_by(None).with_only_columns(group.label("grp")).subquery()
    counts = dict(db.execute(select(grouped.c.grp, func.count()).group_by(grouped.c.grp)).all())
    return int(counts.get(0, 0)), int(counts.get(2, 0))


def count_pending(db: Session, employee_ids: Sequence[int] | None, now: datetime | None = None) -> int:
    """Contacts still waiting for a call today (used by the dashboard)."""
    now = now or utcnow()
    stmt, _, _ = _base(employee_ids, now)
    return db.scalar(select(func.count()).select_from(stmt.order_by(None).with_only_columns(Contact.id).subquery())) or 0
