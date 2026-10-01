from fastapi import APIRouter

from app.api.deps import CurrentEmployee, DbSession, Paging
from app.schemas.common import Message, Page
from app.schemas.misc import NotificationOut
from app.services import notification_service

router = APIRouter()


@router.get("", response_model=Page[NotificationOut])
def list_notifications(db: DbSession, user: CurrentEmployee, paging: Paging, unread_only: bool = False):
    rows, total = notification_service.list_notifications(db, user.id, unread_only=unread_only, page=paging.page, page_size=paging.page_size)
    return Page[NotificationOut](items=[NotificationOut.model_validate(r) for r in rows], total=total, page=paging.page, page_size=paging.page_size)


@router.get("/unread-count")
def unread_count(db: DbSession, user: CurrentEmployee):
    return {"unread": notification_service.unread_count(db, user.id)}


@router.post("/read-all", response_model=Message)
def read_all(db: DbSession, user: CurrentEmployee):
    count = notification_service.mark_all_read(db, user.id)
    return Message(message=f"{count} notification(s) marked as read.")


@router.post("/{notification_id}/read", response_model=NotificationOut)
def read_one(notification_id: int, db: DbSession, user: CurrentEmployee):
    return NotificationOut.model_validate(notification_service.mark_read(db, user.id, notification_id))
