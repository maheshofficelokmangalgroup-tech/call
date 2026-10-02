"""SQLAlchemy engine / session management (synchronous)."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from functools import lru_cache
from pathlib import Path

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

log = logging.getLogger(__name__)


def build_engine(url: str) -> Engine:
    settings = get_settings()
    parsed = make_url(url)
    kwargs: dict = {"pool_pre_ping": True}

    if parsed.get_backend_name() == "sqlite":
        kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}
        database = parsed.database
        if database and database != ":memory:":
            Path(database).parent.mkdir(parents=True, exist_ok=True)
    else:
        kwargs.update(
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            pool_timeout=settings.db_pool_timeout_seconds,
            pool_recycle=1800,
            # MySQL defaults to REPEATABLE READ, which keeps a stale snapshot for the life of a
            # transaction and takes extra gap locks. READ COMMITTED is what this workload wants.
            isolation_level="READ COMMITTED",
        )
        if parsed.get_backend_name() == "mysql" and "charset" not in parsed.query:
            kwargs["connect_args"] = {"charset": "utf8mb4"}

    engine = create_engine(url, **kwargs)

    if parsed.get_backend_name() == "sqlite":

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_conn, _record):  # pragma: no cover - trivial
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA busy_timeout=30000")
            cur.close()

    return engine


@lru_cache
def get_engine() -> Engine:
    return build_engine(get_settings().database_url)


@lru_cache
def get_sessionmaker() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), autoflush=False, expire_on_commit=False)


def new_session() -> Session:
    """Create a standalone session (background tasks, scripts). Caller must close it."""
    return get_sessionmaker()()


def get_db() -> Iterator[Session]:
    """FastAPI dependency. Services commit explicitly; anything uncommitted is rolled back."""
    db = new_session()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def reset_database_state() -> None:
    """Drop cached engine/sessionmaker (used by tests when DATABASE_URL changes)."""
    if get_engine.cache_info().currsize:
        get_engine().dispose()
    get_engine.cache_clear()
    get_sessionmaker.cache_clear()
