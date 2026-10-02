"""Measure how the API behaves when many phones are calling at the same time (see also scripts/seed_load.py).

    python -m scripts.loadtest --base-url http://127.0.0.1:8000 --phones 100 --viewers 3 --seconds 60

Each simulated phone signs in once and then does what the real app does, only faster: it asks for its queue, starts a call, reports
its events, reports the end, records the outcome, reports in (the heartbeat) and now and then opens its dashboard. A few simulated
administrators watch the live view and the reports, like open browser tabs.

It prints a table (and writes it to the GitHub job summary) and exits with 1 when the service is too slow or answers with errors,
so it can stand guard in CI. NEVER point it at a production server: it creates thousands of calls.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import random
import statistics
import sys
import time
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import httpx

OUTCOMES = ["CONNECTED", "CONNECTED", "NO_ANSWER", "BUSY", "INTERESTED", "NOT_INTERESTED", "SWITCHED_OFF"]


class Recorder:
    def __init__(self) -> None:
        self.samples: dict[str, list[float]] = defaultdict(list)
        self.failures: dict[str, int] = defaultdict(int)
        self.throttled: dict[str, int] = defaultdict(int)
        self.first_errors: dict[str, str] = {}

    def add(self, name: str, status: int, seconds: float, detail: str = "") -> None:
        if status == 429:
            self.throttled[name] += 1
            return
        self.samples[name].append(seconds * 1000)
        if status >= 500 or status == 0:
            self.failures[name] += 1
            self.first_errors.setdefault(name, f"{status} {detail[:160]}")


def percentile(values: list[float], p: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(p / 100 * (len(ordered) - 1))))]


async def call(client: httpx.AsyncClient, rec: Recorder, name: str, method: str, url: str, **kw) -> httpx.Response | None:
    started = time.perf_counter()
    try:
        response = await client.request(method, url, **kw)
    except httpx.HTTPError as exc:
        rec.add(name, 0, time.perf_counter() - started, repr(exc))
        return None
    rec.add(name, response.status_code, time.perf_counter() - started, response.text)
    return response


def now_iso(delta: timedelta = timedelta()) -> str:
    return (datetime.now(timezone.utc) + delta).isoformat()


def tls_check(args) -> bool:
    """Certificate checking only exists for https (building the TLS machinery for every simulated phone is slow for the tool itself)."""
    return args.base_url.startswith("https") and not args.insecure


async def phone(index: int, args, rec: Recorder, deadline: float) -> None:
    await asyncio.sleep(args.ramp * index / max(1, args.phones))  # people open the app one after the other, not in the same instant
    async with httpx.AsyncClient(base_url=args.base_url, timeout=30, verify=tls_check(args)) as client:
        code = f"LT{args.first_employee + index:05d}"
        login = await call(
            client, rec, "login", "POST", "/api/v1/auth/login",
            json={"identifier": code, "password": args.password, "device": {"device_uid": f"load-{uuid.uuid4().hex[:12]}", "name": "Load phone", "platform": "android", "os_version": "14", "app_version": "1.2.0"}},
        )
        if login is None or login.status_code != 200:
            return
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        await call(client, rec, "GET /me", "GET", "/api/v1/me", headers=headers)
        queue = await call(client, rec, "GET /queue", "GET", "/api/v1/queue", params={"limit": 100}, headers=headers)
        contacts = [item["contact"]["id"] for item in (queue.json()["items"] if queue is not None and queue.status_code == 200 else [])]
        if not contacts:
            return
        await asyncio.sleep(random.random() * args.think)  # the phones do not all start in the same instant
        beat_at, calls_made = 0.0, 0
        while time.monotonic() < deadline:
            contact_id = contacts[calls_made % len(contacts)]
            started = datetime.now(timezone.utc)
            created = await call(client, rec, "POST /calls", "POST", "/api/v1/calls", headers=headers, json={"client_call_id": uuid.uuid4().hex, "contact_id": contact_id, "started_at": started.isoformat()})
            if created is not None and created.status_code in (200, 201):
                call_id = created.json()["id"]
                await call(client, rec, "POST /calls/id/events", "POST", f"/api/v1/calls/{call_id}/events", headers=headers, json={"events": [
                    {"event_type": "dialing", "occurred_at": (started + timedelta(seconds=1)).isoformat()},
                    {"event_type": "ringing", "occurred_at": (started + timedelta(seconds=3)).isoformat()},
                    {"event_type": "connected", "occurred_at": (started + timedelta(seconds=9)).isoformat()},
                    {"event_type": "ended", "occurred_at": (started + timedelta(seconds=40)).isoformat()},
                ]})
                await call(client, rec, "PATCH /calls/id", "PATCH", f"/api/v1/calls/{call_id}", headers=headers, json={"duration_seconds": 31, "ended_at": (started + timedelta(seconds=40)).isoformat(), "status": "completed"})
                await call(client, rec, "POST /calls/id/disposition", "POST", f"/api/v1/calls/{call_id}/disposition", headers=headers, json={"disposition_code": random.choice(OUTCOMES), "notes": "load test"})
            calls_made += 1
            if time.monotonic() >= beat_at:
                beat_at = time.monotonic() + args.heartbeat
                await call(client, rec, "POST /me/heartbeat", "POST", "/api/v1/me/heartbeat", headers=headers, json={"app_state": "foreground", "battery_percent": random.randint(10, 100), "network": "cellular", "pending_sync": 0, "permissions_ok": True, "missing_permissions": []})
            if calls_made % 3 == 0:
                await call(client, rec, "GET /dashboard", "GET", "/api/v1/dashboard", headers=headers)
            if calls_made % 4 == 0:
                await call(client, rec, "GET /queue", "GET", "/api/v1/queue", params={"limit": 100}, headers=headers)
            if calls_made % 6 == 0:
                await call(client, rec, "GET /me", "GET", "/api/v1/me", headers=headers)
            await asyncio.sleep(args.think * (0.5 + random.random()))


async def viewer(index: int, args, rec: Recorder, deadline: float) -> None:
    await asyncio.sleep(args.ramp * (index + 1) / max(1, args.viewers + 1))
    async with httpx.AsyncClient(base_url=args.base_url, timeout=60, verify=tls_check(args)) as client:
        login = await call(client, rec, "login", "POST", "/api/v1/auth/login", json={"identifier": args.admin_email, "password": args.admin_password, "device": {"device_uid": f"viewer-{index}", "name": "Panel", "platform": "web"}})
        if login is None or login.status_code != 200:
            return
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        tick = 0
        while time.monotonic() < deadline:
            await call(client, rec, "admin GET live", "GET", "/api/v1/analytics/live", headers=headers)
            if tick % 3 == 0:
                await call(client, rec, "admin GET employees", "GET", "/api/v1/analytics/employees", headers=headers)
            if tick % 5 == 0:
                await call(client, rec, "admin GET overview", "GET", "/api/v1/analytics/overview", headers=headers)
                await call(client, rec, "admin GET calls", "GET", "/api/v1/calls", params={"page_size": 25}, headers=headers)
            tick += 1
            await asyncio.sleep(args.viewer_pause)


def report(rec: Recorder, seconds: float, args) -> int:
    rows = []
    total_requests = total_failures = 0
    worst_p95 = 0.0
    login_p95 = 0.0
    for name in sorted(rec.samples):
        values = rec.samples[name]
        p95 = percentile(values, 95)
        rows.append((name, len(values), statistics.median(values), p95, percentile(values, 99), max(values), rec.failures[name], rec.throttled[name]))
        total_requests += len(values)
        total_failures += rec.failures[name]
        if name == "login":
            login_p95 = p95
        else:
            worst_p95 = max(worst_p95, p95)
    lines = ["| request | count | median ms | p95 ms | p99 ms | max ms | errors | throttled |", "|---|---:|---:|---:|---:|---:|---:|---:|"]
    lines += [f"| {n} | {c} | {m:.0f} | {p95:.0f} | {p99:.0f} | {mx:.0f} | {e} | {t} |" for n, c, m, p95, p99, mx, e, t in rows]
    error_rate = 100.0 * total_failures / max(1, total_requests)
    summary = (
        f"**{total_requests} requests in {seconds:.0f} s = {total_requests / seconds:.0f} per second** from {args.phones} phones and {args.viewers} "
        f"administrator tabs; errors {total_failures} ({error_rate:.2f} %); slowest p95 {worst_p95:.0f} ms (limit {args.max_p95_ms} ms); "
        f"sign-in p95 {login_p95:.0f} ms (limit {args.max_login_p95_ms} ms)"
    )
    print("\n" + summary + "\n" + "\n".join(lines))
    for name, text in rec.first_errors.items():
        print(f"first error of {name}: {text}")
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write("### Load test\n\n" + summary + "\n\n" + "\n".join(lines) + "\n")
    problems = []
    if error_rate > args.max_error_percent:
        problems.append(f"{error_rate:.2f} % of the requests failed (limit {args.max_error_percent} %)")
    if worst_p95 > args.max_p95_ms:
        problems.append(f"the slowest request has p95 {worst_p95:.0f} ms (limit {args.max_p95_ms} ms)")
    if login_p95 > args.max_login_p95_ms:
        problems.append(f"signing in has p95 {login_p95:.0f} ms (limit {args.max_login_p95_ms} ms)")
    if total_requests < args.phones * 3:
        problems.append("hardly any requests were made: the phones could not sign in or had nothing to call")
    for problem in problems:
        print(f"FAILED: {problem}", file=sys.stderr)
    return 1 if problems else 0


async def main_async(args) -> int:
    rec = Recorder()
    started = time.monotonic()
    deadline = started + args.ramp + args.seconds
    phones = [phone(i, args, rec, deadline) for i in range(args.phones)]
    viewers = [viewer(i, args, rec, deadline) for i in range(args.viewers)]
    await asyncio.gather(*phones, *viewers)
    return report(rec, time.monotonic() - started, args)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--phones", type=int, default=50)
    parser.add_argument("--viewers", type=int, default=2)
    parser.add_argument("--seconds", type=int, default=60, help="how long the phones keep calling once they are all signed in")
    parser.add_argument("--ramp", type=float, default=0.0, help="seconds over which the phones open the app, one after the other (0: all at once)")
    parser.add_argument("--think", type=float, default=2.0, help="seconds between two calls of a phone (a real employee: about 60)")
    parser.add_argument("--heartbeat", type=float, default=10.0, help="seconds between two heartbeats (a real phone: 60)")
    parser.add_argument("--viewer-pause", type=float, default=2.0, help="seconds between two refreshes of an administrator's live view (the panel: 8)")
    parser.add_argument("--first-employee", type=int, default=1)
    parser.add_argument("--password", default="LoadTest-9x7Qm")
    parser.add_argument("--admin-email", default="load-admin@example.com")
    parser.add_argument("--admin-password", default="LoadAdmin-4k8Zp")
    parser.add_argument("--max-p95-ms", type=float, default=1500)
    parser.add_argument("--max-login-p95-ms", type=float, default=8000, help="a sign-in is one bcrypt check of CPU; a burst of them is slower")
    parser.add_argument("--max-error-percent", type=float, default=0.5)
    parser.add_argument("--insecure", action="store_true", help="do not verify the TLS certificate (a test server)")
    return asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
