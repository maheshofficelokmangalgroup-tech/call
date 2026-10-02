"""Small database helpers that behave the same on MySQL (production) and SQLite (development and tests)."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Any, TypeVar

from sqlalchemy import Table, insert
from sqlalchemy.exc import DBAPIError, InterfaceError, OperationalError
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)
T = TypeVar("T")

# MySQL: 1205 lock wait timeout, 1213 deadlock, 2006 / 2013 / 2014 connection lost - all go away when the work is simply tried again
_TRANSIENT_MYSQL = {1205, 1213, 2006, 2013, 2014, 2055}


def insert_ignore(db: Session, table: Table, rows: list[dict[str, Any]], *, conflict_column: str | tuple[str, ...]) -> None:
    """INSERT the rows. A row whose `conflict_column` value(s) are already there is left out, silently; no other problem is hidden
    (that is the difference to INSERT IGNORE, which also turns a too long text into a quietly cut one)."""
    if not rows:
        return
    columns = (conflict_column,) if isinstance(conflict_column, str) else tuple(conflict_column)
    dialect = db.get_bind().dialect.name
    if dialect == "mysql":
        from sqlalchemy.dialects.mysql import insert as mysql_insert

        # "set the column to what it is" - the row that is already there stays exactly as it is
        statement = mysql_insert(table).on_duplicate_key_update({columns[0]: table.c[columns[0]]})
    elif dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert

        statement = sqlite_insert(table).on_conflict_do_nothing(index_elements=list(columns))
    else:  # pragma: no cover - only MySQL and SQLite are used
        statement = insert(table)
    db.execute(statement, rows)


def is_transient(exc: BaseException) -> bool:
    """A failure that is worth trying again: a deadlock, a lock that did not clear, a lost connection, a busy SQLite file."""
    if isinstance(exc, InterfaceError):
        return True
    if isinstance(exc, DBAPIError):
        code = (getattr(exc.orig, "args", None) or [None])[0]
        if isinstance(code, int) and code in _TRANSIENT_MYSQL:
            return True
        return isinstance(exc, OperationalError) and "locked" in str(exc.orig).lower()
    return False


def retry_transient(db: Session, work: Callable[[], T], *, attempts: int = 4, base_delay: float = 0.4) -> T:
    """Run `work` (one unit that ends with a commit); when the database says "try again" roll back and do it once more."""
    for attempt in range(1, attempts + 1):
        try:
            return work()
        except Exception as exc:  # noqa: BLE001 - re-raised below unless it is a transient database failure
            db.rollback()
            if attempt == attempts or not is_transient(exc):
                raise
            delay = base_delay * (2 ** (attempt - 1))
            log.warning("Database busy (%s); trying the same step again in %.1f s (%s of %s)", exc.__class__.__name__, delay, attempt, attempts)
            time.sleep(delay)
    raise RuntimeError("unreachable")  # pragma: no cover
