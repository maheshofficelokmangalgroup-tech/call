"""Assigning contacts to employees (one active owner per contact, enforced by the database)."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence

from fastapi import Request
from sqlalchemy import and_, exists, func, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.redis_client import redis_lock
from app.core.timeutils import utcnow
from app.models.call import CALLBACK_CANCELLED, CALLBACK_PENDING, Callback
from app.models.contact import (
    CONTACT_DNC,
    CONTACT_INVALID,
    Campaign,
    CampaignContact,
    Contact,
    ContactAssignment,
)
from app.models.employee import Employee
from app.schemas.contact import AssignRequest, AssignResult
from app.services import audit_service
from app.services.contact_service import escape_like
from app.services.notification_service import notify

CHUNK = 1000
INELIGIBLE_STATUSES = {CONTACT_DNC, CONTACT_INVALID}


def _chunks(items: Sequence, size: int = CHUNK) -> Iterable[Sequence]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def resolve_target_employees(db: Session, employee_ids: list[int] | None, team_id: int | None) -> list[Employee]:
    ids: list[int] = list(dict.fromkeys(employee_ids or []))
    stmt = select(Employee).where(Employee.is_active.is_(True))
    if ids and team_id is not None:
        stmt = stmt.where(Employee.id.in_(ids), Employee.team_id == team_id)
    elif ids:
        stmt = stmt.where(Employee.id.in_(ids))
    elif team_id is not None:
        stmt = stmt.where(Employee.team_id == team_id)
    else:
        raise ValidationFailed("Choose at least one employee or a team.", code="no_target_employees")
    found = list(db.scalars(stmt.order_by(Employee.id)).unique())
    if not found:
        raise ValidationFailed("No active employees match the selection.", code="no_target_employees")
    if ids:
        order = {eid: i for i, eid in enumerate(ids)}
        found.sort(key=lambda e: order.get(e.id, len(order)))
    return found


def _resolve_contact_ids(db: Session, req: AssignRequest) -> list[int]:
    if req.contact_ids:
        return list(dict.fromkeys(req.contact_ids))

    has_filter = bool(req.q or req.status or req.category or req.unassigned_only or req.campaign_id)
    if not has_filter:
        raise ValidationFailed(
            "Provide contact_ids or at least one filter (q, status, category, unassigned_only, campaign_id).",
            code="no_contact_selection",
        )
    stmt = select(Contact.id).where(Contact.deleted_at.is_(None))
    if req.q:
        for token in req.q.strip().lower().split()[:5]:
            stmt = stmt.where(Contact.search_text.like(f"%{escape_like(token)}%", escape="\\"))
    if req.status:
        stmt = stmt.where(Contact.status == req.status)
    if req.category:
        stmt = stmt.where(func.lower(Contact.category) == req.category.lower())
    if req.unassigned_only:
        stmt = stmt.where(~exists().where(and_(ContactAssignment.contact_id == Contact.id, ContactAssignment.status == "active")))
    if req.campaign_id:
        stmt = stmt.where(exists().where(and_(CampaignContact.contact_id == Contact.id, CampaignContact.campaign_id == req.campaign_id)))
    limit = get_settings().assign_max_contacts
    ids = list(db.scalars(stmt.order_by(Contact.priority, Contact.id).limit(limit + 1)))
    if len(ids) > limit:
        raise ValidationFailed(
            f"More than {limit:,} contacts match. Narrow the filter - or add a sheet from Contacts > Import sheet, which shares what it adds "
            "equally between the employees who are working.",
            code="too_many_contacts",
        )
    return ids


def current_loads(db: Session, employee_ids: list[int]) -> dict[int, int]:
    rows = db.execute(
        select(ContactAssignment.employee_id, func.count(ContactAssignment.id))
        .where(ContactAssignment.status == "active", ContactAssignment.employee_id.in_(employee_ids))
        .group_by(ContactAssignment.employee_id)
    ).all()
    loads = {eid: 0 for eid in employee_ids}
    loads.update({eid: cnt for eid, cnt in rows})
    return loads


def plan_distribution(
    contact_ids: list[int], employees: list[Employee], strategy: str, loads: dict[int, int]
) -> dict[int, list[int]]:
    """Decide which employee receives which contact. Pure function (easy to unit test)."""
    plan: dict[int, list[int]] = defaultdict(list)
    if strategy == "single" or len(employees) == 1:
        plan[employees[0].id] = list(contact_ids)
        return plan
    if strategy == "round_robin":
        for i, cid in enumerate(contact_ids):
            plan[employees[i % len(employees)].id].append(cid)
        return plan
    # balanced: always give the next contact to the least-loaded employee
    current = dict(loads)
    for cid in contact_ids:
        eid = min(employees, key=lambda e: (current.get(e.id, 0), e.id)).id
        plan[eid].append(cid)
        current[eid] = current.get(eid, 0) + 1
    return plan


def release_assignments(db: Session, assignment_ids: Sequence[int], contact_ids: Sequence[int], employee_by_contact: dict[int, int]) -> None:
    now = utcnow()
    for chunk in _chunks(list(assignment_ids)):
        db.execute(
            update(ContactAssignment)
            .where(ContactAssignment.id.in_(chunk))
            .values(status="released", active_contact_id=None, released_at=now)
        )
    # A callback is personal to the previous owner; it would otherwise dangle.
    for cid in contact_ids:
        prev = employee_by_contact.get(cid)
        if prev is None:
            continue
        db.execute(
            update(Callback)
            .where(Callback.contact_id == cid, Callback.employee_id == prev, Callback.status == CALLBACK_PENDING)
            .values(status=CALLBACK_CANCELLED, completed_at=now)
        )


def attach_to_campaign(db: Session, campaign_id: int, contact_ids: Sequence[int]) -> int:
    added = 0
    for chunk in _chunks(list(contact_ids)):
        existing = set(
            db.scalars(select(CampaignContact.contact_id).where(CampaignContact.campaign_id == campaign_id, CampaignContact.contact_id.in_(chunk)))
        )
        rows = [{"campaign_id": campaign_id, "contact_id": cid, "status": "pending", "attempts": 0, "added_at": utcnow()} for cid in chunk if cid not in existing]
        if rows:
            db.execute(insert(CampaignContact), rows)
            added += len(rows)
    return added


def apply_plan(
    db: Session,
    *,
    plan: dict[int, list[int]],
    campaign_id: int | None,
    actor_id: int | None,
    current: dict[int, tuple[int, int]],
) -> tuple[int, int]:
    """Create assignments. `current` maps contact_id -> (assignment_id, employee_id). Returns (assigned, reassigned)."""
    now = utcnow()
    to_release: list[int] = []
    released_contacts: list[int] = []
    owner_by_contact: dict[int, int] = {}
    for cids in plan.values():
        for cid in cids:
            if cid in current:
                to_release.append(current[cid][0])
                released_contacts.append(cid)
                owner_by_contact[cid] = current[cid][1]
    if to_release:
        release_assignments(db, to_release, released_contacts, owner_by_contact)
        db.flush()

    assigned = 0
    for eid, cids in plan.items():
        rows = [
            {
                "contact_id": cid,
                "employee_id": eid,
                "campaign_id": campaign_id,
                "status": "active",
                "active_contact_id": cid,
                "assigned_by": actor_id,
                "assigned_at": now,
            }
            for cid in cids
        ]
        for chunk in _chunks(rows):
            db.execute(insert(ContactAssignment), list(chunk))
        assigned += len(rows)
        if campaign_id is not None:
            attach_to_campaign(db, campaign_id, cids)
    return assigned, len(to_release)


def assign_contacts(db: Session, *, req: AssignRequest, actor: Employee, request: Request) -> AssignResult:
    employees = resolve_target_employees(db, req.employee_ids, req.team_id)
    if req.strategy == "single" and len(employees) != 1 and req.employee_ids and len(req.employee_ids) > 1:
        raise ValidationFailed("Strategy 'single' needs exactly one employee.", code="bad_strategy")
    campaign_id = req.assignment_campaign_id
    if campaign_id is not None and db.get(Campaign, campaign_id) is None:
        raise ValidationFailed("Campaign does not exist.", code="unknown_campaign")

    contact_ids = _resolve_contact_ids(db, req)
    total = len(contact_ids)

    with redis_lock("assign-contacts", ttl_seconds=120, wait_seconds=10) as acquired:
        if not acquired:
            raise Conflict("Another assignment is in progress. Please retry in a moment.", code="assignment_busy")

        eligible: list[int] = []
        skipped_ineligible = 0
        skipped_assigned = 0
        current: dict[int, tuple[int, int]] = {}
        target_ids = {e.id for e in employees}

        for chunk in _chunks(contact_ids):
            status_rows = dict(
                db.execute(select(Contact.id, Contact.status).where(Contact.id.in_(chunk), Contact.deleted_at.is_(None))).all()
            )
            for a in db.execute(
                select(ContactAssignment.contact_id, ContactAssignment.id, ContactAssignment.employee_id).where(
                    ContactAssignment.contact_id.in_(chunk), ContactAssignment.status == "active"
                )
            ).all():
                current[a[0]] = (a[1], a[2])
            for cid in chunk:
                status = status_rows.get(cid)
                if status is None or status in INELIGIBLE_STATUSES:
                    skipped_ineligible += 1
                    continue
                if cid in current:
                    same_owner = len(employees) == 1 and current[cid][1] in target_ids
                    if not req.reassign or same_owner:
                        skipped_assigned += 1
                        continue
                eligible.append(cid)

        plan: dict[int, list[int]] = {}
        if eligible:
            loads = current_loads(db, [e.id for e in employees])
            plan = plan_distribution(eligible, employees, req.strategy, loads)
        try:
            assigned, reassigned = apply_plan(db, plan=plan, campaign_id=campaign_id, actor_id=actor.id, current=current)
            per_employee = {eid: len(cids) for eid, cids in plan.items()}
            for eid, count in per_employee.items():
                notify(
                    db,
                    eid,
                    type="assignment",
                    title=f"{count} new contact{'s' if count != 1 else ''} assigned",
                    body="Open your queue to start calling.",
                    data={"count": count},
                )
            audit_service.record(
                db,
                action="contact.assign",
                actor=actor,
                entity_type="contact",
                request=request,
                details={
                    "total": total,
                    "assigned": assigned,
                    "reassigned": reassigned,
                    "skipped_already_assigned": skipped_assigned,
                    "skipped_ineligible": skipped_ineligible,
                    "strategy": req.strategy,
                    "employee_ids": [e.id for e in employees],
                },
            )
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise Conflict("Some contacts were assigned by someone else at the same time. Please retry.", code="assignment_conflict") from exc

    return AssignResult(
        total=total,
        assigned=assigned,  # includes the `reassigned` ones
        reassigned=reassigned,
        skipped_already_assigned=skipped_assigned,
        skipped_ineligible=skipped_ineligible,
        per_employee=per_employee,
    )


def assign_single(db: Session, *, contact_id: int, employee_id: int, campaign_id: int | None, actor: Employee, request: Request) -> None:
    contact = db.get(Contact, contact_id)
    if contact is None or contact.deleted_at is not None:
        raise NotFound("Contact not found.")
    assign_contacts(
        db,
        req=AssignRequest(contact_ids=[contact_id], employee_ids=[employee_id], strategy="single", reassign=True, assignment_campaign_id=campaign_id),
        actor=actor,
        request=request,
    )


def unassign_contacts(db: Session, *, contact_ids: list[int], actor: Employee, request: Request) -> int:
    rows = db.execute(
        select(ContactAssignment.id, ContactAssignment.contact_id, ContactAssignment.employee_id).where(
            ContactAssignment.contact_id.in_(contact_ids), ContactAssignment.status == "active"
        )
    ).all()
    if not rows:
        return 0
    release_assignments(db, [r[0] for r in rows], [r[1] for r in rows], {r[1]: r[2] for r in rows})
    audit_service.record(
        db, action="contact.unassign", actor=actor, entity_type="contact", request=request, details={"count": len(rows)}
    )
    db.commit()
    return len(rows)
