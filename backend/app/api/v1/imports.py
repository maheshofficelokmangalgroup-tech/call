from typing import Annotated

from fastapi import APIRouter, File, Form, Query, Request, Response, UploadFile, status
from fastapi.responses import FileResponse

from app import jobs
from app.api.deps import AdminUser, DbSession, Paging
from app.core import rate_limit
from app.core.errors import ValidationFailed
from app.schemas.common import Page
from app.schemas.distribution import ImportPlanOut
from app.schemas.misc import ImportConfirm, ImportOut, ImportRowOut
from app.services import import_service

router = APIRouter()


def _parse_ids(value: str) -> list[int]:
    ids: list[int] = []
    for part in value.replace(";", ",").split(","):
        part = part.strip()
        if not part:
            continue
        if not part.isdigit() or len(part) > 18:
            raise ValidationFailed("employee_ids must be a comma separated list of numbers.", code="bad_employee_ids")
        ids.append(int(part))
    if len(ids) > 5000:
        raise ValidationFailed("Too many employees were chosen.", code="bad_employee_ids")
    return list(dict.fromkeys(ids))


@router.post("", response_model=ImportOut, status_code=status.HTTP_202_ACCEPTED)
def upload_import(
    request: Request,
    db: DbSession,
    admin: AdminUser,
    file: Annotated[UploadFile, File(description="CSV or XLSX file with a header row")],
    mode: Annotated[str, Form(description="skip | update - what to do with duplicate phone numbers")] = "skip",
    campaign_id: Annotated[int | None, Form()] = None,
    assign_employee_ids: Annotated[str, Form(description="comma separated employee ids that receive the new contacts (default: every employee who is working)")] = "",
    assign_strategy: Annotated[str, Form(description="equal | balance_total")] = "equal",
    default_priority: Annotated[int, Form()] = 2,
):
    """Step 1: upload. The file is checked in the background; poll GET /contacts/import/{id} until status=previewed."""
    rate_limit.enforce_sensitive(request, "import_upload", admin.id)
    imp = import_service.create_import(
        db,
        upload=file,
        actor=admin,
        mode=mode,
        campaign_id=campaign_id,
        assign_employee_ids=_parse_ids(assign_employee_ids),
        assign_strategy=assign_strategy,
        default_priority=default_priority,
        request=request,
    )
    jobs.submit("import-check", import_service.run_validation, imp.id)
    db.refresh(imp)
    return ImportOut.model_validate(imp)


@router.get("", response_model=Page[ImportOut])
def list_imports(db: DbSession, _admin: AdminUser, paging: Paging):
    rows, total = import_service.list_imports(db, page=paging.page, page_size=paging.page_size)
    return Page[ImportOut](items=[ImportOut.model_validate(r) for r in rows], total=total, page=paging.page, page_size=paging.page_size)


@router.get("/{import_id}", response_model=ImportOut)
def get_import(import_id: int, db: DbSession, _admin: AdminUser):
    return ImportOut.model_validate(import_service.get_import(db, import_id))


@router.get("/{import_id}/rows", response_model=Page[ImportRowOut])
def list_rows(
    import_id: int,
    db: DbSession,
    _admin: AdminUser,
    paging: Paging,
    row_status: Annotated[str | None, Query(alias="status", pattern="^(valid|invalid|duplicate)$")] = None,
):
    """A sample of what the check found: the first problem rows and the first valid rows. The whole list of problems is in issues.csv."""
    import_service.get_import(db, import_id)
    rows, total = import_service.list_rows(db, import_id, status=row_status, page=paging.page, page_size=paging.page_size)
    return Page[ImportRowOut](items=[ImportRowOut.model_validate(r) for r in rows], total=total, page=paging.page, page_size=paging.page_size)


@router.get("/{import_id}/issues.csv")
def download_issues(import_id: int, db: DbSession, _admin: AdminUser):
    """CSV of every row that was invalid or a duplicate, with the reason for each (and the original cells, to fix and upload again)."""
    imp = import_service.get_import(db, import_id)
    headers = {"Content-Disposition": f'attachment; filename="import-{imp.id}-issues.csv"', "Cache-Control": "no-store"}
    path = import_service.issues_file(imp)
    if path is not None:
        return FileResponse(path, media_type="text/csv; charset=utf-8", headers=headers)
    return Response(content=import_service.export_issues_csv(db, imp), media_type="text/csv; charset=utf-8", headers=headers)


@router.get("/{import_id}/plan", response_model=ImportPlanOut)
def plan_import(
    import_id: int,
    db: DbSession,
    _admin: AdminUser,
    employee_ids: Annotated[str, Query(description="comma separated employee ids (default: everybody who is working)")] = "",
    strategy: Annotated[str, Query(pattern="^(equal|balance_total)$")] = "equal",
    order: Annotated[str, Query(pattern="^(interleave|blocks)$")] = "interleave",
    leave_unassigned: bool = False,
):
    """Who is working, and how many of the sheet each of them would get. Nothing is changed."""
    imp = import_service.get_import(db, import_id)
    return import_service.build_plan(db, imp, employee_ids=_parse_ids(employee_ids) or None, strategy=strategy, order=order, leave_unassigned=leave_unassigned)


@router.post("/{import_id}/confirm", response_model=ImportOut, status_code=status.HTTP_202_ACCEPTED)
def confirm_import(
    import_id: int,
    payload: ImportConfirm,
    request: Request,
    db: DbSession,
    admin: AdminUser,
):
    """Step 2: add the contacts and give them out. Poll until status=completed (a big sheet takes minutes; it carries on by itself
    after a restart)."""
    imp = import_service.get_import(db, import_id)
    imp = import_service.begin_apply(db, imp, admin, payload.mode, request, payload.distribution)
    jobs.submit("import-apply", import_service.run_apply, imp.id)
    db.refresh(imp)
    return ImportOut.model_validate(imp)


@router.post("/{import_id}/retry", response_model=ImportOut, status_code=status.HTTP_202_ACCEPTED)
def retry_import(import_id: int, request: Request, db: DbSession, admin: AdminUser):
    """Carry on with an import that stopped while adding the contacts (what was added stays)."""
    imp = import_service.get_import(db, import_id)
    imp = import_service.retry_apply(db, imp, admin, request)
    jobs.submit("import-apply", import_service.run_apply, imp.id)
    db.refresh(imp)
    return ImportOut.model_validate(imp)


@router.post("/{import_id}/cancel", response_model=ImportOut)
def cancel_import(import_id: int, request: Request, db: DbSession, admin: AdminUser):
    """Cancel an upload; while contacts are being added, stop after the step that is running (what was added stays)."""
    imp = import_service.get_import(db, import_id)
    return ImportOut.model_validate(import_service.cancel_import(db, imp, admin, request))
