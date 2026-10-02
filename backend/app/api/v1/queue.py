from typing import Annotated

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.api.deps import CurrentEmployee, DbSession
from app.core import cache
from app.core.config import get_settings
from app.models.cache_events import EVERYONE, employee_epoch
from app.schemas.call import QueueOut
from app.services import queue_service

router = APIRouter()


@router.get("", response_model=QueueOut)
def my_queue(
    db: DbSession,
    user: CurrentEmployee,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    """Today's calling queue for the signed-in employee: due callbacks, then priority contacts, then later callbacks.

    The answer is remembered for a few seconds and forgotten the moment anything that decides it changes (a call, an outcome, a
    callback, a contact handed over or taken back, a campaign switched on or off).
    """
    key, epochs = f"queue:{user.id}:{limit}:{offset}", (EVERYONE, employee_epoch(user.id))
    hit = cache.stamped_get(key, *epochs)
    if hit is not None:
        return JSONResponse(hit)
    queue = queue_service.build_queue(db, user.id, limit=limit, offset=offset)
    cache.stamped_set(key, queue.model_dump(mode="json", by_alias=True), get_settings().queue_cache_seconds, *epochs)
    return queue
