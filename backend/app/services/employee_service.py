"""Employee, team and device administration."""

from __future__ import annotations

import io
import secrets
import string

from fastapi import Request
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import auth_cache
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.security import hash_password, validate_password_strength
from app.core.timeutils import utcnow
from app.models.employee import Employee, EmployeeDevice, EmployeeSession, Role, Team
from app.core.config import get_settings
from app.schemas.employee import CredentialOut, EmployeeCreate, EmployeeUpdate, TeamCreate, TeamUpdate
from app.services import audit_service, credential_vault
from app.services.auth_service import revoke_all_sessions
from app.services.settings_service import get_setting

_ALPHABET = string.ascii_letters + string.digits


def generate_temporary_password(length: int = 12) -> str:
    """Random password guaranteed to satisfy the strength policy."""
    while True:
        pwd = "".join(secrets.choice(_ALPHABET) for _ in range(length))
        if any(c.isalpha() for c in pwd) and any(c.isdigit() for c in pwd):
            return pwd


def _role(db: Session, name: str) -> Role:
    role = db.scalars(select(Role).where(Role.name == name)).first()
    if role is None:
        raise ValidationFailed(f"Unknown role '{name}'.", code="unknown_role")
    return role


def _check_team(db: Session, team_id: int | None) -> None:
    if team_id is not None and db.get(Team, team_id) is None:
        raise ValidationFailed("Team does not exist.", code="unknown_team")


def get_employee(db: Session, employee_id: int) -> Employee:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise NotFound("Employee not found.")
    return employee


def list_employees(
    db: Session,
    *,
    q: str | None,
    team_id: int | None,
    role: str | None,
    is_active: bool | None,
    visible_ids: list[int] | None,
    page: int,
    page_size: int,
) -> tuple[list[Employee], int]:
    stmt = select(Employee)
    if visible_ids is not None:
        stmt = stmt.where(Employee.id.in_(visible_ids))
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Employee.full_name).like(like),
                func.lower(Employee.email).like(like),
                func.lower(Employee.employee_code).like(like),
            )
        )
    if team_id is not None:
        stmt = stmt.where(Employee.team_id == team_id)
    if role:
        stmt = stmt.join(Role, Role.id == Employee.role_id).where(Role.name == role)
    if is_active is not None:
        stmt = stmt.where(Employee.is_active.is_(is_active))
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    rows = db.scalars(stmt.order_by(Employee.full_name, Employee.id).limit(page_size).offset((page - 1) * page_size)).unique().all()
    return list(rows), total


def _next_code(db: Session, jump: int = 0) -> str:
    """EMP + the first number after the newest account that no employee has as a code yet. A code can be ahead of the ids (two
    administrators adding somebody at the same moment, or a code typed by hand), and then "newest id + 1" is taken already: every
    new employee after that would be refused for good."""
    number = (db.scalar(select(func.max(Employee.id))) or 0) + 1 + jump
    while db.scalar(select(Employee.id).where(Employee.employee_code == f"EMP{number:04d}")) is not None:
        number += 1
    return f"EMP{number:04d}"


