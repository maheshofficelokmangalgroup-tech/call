from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query, status

from app.api.deps import CurrentEmployee, DbSession, Paging
from app.core.timeutils import ensure_aware
from app.schemas.call import CallbackCreate, CallbackOut, CallbackUpdate
from app.schemas.common import Page
from app.services import callback_service

router = APIRouter()


@router.get("", response_model=Page[CallbackOut])
def list_callbacks(
    db: DbSession,
    user: CurrentEmployee,
    paging: Paging,
    status_filter: Annotated[str | None, Query(alias="status", pattern="^(pending|done|cancelled)$")] = "pending",
    employee_id: int | None = None,
    due_before: datetime | None = None,
):
    items, total = callback_service.list_callbacks(
        db,
        user,
        status=status_filter,
        employee_id=employee_id if employee_id is not None else (user.id if user.role_name == "employee" else None),
        due_before=ensure_aware(due_before) if due_before else None,
        page=paging.page,
        page_size=paging.page_size,
    )
    return Page[CallbackOut](items=items, total=total, page=paging.page, page_size=paging.page_size)


@router.post("", response_model=CallbackOut, status_code=status.HTTP_201_CREATED)
def create_callback(payload: CallbackCreate, db: DbSession, user: CurrentEmployee):
    return callback_service.create_callback(db, user=user, data=payload)


@router.patch("/{callback_id}", response_model=CallbackOut)
def update_callback(callback_id: int, payload: CallbackUpdate, db: DbSession, user: CurrentEmployee):
    callback = callback_service.get_callback(db, user, callback_id)
    return callback_service.update_callback(db, user=user, callback=callback, data=payload)
