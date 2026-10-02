"""Guards that keep one bad or broken client from hurting everybody else: request size limits, response headers, upload slots."""

from __future__ import annotations

import json
import re
import threading
from collections.abc import Iterator
from contextlib import contextmanager

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import get_settings
from app.core.errors import PayloadTooLarge, TooManyRequests

# the only requests that may carry a file: everything else is a small JSON document
UPLOAD_PATHS = (re.compile(r"^/api/v1/recordings/\d+/upload$"), re.compile(r"^/api/v1/contacts/import$"))
UPLOAD_OVERHEAD_BYTES = 1024 * 1024  # form boundaries and the other fields of the upload


def _upload_limit_bytes(path: str) -> int | None:
    settings = get_settings()
    if UPLOAD_PATHS[0].match(path):
        return settings.max_recording_mb * 1024 * 1024 + UPLOAD_OVERHEAD_BYTES
    if UPLOAD_PATHS[1].match(path):
        return settings.max_import_mb * 1024 * 1024 + UPLOAD_OVERHEAD_BYTES
    return None


class BodyLimitMiddleware:
    """Refuses a request whose body is bigger than its kind allows - before the application reads (and keeps in memory) all of it.

    A JSON request is at most `max_json_body_kb`; a recording or a contact sheet may be as big as the settings allow.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] in ("GET", "HEAD", "OPTIONS"):
            await self.app(scope, receive, send)
            return
        upload_limit = _upload_limit_bytes(scope.get("path", ""))
        limit = upload_limit or get_settings().max_json_body_kb * 1024
        declared = next((v for k, v in scope.get("headers", []) if k == b"content-length"), None)
        if declared is not None and declared.isdigit() and int(declared) > limit:
            await self._refuse(send, limit)
            return

        if upload_limit is not None:
            # a file is received as a stream (it is written to disk as it arrives); one that grows past its limit is stopped
            received = 0

            async def counted() -> Message:
                nonlocal received
                message = await receive()
                if message["type"] == "http.request":
                    received += len(message.get("body", b""))
                    if received > limit:
                        raise PayloadTooLarge(f"The upload is larger than {limit // (1024 * 1024)} MB.")
                return message

            await self.app(scope, counted, send)
            return

        # a JSON document is small: read it here, so that one that never says how big it is (chunked) is refused with the same
        # answer as one that does, and hand it on
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] != "http.request":  # the client went away
                return
            body += message.get("body", b"")
            if len(body) > limit:
                await self._refuse(send, limit)
                return
            if not message.get("more_body", False):
                break
        replayed = False

        async def replay() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)

    @staticmethod
    async def _refuse(send: Send, limit: int) -> None:
        body = json.dumps({"error": {"code": "payload_too_large", "message": f"The request is larger than {limit // 1024} KB."}}).encode()
        await send({"type": "http.response.start", "status": 413, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})


class PathSanityMiddleware:
    """An id with more digits than a database id can have names nothing: answer "not found" without asking the database."""

    MAX_ID_DIGITS = 18  # a BIGINT has at most 19, and the ones this system hands out are far smaller

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and any(len(part) > self.MAX_ID_DIGITS and part.isdigit() for part in scope.get("path", "").split("/")):
            body = json.dumps({"error": {"code": "not_found", "message": "Resource not found."}}).encode()
            await send({"type": "http.response.start", "status": 404, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
            await send({"type": "http.response.body", "body": body})
            return
        await self.app(scope, receive, send)


class SecurityHeadersMiddleware:
    """Answers of the API are for one person: nothing may keep a copy (a shared phone, a proxy), and nothing may be sniffed as HTML."""

    HEADERS = (
        (b"cache-control", b"no-store"),
        (b"x-content-type-options", b"nosniff"),
        (b"referrer-policy", b"no-referrer"),
        (b"cross-origin-resource-policy", b"same-origin"),
    )

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope.get("path", "").startswith("/api/"):
            await self.app(scope, receive, send)
            return

        async def with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                present = {k.lower() for k, _ in message.get("headers", [])}
                message["headers"] = list(message.get("headers", [])) + [(k, v) for k, v in self.HEADERS if k not in present]
            await send(message)

        await self.app(scope, receive, with_headers)


# ------------------------------------------------------------------------------------------------ uploads
_uploads = threading.BoundedSemaphore(1024)  # replaced per worker by `configure_upload_slots`
_slot_count = 0


def configure_upload_slots(count: int | None = None) -> None:
    global _uploads, _slot_count
    _slot_count = max(1, count if count is not None else get_settings().max_concurrent_uploads)
    _uploads = threading.BoundedSemaphore(_slot_count)


@contextmanager
def upload_slot() -> Iterator[None]:
    """At most `max_concurrent_uploads` recordings or sheets are received at the same time by one worker. A phone on a slow
    connection holds its slot (and a worker thread) for minutes; without a limit a few of them would leave no thread for anybody
    else. The rest are told to come back in a moment - the app retries by itself."""
    if _slot_count == 0:
        configure_upload_slots()
    if not _uploads.acquire(blocking=False):
        raise TooManyRequests("The server is receiving many uploads right now. Try again in a moment.", details={"retry_after_seconds": 5}, headers={"Retry-After": "5"})
    try:
        yield
    finally:
        _uploads.release()
