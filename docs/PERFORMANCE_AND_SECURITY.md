# Speed, capacity and security

What was built so that hundreds of phones can call at the same time, how it was measured, and how to keep it that way.

## 1. How a request is served

```
phone / panel ──► Caddy (HTTPS, size limits) ──► API worker (x2) ──► Redis  (who is calling, what was asked a moment ago)
                                                              └──► MySQL  (the truth)
```

**Redis answers, MySQL is asked only when something is not already known** (`backend/app/core/cache.py`, `auth_cache.py`):

| What | Where it comes from | Cleared by |
|---|---|---|
| Who is calling (session + employee, never the password hash) | Redis, 60 s | sign-out, "sign out everywhere", password change/reset, deactivation, every edit of the employee |
| Organisation settings, outcome list, unread count | Redis | the edit of a setting / a notification |
| An employee's calling queue, the employee dashboard | Redis, 20 s / 15 s | the writes the queue is made of (a call, an outcome, a callback, a hand-over, a campaign switched on/off) - **of that employee only** |
| The admin panel's live view and reports | Redis, 8 s, computed once for all viewers | any change of a person, a team or a setting (never by a sign-in) |
| "Last seen" | one write per minute per session, decided in Redis | - |

Rules that keep an answer from being wrong: a cache only holds what was true when it was stored; the change that makes it untrue clears it **after the commit**, never before; values carry an *epoch*, bumping the epoch invalidates a whole kind at once; with no real Redis nothing is cached and MySQL answers (production refuses to start without Redis).

Every phone reports in (`POST /me/heartbeat`: battery, network, permissions, unsent work) - the freshest report lives in Redis and is copied to the device row every few minutes, so tracking costs MySQL almost nothing. The server tells phones how often to report and sync (`heartbeat_seconds`, `sync_interval_seconds` in `/me`): nothing is fixed in the app.

## 2. Protecting the service from itself

* **Turn-taking per worker** (`InFlightLimitMiddleware`, `MAX_INFLIGHT_REQUESTS`, default 24): found by the load test. With more requests in progress than threads, requests that already held a database connection waited for a thread behind requests that waited for a connection - nothing moved for 30 s. Now a burst is served a little later, never stands still. Waiting longer than `INFLIGHT_WAIT_SECONDS` (15) gives a `503` with `Retry-After`; the app retries by itself. `/health`, `/ready` and uploads are not counted. `tests/test_inflight.py` has a control that shows the old standstill.
* **When Redis stops answering** (restart, broken network, out of memory) the service goes on - slower, every question asked of MySQL, the rate limit lets requests through - and connects again by itself. A crash test under load found that every Redis call then waited for its own timeout (admin pages took 13 s); now the first failing call finds out, the next ones are refused at once for 3 seconds, and then ONE caller at a time checks whether it is back (`GuardedRedis`, `tests/test_redis_outage.py`). In production the service never replaces Redis by a private in-memory stand-in (`REDIS_REQUIRED`, always on there): `/ready` says honestly that Redis is missing, and recovers by itself.
* **When no database connection is free** for `DB_POOL_TIMEOUT_SECONDS` (10) the request is answered `503` + `Retry-After` (a deadlock or a lost connection too), never `500`; the app retries.
* Request size limits (JSON 1 MB; recordings and contact sheets by their own limits) at Caddy **and** in the API; upload slots per worker (`MAX_CONCURRENT_UPLOADS`).
* Per-person rate limit (`RATE_LIMIT_USER_PER_MINUTE`, 600), sign-in limits per address and per account.
* `Cache-Control: no-store`, `nosniff`, `no-referrer` on every API answer; Redis has a password; containers drop all capabilities, run with `no-new-privileges`, the API container's filesystem is read-only.
* Nonsense input is a `4xx`, never a `500`: impossible ids, numbers beyond the database range, unstorable text, duplicates, dangling references (found by the fuzz test, which now runs on MySQL).
* Production **refuses** to start with SQLite, with a missing `REDIS_URL`, a weak `JWT_SECRET` or debug on. The demo seed scripts refuse production.
* A temporary password only opens the password screens (enforced by the server); the first administrator must choose a password.

## 3. Measured capacity

