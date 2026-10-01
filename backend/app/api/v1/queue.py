from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import CurrentEmployee, DbSession
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
    """Today's calling queue for the signed-in employee: due callbacks, then priority contacts, then later callbacks."""
    return queue_service.build_queue(db, user.id, limit=limit, offset=offset)
