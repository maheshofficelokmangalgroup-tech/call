from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.api.deps import AdminUser, DbSession, Paging
from app.core.timeutils import ensure_aware
from app.models.system import AuditLog
from app.schemas.common import Page
from app.schemas.misc import AuditLogOut

router = APIRouter()


@router.get("", response_model=Page[AuditLogOut])
def list_audit_logs(
    db: DbSession,
    _admin: AdminUser,
    paging: Paging,
    action: Annotated[str | None, Query(max_length=64, description="Exact action or prefix ending with '.', e.g. 'auth.'")] = None,
    actor_id: int | None = None,
    entity_type: Annotated[str | None, Query(max_length=48)] = None,
    entity_id: Annotated[str | None, Query(max_length=64)] = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
):
    stmt = select(AuditLog)
    if action:
        stmt = stmt.where(AuditLog.action.like(f"{action}%") if action.endswith(".") else AuditLog.action == action)
    if actor_id is not None:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    if date_from:
        stmt = stmt.where(AuditLog.created_at >= ensure_aware(date_from))
    if date_to:
        stmt = stmt.where(AuditLog.created_at < ensure_aware(date_to))
    total = db.scalar(select(func.count()).select_from(stmt.with_only_columns(AuditLog.id).subquery())) or 0
    rows = db.scalars(stmt.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(paging.page_size).offset(paging.offset)).all()
    return Page[AuditLogOut](items=[AuditLogOut.model_validate(r) for r in rows], total=total, page=paging.page, page_size=paging.page_size)
