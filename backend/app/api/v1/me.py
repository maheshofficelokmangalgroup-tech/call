from fastapi import APIRouter

from app.api.deps import CurrentEmployee, DbSession
from app.core.config import get_settings
from app.core.timeutils import utcnow
from app.schemas.call import DispositionOut
from app.schemas.employee import EmployeeOut
from app.schemas.misc import ClientConfig, MeOut, RecordingConfig
from app.services import call_service, notification_service
from app.services.settings_service import get_recording_config

router = APIRouter()


def build_config(db, user) -> ClientConfig:
    settings = get_settings()
    rec = get_recording_config(db)
    return ClientConfig(
        server_time=utcnow(),
        timezone=settings.app_timezone,
        daily_target=user.daily_target,
        default_phone_region=settings.default_phone_region,
        recording=RecordingConfig(
            enabled=bool(rec.get("enabled")),
            notice_text=str(rec.get("notice_text", "")),
            max_size_mb=settings.max_recording_mb,
            allowed_types=sorted(settings.allowed_recording_type_set),
        ),
        dispositions=[DispositionOut.model_validate(d) for d in call_service.list_dispositions(db)],
        unread_notifications=notification_service.unread_count(db, user.id),
    )


@router.get("/me", response_model=MeOut)
def me(db: DbSession, user: CurrentEmployee):
    """Profile of the signed-in employee plus the server-driven configuration the app needs."""
    return MeOut(employee=EmployeeOut.model_validate(user), config=build_config(db, user))
