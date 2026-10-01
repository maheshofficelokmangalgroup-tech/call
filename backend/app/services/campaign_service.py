"""Campaign management: membership, assignees, progress and distribution."""

from __future__ import annotations

from fastapi import Request
from sqlalchemy import and_, exists, func, select
from sqlalchemy.orm import Session

from app.core.errors import Conflict, NotFound, ValidationFailed
from app.models.call import Call
from app.models.contact import (
    CAMPAIGN_ACTIVE,
    Campaign,
    CampaignAssignee,
    CampaignContact,
    Contact,
    ContactAssignment,
)
from app.models.employee import Employee
from app.schemas.contact import (
    AssignRequest,
    CampaignAssigneesRequest,
    CampaignContactsRequest,
    CampaignCreate,
    CampaignOut,
    CampaignUpdate,
    DistributeRequest,
)
from app.services import assignment_service, audit_service
from app.services.scope import is_admin


def get_campaign(db: Session, campaign_id: int) -> Campaign:
    campaign = db.get(Campaign, campaign_id)
    if campaign is None:
        raise NotFound("Campaign not found.")
    return campaign


def _stats(db: Session, campaign_ids: list[int]) -> dict[int, dict[str, int]]:
    stats: dict[int, dict[str, int]] = {cid: {"contacts": 0, "completed": 0, "calls": 0} for cid in campaign_ids}
    if not campaign_ids:
        return stats
    for cid, total in db.execute(
        select(CampaignContact.campaign_id, func.count(CampaignContact.id))
        .where(CampaignContact.campaign_id.in_(campaign_ids))
        .group_by(CampaignContact.campaign_id)
    ).all():
        stats[cid]["contacts"] = total
    for cid, cnt in db.execute(
        select(CampaignContact.campaign_id, func.count(CampaignContact.id))
        .where(CampaignContact.campaign_id.in_(campaign_ids), CampaignContact.status == "completed")
        .group_by(CampaignContact.campaign_id)
    ).all():
        stats[cid]["completed"] = cnt
    for cid, cnt in db.execute(
        select(Call.campaign_id, func.count(Call.id)).where(Call.campaign_id.in_(campaign_ids)).group_by(Call.campaign_id)
    ).all():
        stats[cid]["calls"] = cnt
    return stats


def to_out(db: Session, campaigns: list[Campaign]) -> list[CampaignOut]:
    stats = _stats(db, [c.id for c in campaigns])
    result: list[CampaignOut] = []
    for c in campaigns:
        out = CampaignOut.model_validate(c)
        s = stats[c.id]
        out.contact_count = s["contacts"]
        out.completed_count = s["completed"]
        out.calls_made = s["calls"]
        out.completion_percent = round(100.0 * s["completed"] / s["contacts"], 1) if s["contacts"] else 0.0
        result.append(out)
    return result


def list_campaigns(db: Session, user: Employee, *, status: str | None, q: str | None) -> list[CampaignOut]:
    stmt = select(Campaign)
    if not is_admin(user):
        # Employees/managers only see campaigns they work on.
        stmt = stmt.where(
            exists().where(and_(ContactAssignment.campaign_id == Campaign.id, ContactAssignment.employee_id == user.id, ContactAssignment.status == "active"))
            | exists().where(and_(CampaignAssignee.campaign_id == Campaign.id, CampaignAssignee.employee_id == user.id))
        )
    if status:
        stmt = stmt.where(Campaign.status == status)
    if q:
        stmt = stmt.where(func.lower(Campaign.name).like(f"%{q.strip().lower()}%"))
    return to_out(db, list(db.scalars(stmt.order_by(Campaign.created_at.desc(), Campaign.id.desc()))))


def create_campaign(db: Session, data: CampaignCreate, actor: Employee, request: Request) -> Campaign:
    if db.scalars(select(Campaign.id).where(func.lower(Campaign.name) == data.name.strip().lower())).first():
        raise Conflict("A campaign with this name already exists.", code="campaign_exists")
    if data.start_date and data.end_date and data.end_date < data.start_date:
        raise ValidationFailed("End date cannot be before the start date.", code="bad_dates")
    campaign = Campaign(
        name=data.name.strip(),
        description=data.description,
        status=data.status,
        priority=data.priority,
        start_date=data.start_date,
        end_date=data.end_date,
        target_calls=data.target_calls,
        created_by=actor.id,
    )
    db.add(campaign)
    db.flush()
    audit_service.record(db, action="campaign.create", actor=actor, entity_type="campaign", entity_id=campaign.id, request=request)
    db.commit()
    return campaign


