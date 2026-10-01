from fastapi import APIRouter, Request, status

from app.api.deps import CurrentEmployee, DbSession
from app.schemas.common import Message
from app.schemas.employee import ChangePasswordRequest, LoginRequest, RefreshRequest, TokenPair
from app.services import auth_service

router = APIRouter()


@router.post("/login", response_model=TokenPair)
def login(payload: LoginRequest, request: Request, db: DbSession):
    """Sign in with email or employee ID. Registers the device when supplied."""
    return auth_service.login(db, identifier=payload.identifier, password=payload.password, device=payload.device, request=request)


@router.post("/refresh", response_model=TokenPair)
def refresh(payload: RefreshRequest, request: Request, db: DbSession):
    """Exchange a refresh token for a new access + refresh token pair (rotation)."""
    return auth_service.refresh(db, refresh_token=payload.refresh_token, request=request)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, db: DbSession, user: CurrentEmployee):
    auth_service.logout(db, session_id=request.state.session_id, employee=user, request=request)


@router.post("/change-password", response_model=Message)
def change_password(payload: ChangePasswordRequest, request: Request, db: DbSession, user: CurrentEmployee):
    auth_service.change_password(
        db,
        employee=user,
        current_password=payload.current_password,
        new_password=payload.new_password,
        current_session_id=request.state.session_id,
        request=request,
    )
    return Message(message="Password changed. Other devices have been signed out.")
