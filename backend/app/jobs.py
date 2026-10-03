"""Background work of the API: a sheet being checked or applied, the automatic rebalancing, housekeeping.

It runs in threads of the API process - nothing more has to be installed or started. What a thread is doing is always written to the
database in small steps (see import_service), so a restart or a crash only delays the work: the scheduler below finds work that nobody
is doing any more and carries on. Tests run the work inline (JOBS_INLINE) and keep the scheduler off (BACKGROUND_JOBS=false).
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

from app.core import cache
from app.core.config import get_settings

log = logging.getLogger(__name__)

TICK_SECONDS = 30
_stop = threading.Event()
_scheduler: threading.Thread | None = None
# The database connections of a worker are few (the phones and the panel use the same ones). Of the background jobs that write a lot -
# adding a sheet, moving contacts - one runs at a time in a process, so they can never take the connections of the requests.
_writer = threading.Semaphore(1)


@contextmanager
def writer_slot() -> Iterator[None]:
    with _writer:
        yield


def _run(name: str, fn: Callable[..., Any], args: tuple[Any, ...]) -> None:
    try:
        fn(*args)
    except Exception:  # noqa: BLE001 - a background job must never take the process down
        log.exception("Background job %s failed", name)


def submit(name: str, fn: Callable[..., Any], *args: Any) -> None:
    """Do `fn(*args)` in the background (in a thread of its own; right here when JOBS_INLINE is set)."""
    if get_settings().jobs_inline:
        _run(name, fn, args)
        return
    threading.Thread(target=_run, args=(name, fn, args), name=name, daemon=True).start()


def clean_upload_tmp(max_age_seconds: int = 24 * 3600) -> int:
    """Half-received uploads that a crash left behind (the folder of temporary upload files, when it is on the data volume)."""
    import time
    from pathlib import Path

    folder = get_settings().upload_tmp_path
    if not folder or not Path(folder).is_dir():
        return 0
    removed = 0
    limit = time.time() - max_age_seconds
    for entry in Path(folder).iterdir():
        try:
            if entry.is_file() and entry.stat().st_mtime < limit:
                entry.unlink()
                removed += 1
        except OSError:  # pragma: no cover - somebody else removed it, or it is in use
            continue
    return removed


def tick() -> None:
    """One round of the scheduler. Every step is safe to run in every worker at the same time (leases / one-per-window gates)."""
    from app.core.database import new_session
    from app.services import credential_vault, import_service, rebalance_service

    try:
        import_service.recover_stuck_imports()
    except Exception:  # noqa: BLE001
        log.exception("Recovering unfinished imports failed")
    if cache.once_per("job:auto-rebalance", 600):  # every ten minutes, in one worker
        try:
            rebalance_service.auto_rebalance()
        except Exception:  # noqa: BLE001
            log.exception("Automatic rebalancing failed")
    if cache.once_per("job:housekeeping", 3600):
        db = new_session()
        try:
            import_service.purge_old_imports(db, older_than_days=30)
            import_service.expire_unconfirmed(db)
            credential_vault.purge_expired(db)
            rebalance_service.recover_stuck_runs(db)
            clean_upload_tmp()
        except Exception:  # noqa: BLE001
            log.exception("Housekeeping failed")
        finally:
            db.close()


def _loop() -> None:
    if _stop.wait(15):  # give the process time to start answering first
        return
    while not _stop.is_set():
        tick()
        if _stop.wait(TICK_SECONDS):
            return


def start_scheduler() -> None:
    global _scheduler
    if not get_settings().background_jobs or (_scheduler is not None and _scheduler.is_alive()):
        return
    _stop.clear()
    _scheduler = threading.Thread(target=_loop, name="scheduler", daemon=True)
    _scheduler.start()
    log.info("Background scheduler started")


def stop_scheduler() -> None:
    _stop.set()
