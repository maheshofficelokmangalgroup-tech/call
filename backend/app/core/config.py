"""Application settings, loaded from environment variables / .env files.

Variable names follow section 27 of the project documentation. Secrets are never
hard-coded: the defaults below are only valid for local development and the
application refuses to start in staging/production with a weak JWT secret.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]

WEAK_SECRETS = {
    "",
    "change-me",
    "changeme",
    "secret",
    "password",
    "<local-secret>",
    "dev-secret-change-me",
    "local-dev-secret-change-me-please-0123456789",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- application ---------------------------------------------------------
    app_env: Literal["local", "development", "test", "staging", "production"] = "local"
    app_debug: bool = False
    app_name: str = "Employee Calling & CRM API"
    app_timezone: str = "Asia/Kolkata"  # business timezone used for "today" boundaries
    log_level: str = "INFO"
    log_json: bool = True
    default_phone_region: str = "IN"
    trust_proxy_headers: bool = False  # honour X-Forwarded-For (only behind a trusted proxy)

    # --- database / cache ----------------------------------------------------
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'var' / 'dev.db').as_posix()}"
    db_pool_size: int = 10
    db_max_overflow: int = 20
    redis_url: str | None = "redis://localhost:6379/0"

    # --- auth ----------------------------------------------------------------
    jwt_secret: str = "local-dev-secret-change-me-please-0123456789"
    jwt_algorithm: str = "HS256"
    jwt_access_ttl_minutes: int = 15
    jwt_refresh_ttl_days: int = 30
    bcrypt_rounds: int = 12
    password_min_length: int = 8
    refresh_reuse_grace_seconds: int = 60

    # --- rate limiting ---------------------------------------------------------
    rate_limit_enabled: bool = True
    rate_limit_login_per_ip: int = 30  # per minute
    rate_limit_login_per_identifier: int = 10  # per 5 minutes
    rate_limit_sensitive_per_minute: int = 30

    # --- speed: what is remembered in Redis instead of being asked of the database again ----------------------
    # (0 switches a cache off. Every cache is cleared by the change it depends on; the time is only the safety net.)
    auth_cache_seconds: int = 60  # a signed-in session and its employee: 0 database queries per request while it is warm
    config_cache_seconds: int = 300  # settings and outcome list the phones download
    queue_cache_seconds: int = 20  # an employee's calling queue
    dashboard_cache_seconds: int = 15
    analytics_cache_seconds: int = 8  # the admin panel's live view and reports (computed once per few seconds, not per viewer)

    # --- protection of the service itself -------------------------------------------------------------------------
    rate_limit_user_per_minute: int = 600  # requests one signed-in person may make per minute (a runaway app cannot flood the API)
    max_json_body_kb: int = 1024  # every request except an upload must be smaller than this
    max_concurrent_uploads: int = 6  # recording uploads one worker handles at the same time (the rest wait their turn with a 429)
    max_inflight_requests: int = 24  # requests one worker works on at the same time; the others wait for their turn (see protection.py)
    inflight_wait_seconds: float = 15.0  # how long one may wait for its turn before it is told to come back in a moment (503)

    # --- what the phones are told to do (they ask /me, nothing is fixed in the app) ----------------------------------
    heartbeat_seconds: int = 60  # how often a phone that is open reports that it is alive (and how its battery / network are)
    sync_interval_seconds: int = 45  # how often a phone retries what it could not send

    # --- storage / recordings --------------------------------------------------
    storage_backend: Literal["local", "s3"] = "local"
    local_storage_path: str = str(BACKEND_DIR / "var" / "storage")
    aws_region: str = "ap-south-1"
    aws_s3_bucket: str | None = None
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None
    s3_endpoint_url: str | None = None  # e.g. a local S3-compatible mock
    recording_url_ttl_seconds: int = 300
    max_recording_mb: int = 100
    allowed_recording_types: str = (
        "audio/mpeg,audio/mp4,audio/aac,audio/x-m4a,audio/wav,audio/x-wav,audio/ogg,"
        "audio/amr,audio/3gpp,audio/webm,audio/flac"
    )

    # --- imports ---------------------------------------------------------------
    import_storage_path: str = str(BACKEND_DIR / "var" / "imports")
    max_import_mb: int = 25
    max_import_rows: int = 100_000

    # --- web -------------------------------------------------------------------
    admin_web_origin: str = "http://localhost:3000"
    extra_cors_origins: str = ""

    # --- bootstrap (optional first admin created by scripts.bootstrap) ---------
    bootstrap_admin_email: str | None = None
    bootstrap_admin_password: str | None = None

    @field_validator("log_level")
    @classmethod
    def _upper_log_level(cls, v: str) -> str:
        return v.upper()

    @model_validator(mode="after")
    def _validate_production(self) -> "Settings":
        if self.app_env in ("staging", "production"):
            if self.jwt_secret in WEAK_SECRETS or len(self.jwt_secret) < 32:
                raise ValueError(
                    "JWT_SECRET must be a random string of at least 32 characters in "
                    f"{self.app_env}. Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
                )
            if self.app_debug:
                raise ValueError("APP_DEBUG must be false in staging/production")
            if self.storage_backend == "s3" and not self.aws_s3_bucket:
                raise ValueError("AWS_S3_BUCKET is required when STORAGE_BACKEND=s3")
            if self.is_sqlite:
                raise ValueError(
                    f"SQLite is for development and tests only: set DATABASE_URL to a MySQL database in {self.app_env} "
                    "(for example mysql+pymysql://user:password@host:3306/dbname?charset=utf8mb4)."
                )
            if not self.redis_url:
                raise ValueError(f"REDIS_URL is required in {self.app_env}: the caches, the rate limits and the sign-in checks need it.")
        return self

    # --- helpers ---------------------------------------------------------------
    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def cors_origins(self) -> list[str]:
        origins = [self.admin_web_origin]
        origins += [o.strip() for o in self.extra_cors_origins.split(",") if o.strip()]
        return [o for o in origins if o and o != "*"]

    @property
    def allowed_recording_type_set(self) -> set[str]:
        return {t.strip().lower() for t in self.allowed_recording_types.split(",") if t.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()


def reset_settings_cache() -> None:
    get_settings.cache_clear()
