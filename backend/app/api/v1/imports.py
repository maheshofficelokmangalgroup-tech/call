from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, File, Form, Query, Request, Response, UploadFile, status

from app.api.deps import AdminUser, DbSession, Paging
from app.core import rate_limit
from app.core.errors import ValidationFailed
from app.schemas.common import Page
from app.schemas.misc import ImportConfirm, ImportOut, ImportRowOut
from app.services import import_service

router = APIRouter()


def _parse_ids(value: str) -> list[int]:
    ids: list[int] = []
    for part in value.replace(";", ",").split(","):
        part = part.strip()
        if not part:
            continue
        if not part.isdigit():
            raise ValidationFailed("assign_employee_ids must be a comma separated list of numbers.", code="bad_employee_ids")
        ids.append(int(part))
    return list(dict.fromkeys(ids))


@router.post("", response_model=ImportOut, status_code=status.HTTP_202_ACCEPTED)
def upload_import(
    request: Request,
    db: DbSession,
    admin: AdminUser,
    background: BackgroundTasks,
    file: Annotated[UploadFile, File(description="CSV or XLSX file with a header row")],
    mode: Annotated[str, Form(description="skip | update - what to do with duplicate phone numbers")] = "skip",
    campaign_id: Annotated[int | None, Form()] = None,
    assign_employee_ids: Annotated[str, Form(description="comma separated employee ids to distribute the new contacts to")] = "",
    assign_strategy: Annotated[str, Form()] = "round_robin",
    default_priority: Annotated[int, Form()] = 2,
):
    """Step 1: upload. The file is validated in the background; poll GET /contacts/import/{id} until status=previewed."""
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
    background.add_task(import_service.run_validation, imp.id)
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
    import_service.get_import(db, import_id)
    rows, total = import_service.list_rows(db, import_id, status=row_status, page=paging.page, page_size=paging.page_size)
    return Page[ImportRowOut](items=[ImportRowOut.model_validate(r) for r in rows], total=total, page=paging.page, page_size=paging.page_size)


@router.get("/{import_id}/issues.csv")
def download_issues(import_id: int, db: DbSession, _admin: AdminUser):
    """CSV of rows that were invalid or duplicates, with the reason for each."""
    imp = import_service.get_import(db, import_id)
    body = import_service.export_issues_csv(db, imp)
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="import-{imp.id}-issues.csv"'},
    )


@router.post("/{import_id}/confirm", response_model=ImportOut, status_code=status.HTTP_202_ACCEPTED)
def confirm_import(
    import_id: int,
    payload: ImportConfirm,
    request: Request,
    db: DbSession,
    admin: AdminUser,
    background: BackgroundTasks,
):
    """Step 2: apply the previewed import in one transaction. Poll until status=completed."""
    imp = import_service.get_import(db, import_id)
    imp = import_service.begin_apply(db, imp, admin, payload.mode, request)
    background.add_task(import_service.run_apply, imp.id, admin.id)
    return ImportOut.model_validate(imp)


@router.post("/{import_id}/cancel", response_model=ImportOut)
def cancel_import(import_id: int, request: Request, db: DbSession, admin: AdminUser):
    imp = import_service.get_import(db, import_id)
    return ImportOut.model_validate(import_service.cancel_import(db, imp, admin, request))
