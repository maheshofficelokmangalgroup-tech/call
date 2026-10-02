"""Login, refresh-token rotation, logout and password changes."""

from __future__ import annotations

import uuid
from datetime import timedelta

from fastapi import Request
from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from app.core import auth_cache, rate_limit
from app.core.config import get_settings
from app.core.errors import Forbidden, Unauthorized, ValidationFailed
from app.core.rate_limit import client_ip
from app.core.security import (
    burn_password_check,
    create_access_token,
    hash_password,
    new_refresh_token,
    split_refresh_token,
    tokens_equal,
    validate_password_strength,
    verify_password,
)
from app.core.timeutils import utcnow
from app.models.employee import ROLE_ADMIN, ROLE_MANAGER, Employee, EmployeeDevice, EmployeeSession
from app.schemas.employee import DeviceInfo, EmployeeOut, TokenPair
from app.services import audit_service


def find_employee_by_identifier(db: Session, identifier: str) -> Employee | None:
    ident = identifier.strip()
    if not ident:
        return None
    return db.scalars(
        select(Employee).where(or_(Employee.email == ident.lower(), Employee.employee_code == ident.upper()))
    ).first()


WEB_PLATFORM = "web"  # the admin panel signs in with this platform; phones say "android"


def _register_device(db: Session, employee: Employee, info: DeviceInfo | None, ip: str | None) -> EmployeeDevice | None:
    """Create/refresh the device record and enforce optional device binding."""
    if info is not None and info.platform == WEB_PLATFORM:
        # A browser is not a phone: it never becomes a registered device (and so can never take the "first phone" place of a
        # bound account). Web sign-ins are visible as sessions, with their browser and address.
        return None
    if info is None:
        if employee.device_binding_enabled:
            raise Forbidden(
                "This account is bound to a registered device. Update the app and try again.",
                code="device_not_allowed",
            )
        return None

    now = utcnow()
    device = db.scalars(
        select(EmployeeDevice).where(
            EmployeeDevice.employee_id == employee.id, EmployeeDevice.device_uid == info.device_uid
        )
    ).first()

    if employee.device_binding_enabled:
        approved_exists = db.scalars(
            select(EmployeeDevice.id).where(EmployeeDevice.employee_id == employee.id, EmployeeDevice.is_approved.is_(True))
        ).first()
        if device is None and approved_exists is not None:
            raise Forbidden(
                "This device is not registered for your account. Ask your administrator to unbind your old device.",
                code="device_not_allowed",
            )
        if device is not None and not device.is_approved:
            raise Forbidden("This device has been blocked for your account.", code="device_not_allowed")

    if device is None:
        device = EmployeeDevice(employee_id=employee.id, device_uid=info.device_uid, is_approved=True)
        db.add(device)
    device.device_name = info.name or device.device_name
    device.platform = info.platform or device.platform
    device.os_version = info.os_version or device.os_version
    device.app_version = info.app_version or device.app_version
    device.last_seen_at = now
    device.last_ip = ip
    db.flush()
    return device


def _issue_tokens(db: Session, employee: Employee, session: EmployeeSession, refresh_token: str) -> TokenPair:
    access, expires_in = create_access_token(employee_id=employee.id, session_id=session.id, role=employee.role_name)
    return TokenPair(
        access_token=access,
        refresh_token=refresh_token,
        expires_in=expires_in,
        must_change_password=employee.must_change_password,
        employee=EmployeeOut.model_validate(employee),
    )


def login(db: Session, *, identifier: str, password: str, device: DeviceInfo | None, request: Request) -> TokenPair:
    settings = get_settings()
    ip = client_ip(request)
    ident_key = identifier.strip().lower()[:100]

    rate_limit.enforce(f"login:ip:{ip}", settings.rate_limit_login_per_ip, 60, message="Too many sign-in attempts. Try again shortly.")
    rate_limit.enforce(
        f"login:id:{ident_key}",
        settings.rate_limit_login_per_identifier,
        300,
        message="Too many sign-in attempts for this account. Try again in a few minutes.",
    )

    employee = find_employee_by_identifier(db, identifier)
    if employee is None:
        burn_password_check(password)
        audit_service.record(db, action="auth.login_failed", actor_label=ident_key, request=request, details={"reason": "unknown_user"})
        db.commit()
        raise Unauthorized("Incorrect employee ID/email or password.", code="invalid_credentials")

    if not verify_password(password, employee.password_hash):
        audit_service.record(db, action="auth.login_failed", actor=employee, request=request, details={"reason": "bad_password"})
        db.commit()
        raise Unauthorized("Incorrect employee ID/email or password.", code="invalid_credentials")

    if not employee.is_active:
        audit_service.record(db, action="auth.login_blocked", actor=employee, request=request, details={"reason": "inactive"})
        db.commit()
        raise Forbidden("Your account has been deactivated. Contact your administrator.", code="account_disabled")

    if device is not None and device.platform == WEB_PLATFORM and employee.role_name not in (ROLE_ADMIN, ROLE_MANAGER):
        # the admin panel is for administrators and managers; do not even open a session for anybody else
        audit_service.record(db, action="auth.login_blocked", actor=employee, request=request, details={"reason": "panel_not_allowed"})
        db.commit()
        raise Forbidden("This panel is for administrators and managers. Employees use the mobile app.", code="panel_not_allowed")

    try:
        device_row = _register_device(db, employee, device, ip)
    except Forbidden:
        audit_service.record(db, action="auth.login_blocked", actor=employee, request=request, details={"reason": "device_not_allowed"})
        db.commit()
        raise

    now = utcnow()
    session_id = str(uuid.uuid4())
    refresh_token, refresh_hash = new_refresh_token(session_id)
    session = EmployeeSession(
        id=session_id,
        employee_id=employee.id,
        device_id=device_row.id if device_row else None,
        refresh_hash=refresh_hash,
        created_at=now,
        last_used_at=now,
        expires_at=now + timedelta(days=settings.jwt_refresh_ttl_days),
        ip=ip,
        user_agent=(request.headers.get("user-agent", "")[:255] or None),
    )
    db.add(session)
    employee.last_login_at = now
    audit_service.record(db, action="auth.login", actor=employee, entity_type="employee", entity_id=employee.id, request=request)
    db.commit()
    rate_limit.reset(f"login:id:{ident_key}")
    return _issue_tokens(db, employee, session, refresh_token)