def update_campaign(db: Session, campaign: Campaign, data: CampaignUpdate, actor: Employee, request: Request) -> Campaign:
    fields = data.model_fields_set
    if "name" in fields and data.name and data.name.strip().lower() != campaign.name.lower():
        if db.scalars(select(Campaign.id).where(func.lower(Campaign.name) == data.name.strip().lower(), Campaign.id != campaign.id)).first():
            raise Conflict("A campaign with this name already exists.", code="campaign_exists")
        campaign.name = data.name.strip()
    for field in ("description", "status", "priority", "start_date", "end_date", "target_calls"):
        if field in fields:
            value = getattr(data, field)
            if value is None and field in ("status", "priority"):
                continue
            setattr(campaign, field, value)
    if campaign.start_date and campaign.end_date and campaign.end_date < campaign.start_date:
        raise ValidationFailed("End date cannot be before the start date.", code="bad_dates")
    audit_service.record(
        db, action="campaign.update", actor=actor, entity_type="campaign", entity_id=campaign.id, request=request,
        details={k: str(getattr(data, k)) for k in fields},
    )
    db.commit()
    return campaign


def attach_contacts(db: Session, campaign: Campaign, data: CampaignContactsRequest, actor: Employee, request: Request) -> int:
    existing_ids = set(db.scalars(select(Contact.id).where(Contact.id.in_(data.contact_ids), Contact.deleted_at.is_(None))))
    added = assignment_service.attach_to_campaign(db, campaign.id, [cid for cid in dict.fromkeys(data.contact_ids) if cid in existing_ids])
    audit_service.record(
        db, action="campaign.attach_contacts", actor=actor, entity_type="campaign", entity_id=campaign.id, request=request,
        details={"requested": len(data.contact_ids), "added": added},
    )
    db.commit()
    return added


def detach_contact(db: Session, campaign: Campaign, contact_id: int, actor: Employee, request: Request) -> None:
    row = db.scalars(
        select(CampaignContact).where(CampaignContact.campaign_id == campaign.id, CampaignContact.contact_id == contact_id)
    ).first()
    if row is None:
        raise NotFound("Contact is not part of this campaign.")
    db.delete(row)
    audit_service.record(
        db, action="campaign.detach_contact", actor=actor, entity_type="campaign", entity_id=campaign.id, request=request,
        details={"contact_id": contact_id},
    )
    db.commit()


def set_assignees(db: Session, campaign: Campaign, data: CampaignAssigneesRequest, actor: Employee, request: Request) -> list[int]:
    ids = set(data.employee_ids)
    if data.team_ids:
        ids |= set(db.scalars(select(Employee.id).where(Employee.team_id.in_(data.team_ids), Employee.is_active.is_(True))))
    valid = set(db.scalars(select(Employee.id).where(Employee.id.in_(ids), Employee.is_active.is_(True)))) if ids else set()
    existing = set(db.scalars(select(CampaignAssignee.employee_id).where(CampaignAssignee.campaign_id == campaign.id)))
    for eid in valid - existing:
        db.add(CampaignAssignee(campaign_id=campaign.id, employee_id=eid))
    audit_service.record(
        db, action="campaign.set_assignees", actor=actor, entity_type="campaign", entity_id=campaign.id, request=request,
        details={"added": len(valid - existing)},
    )
    db.commit()
    return sorted(valid | existing)


def list_assignee_ids(db: Session, campaign_id: int) -> list[int]:
    return list(db.scalars(select(CampaignAssignee.employee_id).where(CampaignAssignee.campaign_id == campaign_id)))


def distribute(db: Session, campaign: Campaign, data: DistributeRequest, actor: Employee, request: Request):
    """Assign the campaign's still-unassigned contacts across its assignees."""
    employee_ids = data.employee_ids or list_assignee_ids(db, campaign.id)
    if not employee_ids:
        raise ValidationFailed("Add assignees to the campaign first.", code="no_target_employees")
    if campaign.status != CAMPAIGN_ACTIVE:
        raise Conflict("Activate the campaign before distributing its contacts.", code="campaign_not_active")
    req = AssignRequest(
        campaign_id=campaign.id,
        unassigned_only=True,
        employee_ids=employee_ids,
        strategy=data.strategy,
        assignment_campaign_id=campaign.id,
    )
    return assignment_service.assign_contacts(db, req=req, actor=actor, request=request)


def progress(db: Session, campaign: Campaign) -> dict:
    out = to_out(db, [campaign])[0]
    per_employee = db.execute(
        select(Employee.id, Employee.full_name, func.count(Call.id))
        .join(Call, Call.employee_id == Employee.id)
        .where(Call.campaign_id == campaign.id)
        .group_by(Employee.id, Employee.full_name)
        .order_by(func.count(Call.id).desc())
    ).all()
    by_status = db.execute(
        select(CampaignContact.status, func.count(CampaignContact.id))
        .where(CampaignContact.campaign_id == campaign.id)
        .group_by(CampaignContact.status)
    ).all()
    return {
        "campaign": out,
        "contacts_by_status": {s: c for s, c in by_status},
        "calls_by_employee": [{"employee_id": e, "name": n, "calls": c} for e, n, c in per_employee],
    }
