from fastapi import APIRouter, Request

from app.api.deps import CurrentEmployee, DbSession
from app.core import cache
from app.core.config import get_settings
from app.core.timeutils import utcnow
from app.schemas.call import DispositionOut
from app.schemas.employee import EmployeeOut
from app.schemas.misc import ClientConfig, HeartbeatIn, HeartbeatOut, MeOut, RecordingConfig
from app.services import call_service, heartbeat_service, notification_service
from app.services.settings_service import EPOCH, get_recording_config

router = APIRouter()


def _organisation_config(db) -> dict:
    """What every phone is told, the same for everybody: the recording rules and the list of outcomes. It is remembered in Redis
    and rebuilt when a setting changes - not asked of the database by every phone every time the app opens."""
    if not cache.is_dirty(db, EPOCH):
        hit = cache.stamped_get("config:client", EPOCH)
        if hit is not None:
            return hit
    settings = get_settings()
    rec = get_recording_config(db)
    value = {
        "recording": RecordingConfig(
            enabled=bool(rec.get("enabled")),
            notice_text=str(rec.get("notice_text", "")),
            max_size_mb=settings.max_recording_mb,
            allowed_types=sorted(settings.allowed_recording_type_set),
        ).model_dump(),
        "dispositions": [DispositionOut.model_validate(d).model_dump() for d in call_service.list_dispositions(db)],
    }
    if not cache.is_dirty(db, EPOCH):
        cache.stamped_set("config:client", value, settings.config_cache_seconds, EPOCH)
    return value


def build_config(db, user) -> ClientConfig:
    settings = get_settings()
    shared = _organisation_config(db)
    return ClientConfig(
        server_time=utcnow(),
        timezone=settings.app_timezone,
        daily_target=user.daily_target,
        default_phone_region=settings.default_phone_region,
        recording=RecordingConfig.model_validate(shared["recording"]),
        dispositions=[DispositionOut.model_validate(d) for d in shared["dispositions"]],
        unread_notifications=notification_service.unread_count(db, user.id),
        heartbeat_seconds=settings.heartbeat_seconds,
        sync_interval_seconds=settings.sync_interval_seconds,
    )


@router.get("/me", response_model=MeOut)
def me(db: DbSession, user: CurrentEmployee):
    """Profile of the signed-in employee plus the server-driven configuration the app needs."""
    return MeOut(employee=EmployeeOut.model_validate(user), config=build_config(db, user))


@router.post("/me/heartbeat", response_model=HeartbeatOut)
def heartbeat(payload: HeartbeatIn, request: Request, db: DbSession, user: CurrentEmployee):
    """An open app reports that it is alive, and how the phone is (battery, network, permissions, unsent work).

    Costs the database nothing most of the time: the report is kept in Redis and copied into the device's row every few minutes.
    """
    heartbeat_service.record(db, employee=user, device_id=getattr(request.state, "device_id", None), data=payload, request=request)
    return HeartbeatOut(server_time=utcnow(), next_in_seconds=heartbeat_service.interval_seconds())
