"""Uniform error model.

Every error leaves the API as:
    {"error": {"code": "<machine_code>", "message": "<human text>", "details": ..., "request_id": "..."}}
The mobile app keys its behaviour off `code`, never off the message text.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import request_id_ctx

log = logging.getLogger(__name__)


class AppError(Exception):
    status_code = 400
    default_code = "bad_request"

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        details: Any = None,
        status_code: int | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code or self.default_code
        self.details = details
        self.headers = headers
        if status_code is not None:
            self.status_code = status_code


class BadRequest(AppError):
    status_code = 400
    default_code = "bad_request"


class Unauthorized(AppError):
    status_code = 401
    default_code = "unauthorized"

    def __init__(self, message: str = "Authentication required.", **kw: Any) -> None:
        kw.setdefault("headers", {"WWW-Authenticate": "Bearer"})
        super().__init__(message, **kw)


class Forbidden(AppError):
    status_code = 403
    default_code = "forbidden"

    def __init__(self, message: str = "You do not have permission to perform this action.", **kw: Any) -> None:
        super().__init__(message, **kw)


class NotFound(AppError):
    status_code = 404
    default_code = "not_found"

    def __init__(self, message: str = "Resource not found.", **kw: Any) -> None:
        super().__init__(message, **kw)


class Conflict(AppError):
    status_code = 409
    default_code = "conflict"


class ValidationFailed(AppError):
    status_code = 422
    default_code = "validation_error"


class TooManyRequests(AppError):
    status_code = 429
    default_code = "rate_limited"


class PayloadTooLarge(AppError):
    status_code = 413
    default_code = "payload_too_large"


def _payload(code: str, message: str, details: Any = None) -> dict[str, Any]:
    body: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        body["details"] = details
    rid = request_id_ctx.get()
    if rid:
        body["request_id"] = rid
    return {"error": body}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_payload(exc.code, exc.message, exc.details),
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = []
        for err in exc.errors():
            loc = ".".join(str(p) for p in err.get("loc", []) if p not in ("body",))
            details.append({"field": loc, "message": err.get("msg", "Invalid value")})
        return JSONResponse(
            status_code=422,
            content=_payload("validation_error", "The request contains invalid data.", details),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed"}.get(
            exc.status_code, f"http_{exc.status_code}"
        )
        message = exc.detail if isinstance(exc.detail, str) else "Request failed."
        return JSONResponse(
            status_code=exc.status_code,
            content=_payload(code, message),
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("Unhandled error: %s", exc)
        return JSONResponse(
            status_code=500,
            content=_payload("internal_error", "An unexpected error occurred. Please try again."),
        )
