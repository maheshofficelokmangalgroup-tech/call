"""Audit trail for security-relevant and administrative actions (section 16)."""

from __future__ import annotations

from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.core.rate_limit import client_ip
from app.models.employee import Employee
from app.models.system import AuditLog

_SENSITIVE_KEYS = ("password", "token", "secret", "hash")


def _scrub(details: dict[str, Any] | None) -> dict[str, Any] | None:
    if not details:
        return None
    clean: dict[str, Any] = {}
    for key, value in details.items():
        if any(s in key.lower() for s in _SENSITIVE_KEYS):
            continue
        clean[key] = value
    return clean or None


def record(
    db: Session,
    *,
    action: str,
    actor: Employee | None = None,
    actor_label: str | None = None,
    entity_type: str | None = None,
    entity_id: Any = None,
    request: Request | None = None,
    details: dict[str, Any] | None = None,
) -> AuditLog:
    """Add an audit row to the current transaction (the caller commits)."""
    row = AuditLog(
        actor_id=actor.id if actor else None,
        actor_label=(actor.email if actor else actor_label),
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        ip=client_ip(request) if request else None,
        user_agent=(request.headers.get("user-agent", "")[:255] if request else None) or None,
        details=_scrub(details),
    )
    db.add(row)
    return row
