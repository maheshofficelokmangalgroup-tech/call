"""FastAPI application factory."""

from __future__ import annotations

import logging
import os
import tempfile
from contextlib import asynccontextmanager

import anyio.to_thread
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app import __version__, jobs
from app.api.v1 import api_router
from app.core.config import get_settings
from app.core.database import get_engine
from app.core.errors import install_error_handlers
from app.core.logging import RequestContextMiddleware, configure_logging
from app.core.protection import BodyLimitMiddleware, InFlightLimitMiddleware, PathSanityMiddleware, SecurityHeadersMiddleware, configure_upload_slots
from app.core.redis_client import get_redis, redis_status

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level, settings.log_json)
    log.info("Starting %s v%s (env=%s, db=%s)", settings.app_name, __version__, settings.app_env, get_engine().dialect.name)
    get_redis()  # connect early so a missing Redis is reported at boot, not on the first login
    configure_upload_slots()
    if settings.upload_tmp_path:
        os.makedirs(settings.upload_tmp_path, exist_ok=True)
        tempfile.tempdir = settings.upload_tmp_path
    # the handlers run in threads; there must always be a free one for a request that is in the middle of its work (see
    # InFlightLimitMiddleware): more threads than requests that are allowed to be in progress
    threads = anyio.to_thread.current_default_thread_limiter()
    threads.total_tokens = max(threads.total_tokens, settings.max_inflight_requests + 16)
    jobs.start_scheduler()  # takes over an import that was running when the last process stopped, rebalances, tidies up
    yield
    log.info("Shutting down")
    jobs.stop_scheduler()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        description="Backend for the Employee Calling & CRM platform. All endpoints live under /api/v1.",
        lifespan=lifespan,
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID", "Retry-After"],
    )
    # (the one added last is the outermost) request id + access log around everything, then the security headers - so that even an
    # answer given before the application is reached (a body that is too big, an impossible id) carries them. The turn-taking comes
    # after the body has been received (a slow uploader must not hold a turn while the body trickles in).
    app.add_middleware(InFlightLimitMiddleware)
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(PathSanityMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestContextMiddleware)
    install_error_handlers(app)

    app.include_router(api_router, prefix="/api/v1")

    @app.get("/health", tags=["ops"], include_in_schema=False)
    async def health():
        """Liveness probe: the process is up (answered without a thread, so it still answers when every thread is busy)."""
        return {"status": "ok", "version": __version__}

    @app.get("/ready", tags=["ops"], include_in_schema=False)
    def ready():
        """Readiness probe: the database (required) and Redis (degraded is tolerated outside production)."""
        checks: dict[str, object] = {}
        ok = True
        try:
            with get_engine().connect() as conn:
                conn.execute(text("SELECT 1"))
            checks["database"] = "ok"
        except Exception as exc:  # pragma: no cover - depends on infrastructure
            checks["database"] = f"error: {exc.__class__.__name__}"
            ok = False
        redis_info = redis_status()
        checks["redis"] = redis_info["mode"] if redis_info["ok"] else "error"
        if not redis_info["ok"] or (settings.is_production and redis_info["mode"] != "redis"):
            ok = False
        return JSONResponse(status_code=200 if ok else 503, content={"status": "ready" if ok else "degraded", "checks": checks})

    return app


app = create_app()