The load test runs in CI on **MySQL 8.4 + Redis, with the production layout** (2 uvicorn workers, pool 3+1 connections each), on a 2-vCPU runner that also runs MySQL, Redis and the load generator - the same shape as the production server (2 vCPU / 3.8 GB, shared), so it is a fair, slightly pessimistic test.

| Profile | Result |
|---|---|
| **500 employees, 100,000 contacts handed out**, 500 phones calling for 150 s at a pace busier than a real day (a call every ~40 s each), 5 administrators watching | 13,155 requests, **0 errors**, p95 **300 ms** (every kind of request), sign-in p95 164 ms |
| 150 phones with a call every ~2.5 s (about 5x what 500 real employees do) | 6,165 requests in 50 s = **122 requests/s sustained, 0 errors**, p95 1.4 s |

Rule of thumb: 500 employees make about 50-70 requests/s; one server of this size serves about 120/s. **MySQL connections used: at most 9** (2 workers x (3+1) + one) - the footprint on a shared RDS is small.

Run it yourself: the **CI** workflow (`load-test` job), or locally

```bash
cd backend
python -m scripts.bootstrap && python -m scripts.seed_load --employees 500 --contacts-per-employee 200     # a TEST database only
python -m uvicorn app.main:app --workers 2 &
python -m scripts.loadtest --base-url http://127.0.0.1:8000 --phones 500 --viewers 5 --ramp 45 --seconds 150 --think 40 --heartbeat 30 --viewer-pause 8
```

**Never point the load test at production**: it creates thousands of calls, and the production server and database are shared with other projects. `seed_load.py` and `seed_demo.py` refuse production on purpose.

### Sizing
* More employees than ~1,500, or a busier calling pace: add CPU first (a worker per core; `--workers`), then raise `DB_POOL_SIZE`. Every worker adds `DB_POOL_SIZE + DB_MAX_OVERFLOW` MySQL connections - check `max_connections` of the database server before raising it.
* The admin panel's reports are computed once per few seconds for all viewers; a very large history (millions of calls) will need the report queries looked at again (`EXPLAIN`), not more workers.

## 4. Settings that matter (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | - | MySQL (production never accepts SQLite) |
| `REDIS_URL` / `REDIS_PASSWORD` | - | required in production; the password is generated by the deploy scripts |
| `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, `DB_POOL_TIMEOUT_SECONDS` | 3, 1 (shared server), 10 | connections per worker; how long a request waits for one |
| `REDIS_REQUIRED` | true in production | never fall back to an in-memory stand-in (see 2) |
| `MAX_INFLIGHT_REQUESTS`, `INFLIGHT_WAIT_SECONDS` | 24, 15 | turn-taking per worker (see 2) |
| `AUTH_CACHE_SECONDS`, `CONFIG_CACHE_SECONDS`, `QUEUE_CACHE_SECONDS`, `DASHBOARD_CACHE_SECONDS`, `ANALYTICS_CACHE_SECONDS` | 60, 300, 20, 15, 8 | how long a remembered answer may live at most (0 switches a cache off) |
| `RATE_LIMIT_USER_PER_MINUTE`, `RATE_LIMIT_LOGIN_PER_IP` | 600, 30 | |
| `MAX_JSON_BODY_KB`, `MAX_CONCURRENT_UPLOADS` | 1024, 6 | |
| `HEARTBEAT_SECONDS`, `SYNC_INTERVAL_SECONDS` | 60, 45 | what phones are told to do |

## 5. What CI checks on every pull request

API tests on SQLite **and** MySQL 8.4 - route-by-route authorization matrix (who may call what; forged / expired / foreign tokens) - **API fuzz test on MySQL + Redis** (Schemathesis generates thousands of odd requests from the API's own description; none may cause a server error) - hot-path statement budgets (a call costs at most N queries) - the load test above - `pip-audit`, `bandit`, `npm audit` - **Trivy** on both images (anything serious that has a fix fails the build) - the shared-server stack exactly as deployed (own HTTPS port, MySQL outside, Redis with a password, read-only API container) - the admin panel in a real browser (77 tests) - the app (types, lint, unit tests).

## 6. Known limits
* The app's outcome list, language and look are the app's; what the *server* offers (outcomes, recording rules, intervals) is the server's.
* A session edited directly in the database (not through the API) can be believed for up to `AUTH_CACHE_SECONDS`.
* Android does not let an app record the other side of a normal phone call; see [TELEPHONY.md](TELEPHONY.md).
