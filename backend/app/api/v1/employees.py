from typing import Annotated

from fastapi import APIRouter, Query, Request, status

from app.api.deps import AdminUser, DbSession, Paging, StaffUser
from app.core import rate_limit
from app.core.errors import AppError
from app.schemas.common import Message, Page
from app.schemas.employee import (
    BulkEmployeeResult,
    BulkEmployeesIn,
    BulkEmployeesOut,
    DeviceOut,
    EmployeeCreate,
    EmployeeCreated,
    EmployeeOut,
    EmployeeUpdate,
    PasswordReset,
    PasswordResetResult,
    SessionOut,
)
from app.services import employee_service
from app.services.scope import require_view_employee, visible_employee_ids

router = APIRouter()


@router.get("", response_model=Page[EmployeeOut])
def list_employees(
    db: DbSession,
    user: StaffUser,
    paging: Paging,
    q: Annotated[str | None, Query(max_length=100)] = None,
    team_id: int | None = None,
    role: Annotated[str | None, Query(pattern="^(admin|manager|employee)$")] = None,
    is_active: bool | None = None,
):
    rows, total = employee_service.list_employees(
        db,
        q=q,
        team_id=team_id,
        role=role,
        is_active=is_active,
        visible_ids=visible_employee_ids(db, user),
        page=paging.page,
        page_size=paging.page_size,
    )
    return Page[EmployeeOut](items=[EmployeeOut.model_validate(e) for e in rows], total=total, page=paging.page, page_size=paging.page_size)


@router.post("", response_model=EmployeeCreated, status_code=status.HTTP_201_CREATED)
def create_employee(payload: EmployeeCreate, request: Request, db: DbSession, admin: AdminUser):
    employee, temporary = employee_service.create_employee(db, data=payload, actor=admin, request=request)
    return EmployeeCreated(employee=EmployeeOut.model_validate(employee), temporary_password=temporary)


@router.post("/bulk", response_model=BulkEmployeesOut)
def create_employees_bulk(payload: BulkEmployeesIn, request: Request, db: DbSession, admin: AdminUser):
    """Create up to 100 employees at once. Each row succeeds or fails on its own (a duplicate email does not stop the rest)."""
    rate_limit.enforce_sensitive(request, "employee_bulk", admin.id)
    results: list[BulkEmployeeResult] = []
    for index, item in enumerate(payload.employees):
        try:
            employee, temporary = employee_service.create_employee(db, data=item, actor=admin, request=request)
        except AppError as exc:
            db.rollback()
            results.append(BulkEmployeeResult(index=index, ok=False, code=exc.code, error=exc.message))
            continue
        results.append(BulkEmployeeResult(index=index, ok=True, employee=EmployeeOut.model_validate(employee), temporary_password=temporary))
    created = sum(1 for r in results if r.ok)
    return BulkEmployeesOut(created=created, failed=len(results) - created, results=results)


@router.get("/{employee_id}", response_model=EmployeeOut)
def get_employee(employee_id: int, db: DbSession, user: StaffUser):
    require_view_employee(db, user, employee_id)
    return EmployeeOut.model_validate(employee_service.get_employee(db, employee_id))


@router.patch("/{employee_id}", response_model=EmployeeOut)
def update_employee(employee_id: int, payload: EmployeeUpdate, request: Request, db: DbSession, admin: AdminUser):
    employee = employee_service.get_employee(db, employee_id)
    return EmployeeOut.model_validate(employee_service.update_employee(db, employee=employee, data=payload, actor=admin, request=request))


@router.post("/{employee_id}/deactivate", response_model=EmployeeOut)
def deactivate(employee_id: int, request: Request, db: DbSession, admin: AdminUser):
    employee = employee_service.get_employee(db, employee_id)
    return EmployeeOut.model_validate(employee_service.set_active(db, employee=employee, active=False, actor=admin, request=request))


@router.post("/{employee_id}/activate", response_model=EmployeeOut)
def activate(employee_id: int, request: Request, db: DbSession, admin: AdminUser):
    employee = employee_service.get_employee(db, employee_id)
    return EmployeeOut.model_validate(employee_service.set_active(db, employee=employee, active=True, actor=admin, request=request))


@router.post("/{employee_id}/reset-password", response_model=PasswordResetResult)
def reset_password(employee_id: int, payload: PasswordReset, request: Request, db: DbSession, admin: AdminUser):
    employee = employee_service.get_employee(db, employee_id)
    password = employee_service.reset_password(db, employee=employee, new_password=payload.new_password, actor=admin, request=request)
    return PasswordResetResult(temporary_password=password)


@router.post("/{employee_id}/revoke-sessions", response_model=Message)
def revoke_sessions(employee_id: int, request: Request, db: DbSession, admin: AdminUser):
    employee = employee_service.get_employee(db, employee_id)
    count = employee_service.revoke_sessions(db, employee=employee, actor=admin, request=request)
    return Message(message=f"{count} session(s) revoked.")


@router.get("/{employee_id}/devices", response_model=list[DeviceOut])
def list_devices(employee_id: int, db: DbSession, admin: AdminUser):
    employee_service.get_employee(db, employee_id)
    return [DeviceOut.model_validate(d) for d in employee_service.list_devices(db, employee_id)]


@router.delete("/{employee_id}/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def unbind_device(employee_id: int, device_id: int, request: Request, db: DbSession, admin: AdminUser):
    employee = employee_service.get_employee(db, employee_id)
    employee_service.unbind_device(db, employee=employee, device_id=device_id, actor=admin, request=request)


@router.get("/{employee_id}/sessions", response_model=list[SessionOut])
def list_sessions(employee_id: int, db: DbSession, admin: AdminUser):
    employee_service.get_employee(db, employee_id)
    return [SessionOut.model_validate(s) for s in employee_service.list_sessions(db, employee_id)]