def refresh(db: Session, *, refresh_token: str, request: Request) -> TokenPair:
    settings = get_settings()
    session_id, token_hash = split_refresh_token(refresh_token)
    now = utcnow()

    session = db.get(EmployeeSession, session_id)
    if session is None or session.revoked_at is not None or session.expires_at <= now:
        raise Unauthorized("Your session has ended. Please sign in again.", code="invalid_refresh_token")

    matches_current = tokens_equal(session.refresh_hash, token_hash)
    matches_previous = (
        tokens_equal(session.prev_refresh_hash, token_hash)
        and session.prev_valid_until is not None
        and session.prev_valid_until > now
    )
    if not (matches_current or matches_previous):
        # An old refresh token was replayed outside the grace window: assume theft, kill the session.
        session.revoked_at = now
        session.revoked_reason = "refresh_token_reuse"
        audit_service.record(
            db,
            action="auth.refresh_reuse_detected",
            actor_label=str(session.employee_id),
            entity_type="session",
            entity_id=session.id,
            request=request,
        )
        db.commit()
        raise Unauthorized("Your session has ended. Please sign in again.", code="invalid_refresh_token")

    employee = db.get(Employee, session.employee_id)
    if employee is None or not employee.is_active:
        session.revoked_at = now
        session.revoked_reason = "account_disabled"
        db.commit()
        raise Forbidden("Your account has been deactivated. Contact your administrator.", code="account_disabled")

    new_token, new_hash = new_refresh_token(session.id)
    session.prev_refresh_hash = session.refresh_hash
    session.prev_valid_until = now + timedelta(seconds=settings.refresh_reuse_grace_seconds)
    session.refresh_hash = new_hash
    session.last_used_at = now
    session.expires_at = now + timedelta(days=settings.jwt_refresh_ttl_days)
    db.commit()
    return _issue_tokens(db, employee, session, new_token)


def logout(db: Session, *, session_id: str, employee: Employee, request: Request) -> None:
    session = db.get(EmployeeSession, session_id)
    if session is not None and session.revoked_at is None:
        session.revoked_at = utcnow()
        session.revoked_reason = "logout"
        audit_service.record(db, action="auth.logout", actor=employee, entity_type="employee", entity_id=employee.id, request=request)
        auth_cache.forget_session(db, session_id)
        db.commit()


def revoke_all_sessions(db: Session, employee_id: int, *, reason: str, except_session_id: str | None = None) -> int:
    stmt = (
        update(EmployeeSession)
        .where(EmployeeSession.employee_id == employee_id, EmployeeSession.revoked_at.is_(None))
        .values(revoked_at=utcnow(), revoked_reason=reason)
    )
    if except_session_id:
        stmt = stmt.where(EmployeeSession.id != except_session_id)
    result = db.execute(stmt)
    auth_cache.forget_employee(db, employee_id)  # (after the commit) every remembered session of this person is asked again
    return result.rowcount or 0


def change_password(
    db: Session,
    *,
    employee: Employee,
    current_password: str,
    new_password: str,
    current_session_id: str | None,
    request: Request,
) -> None:
    rate_limit.enforce_sensitive(request, "change_password", employee.id)
    if not verify_password(current_password, employee.password_hash):
        raise Unauthorized("Current password is incorrect.", code="invalid_credentials")
    if current_password == new_password:
        raise ValidationFailed("Choose a password different from the current one.", code="password_unchanged")

    problems = validate_password_strength(
        new_password, forbidden=[employee.employee_code, employee.email.split("@")[0], employee.full_name.split(" ")[0]]
    )
    if problems:
        raise ValidationFailed(problems[0], code="weak_password", details=problems)

    # (a remembered session does not carry the password hash: reading it above loaded it from the database)
    employee.password_hash = hash_password(new_password)
    employee.must_change_password = False
    employee.password_changed_at = utcnow()
    auth_cache.forget_employee(db, employee.id)
    # Sign out every other device; keep the session that made the change.
    revoke_all_sessions(db, employee.id, reason="password_changed", except_session_id=current_session_id)
    audit_service.record(db, action="auth.password_changed", actor=employee, entity_type="employee", entity_id=employee.id, request=request)
    db.commit()
