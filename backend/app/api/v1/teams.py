from fastapi import APIRouter, Request, status

from app.api.deps import AdminUser, CurrentEmployee, DbSession
from app.schemas.employee import TeamCreate, TeamOut, TeamUpdate
from app.services import employee_service

router = APIRouter()


@router.get("", response_model=list[TeamOut])
def list_teams(db: DbSession, _user: CurrentEmployee):
    return [TeamOut(id=t.id, name=t.name, description=t.description, is_active=t.is_active, member_count=n) for t, n in employee_service.list_teams(db)]


@router.post("", response_model=TeamOut, status_code=status.HTTP_201_CREATED)
def create_team(payload: TeamCreate, request: Request, db: DbSession, admin: AdminUser):
    team = employee_service.create_team(db, payload, admin, request)
    return TeamOut(id=team.id, name=team.name, description=team.description, is_active=team.is_active, member_count=0)


@router.patch("/{team_id}", response_model=TeamOut)
def update_team(team_id: int, payload: TeamUpdate, request: Request, db: DbSession, admin: AdminUser):
    team = employee_service.update_team(db, team_id, payload, admin, request)
    count = dict((t.id, n) for t, n in employee_service.list_teams(db)).get(team.id, 0)
    return TeamOut(id=team.id, name=team.name, description=team.description, is_active=team.is_active, member_count=count)


@router.delete("/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_team(team_id: int, request: Request, db: DbSession, admin: AdminUser):
    employee_service.delete_team(db, team_id, admin, request)
