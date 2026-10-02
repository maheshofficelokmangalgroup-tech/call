from fastapi import APIRouter

from app.api.v1 import (
    analytics,
    audit_logs,
    auth,
    callbacks,
    calls,
    campaigns,
    contacts,
    dashboard,
    employees,
    imports,
    me,
    notifications,
    queue,
    recordings,
    settings,
    teams,
)

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(me.router, tags=["me"])
api_router.include_router(employees.router, prefix="/employees", tags=["employees"])
api_router.include_router(teams.router, prefix="/teams", tags=["teams"])
# `imports` must be registered before `contacts` so /contacts/import is not captured by /contacts/{id}.
api_router.include_router(imports.router, prefix="/contacts/import", tags=["imports"])
api_router.include_router(contacts.router, prefix="/contacts", tags=["contacts"])
api_router.include_router(campaigns.router, prefix="/campaigns", tags=["campaigns"])
api_router.include_router(queue.router, prefix="/queue", tags=["queue"])
api_router.include_router(calls.router, prefix="/calls", tags=["calls"])
api_router.include_router(callbacks.router, prefix="/callbacks", tags=["callbacks"])
api_router.include_router(recordings.router, prefix="/recordings", tags=["recordings"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
api_router.include_router(audit_logs.router, prefix="/audit-logs", tags=["audit"])
api_router.include_router(analytics.router, prefix="/analytics", tags=["analytics"])
api_router.include_router(settings.router, prefix="/settings", tags=["settings"])