def create_employee(db: Session, *, data: EmployeeCreate, actor: Employee, request: Request) -> tuple[Employee, str | None]:
    role = _role(db, data.role)
    _check_team(db, data.team_id)

    temporary: str | None = None
    if data.password:
        problems = validate_password_strength(data.password, forbidden=[data.email.split("@")[0]])
        if problems:
            raise ValidationFailed(problems[0], code="weak_password", details=problems)
        password = data.password
    else:
        password = temporary = generate_temporary_password()

    typed = (data.employee_code or "").upper()
    code = typed or _next_code(db)
    if db.scalars(select(Employee.id).where(Employee.email == data.email)).first():
        raise Conflict("An employee with this email already exists.", code="email_taken")
    # (a code that was made here is free - or taken a moment later by somebody adding an employee at the same time, which the unique
    # index below catches and the next code is tried; only a code that was typed can be refused)
    if typed and db.scalars(select(Employee.id).where(Employee.employee_code == code)).first():
        raise Conflict("An employee with this employee ID already exists.", code="employee_code_taken")

    target = data.daily_target if data.daily_target is not None else int(get_setting(db, "default_daily_target") or 50)
    employee = Employee(
        employee_code=code,
        email=data.email,
        full_name=data.full_name,
        phone=data.phone,
        password_hash=hash_password(password),
        role_id=role.id,
        team_id=data.team_id,
        is_active=True,
        daily_target=target,
        must_change_password=data.must_change_password,
        device_binding_enabled=data.device_binding_enabled,
        password_changed_at=utcnow(),
    )
    db.add(employee)
    for attempt in range(1, 6):
        try:
            db.flush()
            break
        except IntegrityError as exc:
            db.rollback()
            # two administrators creating somebody at the same moment are given the same next number: the second takes the one after
            if data.employee_code or attempt == 5 or db.scalars(select(Employee.id).where(Employee.email == data.email)).first():
                raise Conflict("Employee email or ID already exists.", code="employee_exists") from exc
            employee = Employee(
                employee_code=_next_code(db, secrets.randbelow(5 * attempt)),
                email=data.email, full_name=data.full_name, phone=data.phone, password_hash=employee.password_hash, role_id=role.id,
                team_id=data.team_id, is_active=True, daily_target=target, must_change_password=data.must_change_password,
                device_binding_enabled=data.device_binding_enabled, password_changed_at=employee.password_changed_at,
            )
            db.add(employee)
    db.refresh(employee)
    # the first password stays visible to administrators (encrypted) until the employee chooses their own
    credential_vault.store(
        db, employee_id=employee.id, password=password, kind=credential_vault.KIND_GENERATED if temporary else credential_vault.KIND_ADMIN_SET, actor_id=actor.id
    )
    audit_service.record(
        db, action="employee.create", actor=actor, entity_type="employee", entity_id=employee.id, request=request,
        details={"employee_code": employee.employee_code, "role": data.role},
    )
    db.commit()
    return employee, temporary


def update_employee(db: Session, *, employee: Employee, data: EmployeeUpdate, actor: Employee, request: Request) -> Employee:
    changes: dict[str, object] = {}
    if data.email is not None and data.email != employee.email:
        if db.scalars(select(Employee.id).where(Employee.email == data.email, Employee.id != employee.id)).first():
            raise Conflict("An employee with this email already exists.", code="email_taken")
        employee.email = data.email
        changes["email"] = data.email
    if data.full_name is not None:
        employee.full_name = data.full_name.strip()
        changes["full_name"] = employee.full_name
    if data.phone is not None:
        employee.phone = data.phone or None
        changes["phone"] = employee.phone
    if data.role is not None and data.role != employee.role_name:
        if employee.id == actor.id:
            raise ValidationFailed("You cannot change your own role.", code="cannot_change_own_role")
        employee.role_id = _role(db, data.role).id
        changes["role"] = data.role
    if data.clear_team:
        employee.team_id = None
        changes["team_id"] = None
    elif data.team_id is not None:
        _check_team(db, data.team_id)
        employee.team_id = data.team_id
        changes["team_id"] = data.team_id
    if data.daily_target is not None:
        employee.daily_target = data.daily_target
        changes["daily_target"] = data.daily_target
    if data.device_binding_enabled is not None:
        employee.device_binding_enabled = data.device_binding_enabled
        changes["device_binding_enabled"] = data.device_binding_enabled

    db.flush()
    db.refresh(employee)
    if changes:
        audit_service.record(
            db, action="employee.update", actor=actor, entity_type="employee", entity_id=employee.id, request=request, details=changes
        )
        auth_cache.forget_employee(db, employee.id)  # a change of role, team or name is seen by the next request, not a minute later
    db.commit()
    return employee


def set_active(db: Session, *, employee: Employee, active: bool, actor: Employee, request: Request) -> Employee:
    if employee.id == actor.id and not active:
        raise ValidationFailed("You cannot deactivate your own account.", code="cannot_deactivate_self")
    employee.is_active = active
    revoked = 0
    if not active:
        revoked = revoke_all_sessions(db, employee.id, reason="deactivated")
        credential_vault.forget(db, employee.id)  # nobody signs in with it any more
    auth_cache.forget_employee(db, employee.id)
    audit_service.record(
        db,
        action="employee.activate" if active else "employee.deactivate",
        actor=actor,
        entity_type="employee",
        entity_id=employee.id,
        request=request,
        details={"sessions_revoked": revoked},
    )
    db.commit()
    return employee


