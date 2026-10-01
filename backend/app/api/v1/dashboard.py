from datetime import date

from fastapi import APIRouter

from app.api.deps import CurrentEmployee, DbSession
from app.schemas.misc import DashboardOut
from app.services import dashboard_service

router = APIRouter()


@router.get("", response_model=DashboardOut)
def dashboard(
    db: DbSession,
    user: CurrentEmployee,
    day: date | None = None,
    employee_id: int | None = None,
    team_id: int | None = None,
):
    """Employees get their own figures; managers their team's; admins the whole organisation (or a filter)."""
    return dashboard_service.build_dashboard(db, user, day=day, employee_id=employee_id, team_id=team_id)
