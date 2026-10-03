"""Small database helpers that behave the same on MySQL (production) and SQLite (development and tests)."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Any, TypeVar

from sqlalchemy import Table, insert
from sqlalchemy.exc import DBAPIError, InterfaceError, OperationalError
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.sql.expression import ClauseElement
from sqlalchemy.sql.visitors import InternalTraversal

log = logging.getLogger(__name__)
T = TypeVar("T")

# MySQL: 1205 lock wait timeout, 1213 deadlock, 2006 / 2013 / 2014 connection lost - all go away when the work is simply tried again
_TRANSIENT_MYSQL = {1205, 1213, 2006, 2013, 2014, 2055}


class KeepExistingRow(ClauseElement):
    """MySQL's `ON DUPLICATE KEY UPDATE col = col`: the row that is there stays exactly as it is. It is written like this, and not with
    SQLAlchemy's own on_duplicate_key_update(), for the sake of the driver - see `insert_ignore`."""

    __visit_name__ = "keep_existing_row"
    _traverse_internals = [("column_name", InternalTraversal.dp_string)]
    inherit_cache = True

    def __init__(self, column_name: str) -> None:
        self.column_name = column_name


@compiles(KeepExistingRow, "mysql")
def _render_keep_existing_row(element: KeepExistingRow, compiler: Any, **kw: Any) -> str:
    name = compiler.preparer.quote(element.column_name)
    return f"ON DUPLICATE KEY UPDATE {name} = {name}"


def insert_ignore(db: Session, table: Table, rows: list[dict[str, Any]], *, conflict_column: str | tuple[str, ...]) -> None:
    """INSERT the rows. A row whose `conflict_column` value(s) are already there is left out, silently; no other problem is hidden
    (that is the difference to INSERT IGNORE, which also turns a too long text into a quietly cut one)."""
    if not rows:
        return
    columns = (conflict_column,) if isinstance(conflict_column, str) else tuple(conflict_column)
    dialect = db.get_bind().dialect.name
    if dialect == "mysql":
        from sqlalchemy.dialects.mysql import insert as mysql_insert

        # "set the column to what it is" - the row that is already there stays exactly as it is.
        # Not on_duplicate_key_update(): that one makes SQLAlchemy put "AS new" in front of ON DUPLICATE, and pymysql's pattern for
        # "INSERT ... VALUES (...) ON DUPLICATE KEY" does not know it. The pattern then takes seconds to fail (the more columns the
        # longer: 6 s for 2,000 contacts) and every row is sent as a statement of its own. Written as `KeepExistingRow` pymysql
        # joins the rows into statements of up to 1 MB: a few round trips for a whole step.
        statement = mysql_insert(table)
        statement._post_values_clause = KeepExistingRow(table.c[columns[0]].name)
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