def reset_password(db: Session, *, employee: Employee, new_password: str | None, actor: Employee, request: Request) -> str:
    if new_password:
        problems = validate_password_strength(new_password, forbidden=[employee.employee_code, employee.email.split("@")[0]])
        if problems:
            raise ValidationFailed(problems[0], code="weak_password", details=problems)
        password = new_password
    else:
        password = generate_temporary_password()
    employee.password_hash = hash_password(password)
    employee.must_change_password = True
    employee.password_changed_at = utcnow()
    credential_vault.store(
        db, employee_id=employee.id, password=password, kind=credential_vault.KIND_ADMIN_SET if new_password else credential_vault.KIND_GENERATED, actor_id=actor.id
    )
    revoked = revoke_all_sessions(db, employee.id, reason="password_reset")
    auth_cache.forget_employee(db, employee.id)
    audit_service.record(
        db, action="employee.reset_password", actor=actor, entity_type="employee", entity_id=employee.id, request=request,
        details={"sessions_revoked": revoked},
    )
    db.commit()
    return password


def view_credentials(db: Session, *, employee: Employee, actor: Employee, request: Request) -> CredentialOut:
    """The first password of an employee, for the administrator who is looking at their page. Audited every time."""
    stored = credential_vault.read(db, employee.id)
    audit_service.record(
        db, action="employee.credentials_viewed", actor=actor, entity_type="employee", entity_id=employee.id, request=request,
        details={"available": stored is not None},
    )
    setter = db.get(Employee, stored.created_by) if stored and stored.created_by else None
    if stored is not None:
        credential_vault.note_viewed(db, employee.id)
    db.commit()
    return CredentialOut(
        employee_id=employee.id,
        employee_code=employee.employee_code,
        full_name=employee.full_name,
        email=employee.email,
        phone=employee.phone,
        available=stored is not None,
        password=stored.password if stored else None,
        kind=stored.kind if stored else None,
        set_at=stored.created_at if stored else None,
        set_by=setter.full_name if setter else None,
        must_change_password=employee.must_change_password,
        view_count=(stored.view_count + 1) if stored else 0,
        keep_days=get_settings().credential_keep_days,
    )


def credentials_sheet(db: Session, *, ids: list[int], actor: Employee, request: Request) -> tuple[bytes, int]:
    """An Excel sheet with the login of every employee whose first password can still be looked at (or of the ones named).

    Every cell is written as TEXT: a password that starts with = + - @ must not become a formula when the sheet is opened.
    """
    from openpyxl import Workbook
    from openpyxl.cell import WriteOnlyCell

    wanted = ids or credential_vault.pending_employee_ids(db)
    employees = {e.id: e for e in db.scalars(select(Employee).where(Employee.id.in_(wanted)).order_by(Employee.full_name, Employee.id)).unique()}
    workbook = Workbook(write_only=True)
    sheet = workbook.create_sheet("Logins")

    def text(value: str) -> WriteOnlyCell:
        cell = WriteOnlyCell(sheet, value=value)
        cell.data_type = "s"
        return cell

    sheet.append([text(h) for h in ("Employee ID", "Name", "Email", "Phone", "Password", "Must change it at the first sign-in", "Team")])
    count = 0
    for employee in employees.values():
        stored = credential_vault.read(db, employee.id)
        if stored is None:
            continue
        sheet.append(
            [
                text(employee.employee_code),
                text(employee.full_name),
                text(employee.email),
                text(employee.phone or ""),
                text(stored.password),
                text("Yes" if employee.must_change_password else "No"),
                text(employee.team_name or ""),
            ]
        )
        credential_vault.note_viewed(db, employee.id)
        count += 1
    audit_service.record(
        db, action="employee.credentials_exported", actor=actor, entity_type="employee", request=request, details={"employees": count}
    )
    db.commit()
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue(), count


