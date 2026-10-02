"""Background work: it never takes the process down, one heavy writer at a time, the scheduler goes on after a failure."""

from __future__ import annotations

import threading
import time

from app import jobs
from app.core.config import reset_settings_cache
from app.services import import_service, rebalance_service


def test_a_failing_job_is_logged_and_never_raised(caplog):
    def boom():
        raise RuntimeError("this job is broken")

    jobs.submit("test-boom", boom)  # (inline in the tests)
    assert "Background job test-boom failed" in caplog.text


def test_jobs_run_in_a_thread_of_their_own_when_not_inline(monkeypatch):
    monkeypatch.setenv("JOBS_INLINE", "false")
    reset_settings_cache()
    try:
        seen = {}
        done = threading.Event()

        def work():
            seen["thread"] = threading.current_thread().name
            done.set()

        jobs.submit("named-job", work)
        assert done.wait(5) and seen["thread"] == "named-job" and seen["thread"] != threading.current_thread().name
    finally:
        monkeypatch.undo()
        reset_settings_cache()


def test_only_one_heavy_writer_runs_at_a_time():
    running, peak = [0], [0]
    lock = threading.Lock()

    def writer():
        with jobs.writer_slot():
            with lock:
                running[0] += 1
                peak[0] = max(peak[0], running[0])
            time.sleep(0.05)
            with lock:
                running[0] -= 1

    threads = [threading.Thread(target=writer) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert peak[0] == 1


def test_the_scheduler_goes_on_after_a_step_fails(monkeypatch, caplog):
    called = []

    def broken():
        raise RuntimeError("the database blinked")

    monkeypatch.setattr(import_service, "recover_stuck_imports", broken)
    monkeypatch.setattr(rebalance_service, "auto_rebalance", lambda: called.append("rebalance"))
    jobs.tick()
    assert called == ["rebalance"] and "Recovering unfinished imports failed" in caplog.text  # the next step still ran


def test_the_scheduler_only_starts_when_background_jobs_are_on(monkeypatch):
    monkeypatch.setattr(jobs, "_scheduler", None)
    jobs.start_scheduler()  # (BACKGROUND_JOBS=false in the tests)
    assert jobs._scheduler is None

    monkeypatch.setenv("BACKGROUND_JOBS", "true")
    reset_settings_cache()
    try:
        jobs.start_scheduler()
        assert jobs._scheduler is not None and jobs._scheduler.is_alive()
        first = jobs._scheduler
        jobs.start_scheduler()  # a second start does not make a second one
        assert jobs._scheduler is first
    finally:
        jobs.stop_scheduler()
        monkeypatch.undo()
        reset_settings_cache()
        if jobs._scheduler is not None:
            jobs._scheduler.join(2)
        jobs._scheduler = None


def test_old_half_received_uploads_are_removed_and_recent_ones_kept(tmp_path, monkeypatch):
    import os

    monkeypatch.setenv("UPLOAD_TMP_PATH", str(tmp_path))
    reset_settings_cache()
    try:
        old, recent = tmp_path / "old.tmp", tmp_path / "recent.tmp"
        old.write_bytes(b"x")
        recent.write_bytes(b"y")
        long_ago = time.time() - 3 * 24 * 3600
        os.utime(old, (long_ago, long_ago))
        assert jobs.clean_upload_tmp() == 1
        assert not old.exists() and recent.exists()
    finally:
        monkeypatch.undo()
        reset_settings_cache()
