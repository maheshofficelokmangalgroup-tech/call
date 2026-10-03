from typing import Annotated

from fastapi import APIRouter, Query, Request, status

from app.api.deps import AdminUser, CurrentEmployee, DbSession, Paging
from app.schemas.call import CallOut
from app.schemas.common import Page
from app.schemas.contact import (
    AssignRequest,
    AssignResult,
    ContactBrief,
    ContactCreate,
    ContactOut,
    ContactUpdate,
    NoteIn,
    NoteOut,
    UnassignRequest,
)
from app.schemas.common import Message
from app.services import assignment_service, call_service, contact_numbers, contact_service

router = APIRouter()


@router.get("", response_model=Page[ContactBrief])
def list_contacts(
    db: DbSession,
    user: CurrentEmployee,
    paging: Paging,
    q: Annotated[str | None, Query(max_length=100, description="Search name, phone, location, category, tags, custom fields")] = None,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    category: Annotated[str | None, Query(max_length=100)] = None,
    priority: Annotated[int | None, Query(ge=1, le=3)] = None,
    tag: Annotated[str | None, Query(max_length=40)] = None,
    campaign_id: int | None = None,
    employee_id: int | None = None,
    unassigned: bool | None = None,
    sort: Annotated[str, Query(pattern="^(name|recent|priority|last_called)$")] = "name",
):
    """Employees see only the contacts assigned to them; managers their team's; admins everything."""
    rows, total = contact_service.list_contacts(
        db,
        user,
        q=q,
        status=status_filter,
        category=category,
        priority=priority,
        tag=tag,
        campaign_id=campaign_id,
        employee_id=employee_id,
        unassigned=unassigned,
        sort=sort,
        page=paging.page,
        page_size=paging.page_size,
    )
    return Page[ContactBrief](items=contact_numbers.brief_many(db, rows), total=total, page=paging.page, page_size=paging.page_size)


@router.post("", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
def create_contact(payload: ContactCreate, request: Request, db: DbSession, admin: AdminUser):
    contact = contact_service.create_contact(db, data=payload, actor=admin, request=request)
    return contact_service.build_contact_out(db, contact)


@router.post("/assign", response_model=AssignResult)
def assign_contacts(payload: AssignRequest, request: Request, db: DbSession, admin: AdminUser):
    """Bulk assign / reassign contacts (by ids or by filter) to employees or a team."""
    return assignment_service.assign_contacts(db, req=payload, actor=admin, request=request)


@router.post("/unassign", response_model=Message)
def unassign_contacts(payload: UnassignRequest, request: Request, db: DbSession, admin: AdminUser):
    count = assignment_service.unassign_contacts(db, contact_ids=payload.contact_ids, actor=admin, request=request)
    return Message(message=f"{count} contact(s) unassigned.")


@router.get("/{contact_id}", response_model=ContactOut)
def get_contact(contact_id: int, db: DbSession, user: CurrentEmployee):
    contact = contact_service.get_visible_contact(db, user, contact_id)
    return contact_service.build_contact_out(db, contact)


@router.patch("/{contact_id}", response_model=ContactOut)
def update_contact(contact_id: int, payload: ContactUpdate, request: Request, db: DbSession, admin: AdminUser):
    contact = contact_service.get_contact_any(db, contact_id)
    contact = contact_service.update_contact(db, contact=contact, data=payload, actor=admin, request=request)
    return contact_service.build_contact_out(db, contact)


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contact(contact_id: int, request: Request, db: DbSession, admin: AdminUser):
    contact = contact_service.get_contact_any(db, contact_id)
    contact_service.delete_contact(db, contact=contact, actor=admin, request=request)


@router.get("/{contact_id}/notes", response_model=Page[NoteOut])
def list_notes(contact_id: int, db: DbSession, user: CurrentEmployee, paging: Paging):
    contact = contact_service.get_visible_contact(db, user, contact_id)
    notes, total = contact_service.list_notes(db, contact=contact, page=paging.page, page_size=paging.page_size)
    return Page[NoteOut](items=notes, total=total, page=paging.page, page_size=paging.page_size)


@router.post("/{contact_id}/notes", response_model=NoteOut, status_code=status.HTTP_201_CREATED)
def add_note(contact_id: int, payload: NoteIn, db: DbSession, user: CurrentEmployee):
    contact = contact_service.get_visible_contact(db, user, contact_id)
    return contact_service.add_note(db, user=user, contact=contact, data=payload)


@router.get("/{contact_id}/calls", response_model=Page[CallOut])
def contact_calls(contact_id: int, db: DbSession, user: CurrentEmployee, paging: Paging):
    """Call history of one contact (visible to whoever may see the contact)."""
    contact = contact_service.get_visible_contact(db, user, contact_id)
    items, total = call_service.list_contact_calls(db, contact.id, page=paging.page, page_size=paging.page_size)
    return Page[CallOut](items=items, total=total, page=paging.page, page_size=paging.page_size)