def revoke_sessions(db: Session, *, employee: Employee, actor: Employee, request: Request) -> int:
    count = revoke_all_sessions(db, employee.id, reason="revoked_by_admin")
    audit_service.record(
        db, action="employee.revoke_sessions", actor=actor, entity_type="employee", entity_id=employee.id, request=request,
        details={"sessions_revoked": count},
    )
    db.commit()
    return count


def list_devices(db: Session, employee_id: int) -> list[EmployeeDevice]:
    return list(
        db.scalars(select(EmployeeDevice).where(EmployeeDevice.employee_id == employee_id).order_by(EmployeeDevice.last_seen_at.desc()))
    )


def unbind_device(db: Session, *, employee: Employee, device_id: int, actor: Employee, request: Request) -> None:
    device = db.get(EmployeeDevice, device_id)
    if device is None or device.employee_id != employee.id:
        raise NotFound("Device not found.")
    db.execute(
        EmployeeSession.__table__.update()
        .where(EmployeeSession.device_id == device.id, EmployeeSession.revoked_at.is_(None))
        .values(revoked_at=utcnow(), revoked_reason="device_unbound")
    )
    db.delete(device)
    audit_service.record(
        db, action="employee.device_unbind", actor=actor, entity_type="employee", entity_id=employee.id, request=request,
        details={"device_uid": device.device_uid},
    )
    db.commit()


def list_sessions(db: Session, employee_id: int, limit: int = 20) -> list[EmployeeSession]:
    return list(
        db.scalars(
            select(EmployeeSession)
            .where(EmployeeSession.employee_id == employee_id)
            .order_by(EmployeeSession.created_at.desc())
            .limit(limit)
        )
    )


# -------------------------------------------------------------------- teams
def list_teams(db: Session) -> list[tuple[Team, int]]:
    counts = dict(db.execute(select(Employee.team_id, func.count(Employee.id)).where(Employee.team_id.is_not(None)).group_by(Employee.team_id)).all())
    return [(t, counts.get(t.id, 0)) for t in db.scalars(select(Team).order_by(Team.name))]


def create_team(db: Session, data: TeamCreate, actor: Employee, request: Request) -> Team:
    if db.scalars(select(Team.id).where(func.lower(Team.name) == data.name.strip().lower())).first():
        raise Conflict("A team with this name already exists.", code="team_exists")
    team = Team(name=data.name.strip(), description=data.description)
    db.add(team)
    db.flush()
    audit_service.record(db, action="team.create", actor=actor, entity_type="team", entity_id=team.id, request=request, details={"name": team.name})
    db.commit()
    return team


def update_team(db: Session, team_id: int, data: TeamUpdate, actor: Employee, request: Request) -> Team:
    team = db.get(Team, team_id)
    if team is None:
        raise NotFound("Team not found.")
    if data.name is not None and data.name.strip().lower() != team.name.lower():
        if db.scalars(select(Team.id).where(func.lower(Team.name) == data.name.strip().lower(), Team.id != team_id)).first():
            raise Conflict("A team with this name already exists.", code="team_exists")
        team.name = data.name.strip()
    if data.description is not None:
        team.description = data.description
    if data.is_active is not None:
        team.is_active = data.is_active
    for member_id in db.scalars(select(Employee.id).where(Employee.team_id == team_id)):
        auth_cache.forget_employee(db, member_id)  # the team's name is part of what is remembered about each member
    audit_service.record(db, action="team.update", actor=actor, entity_type="team", entity_id=team.id, request=request)
    db.commit()
    return team


def delete_team(db: Session, team_id: int, actor: Employee, request: Request) -> None:
    team = db.get(Team, team_id)
    if team is None:
        raise NotFound("Team not found.")
    members = db.scalar(select(func.count(Employee.id)).where(Employee.team_id == team_id)) or 0
    if members:
        raise Conflict("Move or remove the team's employees before deleting it.", code="team_not_empty")
    db.delete(team)
    audit_service.record(db, action="team.delete", actor=actor, entity_type="team", entity_id=team_id, request=request)
    db.commit()
