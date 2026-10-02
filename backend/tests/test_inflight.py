"""A burst of requests (everybody opens the app at nine o'clock) must be done a little later - never stand still.

The load test on MySQL showed it: with more requests in progress than a worker has threads, the requests that already held a database
connection waited for a thread behind the requests that waited for a connection. Nothing moved until the waiting timed out.
"""

from __future__ import annotations

import asyncio
import time

import httpx
import pytest
from fastapi import Depends, FastAPI
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from app.core.config import reset_settings_cache
from app.core.protection import InFlightLimitMiddleware


def make_app(tmp_path, *, limited: bool, pool_timeout: float):
    """The shape of the real request path: a dependency opens a session, another one asks the database who is calling (the
    connection stays with the request), then the endpoint uses it again - each step in a thread of its own."""
    engine = create_engine(
        f"sqlite:///{(tmp_path / 'burst.db').as_posix()}",
        poolclass=QueuePool,
        pool_size=2,
        max_overflow=0,
        pool_timeout=pool_timeout,
        connect_args={"check_same_thread": False},
    )
    sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def get_db():
        db = sessions()
        try:
            yield db
        finally:
            db.close()

    def who(db: Session = Depends(get_db)):
        db.execute(text("select 1")).all()  # the connection is now this request's, until it ends
        return "somebody"

    app = FastAPI()

    @app.get("/work")
    def work(user: str = Depends(who), db: Session = Depends(get_db)):
        time.sleep(0.005)
        db.execute(text("select 2")).all()
        return {"ok": True}

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    if limited:
        app.add_middleware(InFlightLimitMiddleware)
    return app, engine


async def burst(app, count: int):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=60) as client:
        started = time.monotonic()
        answers = await asyncio.gather(*[client.get("/work") for _ in range(count)], return_exceptions=True)
        return answers, time.monotonic() - started


def codes(answers):
    return [a.status_code if isinstance(a, httpx.Response) else type(a).__name__ for a in answers]


@pytest.fixture()
def small_limits(monkeypatch):
    monkeypatch.setenv("MAX_INFLIGHT_REQUESTS", "24")
    monkeypatch.setenv("INFLIGHT_WAIT_SECONDS", "20")
    reset_settings_cache()
    yield
    reset_settings_cache()


def test_without_turn_taking_a_burst_stands_still(tmp_path, small_limits):
    """The control: this is what happened. 150 requests at once, two database connections, the usual 40 threads."""
    app, engine = make_app(tmp_path, limited=False, pool_timeout=3)
    try:
        answers, _ = asyncio.run(burst(app, 150))
    finally:
        engine.dispose()
    failed = [c for c in codes(answers) if c != 200]
    assert failed, "the burst got through without turn-taking: this test no longer shows the problem it guards against"


def test_with_turn_taking_the_same_burst_is_simply_done(tmp_path, small_limits):
    app, engine = make_app(tmp_path, limited=True, pool_timeout=10)
    try:
        answers, seconds = asyncio.run(burst(app, 150))
    finally:
        engine.dispose()
    assert set(codes(answers)) == {200}, codes(answers)
    assert seconds < 8, f"{seconds:.1f} s"


def test_the_ones_that_wait_too_long_are_told_to_come_back(tmp_path, monkeypatch):
    monkeypatch.setenv("MAX_INFLIGHT_REQUESTS", "2")
    monkeypatch.setenv("INFLIGHT_WAIT_SECONDS", "0.3")
    reset_settings_cache()
    try:
        app = FastAPI()

        @app.get("/slow")
        async def slow():
            await asyncio.sleep(1.0)
            return {"ok": True}

        @app.get("/health")
        async def health():
            return {"status": "ok"}

        app.add_middleware(InFlightLimitMiddleware)

        async def run():
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=30) as client:
                slow_ones = [asyncio.create_task(client.get("/slow")) for _ in range(5)]
                await asyncio.sleep(0.1)
                probe = await client.get("/health")  # a probe is never made to wait
                return probe, await asyncio.gather(*slow_ones)

        probe, answers = asyncio.run(run())
    finally:
        reset_settings_cache()
    assert probe.status_code == 200
    statuses = sorted(a.status_code for a in answers)
    assert statuses == [200, 200, 503, 503, 503], statuses
    refused = next(a for a in answers if a.status_code == 503)
    assert refused.headers["retry-after"] == "3" and refused.json()["error"]["code"] == "server_busy"


def test_a_turn_is_given_back_when_the_request_fails(tmp_path, monkeypatch):
    monkeypatch.setenv("MAX_INFLIGHT_REQUESTS", "1")
    monkeypatch.setenv("INFLIGHT_WAIT_SECONDS", "5")
    reset_settings_cache()
    try:
        app = FastAPI()

        @app.get("/boom")
        async def boom():
            raise RuntimeError("broken")

        @app.get("/fine")
        async def fine():
            return {"ok": True}

        app.add_middleware(InFlightLimitMiddleware)

        async def run():
            transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
            async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=10) as client:
                first = await client.get("/boom")
                return first.status_code, (await client.get("/fine")).status_code

        assert asyncio.run(run()) == (500, 200)
    finally:
        reset_settings_cache()
