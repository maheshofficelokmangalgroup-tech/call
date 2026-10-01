from typing import Annotated

from fastapi import APIRouter, Query, Request, status

from app.api.deps import AdminUser, CurrentEmployee, DbSession, StaffUser
from app.core.errors import NotFound
from app.schemas.contact import (
    AssignResult,
    CampaignAssigneesRequest,
    CampaignContactsRequest,
    CampaignCreate,
    CampaignOut,
    CampaignUpdate,
    DistributeRequest,
)
from app.services import campaign_service

router = APIRouter()


@router.get("", response_model=list[CampaignOut])
def list_campaigns(
    db: DbSession,
    user: CurrentEmployee,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
):
    return campaign_service.list_campaigns(db, user, status=status_filter, q=q)


@router.post("", response_model=CampaignOut, status_code=status.HTTP_201_CREATED)
def create_campaign(payload: CampaignCreate, request: Request, db: DbSession, admin: AdminUser):
    campaign = campaign_service.create_campaign(db, payload, admin, request)
    return campaign_service.to_out(db, [campaign])[0]


@router.get("/{campaign_id}", response_model=CampaignOut)
def get_campaign(campaign_id: int, db: DbSession, user: CurrentEmployee):
    visible = {c.id for c in campaign_service.list_campaigns(db, user, status=None, q=None)}
    if campaign_id not in visible:
        raise NotFound("Campaign not found.")
    return campaign_service.to_out(db, [campaign_service.get_campaign(db, campaign_id)])[0]


@router.patch("/{campaign_id}", response_model=CampaignOut)
def update_campaign(campaign_id: int, payload: CampaignUpdate, request: Request, db: DbSession, admin: AdminUser):
    campaign = campaign_service.update_campaign(db, campaign_service.get_campaign(db, campaign_id), payload, admin, request)
    return campaign_service.to_out(db, [campaign])[0]


@router.post("/{campaign_id}/contacts")
def attach_contacts(campaign_id: int, payload: CampaignContactsRequest, request: Request, db: DbSession, admin: AdminUser):
    added = campaign_service.attach_contacts(db, campaign_service.get_campaign(db, campaign_id), payload, admin, request)
    return {"added": added}


@router.delete("/{campaign_id}/contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def detach_contact(campaign_id: int, contact_id: int, request: Request, db: DbSession, admin: AdminUser):
    campaign_service.detach_contact(db, campaign_service.get_campaign(db, campaign_id), contact_id, admin, request)


@router.get("/{campaign_id}/assignees")
def list_assignees(campaign_id: int, db: DbSession, _admin: AdminUser):
    campaign_service.get_campaign(db, campaign_id)
    return {"employee_ids": campaign_service.list_assignee_ids(db, campaign_id)}


@router.post("/{campaign_id}/assignees")
def set_assignees(campaign_id: int, payload: CampaignAssigneesRequest, request: Request, db: DbSession, admin: AdminUser):
    ids = campaign_service.set_assignees(db, campaign_service.get_campaign(db, campaign_id), payload, admin, request)
    return {"employee_ids": ids}


@router.post("/{campaign_id}/distribute", response_model=AssignResult)
def distribute(campaign_id: int, payload: DistributeRequest, request: Request, db: DbSession, admin: AdminUser):
    """Hand out the campaign's unassigned contacts across its assignees."""
    return campaign_service.distribute(db, campaign_service.get_campaign(db, campaign_id), payload, admin, request)


@router.get("/{campaign_id}/progress")
def progress(campaign_id: int, db: DbSession, _staff: StaffUser):
    return campaign_service.progress(db, campaign_service.get_campaign(db, campaign_id))
