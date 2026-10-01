"""Password hashing, JWT access tokens, opaque refresh tokens and signed playback URLs."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import uuid
from datetime import timedelta
from typing import Any

import bcrypt
import jwt

from app.core.config import get_settings
from app.core.errors import Unauthorized
from app.core.timeutils import utcnow

JWT_ISSUER = "employee-calling-api"


# ----------------------------------------------------------------- passwords
def _prehash(password: str) -> bytes:
    """bcrypt only uses the first 72 bytes; pre-hashing removes that limit (and NUL issues)."""
    digest = hashlib.sha256(password.encode("utf-8")).digest()
    return base64.b64encode(digest)


def hash_password(password: str) -> str:
    rounds = get_settings().bcrypt_rounds
    return bcrypt.hashpw(_prehash(password), bcrypt.gensalt(rounds=rounds)).decode("ascii")


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(_prehash(password), password_hash.encode("ascii"))
    except ValueError:
        return False


_DUMMY_HASH: str | None = None


def burn_password_check(password: str) -> None:
    """Spend the same time as a real check so unknown identifiers are not distinguishable."""
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password("dummy-password-for-timing")
    verify_password(password, _DUMMY_HASH)


def validate_password_strength(password: str, *, forbidden: list[str] | None = None) -> list[str]:
    """Return a list of human-readable problems (empty list == acceptable)."""
    settings = get_settings()
    problems: list[str] = []
    if len(password) < settings.password_min_length:
        problems.append(f"Password must be at least {settings.password_min_length} characters long.")
    if not any(c.isalpha() for c in password) or not any(c.isdigit() for c in password):
        problems.append("Password must contain at least one letter and one number.")
    lowered = password.lower()
    for item in forbidden or []:
        if item and len(item) >= 4 and item.lower() in lowered:
            problems.append("Password must not contain your name, email or employee ID.")
            break
    return problems


# --------------------------------------------------------------- access token
def create_access_token(*, employee_id: int, session_id: str, role: str) -> tuple[str, int]:
    """Returns (token, expires_in_seconds)."""
    settings = get_settings()
    now = utcnow()
    ttl = timedelta(minutes=settings.jwt_access_ttl_minutes)
    payload: dict[str, Any] = {
        "iss": JWT_ISSUER,
        "sub": str(employee_id),
        "sid": session_id,
        "role": role,
        "typ": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
        "jti": uuid.uuid4().hex,
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, int(ttl.total_seconds())


def decode_access_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        claims = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            issuer=JWT_ISSUER,
            options={"require": ["exp", "sub", "sid", "typ"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise Unauthorized("Access token expired.", code="token_expired") from exc
    except jwt.PyJWTError as exc:
        raise Unauthorized("Invalid access token.", code="invalid_token") from exc
    if claims.get("typ") != "access":
        raise Unauthorized("Invalid access token.", code="invalid_token")
    return claims


# -------------------------------------------------------------- refresh token
def new_refresh_token(session_id: str) -> tuple[str, str]:
    """Returns (token_sent_to_client, sha256_hex_stored_in_db)."""
    token = f"{session_id}.{secrets.token_urlsafe(48)}"
    return token, hash_token(token)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def split_refresh_token(token: str) -> tuple[str, str]:
    session_id, _, secret = token.partition(".")
    if not session_id or not secret:
        raise Unauthorized("Invalid refresh token.", code="invalid_refresh_token")
    return session_id, hash_token(token)


def tokens_equal(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return False
    return hmac.compare_digest(a, b)


# ------------------------------------------------------ signed playback URLs
def _signing_key() -> bytes:
    return hashlib.sha256(("recording-url:" + get_settings().jwt_secret).encode("utf-8")).digest()


def sign_playback(recording_id: int, actor_id: int, expires_at: int, mode: str) -> str:
    message = f"{recording_id}:{actor_id}:{expires_at}:{mode}".encode("utf-8")
    return hmac.new(_signing_key(), message, hashlib.sha256).hexdigest()


def verify_playback(recording_id: int, actor_id: int, expires_at: int, mode: str, signature: str) -> bool:
    if expires_at < int(utcnow().timestamp()):
        return False
    expected = sign_playback(recording_id, actor_id, expires_at, mode)
    return hmac.compare_digest(expected, signature or "")
