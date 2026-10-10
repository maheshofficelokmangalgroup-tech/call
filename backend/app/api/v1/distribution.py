"""Who is working, and the rebalancing of contacts from people who stopped to the people who are working (administrators only)."""

from fastapi import APIRouter, Request, status

from app import jobs
from app.api.deps import AdminUser, DbSession, Paging
from app.core import rate_limit
from app.schemas.common import Page
from app.schemas.distribution import ActivityOverviewOut, LevelIn, LevelPlanOut, RebalanceIn, RebalancePlanOut, RebalanceRunOut
from app.services import level_service, rebalance_service

router = APIRouter()


@router.get("/overview", response_model=ActivityOverviewOut)
def overview(db: DbSession, _admin: AdminUser):
    """Every employee with the state they are in (active / new / inactive / deactivated), what they own, and what could be taken back."""
    return rebalance_service.overview(db)


@router.post("/rebalance/preview", response_model=RebalancePlanOut)
def preview(payload: RebalanceIn, db: DbSession, _admin: AdminUser):
    """What a rebalancing would do right now. Nothing is changed."""
    return rebalance_service.preview(db, payload)


@router.post("/rebalance", response_model=RebalanceRunOut, status_code=status.HTTP_202_ACCEPTED)
def rebalance(payload: RebalanceIn, request: Request, db: DbSession, admin: AdminUser):
    """Give the waiting contacts of people who are not working to the people who are. Poll GET /distribution/runs/{id}."""
    rate_limit.enforce_sensitive(request, "rebalance", admin.id)
    run = rebalance_service.start(db, data=payload, actor_id=admin.id, trigger="manual")
    assert run is not None
    jobs.submit("rebalance", rebalance_service.execute_run, run.id)
    db.refresh(run)
    return run


@router.post("/level/preview", response_model=LevelPlanOut)
def level_preview(payload: LevelIn, db: DbSession, _admin: AdminUser):
    """What sharing the not-yet-called contacts equally between the people who are working would do right now. Nothing is changed."""
    return level_service.preview(db, payload)


@router.post("/level", response_model=RebalanceRunOut, status_code=status.HTTP_202_ACCEPTED)
def level(payload: LevelIn, request: Request, db: DbSession, admin: AdminUser):
    """Share the contacts nobody has called yet equally between the people who are working (a new employee gets his share).
    Poll GET /distribution/runs/{id}."""
    rate_limit.enforce_sensitive(request, "level", admin.id)
    run = level_service.start(db, data=payload, actor_id=admin.id, trigger="manual")
    assert run is not None
    jobs.submit("level", level_service.execute_run, run.id)
    db.refresh(run)
    return run


@router.get("/runs", response_model=Page[RebalanceRunOut])
def runs(db: DbSession, _admin: AdminUser, paging: Paging):
    rows, total = rebalance_service.list_runs(db, page=paging.page, page_size=paging.page_size)
    return Page[RebalanceRunOut](items=[RebalanceRunOut.model_validate(r) for r in rows], total=total, page=paging.page, page_size=paging.page_size)


@router.get("/runs/{run_id}", response_model=RebalanceRunOut)
def run_detail(run_id: int, db: DbSession, _admin: AdminUser):
    return rebalance_service.get_run(db, run_id)
