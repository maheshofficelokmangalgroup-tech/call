# API reference: every endpoint, who calls it, and what it does to the database

Written on 2026-10-03 from the code at commit `cdefcb3` (GitHub `main` after pull requests #5 and #6). The backend and the phone app are
identical to commit `f6f389e` of the branch `fix/selftest-settings-cache`; the only app code that differs from it is two admin-panel files
(`src/lib/api.ts` and its test: plain-language upload errors). The list of routes was taken from the running application, not typed by
hand: **88 documented operations + 3 that Swagger does not show = 91 HTTP endpoints.** Nothing was called on the live server; everything
here comes from reading the code and from running the project's own code locally.

> **Kasa vachaycha (Hinglish).** Section 3 madhe 91 endpoints chi index table ahe (kon call karto: Phone / Panel). Section 4 madhe
> ek-ek endpoint cha detail: kon call karto, ani MySQL / Redis madhe kay hote. Section 7 = 24 tables, Section 8 = Redis keys,
> Section 10 = production setup, Section 11 = 2 verified caveats (chhote gaps). Prattyek goshta code madhun ghetlelya, guess nahi.

Contents: 1 The system on one page - 2 Rules for every request - 3 Index of all 91 endpoints - 4 Endpoint details - 5 The admin panel's own
server routes - 6 Flows from start to finish - 7 Database - 8 Redis - 9 Everything else that calls the API - 10 Production wiring -
11 Verified caveats - 12 How this was checked.

---

## 1. The system on one page

```
  Phone (Android app)                              Browser (administrator / manager)
     |  https://HOST:8445/api/v1/...                   |  https://HOST:8445/   /api/backend/...   /api/auth/...
     +----------------------------+--------------------+
                                  v
                       Caddy  (HTTPS, size limits)         <- the only open port: 8445
              /api/v1/*  and  /health |            | everything else
                                      v            v
                                    API  <------  Admin panel server (Next.js, port 3000)
                         (FastAPI, 2 workers)       turns  /api/backend/x  into  API /api/v1/x  and adds the Bearer token
                           |             |
                           v             v
                         Redis        MySQL 8.4  (RDS, database Calling_db)   <- the truth
                  (sessions, caches,  
                   rate limits, locks)
        background threads inside the API: import check/apply, rebalancing, housekeeping (one scheduler tick every 30 s)
```

| Part | Where | What it is |
|---|---|---|
| API | [backend/app/](../backend/app) | FastAPI. Every endpoint lives under `/api/v1`, plus `/health` and `/ready`. |
| Employee app | [mobile/](../mobile) | React Native (Android only). Talks to the API directly. Kotlin only plays the recording link (`MediaPlayer`) and reads the app's own local SQLite for caller names; it makes no other network call. |
| Admin panel | [admin-web/](../admin-web) | Next.js. The browser never sees a token: the panel's server keeps them in httpOnly cookies and forwards calls. |
| Front door | [deploy/shared/Caddyfile](../deploy/shared/Caddyfile) | HTTPS, per-route body-size limits. |

Local development: API `http://localhost:8000` (`scripts/dev-backend.ps1`; Swagger at `/docs`), Android emulator `http://10.0.2.2:8000`,
panel `http://localhost:3000`. Production: `https://<PUBLIC_HOST>:8445` (GitHub variable `PUBLIC_URL`). **Swagger (`/docs`) and
`/openapi.json` are switched off in production.**

### Who may call what (the 91 endpoints)

| Kind | Count | Meaning |
|---|---|---|
| Public | 2 | `POST /auth/login`, `POST /auth/refresh` (the refresh token is the credential) |
| Any signed-in user | 31 | data is limited to what the caller may see (section 2.3) |
| Staff = administrator or manager | 9 | a manager only ever sees their own team |
| Administrator only | 46 | |
| Not part of the 88 | 3 | `GET /recordings/{id}/stream` (the signed link is the credential), `GET /health`, `GET /ready` |

Who uses them: the **phone** calls 30 endpoints, the **admin panel** (browser and its server) calls 67, together **82**. **8 endpoints
have no caller in either app** (section 4.0), and `/ready` is used by deploy scripts and CI only.

---

## 2. Rules for every request

### 2.1 Format
* JSON in and out, field names in `snake_case`; times are ISO 8601; a time without a zone is read as UTC; "today" means the business
  day in `APP_TIMEZONE` (`Asia/Kolkata`). Phone numbers are stored as E.164 (`+919876543210`), the single source for duplicate detection.
* Lists: `{"items": [...], "total": n, "page": 1, "page_size": 20}` (`page` 1 to 100,000, `page_size` 1 to 200, default 20). A few
  lists are plain arrays (teams, campaigns, devices, sessions). The queue is `{items, total, due_callbacks, server_time}`.
* Every response carries `X-Request-ID` (the caller's own, cut to 64 characters, or a new one) and, on `/api/*`, `Cache-Control: no-store`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`.
* CORS allows only `ADMIN_WEB_ORIGIN` (+ `EXTRA_CORS_ORIGINS`), never `*`, no credentials. The panel is same-origin; the app is native.
* A path with a number of more than 18 digits is answered `404` without asking the database.

### 2.2 Signing in
* `POST /auth/login` gives an **access token** (JWT, HS256, 15 minutes: `sub`, `sid`, `role`, `typ=access`, `iss`) and a **refresh token**
  (`<session-id>.<random>`, 30 days, only its SHA-256 is stored). Each sign-in is one row in `employee_sessions`.
* `POST /auth/refresh` rotates the refresh token. The previous one still works for 60 seconds (a lost answer must not log anyone out);
  an older one is treated as theft: the session is revoked.
* Who a person is and what role they have is **always read from the database/session**, never from the token (a token that claims
  `"role": "admin"` gets 403 on admin routes; tested).
* A **temporary password** (new employee, or reset by an administrator) opens only `/auth/change-password`, `/auth/logout` and `/me`
  (all other calls: `403 password_change_required`).
* **Device binding** (per employee, optional): the first phone becomes the only phone; another one gets `403 device_not_allowed` until an
  administrator unbinds the old one. A browser (`platform: "web"`) is never a device, and only administrators and managers may sign in
  from it (`403 panel_not_allowed`).
* A deactivated account: `403 account_disabled` (sign-in, refresh and every request).

### 2.3 Roles and what each can see
| Role | Sees |
|---|---|
| `employee` | Only contacts assigned to them (active assignment), their calls, callbacks, notifications, recordings. |
| `manager` | The same for everybody in their team (and themselves). Cannot use administrator endpoints. |
| `admin` | Everything. The only role that downloads recordings, creates people, imports, assigns, changes settings. |

Rule used everywhere (`visible_employee_ids`): administrators: no restriction; managers: employees of their team + themselves; others:
only themselves. An id that is outside the caller's view answers **404, not 403** (the existence of an id is not revealed) - except
`GET /employees/{id}`, which answers 403 for a manager asking about somebody outside the team.

### 2.4 What every signed-in request costs before its own work (the "auth preamble")
1. Decode the JWT (no database).
2. Redis `INCR rl:user:{id}`: at most **600 requests per minute per person** (`429 rate_limited`, `Retry-After`).
3. Who is calling: one Redis read of the remembered session (`c:auth:s:{sid}` + epoch `c:ep:emp:{id}`, at most 60 seconds old, never
   holds the password hash). **Hit: 0 SQL statements.** Miss: read `employee_sessions`, read `employees` (with `roles`, `teams`), check
   revoked / expired / deactivated, then remember it.
4. Temporary-password gate (section 2.2).
5. "Last seen": the first request of each minute per session (decided in Redis, `c:once:presence:{sid}`) writes `employee_sessions.last_used_at`
   and `employee_devices.last_seen_at / last_ip`, then commits. Other requests write nothing.

In the endpoint details below, "AUTH" means this preamble; only the endpoint's own work is described. With no real Redis (development)
the same checks use the database instead; **production refuses to start without Redis**.

### 2.5 Errors
Every error has the same shape (the apps read `code`, never the text):
```json
{"error": {"code": "disposition_already_set", "message": "...", "details": null, "request_id": "..."}}
```
| Status | Meaning and typical `code` |
|---|---|
| 400 | `bad_request` |
| 401 | `unauthorized`, `token_expired`, `invalid_token`, `session_revoked`, `invalid_refresh_token`, `invalid_credentials` (header `WWW-Authenticate: Bearer`) |
| 403 | `forbidden`, `account_disabled`, `password_change_required`, `device_not_allowed`, `panel_not_allowed`, `download_forbidden`, `invalid_signature`, `recording_disabled` |
| 404 | `not_found` |
| 405 | `method_not_allowed` |
| 409 | `conflict` and its specific forms: `email_taken`, `duplicate_phone`, `disposition_already_set`, `already_uploaded`, `recording_not_available`, `assignment_busy`, `assignment_conflict`, `bad_import_state`, `import_busy`, `rebalance_busy`, `team_not_empty`, `campaign_not_active`, `contact_do_not_contact` |
| 413 | `payload_too_large`, `file_too_large` |
| 422 | `validation_error` (with `details: [{field, message}]`) and many specific ones: `weak_password`, `invalid_phone`, `bad_started_at`, `callback_required`, `callback_in_past`, `unknown_disposition`, `unsupported_media_type`, `checksum_mismatch`, `invalid_setting`, `bad_strategy`, `nothing_to_rebalance`, ... |
| 429 | `rate_limited` (with `Retry-After`) |
| 503 | `server_busy` (waited more than 15 s for a turn), `database_busy` (no free connection for 10 s, deadlock, lost connection). `Retry-After` is set; the app retries by itself. |
| 507 | `disk_full` (an import file does not fit) |
| 500 | `internal_error` - nonsense input is always a 4xx, never a 500 (checked by the fuzz test in CI) |

### 2.6 Idempotency (safe to repeat) - why the phone can retry blindly
| Endpoint | Key | Repeat gives |
|---|---|---|
| `POST /calls` | `client_call_id` (UUID made by the phone), unique per employee | the original row, HTTP 200 instead of 201 |
| `POST /calls/{id}/events` | (call, event type, time) | `{"added": 0}` |
| `POST /calls/{id}/disposition` | same outcome again | no change; a different outcome: `409 disposition_already_set` |
| `POST /calls/{id}/recording` | one recording per call | the existing row, HTTP 200 |
| `POST /contacts/{id}/notes` | `client_ref`, unique per author | the existing note |
| `POST /callbacks` | `client_ref`, unique per employee | the existing callback |
| `POST /recordings/{id}/upload` | already stored | `409 already_uploaded` (the app treats it as success) |
| `POST /auth/refresh` | the previous token for 60 s | a new pair |

### 2.7 Limits and protection (all enforced in the API; the front door repeats the size limits)
| What | Limit | Result |
|---|---|---|
| Sign-in attempts | 30 per minute per address; 10 per 5 minutes per account (cleared by a successful sign-in) | `429` |
| Any signed-in person | 600 requests per minute | `429` |
| "Sensitive" actions (`import_upload`, `recording_upload`, `recording_url`, `rebalance`, `employee_bulk`, `credential_view`, `credential_export`, `change_password`) | 30 per minute per person per kind | `429` |
| JSON body | 1 MB (API), 2 MB (Caddy) | `413` |
| Recording upload | 100 MB (+1 MB form overhead); Caddy 120 MB; 6 uploads at a time per worker | `413` / `429 rate_limited` + `Retry-After: 5` |
| Contact sheet | 200 MB, 1,100,000 rows, 100 columns, a `.xlsx` may unpack to at most 2,000 MB; Caddy 210 MB | `413` / `422` |
| Requests worked on at once | 24 per worker (`/health`, `/ready` and uploads not counted) | the others wait up to 15 s, then `503 server_busy` |
| Database connections | production: 2 workers x (3 + 1 extra) = 8 | waiting more than 10 s: `503 database_busy` |
| Redis | connect 0.5 s, call 1 s; after a failure it is not asked again for 3 s, then one caller tests it | answers come from MySQL; rate limits let requests through |

### 2.8 Order of the layers (outermost first)
request id + access log, security headers, impossible-id check, body-size check, turn-taking, CORS, route. Errors from SQLAlchemy are mapped
(duplicate -> 409, number too big / text unstorable -> 422, deadlock / no connection -> 503).

---

## 3. Index of all 91 endpoints

`Phone` = the Android app. `Panel` = the admin panel (its pages in the browser, or its own server). `-` = no caller in the apps.
IDs are used in section 4. "Other" lists scripts / checks (section 9); every endpoint is also covered by the pytest suite.

| ID | Method and path | Who | Phone | Panel | Other |
|---|---|---|---|---|---|
| AUTH-1 | `POST /auth/login` | public | yes | yes | load test, self-test, scale check, deploy probe, CI |
| AUTH-2 | `POST /auth/refresh` | public (refresh token) | yes | yes | |
| AUTH-3 | `POST /auth/logout` | any | yes | yes | |
| AUTH-4 | `POST /auth/change-password` | any | yes | yes | self-test, e2e |
| ME-1 | `GET /me` | any | yes | yes | load test, CI |
| ME-2 | `POST /me/heartbeat` | any (not with a temporary password) | yes | - | load test |
| EMP-1 | `GET /employees` | staff | - | yes | scale check |
| EMP-2 | `POST /employees` | admin | - | yes | self-test, e2e |
| EMP-3 | `POST /employees/bulk` | admin | - | yes | |
| EMP-4 | `GET /employees/credentials.xlsx` | admin | - | yes | self-test, e2e |
| EMP-5 | `GET /employees/{id}` | staff (manager: own team) | - | - | |
| EMP-6 | `PATCH /employees/{id}` | admin | - | yes | |
| EMP-7 | `POST /employees/{id}/deactivate` | admin | - | yes | |
| EMP-8 | `POST /employees/{id}/activate` | admin | - | yes | |
| EMP-9 | `GET /employees/{id}/credentials` | admin | - | yes | self-test |
| EMP-10 | `POST /employees/{id}/reset-password` | admin | - | yes | |
| EMP-11 | `POST /employees/{id}/revoke-sessions` | admin | - | yes | |
| EMP-12 | `GET /employees/{id}/devices` | admin | - | - | |
| EMP-13 | `DELETE /employees/{id}/devices/{device_id}` | admin | - | yes | |
| EMP-14 | `GET /employees/{id}/sessions` | admin | - | yes | |
| TEAM-1 | `GET /teams` | any | - | yes | |
| TEAM-2 | `POST /teams` | admin | - | yes | |
| TEAM-3 | `PATCH /teams/{id}` | admin | - | yes | |
| TEAM-4 | `DELETE /teams/{id}` | admin | - | yes | |
| CON-1 | `GET /contacts` | any (scoped) | yes | yes | scale check |
| CON-2 | `POST /contacts` | admin | - | yes | |
| CON-3 | `POST /contacts/assign` | admin | - | yes | |
| CON-4 | `POST /contacts/unassign` | admin | - | yes | |
| CON-5 | `GET /contacts/{id}` | any (scoped) | yes | yes | |
| CON-6 | `PATCH /contacts/{id}` | admin | - | yes | |
| CON-7 | `DELETE /contacts/{id}` | admin | - | yes | |
| CON-8 | `GET /contacts/{id}/notes` | any (scoped) | yes | yes | |
| CON-9 | `POST /contacts/{id}/notes` | any (scoped) | yes | yes | |
| CON-10 | `GET /contacts/{id}/calls` | any (scoped) | yes | yes | |
| IMP-1 | `POST /contacts/import` | admin | - | yes | self-test, CI |
| IMP-2 | `GET /contacts/import` | admin | - | yes | scale check |
| IMP-3 | `GET /contacts/import/{id}` | admin | - | yes | self-test, CI |
| IMP-4 | `GET /contacts/import/{id}/rows` | admin | - | yes | |
| IMP-5 | `GET /contacts/import/{id}/issues.csv` | admin | - | yes | |
| IMP-6 | `GET /contacts/import/{id}/plan` | admin | - | yes | self-test |
| IMP-7 | `POST /contacts/import/{id}/confirm` | admin | - | yes | self-test |
| IMP-8 | `POST /contacts/import/{id}/retry` | admin | - | yes | |
| IMP-9 | `POST /contacts/import/{id}/cancel` | admin | - | yes | self-test, CI |
| CAM-1 | `GET /campaigns` | any (non-admin: only campaigns they work on) | - | yes | |
| CAM-2 | `POST /campaigns` | admin | - | yes | |
| CAM-3 | `GET /campaigns/{id}` | any (only visible ones) | - | - | |
| CAM-4 | `PATCH /campaigns/{id}` | admin | - | yes | |
| CAM-5 | `POST /campaigns/{id}/contacts` | admin | - | - | |
| CAM-6 | `DELETE /campaigns/{id}/contacts/{contact_id}` | admin | - | - | |
| CAM-7 | `GET /campaigns/{id}/assignees` | admin | - | yes | |
| CAM-8 | `POST /campaigns/{id}/assignees` | admin | - | yes | |
| CAM-9 | `POST /campaigns/{id}/distribute` | admin | - | yes | |
| CAM-10 | `GET /campaigns/{id}/progress` | staff | - | yes | |
| Q-1 | `GET /queue` | any | yes | - | load test, scale check, self-test |
| CALL-1 | `POST /calls` | any | yes | - | load test, e2e |
| CALL-2 | `GET /calls` | any (scoped) | yes | yes | load test |
| CALL-3 | `GET /calls/export.csv` | staff | - | yes | |
| CALL-4 | `GET /calls/{id}` | any (scoped) | yes | yes | |
| CALL-5 | `PATCH /calls/{id}` | owner or admin | yes | - | load test, e2e |
| CALL-6 | `POST /calls/{id}/events` | owner or admin | yes | - | load test, e2e |
| CALL-7 | `POST /calls/{id}/disposition` | owner or admin | yes | - | load test, e2e |
| CALL-8 | `POST /calls/{id}/recording` | owner or admin | yes | - | e2e |
| CB-1 | `GET /callbacks` | any (scoped) | yes | - | |
| CB-2 | `POST /callbacks` | any | yes | - | |
| CB-3 | `PATCH /callbacks/{id}` | owner or admin | yes | - | |
| REC-1 | `GET /recordings/{id}` | any (scoped) | - | - | |
| REC-2 | `POST /recordings/{id}/upload` | owner or admin | yes | - | e2e |
| REC-3 | `GET /recordings/{id}/playback-url` | any (scoped); `download` admin only | yes | yes | |
| REC-4 | `GET /recordings/{id}/stream` (hidden) | the signed link | yes | yes | |
| REC-5 | `GET /recordings/{id}/access-log` | admin | - | - | |
| REC-6 | `DELETE /recordings/{id}` | admin | - | yes | |
| DASH-1 | `GET /dashboard` | any (scoped) | yes | - | load test, scale check |
| NOT-1 | `GET /notifications` | any (own) | yes | - | |
| NOT-2 | `GET /notifications/unread-count` | any (own) | - | - | |
| NOT-3 | `POST /notifications/read-all` | any (own) | yes | - | |
| NOT-4 | `POST /notifications/{id}/read` | any (own) | yes | - | |
| AUD-1 | `GET /audit-logs` | admin | - | yes | |
| ANA-1 | `GET /analytics/overview` | staff | - | yes | load test, scale check |
| ANA-2 | `GET /analytics/employees` | staff | - | yes | load test |
| ANA-3 | `GET /analytics/employees.csv` | staff | - | yes | |
| ANA-4 | `GET /analytics/employees/{id}` | staff | - | yes | |
| ANA-5 | `GET /analytics/live` | staff | - | yes | load test, scale check |
| SET-1 | `GET /settings` | admin | - | yes | |
| SET-2 | `PUT /settings/{key}` | admin | - | yes | self-test |
| DIS-1 | `GET /distribution/overview` | admin | - | yes | scale check |
| DIS-2 | `POST /distribution/rebalance/preview` | admin | - | yes | self-test, scale check |
| DIS-3 | `POST /distribution/rebalance` | admin | - | yes | self-test |
| DIS-4 | `GET /distribution/runs` | admin | - | yes | |
| DIS-5 | `GET /distribution/runs/{id}` | admin | - | yes | self-test |
| OPS-1 | `GET /health` (hidden) | public | yes | yes | Docker, deploy, CI |
| OPS-2 | `GET /ready` (hidden) | public | - | - | deploy, CI |

All paths are under `/api/v1` except `/health` and `/ready`.

---

## 4. Endpoint details

How to read a block: **Called by** names the screen or code that makes the call. **MySQL** lists what is read (R) and written (W);
"commit" is one transaction commit. **Redis** lists keys (section 8). Every signed-in endpoint starts with the AUTH preamble (2.4).

### 4.0 Endpoints that no app calls today (still live and protected)
`GET /employees/{id}` (EMP-5), `GET /employees/{id}/devices` (EMP-12; the employee page reads devices from `ANA-4`),
`GET /campaigns/{id}` (CAM-3), `POST /campaigns/{id}/contacts` (CAM-5), `DELETE /campaigns/{id}/contacts/{contact_id}` (CAM-6),
`GET /recordings/{id}` (REC-1; the phone has a helper for it that nothing calls), `GET /recordings/{id}/access-log` (REC-5),
`GET /notifications/unread-count` (NOT-2; the phone gets the number inside `/me`). They are for API users, tests and future screens;
the authorization test covers them like any other route.

### 4.1 Auth - `/api/v1/auth`

**AUTH-1 `POST /auth/login`** - public. Body: `identifier` (email or employee ID), `password`, optional `device {device_uid, name, platform, os_version, app_version}`. Answer: `TokenPair` (`access_token`, `refresh_token`, `expires_in`, `must_change_password`, `employee`).
* *Called by:* Phone - Login screen via `authStore.signIn`. Panel - its own server route `/api/auth/login` (sends `platform: "web"`).
* *Redis:* `INCR rl:login:ip:{ip}` (30/min), `INCR rl:login:id:{identifier}` (10/5 min, reset on success); on success it remembers the new session (`c:auth:s:{sid}`) so the first request needs no query.
* *MySQL:* R `employees` (+`roles`,`teams`) by email or employee code; **commit first** (a bcrypt check takes about 100 ms and must not hold a connection). Wrong password / unknown user: W `audit_logs` (`auth.login_failed`), `401 invalid_credentials` (an unknown user costs the same time). Deactivated / panel-not-allowed / device-not-allowed: W `audit_logs` (`auth.login_blocked`). Success: `SELECT ... FOR UPDATE` on the employee row (two sign-ins of one person at the same moment would deadlock otherwise), R/W `employee_devices` (+ binding check), W `employee_sessions`, W `employees.last_login_at`, W `audit_logs` (`auth.login`), one commit.

**AUTH-2 `POST /auth/refresh`** - public. Body `refresh_token`. Answer: a new `TokenPair`.
* *Called by:* Phone - `client.ts` automatically when the access token has less than 30 s left or an answer says `token_expired` (one refresh at a time). Panel - server code `refreshTokens` (when the access cookie is gone, or after a 401; one refresh at a time per token).
* *MySQL:* R `employee_sessions`, R `employees`; W `employee_sessions` (new hash, old hash kept 60 s, expiry +30 days), commit. A replayed old token: session revoked + W `audit_logs` (`auth.refresh_reuse_detected`) -> `401 invalid_refresh_token`. Deactivated: session revoked, `403 account_disabled`. *Redis:* none.

**AUTH-3 `POST /auth/logout`** - any signed-in (also with a temporary password). `204`.
* *Called by:* Phone `signOut`. Panel `/api/auth/logout` (and the login route, to undo a sign-in of a non-staff account).
* *MySQL:* R/W `employee_sessions` (`revoked_at`, reason `logout`), W `audit_logs`, commit. *Redis:* deletes `c:auth:s:{sid}` after the commit.

**AUTH-4 `POST /auth/change-password`** - any signed-in (also with a temporary password). Body `current_password`, `new_password` (at least 8 characters, a letter and a digit, must not contain the name, the e-mail's first part or the employee ID; must differ from the old one).
* *Called by:* Phone - Change password screen (forced after a temporary password). Panel - the change-password dialog through the proxy (the only `auth/*` route the proxy lets through).
* *Redis:* `rl:sensitive:change_password:u{id}`. After the commit the epoch `emp:{id}` is bumped, so every remembered session of this person is checked again.
* *MySQL:* R `employees` (loads the password hash that the remembered session does not carry), W `employees` (`password_hash`, `must_change_password=false`, `password_changed_at`), DELETE `employee_credentials` (their own password is nobody else's to see), W `employee_sessions` (every other session revoked), W `audit_logs`, one commit.

### 4.2 Me - `/api/v1`

**ME-1 `GET /me`** - any signed-in (also with a temporary password). Answer: `employee` + `config {server_time, timezone, daily_target, default_phone_region, recording {enabled, notice_text, max_size_mb, allowed_types}, dispositions[], unread_notifications, heartbeat_seconds, sync_interval_seconds}`. The server, not the app, decides the outcome list, recording rules and the pace.
* *Called by:* Phone - at start (cached profile first, then fresh), right after sign-in (asked up to twice), after notifications are read. Panel - `GET /api/auth/me` (the panel server) for `useMe()` on every page (role, recording switch).
* *Redis:* `c:config:client` (300 s, epoch `settings`), `c:settings:all`, `c:unread:{id}` (30 s).
* *MySQL:* normally **0 statements**. Only on a cache miss: R `settings`, R `call_dispositions` (active), R `notifications` (unread count).

**ME-2 `POST /me/heartbeat`** - any signed-in, **not** while a temporary password is active. Body: `app_state`, `battery_percent`, `charging`, `network`, `app_version`, `os_version`, `pending_sync`, `permissions_ok`, `missing_permissions[]`, `on_call`, `client_time`. Answer `{server_time, next_in_seconds}`. No location, nothing about other apps.
* *Called by:* Phone - `heartbeat.ts`: at start, every `heartbeat_seconds` (60) and whenever the app goes to or comes back from the background. Load test.
* *Redis:* read + write `c:hb:{employee}` (15-minute TTL; the admin panel reads it for "online / battery / permissions"); gate `c:once:heartbeat-write:{device}` (5 min).
* *MySQL:* usually nothing. W `employee_devices` (one UPDATE: battery, charging, network, state, permissions, pending, clock skew, `last_heartbeat_at`) when `permissions_ok`, `app_version` or `os_version` changed, or once every 5 minutes; commit. A browser session (no device) writes nothing.

### 4.3 Employees - `/api/v1/employees`

**EMP-1 `GET /employees`** - staff. Query: `q` (name, email or code), `team_id`, `role`, `is_active`, `page`, `page_size`. Administrator: everybody; manager: own team.
* *Called by:* Panel - person pickers: Contacts filter, Assign dialog, Campaigns, Calls filter, Audit filter, Import wizard, Ctrl+K search, forms. (The Employees page itself uses ANA-2.) Scale check.
* *MySQL:* manager: R `employees` ids of the team; R `employees` (+`roles` when filtered by role) `COUNT(*)` and a page `ORDER BY full_name, id`. *Redis:* none.

**EMP-2 `POST /employees`** - admin. Body: `employee_code?`, `email`, `full_name`, `phone?`, `role` (default `employee`), `team_id?`, `daily_target` (0 to 2000), `password?` (otherwise a 12-character one is generated), `must_change_password` (default true), `device_binding_enabled`. `201 {employee, temporary_password}`.
* *Called by:* Panel - New employee dialog. Self-test, e2e.
* *MySQL:* R `roles`, R `teams`, R `employees` (email and code unique; `MAX(id)` for the next `EMPnnnn`), W `employees`, W `employee_credentials` (the first password, **encrypted** with Fernet; the key is derived from `JWT_SECRET`), W `audit_logs` (`employee.create`), one commit. If two administrators get the same next code the insert is retried up to 5 times. After the commit the roster epoch `admin:roster` changes, so the panel's reports refresh.

**EMP-3 `POST /employees/bulk`** - admin. Body `{employees: [...]}` (1 to 100). Every row succeeds or fails alone (`results[]` with `ok`, `code`, `error`). Sensitive limit `employee_bulk`.
* *Called by:* Panel - Employees page, "Import sheet" (a CSV file, read in the browser).
* *MySQL:* as EMP-2 per row, one commit per row; a failed row is rolled back.

**EMP-4 `GET /employees/credentials.xlsx`** - admin. Query `ids` (comma list, at most 2,000; empty = everybody whose first password can still be seen). Excel file, every cell written as text (a password starting with `=` is not a formula), `Cache-Control: no-store`. Sensitive limit `credential_export`.
* *Called by:* Panel - "Login sheet" button on the Employees page (the people in the list, at most 300). Self-test, e2e.
* *MySQL:* R `employee_credentials`, R `employees`, W `employee_credentials` (`view_count`, `last_viewed_at` per person), W `audit_logs` (`employee.credentials_exported`), commit.

**EMP-5 `GET /employees/{id}`** - staff; a manager asking about somebody outside the team gets 403. *Called by:* nobody today. *MySQL:* R `employees`.

**EMP-6 `PATCH /employees/{id}`** - admin. Any of `email`, `full_name`, `phone`, `role` (not your own), `team_id` / `clear_team`, `daily_target`, `device_binding_enabled`.
* *Called by:* Panel - employee menu, "Edit details".
* *MySQL:* R `employees` (new email must be unique), R `roles`, R `teams`; W `employees`, W `audit_logs` (`employee.update`, only if something changed), commit. *Redis:* epoch `emp:{id}` (the change is seen by the next request, not a minute later) and `admin:roster`.

**EMP-7 `POST /employees/{id}/deactivate`** and **EMP-8 `.../activate`** - admin. You cannot deactivate yourself.
* *Called by:* Panel - employee menu, "Deactivate" / "Activate again".
* *MySQL:* W `employees.is_active`; deactivate also W `employee_sessions` (all revoked, reason `deactivated`) and DELETE `employee_credentials`; W `audit_logs`; commit. *Redis:* epoch `emp:{id}`.

**EMP-9 `GET /employees/{id}/credentials`** - admin. The first password handed out, while the employee has not chosen their own (and for at most `CREDENTIAL_KEEP_DAYS`, 30). Sensitive limit `credential_view`.
* *Called by:* Panel - employee menu, "Show password" (asked once when the dialog opens, never refetched). Self-test.
* *MySQL:* R `employee_credentials` (decrypted in the API), R `employees`, W `employee_credentials` (`view_count`, `last_viewed_at`), W `audit_logs` (`employee.credentials_viewed`, also when nothing was available), commit.

**EMP-10 `POST /employees/{id}/reset-password`** - admin. Body `new_password?` (otherwise generated). `{temporary_password}`.
* *Called by:* Panel - employee menu, "Reset password".
* *MySQL:* W `employees` (hash, `must_change_password=true`), W `employee_credentials` (replaced), W `employee_sessions` (all revoked), W `audit_logs`, one commit. *Redis:* epoch `emp:{id}`.

**EMP-11 `POST /employees/{id}/revoke-sessions`** - admin ("sign out everywhere"). `{message}`.
* *Called by:* Panel - employee menu ("Sign out of all phones") and the devices panel ("Sign out everywhere"). *MySQL:* W `employee_sessions`, W `audit_logs`, commit. *Redis:* epoch `emp:{id}` (the old access token stops working at once: tested).

**EMP-12 `GET /employees/{id}/devices`** - admin. *Called by:* nobody (the employee page reads devices inside ANA-4). *MySQL:* R `employee_devices` newest first.

**EMP-13 `DELETE /employees/{id}/devices/{device_id}`** - admin ("unbind", so a new phone can register). `204`.
* *Called by:* Panel - devices panel, "Release" ("Release phone").
* *MySQL:* R `employee_devices`, W `employee_sessions` (sessions of that device revoked), DELETE `employee_devices`, W `audit_logs` (`employee.device_unbind`), commit. **See caveat 11.1: the old access token can still work for up to 60 seconds.**

**EMP-14 `GET /employees/{id}/sessions`** - admin. The last 20 sign-ins (browser, address, last used, revoked).
* *Called by:* Panel - devices panel. *MySQL:* R `employee_sessions` newest first, limit 20.

### 4.4 Teams - `/api/v1/teams`

**TEAM-1 `GET /teams`** - any signed-in. Plain array with `member_count`. *Called by:* Panel - team filters and employee/bulk forms. *MySQL:* R `employees` (`COUNT ... GROUP BY team_id`), R `teams` by name.

**TEAM-2 `POST /teams`**, **TEAM-3 `PATCH /teams/{id}`**, **TEAM-4 `DELETE /teams/{id}`** - admin. *Called by:* Panel - Teams page. *MySQL:* R `teams` (name unique, case-insensitive: `409 team_exists`), W `teams`, W `audit_logs` (`team.create / update / delete`), commit. Update also reads the team's members and changes each member's epoch `emp:{id}` (the team name is part of a remembered session). Delete refuses a team that still has members (`409 team_not_empty`). *Redis:* `admin:roster`.

### 4.5 Contacts - `/api/v1/contacts`

Visibility: employees see contacts with an **active assignment** to them; managers those of their team; administrators all (deleted contacts never). Search words are matched in `contacts.search_text` (lower-case name, number, e-mail, location, category, tags, custom fields; at most 5 words).

**CON-1 `GET /contacts`** - any (scoped). Query: `q`, `status`, `category`, `priority` 1-3, `tag`, `campaign_id`, `employee_id`, `unassigned` (administrators only), `sort` = `name` / `recent` / `priority` / `last_called`, `page`, `page_size`.
* *Called by:* Phone - Queue screen, "All" tab search (debounced 350 ms, 30 per page; falls back to the local SQLite copy when offline). Panel - Contacts page. Scale check.
* *MySQL:* manager: R `employees` ids of the team. One query on `contacts` with `EXISTS` on `contact_assignments` (+`campaign_contacts` for a campaign filter). A number written in full (10+ digits, first page) is looked up through the unique index on `normalized_phone`. `COUNT(*)`, then the page. *Redis:* a count of 20,000 or more is remembered for 60 s (`c:contacts:total:{hash}`, cleared by the epoch `queue:all`).

**CON-2 `POST /contacts`** - admin. Body: `name`, `phone`, `email`, `location`, `category`, `priority`, `tags`, `custom_fields`, `campaign_id?`, `assign_to_employee_id?`. A number that already exists: `409 duplicate_phone`; a deleted contact with that number is restored.
* *Called by:* Panel - New contact dialog.
* *MySQL:* R `contacts` (by `normalized_phone`), R `campaigns`; W `contacts`, W `campaign_contacts`, W `audit_logs` (`contact.create`), commit; then (if asked) the same work as CON-3 for one contact.

**CON-3 `POST /contacts/assign`** - admin. Body: `contact_ids` (at most 50,000) **or** a filter (`q`, `status`, `category`, `unassigned_only`, `campaign_id`; at most `ASSIGN_MAX_CONTACTS` = 100,000), `employee_ids` or `team_id`, `strategy` (`single`, `round_robin`, `balanced`), `reassign`, `assignment_campaign_id`. Answer: totals and `per_employee`.
* *Called by:* Panel - Assign dialog (Contacts page).
* *Redis:* lock `lock:assign-contacts` (120 s, waits up to 10 s; busy: `409 assignment_busy`); queue epochs change.
* *MySQL:* R `employees` (active targets), R `contacts` (status; skips deleted, `do_not_contact`, `invalid`), R `contact_assignments` (current owners), `COUNT ... GROUP BY employee` (loads); W `contact_assignments` (old ones set to `released`, new inserted in blocks of 1,000), W `callbacks` (pending callbacks of the previous owner cancelled), W `campaign_contacts`, W `notifications` (one "N new contacts assigned" per employee), W `audit_logs` (`contact.assign`), one commit. Two admins racing: the unique `active_contact_id` fails the second -> `409 assignment_conflict`, nothing half-done.

**CON-4 `POST /contacts/unassign`** - admin. Body `contact_ids`. *Called by:* Panel - Contacts page. *MySQL:* R + W `contact_assignments` (released), W `callbacks` (cancelled), W `audit_logs` (`contact.unassign`), commit.

**CON-5 `GET /contacts/{id}`** - any (scoped, else 404). *Called by:* Phone - Contact detail screen and the in-call details sheet. Panel - contact drawer. *MySQL:* R `contacts` (scoped), R `contact_assignments` + R `employees` (owner), R `campaigns` JOIN `campaign_contacts`.

**CON-6 `PATCH /contacts/{id}`** - admin. Any contact field, including `status`; a new phone number must be unique (`409 duplicate_phone`). Setting `new` or `in_progress` clears the retry counters. *Called by:* Panel - Edit contact dialog. *MySQL:* R `contacts`; W `contacts` (`search_text` rebuilt), W `audit_logs` (`contact.update`), commit.

**CON-7 `DELETE /contacts/{id}`** - admin. **Soft delete.** *Called by:* Panel - contact drawer. *MySQL:* W `contact_assignments` (released), W `callbacks` (pending ones cancelled), W `contacts.deleted_at`, W `audit_logs` (`contact.delete`), commit. The row and its calls stay; the number can be re-created later.

**CON-8 `GET /contacts/{id}/notes`** (newest first) - any (scoped). *Called by:* Phone - Contact detail; Panel - contact drawer. *MySQL:* R `contacts` (scope), `COUNT` + R `call_notes` JOIN `employees` (author name).

**CON-9 `POST /contacts/{id}/notes`** - any (scoped). Body `body` (1 to 2,000 characters), `call_id?`, `client_ref?` (idempotency). `201`. *Called by:* Phone - sync operation `note_create`; Panel - contact drawer. *MySQL:* R `contacts` (scope), R `call_notes` (by `author_id` + `client_ref`), R `calls` (if `call_id`; must be yours unless administrator), W `call_notes`, commit.

**CON-10 `GET /contacts/{id}/calls`** - any (scoped). The whole call history of the contact, including calls made by earlier owners. *Called by:* Phone - Contact detail; Panel - contact drawer. *MySQL:* R `contacts` (scope), `COUNT` + R `calls` (+`call_dispositions`), then three queries for the whole page (names from `employees`, `recordings`, pending `callbacks`) - never one per row.

### 4.6 Importing a sheet - `/api/v1/contacts/import` (all administrators)
Registered before `/contacts/{id}` so `import` is not read as an id. The flow is in section 6.4.

**IMP-1 `POST /contacts/import`** - `multipart/form-data`: `file` (`.csv` or `.xlsx`, header row; needs a name column and a mobile/phone column), `mode` (`skip` / `update`), `campaign_id?`, `assign_employee_ids` (comma list), `assign_strategy` (`equal` / `balance_total`), `default_priority`. `202` with the import row. Sensitive limit `import_upload`.
* *Called by:* Panel - Contacts page, "Import sheet" -> "Check the sheet" (the Import wizard; a progress bar uses `XMLHttpRequest`; the panel's proxy streams the file and never holds it in memory). Self-test, CI (a 12 MB sheet through the real front door).
* *Disk:* the file is streamed to `IMPORT_STORAGE_PATH/<uuid>/source.<ext>`; free disk must be at least 5x the file + 256 MB (`507 disk_full`).
* *MySQL:* R `campaigns`; W `imports` (status `validating`), W `audit_logs` (`import.upload`), commit. Then a background thread `import-check` runs: it claims a **lease** in `imports` (`lease_owner`, `heartbeat_at`, 90 s) and reads the sheet row by row (never all in memory): W `import_rows` (a sample: at most 5,000 problem rows and 200 good rows), R `contacts` (1,000 numbers per `IN (...)` query against the unique index), progress written to `imports` every 2,000 rows or 3 s; files `valid.jsonl`, `existing.jsonl`, `issues.csv` on disk; at the end `imports.status = previewed`.

**IMP-2 `GET /contacts/import`** (list) - *Called by:* Panel - Contacts page, polled every 8 s while the page is open; scale check. *MySQL:* `COUNT` + R `imports` newest first.
**IMP-3 `GET /contacts/import/{id}`** - *Called by:* Panel - Import wizard, every 1.5 s while the import is `validating` or `applying`; self-test; CI. *MySQL:* R `imports`.
**IMP-4 `GET /contacts/import/{id}/rows?status=valid|invalid|duplicate`** - the stored sample. *Called by:* Panel - preview tab. *MySQL:* `COUNT` + R `import_rows` by `row_number`.
**IMP-5 `GET /contacts/import/{id}/issues.csv`** - every bad or repeated row with the reason and the original cells. *Called by:* Panel - "Download the problem list" / "Download the lines that were not added". *Disk:* the file `issues.csv` (kept after completion); older imports: built from `import_rows`. Cells that start with `= + - @` are neutralised.
**IMP-6 `GET /contacts/import/{id}/plan?employee_ids=&strategy=&order=&leave_unassigned=`** - who is working and how many of the sheet each would get; **writes nothing**. *Called by:* Panel - preview step, asked again at every change of choice. Self-test.
* *MySQL:* R `employees` (+roles), R `employee_sessions` (`MAX(last_used_at)` per person), R `employee_devices` (`MAX(last_seen_at, last_heartbeat_at)`), R `contact_assignments` (`COUNT ... GROUP BY employee`); for `balance_total` also `contacts` JOIN `contact_assignments` (pending work per person). *Redis:* `c:hb:*` (live phone reports count as activity), `c:settings:all`.
* *Who is working:* an account that is on and was seen (sign-in, any request, phone report) within `inactive_after_days` (default 2) or is new and waiting for its first sign-in. Others get nothing.

**IMP-7 `POST /contacts/import/{id}/confirm`** - body `{mode?, distribution {strategy, order, employee_ids?, leave_unassigned}}`. `202`. Only a `previewed` import; only one import may be `applying` at a time (`409 import_busy`).
* *Called by:* Panel - Import wizard, the "Add N contacts" button. Self-test.
* *MySQL:* W `imports` (status `applying`; the plan is **frozen** in `options.distribution`), W `audit_logs` (`import.confirm`), commit. Background thread `import-apply` (one writer job at a time per process): per **2,000 rows = one transaction**: W `contacts` (insert; a number that is already there is skipped by the unique index: `INSERT ... ON DUPLICATE KEY UPDATE col = col` on MySQL), R `contacts`, R `contact_assignments`, W `contact_assignments` (`INSERT` ignoring the unique `active_contact_id`), W `campaign_contacts`, W `imports` (resume point `applied_rows` as an absolute number, counters, lease renewal). Deadlocks are retried (4 tries). At the end: W `imports.status = completed`, W `notifications` (one per receiving employee), W `audit_logs` (`import.completed`), epoch `queue:all` and the receivers' queue epochs; the files except `issues.csv` are deleted. `mode = update` also updates the contacts that were already there.

**IMP-8 `POST /contacts/import/{id}/retry`** - continue an import that stopped half way (`failed` after confirm); what was added stays. `202`. *Called by:* Panel - "Continue where it stopped". *MySQL:* W `imports` (status `applying`), W `audit_logs`.
**IMP-9 `POST /contacts/import/{id}/cancel`** - before/while checking or after a failure: status `cancelled`, files removed. While adding: stops after the current step (`cancel_requested`), what was added stays. *Called by:* Panel - "Cancel" / "Cancel import" in the wizard; self-test; CI. *MySQL:* W `imports`, W `audit_logs`.

### 4.7 Campaigns - `/api/v1/campaigns`

**CAM-1 `GET /campaigns`** - any signed-in; non-administrators see only campaigns where they have assigned contacts or are an assignee. Query `status`, `q`. Plain array with `contact_count`, `completed_count`, `calls_made`, `completion_percent`.
* *Called by:* Panel - Campaigns page and the pickers in Contacts / forms / Import wizard.
* *MySQL:* R `campaigns` (+`EXISTS` on `contact_assignments`, `campaign_assignees`), then three grouped queries: `campaign_contacts` (total), `campaign_contacts` (completed), `calls`.

**CAM-2 `POST /campaigns`** (`201`), **CAM-4 `PATCH /campaigns/{id}`** - admin. Name is unique (`409 campaign_exists`); `end_date` not before `start_date`; status `draft / active / paused / completed / archived`. *Called by:* Panel - Campaigns page. *MySQL:* R `campaigns`, W `campaigns`, W `audit_logs` (`campaign.create / update`), commit. Changing the status changes who sees the contacts in their queue (queue epoch `queue:all`).
**CAM-3 `GET /campaigns/{id}`** - *Called by:* nobody. A campaign the caller does not work on: 404.
**CAM-5 `POST /campaigns/{id}/contacts`** (`{added}`) and **CAM-6 `DELETE /campaigns/{id}/contacts/{contact_id}`** - admin. *Called by:* nobody (contacts join a campaign through assign / import / create). *MySQL:* R `contacts`, W `campaign_contacts`, W `audit_logs`.
**CAM-7 `GET /campaigns/{id}/assignees`**, **CAM-8 `POST /campaigns/{id}/assignees`** (adds; `{employee_ids}`) - admin. *Called by:* Panel - campaign details. *MySQL:* R/W `campaign_assignees`, R `employees` (active only), W `audit_logs` (`campaign.set_assignees`).
**CAM-9 `POST /campaigns/{id}/distribute`** - admin; body `strategy` (`round_robin` / `balanced`), `employee_ids?` (default: the assignees). The campaign must be `active` (`409 campaign_not_active`). *Called by:* Panel - campaign details. Runs the work of CON-3 on the campaign's unassigned contacts.
**CAM-10 `GET /campaigns/{id}/progress`** - staff. Contacts by status, calls per employee. *Called by:* Panel - campaign details. *MySQL:* `campaign_contacts` grouped, `calls` JOIN `employees` grouped. **Not limited to the manager's team: see caveat 11.2.**

### 4.8 Queue - `GET /queue`

**Q-1** - any signed-in; the caller's own work for today. Query `limit` (1 to 500, default 100), `offset`. Order: callbacks that are due (oldest first), then contacts left over from earlier days, then by contact priority, campaign priority, never-called first, then callbacks later today. Left out: finished statuses (`interested`, `not_interested`, `completed`, `invalid`, `unreachable`, `do_not_contact`), contacts cooling down after a failed attempt, contacts of inactive / not-yet-started / ended campaigns.
* *Called by:* Phone - Home, Queue, the tab bar badge and the Outcome screen (`api.queue(200)`, cache-first, refreshed after every successful sync). Load test, scale check, self-test.
* *Redis:* `c:queue:{employee}:{limit}:{offset}`, 20 s, valid only while the epochs `queue:all` and `queue:emp:{id}` are unchanged (their own call / outcome / callback / hand-over clears it at once).
* *MySQL (miss):* one query joining `contacts`, `contact_assignments`, `campaigns` and a grouped subquery on `callbacks`: `COUNT`, a counts query for the badge, the page, and the callbacks of the page. Held to **at most 8 statements** by a test (25 rows; the number does not grow with the rows).

### 4.9 Calls - `/api/v1/calls`

**CALL-1 `POST /calls`** - any signed-in. Body: `client_call_id` (8 to 64 characters), `contact_id` or `phone_number`, `campaign_id?`, `started_at` (not more than 10 minutes in the future, not older than 14 days), `external_call_reference?`. `201`, or `200` with the original row on a repeat. A `do_not_contact` contact: `409`. A number that matches one of the caller's own contacts is linked to it.
* *Called by:* Phone - sync operation `create_call`, queued the moment the employee taps Call (it works offline). If the contact was reassigned meanwhile (404) the app sends the number instead. Load test, e2e.
* *MySQL:* R `calls` (idempotency), R `contacts` (scope) or by phone, R `contact_assignments` (campaign), `COUNT(calls)` for `attempt_number`, W `calls`, W `call_events` (`initiated`), W `contacts` (`call_count`, `last_called_at`), one commit. **At most 8 statements** (test). *Redis:* this person's queue epoch `queue:emp:{id}` changes after the commit.

**CALL-2 `GET /calls`** - any (scoped). Query: `employee_id`, `contact_id`, `campaign_id`, `status`, `disposition`, `needs_disposition`, `has_recording`, `min_duration`, `day`, `from_day`, `to_day`, `date_from`, `date_to`, `q`, `sort` = `newest` / `oldest` / `longest`, paging.
* *Called by:* Phone - History screen (`page_size=100`, merged with the local SQLite copy). Panel - Calls page (25 per page), Recordings page, employee page. Load test.
* *MySQL:* `COUNT` + page of `calls` (with its outcome), then `employees` (names), `recordings`, pending `callbacks` for the whole page: **at most 8 statements** (tested with 12 rows; the number does not grow with the rows).

**CALL-3 `GET /calls/export.csv`** - staff. The same filters; at most 20,000 rows, 500 per read, streamed, UTF-8 with BOM, local times, cells neutralised against spreadsheet formulas. *Called by:* Panel - "Export CSV" button on the Calls page. *MySQL:* W `audit_logs` (`report.export`) first, then repeated reads of `calls`.

**CALL-4 `GET /calls/{id}`** - any (scoped, else 404). Adds notes and the event timeline. *Called by:* Phone - Call details screen; Panel - call drawer. *MySQL:* R `calls`, R `call_notes`, R `call_events`, R `employees`, R `recordings`, R `callbacks`.

**CALL-5 `PATCH /calls/{id}`** - owner or administrator. Body (all optional): `status`, `answered_at`, `ended_at`, `duration_seconds`, `external_call_reference`. The server keeps the better status (status only moves forward until an outcome fixes it) and works out missing times.
* *Called by:* Phone - sync operation `call_update` (the device's measured times). Load test, e2e. *MySQL:* R `calls`, W `calls`, commit. At most 5 statements (test).

**CALL-6 `POST /calls/{id}/events`** - owner or administrator. Body `{events: [1 to 50 of {event_type, occurred_at, payload}]}`; types `dialing`, `ringing`, `connected`, `ended`, `failed`, `app_resumed`, `reconciled`, `note`. `{added}`.
* *Called by:* Phone - sync operation `call_events` (the `ended` event carries the source, the disconnect reason and why a call has no recording). Load test, e2e.
* *MySQL:* one `SELECT` of the call's known events, W `call_events` (unique per call, type, time), W `calls` (status, answered / ended time), commit. At most 8 statements for 4 events (test).

**CALL-7 `POST /calls/{id}/disposition`** - owner or administrator. Body `disposition_code` (one of 11, see below), `notes?`, `callback_at?` (required for `CALLBACK` and `FOLLOW_UP`, 5 minutes in the past to 365 days ahead), `callback_note?`, `note_client_ref?`.
* *Called by:* Phone - sync operation `disposition`, after the employee fills the Outcome screen (an outcome is required after every CRM call). Load test, e2e.
* *MySQL (one commit, at most 14 statements - test):* R `call_dispositions`, R `contacts`, W `calls` (status, end time, `disposition_id`), W `call_events` (`disposition`), W `call_notes`, W `contacts` (status and counters from the outcome rules below, `next_eligible_at`), W `callbacks` (the contact's pending callbacks of this employee are closed; a new one for `CALLBACK` / `FOLLOW_UP`), R/W `campaign_contacts` (attempts, `completed`). The retry delay comes from the setting `retry_rules` (read from the Redis copy).
* *Redis:* this person's queue epoch changes after the commit; their remembered dashboard too.

| Outcome | Contact becomes | Also |
|---|---|---|
| `CONNECTED` | `in_progress` | counters reset; next call from the next business day |
| `NO_ANSWER` / `BUSY` / `SWITCHED_OFF` | `in_progress`, then `unreachable` after `max_attempts` | next try after `delay_minutes` (defaults: 120 min / 3, 30 min / 5, 240 min / 3) |
| `INVALID_NUMBER` | `invalid` | call status `failed` |
| `INTERESTED`, `NOT_INTERESTED`, `COMPLETED` | `interested`, `not_interested`, `completed` | leaves the queue |
| `CALLBACK`, `FOLLOW_UP` | `callback`, `follow_up` | creates a pending callback at `callback_at` |
| `DO_NOT_CONTACT` | `do_not_contact` | never in a queue; new calls refused |

**CALL-8 `POST /calls/{id}/recording`** - owner or administrator. Body `content_type` (an allowed audio type), `size_bytes` (up to 100 MB), `duration_seconds?`, `sha256?`. `201`, or `200` for an existing one. `403 recording_disabled` unless an administrator switched recording on in settings.
* *Called by:* Phone - sync operation `recording_meta`. e2e. *MySQL:* R `settings` (Redis copy), R `recordings`, W `recordings` (`pending`), commit.

### 4.10 Callbacks - `/api/v1/callbacks`

**CB-1 `GET /callbacks`** - any (scoped; an employee always gets their own). Query `status` (`pending` default / `done` / `cancelled`), `employee_id`, `due_before`, paging. Each item has `overdue`.
* *Called by:* Phone - Callbacks screen and Contact detail (`status=pending`, first 100). *MySQL:* `COUNT` + `callbacks` JOIN `contacts` (not deleted) by `scheduled_at`.

**CB-2 `POST /callbacks`** - any. Body `contact_id`, `scheduled_at`, `note?`, `client_ref?`. A `do_not_contact` contact: `409`. *Called by:* Phone - sync operation `callback_create` (scheduling a callback on the Contact detail screen). *MySQL:* R `contacts` (scope), R `callbacks` (by `client_ref`), W `callbacks`, W `contacts` (`status=callback`, `next_eligible_at`), commit.

**CB-3 `PATCH /callbacks/{id}`** - owner or administrator (another person's callback: 404). Body `scheduled_at?` (pending only), `status?` (`done` / `cancelled`), `note?`. *Called by:* Phone - sync operation `callback_update` (Callbacks screen: done, cancel, reschedule). *MySQL:* R `callbacks`, R `contacts`, W `callbacks`, W `contacts` (back to `in_progress` when no callback is left), commit.

### 4.11 Recordings - `/api/v1/recordings`

Recordings are private: metadata in `recordings`, audio on disk (`<LOCAL_STORAGE_PATH>/recordings/<year>/<month>/<employee>/<call>.<ext>`) or in S3 (server-side encrypted). Listening goes through a **short-lived signed link** (5 minutes). Employees hear their own, managers their team's, administrators everybody's; only administrators can download.

**REC-1 `GET /recordings/{id}`** - any (scoped). *Called by:* nobody. *MySQL:* R `recordings`.

**REC-2 `POST /recordings/{id}/upload`** - `multipart/form-data` `file`; owner or administrator. Checks the first bytes are real audio (mp3, mp4/m4a/3gp, wav, ogg, flac, amr, webm), the size, and the checksum if one was announced.
* *Called by:* Phone - sync operation `recording_upload` (120 s timeout; the app deletes its private copy of the file afterwards). e2e. Sensitive limit `recording_upload`; 6 uploads at a time per worker, the rest `429` + `Retry-After: 5`.
* *MySQL:* R `recordings`; W `recordings` (`uploading`, then `available` with size, checksum, `uploaded_at`; or `failed` + reason), commit at each step.

**REC-3 `GET /recordings/{id}/playback-url?mode=play|download`** - any (scoped); `download` administrators only (`403 download_forbidden`). `{url, expires_at, mode}`. The URL is `/api/v1/recordings/{id}/stream?exp=&u=&m=&sig=` (HMAC-SHA256 over id, person, expiry and mode) or, with S3, a presigned S3 URL. Sensitive limit `recording_url`.
* *Called by:* Phone - the Play button on Call details. Panel - the player and the download button in the call drawer (asked only when pressed). *MySQL:* R `recordings`, W `recording_access_logs` (`playback_url` / `download_url`), W `audit_logs` (`recording.access`), commit.

**REC-4 `GET /recordings/{id}/stream?exp&u&m&sig`** - hidden from Swagger; the **signature is the credential** (no Authorization header). Supports `Range` (`206`, `416`).
* *Called by:* Phone - Android `MediaPlayer` reads the link directly. Panel - the browser's `<audio>` element, using the link rewritten to `/api/backend/...`; the panel's proxy forwards it without a token. *MySQL:* R `recordings` (must be `available`), R `employees` (the person must still be active), the scope check again, W `recording_access_logs` (`stream` / `download`) **only when the read starts at byte 0** (a seek or a resumed download adds no row), commit. The bytes come from disk/S3, not MySQL. `Cache-Control: private, no-store`.

**REC-5 `GET /recordings/{id}/access-log`** - admin. *Called by:* nobody. *MySQL:* `COUNT` + R `recording_access_logs` newest first.
**REC-6 `DELETE /recordings/{id}`** - admin. `204`. *Called by:* Panel - "Delete recording" in the call drawer. *MySQL:* W `audit_logs` (`recording.delete`), DELETE `recordings` (access logs go with it), commit; the audio file is deleted (best effort).

### 4.12 Dashboard - `GET /dashboard`

**DASH-1** - any signed-in. Query `day` (YYYY-MM-DD, default today), `employee_id`, `team_id`. Employees: their own figures; managers: their team; administrators: the organisation. Calls started that day, connected, no answer, busy / switched off / invalid, outcomes recorded, waiting for an outcome, talk time, average, target progress %, calls per hour, contacts still to call, callbacks due now / later today.
* *Called by:* Phone - Home screen (`useDashboard`). Load test, scale check. *(The panel does not use it; it uses ANA-1.)*
* *Redis:* one person: `c:dash:employee:...` 15 s, cleared when that person's own calls / callbacks / contacts change; team / organisation: computed once per 15 s for everybody who asks (single flight). From 50,000 assigned contacts the "still to call" figures use a stale-while-revalidate copy (`c:dash:contacts:...`, fresh 60 s, kept 1 h).
* *MySQL (miss):* R `calls` (one query, nine aggregates, LEFT JOIN `call_dispositions`), R `calls.started_at` for the day (hour histogram), R `employees` (counts, targets), `COUNT(contact_assignments)`, then the two queue counters (`contacts` + `contact_assignments` + `callbacks`).

### 4.13 Notifications - `/api/v1/notifications` (always the caller's own)
Created by the system: CON-3, CAM-9, import finished or stopped, rebalancing (type `assignment`, "N new contacts assigned").

**NOT-1 `GET /notifications?unread_only=`** - *Called by:* Phone - Notifications screen (first 50). *MySQL:* `COUNT` + R `notifications` newest first.
**NOT-2 `GET /notifications/unread-count`** - `{unread}`. *Called by:* nobody (the number is inside `/me`). *Redis:* `c:unread:{id}` 30 s.
**NOT-3 `POST /notifications/read-all`** and **NOT-4 `POST /notifications/{id}/read`** - *Called by:* Phone - Notifications screen (then it asks `/me` again). *MySQL:* W `notifications` (`is_read`, `read_at`), commit. *Redis:* `c:unread:{id}` deleted after the commit.

### 4.14 Audit log - `GET /audit-logs`

**AUD-1** - admin. Query `action` (exact, or a prefix ending in `.` such as `auth.`), `actor_id`, `entity_type`, `entity_id`, `date_from`, `date_to`, paging. *Called by:* Panel - Audit log page (30 per page). *MySQL:* `COUNT` + R `audit_logs` `ORDER BY created_at DESC, id DESC` (index `ix_audit_logs_created`; `ix_audit_logs_action_created` etc. for filters).
Actions written today: `auth.login`, `auth.login_failed`, `auth.login_blocked`, `auth.logout`, `auth.password_changed`, `auth.refresh_reuse_detected`; `employee.create / update / activate / deactivate / reset_password / credentials_viewed / credentials_exported / revoke_sessions / device_unbind`; `team.create / update / delete`; `contact.create / update / delete / assign / unassign`; `campaign.create / update / attach_contacts / detach_contact / set_assignees`; `import.upload / confirm / retry / cancel / cancel_requested / completed`; `distribution.rebalance`; `recording.access / delete`; `settings.update`; `report.export`. Any detail whose key contains `password`, `token`, `secret` or `hash` is dropped before saving.

### 4.15 Analytics (reports for the panel) - `/api/v1/analytics`, staff only
A manager always gets only their own team. Day and hour buckets are computed in the business time zone with plain integer arithmetic on the UTC time, so the same SQL runs on MySQL and SQLite. Range: `date_from` / `date_to` (inclusive business days, at most 366 days; default the last 7).
*Redis for ANA-1, ANA-2, ANA-5:* one worker works out the answer and the others wait for it (`c:analytics:{name}:{org or team}:{hash}`, **8 seconds**, invalid the moment an employee / team / setting changes: epochs `admin:roster`, `settings`). All administrators share one answer.

**ANA-1 `GET /analytics/overview`** (+ `employee_id`, `team_id`) - totals with the previous period, per-day and per-hour series, weekday x hour heatmap, outcomes, statuses, recording coverage with the reasons for missing recordings, people counts, leaderboard (top 8). *Called by:* Panel - Dashboard page (refetched every 60 s) and Recordings page. Load test, scale check. *MySQL (miss, about 15 reads):* `calls` (totals for both periods, day x hour `GROUP BY`, outcomes, statuses), `recordings` JOIN `calls`, `callbacks`, `call_events` (`payload.recording` JSON), `employees` + `roles`, per-employee figures from `calls`, `employee_sessions` (`MAX(last_used_at)`), `employee_devices`, `settings`. Redis `c:hb:*` for live phone reports.
**ANA-2 `GET /analytics/employees`** - every employee the caller may see with the figures of the period. Query: `q`, `team_id`, `role`, `state` (`all/active/inactive`), `presence` (`on_call/online/idle/offline/inactive`), `sort`, `order`. *Called by:* Panel - Employees page (60 s). Load test.
**ANA-3 `GET /analytics/employees.csv`** - the same as a CSV; W `audit_logs` (`report.export`); not remembered. *Called by:* Panel - "Export" button on the Employees page.
**ANA-4 `GET /analytics/employees/{id}`** - one employee: figures, patterns, outcomes, top contacts, 10 recent calls, devices, recording reasons. Default range 30 days. **Not remembered in Redis.** `404` when the person is outside the caller's view. *Called by:* Panel - Employee page. *MySQL:* the employee-row queries, `calls` series, `_top_contacts` (one grouped query plus up to 20 small look-ups for the last outcome of each), `calls` list (3 more reads), `employee_devices`.
**ANA-5 `GET /analytics/live`** - who is on a call now (started within 2 hours and not ended), the 12 latest calls, how many people are `on_call / online (5 min) / idle (1 h) / offline / inactive`, today's totals. *Called by:* Panel - sidebar badge and the live panel (every 8 s while the tab is visible). Load test, scale check.

### 4.16 Settings - `/api/v1/settings` (administrators)

**SET-1 `GET /settings`** - all settings with descriptions and `updated_at`. *Called by:* Panel - Settings page, the Import wizard (duplicate policy), employee forms (default target). *MySQL:* R `settings` (all rows, for `updated_at`); the values themselves come from the remembered copy. *Redis:* `c:settings:all`.
**SET-2 `PUT /settings/{key}`** - body `{value}`; an unknown key: 404; a wrong value: `422 invalid_setting`. Keys: `recording {enabled, notice_text (10+ characters)}`, `retry_rules {NO_ANSWER, BUSY, SWITCHED_OFF: {delay_minutes 1 to 10080, max_attempts 1 to 20}}`, `default_daily_target` (0 to 2000), `duplicate_policy` (`skip` / `update`), `inactive_after_days` (1 to 90), `auto_rebalance` (true / false).
* *Called by:* Panel - Settings page; self-test (switches `auto_rebalance` off for its run and restores it).
* *MySQL:* R `settings`, W `settings` (insert or update with `updated_by`), W `audit_logs` (`settings.update` with before and after), commit. *Redis:* epochs `settings` and `admin:roster` change after the commit; phones get the new rules from their next `/me`.

### 4.17 Work sharing - `/api/v1/distribution` (administrators)
"Working" is defined in IMP-6. The **rebalancing** takes the contacts that a not-working employee has not started on (status `new` or `in_progress`, no promised callback) and shares them equally between those who work; calls already done and promised callbacks stay.

**DIS-1 `GET /distribution/overview`** - every employee with state (`active / new / inactive / deactivated`), contacts owned, and how many could be taken back; last run. *Called by:* Panel - Work sharing page (every 30 s); scale check. *MySQL:* the reads of IMP-6 + `contacts` JOIN `contact_assignments` with `NOT EXISTS` pending callbacks + R `distribution_runs`.
**DIS-2 `POST /distribution/rebalance/preview`** - body `{from_employee_ids?, to_employee_ids?, strategy: equal|balance_total, order: interleave|blocks}`. **Nothing is written.** *Called by:* Panel - Work sharing page, the dialog "Share the contacts of people who stopped" (asked again at every change); self-test; scale check.
**DIS-3 `POST /distribution/rebalance`** - same body. `202` with the run; `422 nothing_to_rebalance` if there is nothing to move; `409 rebalance_busy`. Sensitive limit `rebalance`. *Called by:* Panel - the "Move N contacts" button of that dialog; self-test. *MySQL:* W `distribution_runs` (`running`), commit; then a background thread moves in pages of 1,000 (`FOR UPDATE SKIP LOCKED`, one transaction per page): W `contact_assignments` (old released, new inserted), W `distribution_runs` (`moved`, heartbeat); at the end W `notifications`, W `audit_logs` (`distribution.rebalance`), epoch `queue:all` and the queue epochs of everybody involved. The same run also starts **by itself every 10 minutes** while `auto_rebalance` is on (scheduler).
**DIS-4 `GET /distribution/runs`** (history, 10 per page, refetched every 30 s) and **DIS-5 `GET /distribution/runs/{id}`** (polled every 1.5 s while `running`) - *Called by:* Panel; self-test (DIS-5). *MySQL:* R `distribution_runs`.

### 4.18 Operations (not under `/api/v1`)

**OPS-1 `GET /health`** - `{"status": "ok", "version": "..."}`. Liveness only: answered without a worker thread, so it works even when every thread is busy. *Called by:* Phone - the "Test" button for the server address on the login screen. The panel's `/api/health?deep=1`. Docker `HEALTHCHECK` of the API image, deploy scripts, the deploy workflow (public URL), CI. Public through Caddy.
**OPS-2 `GET /ready`** - `{"status": "ready"|"degraded", "checks": {"database": "ok"|"error: ...", "redis": "redis"|"memory-fallback"|"error"}}`, `200` or `503`. MySQL is required; in production anything other than a real Redis is `degraded`. *Called by:* deploy scripts and CI, **inside the container** (`docker compose exec api curl .../ready`); Caddy does not route it. *MySQL:* `SELECT 1`. *Redis:* `PING`.
Swagger `/docs` and `/openapi.json` exist only outside production.

---

## 5. The admin panel's own server routes (Next.js)

The panel is a "backend for frontend". Its browser code only talks to these routes, never to the API.

| Route | Does | Calls on the API |
|---|---|---|
| `POST /api/auth/login` | checks the `x-requested-with: admin-web` header, signs in with `platform: "web"`, refuses non-staff (also signs them out again), sets the cookies `ec_at` (access) and `ec_rt` (refresh): httpOnly, SameSite=Lax, Secure in production | AUTH-1 (AUTH-3 for non-staff) |
| `POST /api/auth/logout` | ends the session, clears the cookies | AUTH-3 |
| `GET /api/auth/me` | who is signed in + the settings the phones use; renews the session if the access cookie expired; non-staff are signed out | AUTH-2 (if needed), ME-1 |
| `GET/POST/PUT/PATCH/DELETE /api/backend/<path>` | forwards to `/api/v1/<path>` with `Authorization: Bearer <cookie>`; renews the token first when only the refresh cookie is left, and once more after a 401; **non-GET needs `x-requested-with: admin-web`** (else `403 csrf`); `auth/*` is `404` except `auth/change-password`; a recording link needs no token; a contact sheet is streamed (never held in memory); passes `content-type`, `range`, `retry-after`, `x-request-id`, `content-disposition`; `502 backend_unreachable` if the API is down | any (section 4) |
| `GET /api/health` (`?deep=1`) | liveness of the panel; `deep` also asks the API | OPS-1 |
| pages | `src/proxy.ts` sends visitors without a session cookie to `/login`; the API decides whether the session is real | - |

Page -> endpoints (browser, through `/api/backend`):

| Page | Endpoints |
|---|---|
| every page (shell) | `/api/auth/me` (ME-1), sidebar `analytics/live` (ANA-5, 8 s), Ctrl+K `employees?q` (EMP-1), change password (AUTH-4), sign out |
| Dashboard | ANA-1 (60 s), ANA-5 (8 s), TEAM-1 |
| Employees | ANA-2 (60 s), TEAM-1, EMP-2, EMP-3, EMP-6, EMP-7/8, EMP-10, EMP-11, EMP-9, EMP-4 link, ANA-3 link |
| Employee (one) | ANA-4, CALL-2 (this employee's calls), devices panel: EMP-14, EMP-13, EMP-11; "Manage" menu: EMP-6, EMP-9, EMP-10, EMP-11, EMP-7/8 |
| Teams | TEAM-1 to TEAM-4 |
| Work sharing | DIS-1 (30 s), DIS-2, DIS-3, DIS-4 (30 s), DIS-5 (1.5 s) |
| Calls | CALL-2, CALL-3 link, drawer: CALL-4, REC-3, REC-4, REC-6 |
| Recordings | ANA-1, CALL-2 (`has_recording=true`), REC-3, REC-4, REC-6 |
| Contacts | CON-1, EMP-1, CAM-1, IMP-2 (8 s), CON-2, CON-3, CON-4, CON-6, CON-7, drawer: CON-5, CON-8, CON-9, CON-10, wizard: IMP-1 to IMP-9, SET-1 |
| Campaigns | CAM-1, CAM-2, CAM-4, CAM-7, CAM-8, CAM-9, CAM-10, EMP-1 |
| Audit log | AUD-1, EMP-1 |
| Settings | SET-1, SET-2 |

---

## 6. Flows from start to finish

### 6.1 Phone: sign-in and start-up
1. (Login screen "Test" button) `GET /health`.
2. `POST /auth/login` with device info -> tokens saved in the Android Keystore store.
3. `GET /me` (once more if the first answer is lost) -> outcomes, recording rules, `heartbeat_seconds`, `sync_interval_seconds`. The profile is cached in the phone's SQLite so the app opens instantly, also offline.
4. The sync engine starts (every `sync_interval_seconds`, 45 by default, also when the app comes to the front) and the heartbeat starts (`POST /me/heartbeat` now and every 60 s). With a temporary password only the password screen works and the heartbeat stays off.
5. Screens show the cached copy first, then ask: `GET /queue?limit=200`, `GET /dashboard`, `GET /callbacks`, `GET /notifications`, `GET /calls?page_size=100`, `GET /contacts?q=`.
6. Before every request, if the access token has less than 30 s left: `POST /auth/refresh`.
7. Sign-out: `POST /auth/logout`; the server cache is cleared on the phone, calls and operations that are not yet sent are kept.

### 6.2 One call, end to end (phone)
1. The employee taps Call. The app writes the call to its own SQLite and queues `create_call` -> `POST /calls`.
2. The Kotlin phone layer measures dialing / answered / ended. The app queues `call_events` -> `POST /calls/{id}/events` and `call_update` -> `PATCH /calls/{id}`.
3. Outcome screen -> `disposition` -> `POST /calls/{id}/disposition` (contact status, retries, callback and campaign counters change on the server).
4. If recording is on and a file exists: `recording_meta` -> `POST /calls/{id}/recording`, then `recording_upload` -> `POST /recordings/{id}/upload`.
5. Operations are sent in order. A server or network problem is retried with a growing wait (5 s, 10 s, 20 s ... with a little random spread, at most 15 minutes; 12 tries, then it waits for a manual "Retry failed"); an operation that depends on an earlier one waits 20 s. Because of the idempotency keys (2.6) a repeat is harmless.
6. After a successful round the queue, dashboard, history and callbacks are fetched again.

### 6.3 Panel: sign-in and every request
`POST /api/auth/login` -> cookies. Each page call `/api/backend/x` -> the panel server reads the cookie, adds the Bearer token, calls `/api/v1/x`. No access cookie but a refresh cookie: `POST /api/v1/auth/refresh` first. A `401` from the API: refresh once and repeat. No session at all: `401` and the browser goes to `/login?next=...`.

### 6.4 Administrator: import a sheet and share it
1. `POST /contacts/import` (file) -> `202`. Poll `GET /contacts/import/{id}` until `previewed` (progress, counts of good / bad / repeated / already-contacts rows).
2. Preview: `GET .../rows`, `GET .../plan` (re-asked when the choice changes), `GET .../issues.csv`.
3. `POST .../confirm` -> `202`. The plan is frozen; poll until `completed`. Each employee gets a notification and their queue refreshes.
4. If the server restarts: the scheduler finds the import whose lease is older than 90 s and carries on from the resume point. `POST .../retry` or `POST .../cancel` by hand.

### 6.5 Administrator: rebalance
`GET /distribution/overview` -> `POST /distribution/rebalance/preview` -> `POST /distribution/rebalance` (`202`) -> poll `GET /distribution/runs/{id}`. The scheduler does the same every 10 minutes when `auto_rebalance` is on.

### 6.6 Listening to a recording
Call drawer -> `GET /recordings/{id}/playback-url?mode=play` -> `<audio src="/api/backend/recordings/{id}/stream?exp=...&sig=...">` -> the panel forwards the `Range` requests without a token -> the API checks the signature, the person and the scope, logs the playback (when the read starts at byte 0), streams the bytes. On the phone `MediaPlayer` reads the same link directly from the API.

---

## 7. Database (MySQL 8.4 in production, SQLite only for development and tests)

### 7.1 How the API uses it
* One synchronous SQLAlchemy engine per worker; `pool_pre_ping`, `pool_recycle` 1800 s, isolation level **READ COMMITTED**, `utf8mb4` / `utf8mb4_unicode_ci`, InnoDB. Production pool: 3 + 1 extra per worker, 2 workers, so at most 8 connections on the shared RDS (the load test saw at most 9 in use); the database user is capped at 12 (`MAX_USER_CONNECTIONS`).
* A request takes a connection only when it runs its first statement. A cached session needs none. Services commit explicitly; anything uncommitted is rolled back when the request ends; `autoflush` is off, `expire_on_commit` is off.
* All times are stored as UTC `DATETIME(6)`. Primary keys are `BIGINT` (the odd `INTEGER` is only SQLite). JSON columns store `None` as SQL `NULL`.
* Schema changes only through Alembic (`backend/migrations/versions/0001` to `0005`), run at API start by `entrypoint.sh` -> `python -m scripts.bootstrap` (waits up to 60 s for the database, migrates, adds missing roles / outcomes / default settings, creates the first administrator when `BOOTSTRAP_ADMIN_*` is set). A database that is **newer** than the running code (after a rollback of the images) is used as it is: migrations only ever add.

### 7.2 The 24 tables
| Table | One row is | Keys, uniqueness, indexes | Written by |
|---|---|---|---|
| `roles` | admin / manager / employee | `name` unique | start-up only |
| `teams` | a team | `name` unique | TEAM-2/3/4 |
| `employees` | a person (also administrators and managers) | `employee_code` unique, `email` unique, `(team_id, is_active)`; `role_id` -> roles; `team_id` -> teams (set null). Stores a bcrypt hash of a SHA-256 of the password (12 rounds). | EMP-2/3/6/7/8/10, AUTH-1 (`last_login_at`), AUTH-4 |
| `employee_devices` | a phone of a person | `(employee_id, device_uid)` unique; holds the last heartbeat (battery, network, permissions, pending, clock skew) | AUTH-1, ME-2, every request once a minute (`last_seen_at`), EMP-13 |
| `employee_sessions` | one sign-in | id is a UUID; `(employee_id, revoked_at)`; stores only the SHA-256 of the refresh token and of the previous one | AUTH-1/2/3/4, EMP-7/10/11/13, every request once a minute (`last_used_at`) |
| `employee_credentials` | the first password an administrator handed out, **encrypted** (Fernet, key derived from `JWT_SECRET` by HKDF) | primary key = `employee_id` | EMP-2/3/10 (write), EMP-4/9 (view counter), AUTH-4 and EMP-7 (delete), hourly purge after 30 days |
| `call_dispositions` | one of the 11 outcomes | `code` unique | start-up only |
| `contacts` | a person to call (soft-deleted with `deleted_at`) | `normalized_phone` **unique**; `(status, deleted_at)`, `created_at`, `name`, `category`, `next_eligible_at`; `search_text` for search | CON-2/6/7, IMP-7 (background), CALL-1 (`call_count`, `last_called_at`), CALL-7 (status machine), CB-2/3 |
| `contact_assignments` | who owns a contact | `active_contact_id` **unique** (equals `contact_id` while active, `NULL` after): one active owner per contact, enforced by the database; `(employee_id, status)`, `contact_id`, `campaign_id` | CON-2/3/4/7, CAM-9, IMP-7, DIS-3 |
| `campaigns` | a campaign | `name` unique, `status` | CAM-2/4 |
| `campaign_contacts` | a contact in a campaign (`pending / in_progress / completed`, attempts) | `(campaign_id, contact_id)` unique, `contact_id`, `(campaign_id, status)` | CON-2/3, CAM-5/6/9, IMP-7, CALL-7 |
| `campaign_assignees` | an employee working a campaign | `(campaign_id, employee_id)` unique | CAM-8 |
| `calls` | one call attempt (never rewritten: contact name and number are copied in) | `(employee_id, client_call_id)` **unique** = the idempotency key; `(employee_id, started_at)`, `(contact_id, started_at)`, `(campaign_id, started_at)`, `(status, started_at)`, `started_at` | CALL-1/5/6/7 |
| `call_events` | a step of a call (dialing, ringing, connected, ended, failed, disposition ...) | `(call_id, event_type, occurred_at)` unique, `(call_id, occurred_at)` | CALL-1/6/7 |
| `call_notes` | a note on a contact (optionally on a call) | `(author_id, client_ref)` unique, `(contact_id, created_at)`, `call_id` | CON-9, CALL-7 |
| `callbacks` | a promise to call back | `(employee_id, client_ref)` unique, `(employee_id, scheduled_at, status)`, `contact_id` | CB-2/3, CALL-7; cancelled by CON-3/4/7, DIS-3 |
| `recordings` | metadata of one recording | `call_id` unique (one per call), `uid` unique, `(employee_id, created_at)` | CALL-8, REC-2, REC-6 |
| `recording_access_logs` | who asked for / played a recording | `(recording_id, created_at)` | REC-3, REC-4 |
| `notifications` | a message to an employee | `(employee_id, is_read, created_at)` | CON-3, CAM-9, IMP-7, DIS-3 (create); NOT-3/4 (read) |
| `audit_logs` | who did what | `(actor_id, created_at)`, `(action, created_at)`, `(entity_type, entity_id)`, `created_at` | almost every write, sign-in attempts, exports, recording links |
| `settings` | one setting (JSON value) | primary key `key` | SET-2, start-up (defaults) |
| `imports` | one sheet and its progress / lease / frozen plan | `(created_by, created_at)` | IMP-1/7/8/9 and the background jobs |
| `import_rows` | a sample of one sheet (bad rows, a few good rows) | `(import_id, status)`, `(import_id, row_number)` | background check; purged after 30 days |
| `distribution_runs` | one rebalancing | `created_at` | DIS-3 and the automatic run |
| *(Alembic's own)* `alembic_version` | the current revision | | migrations |

### 7.3 Relationships
```
roles 1-n employees n-1 teams
employees 1-n employee_devices, employee_sessions (n-1 device), employee_credentials (1-1), notifications, callbacks, calls, call_notes,
          recordings, recording_access_logs, audit_logs (actor), settings (updated_by), imports / distribution_runs (created_by)
contacts  1-n contact_assignments (one active), campaign_contacts, calls, call_notes, callbacks     contacts n-1 imports
campaigns 1-n campaign_contacts, campaign_assignees, contact_assignments, calls     imports 1-n import_rows
calls     1-n call_events, call_notes, callbacks;  1-1 recordings (n access logs);  n-1 call_dispositions
```
Deleting a parent: `employee_devices`, `employee_sessions`, `employee_credentials`, `notifications`, `campaign_*`, `call_events`, `recordings` follow their parent (cascade); `contacts.import_id`, `calls.contact_id`, `audit_logs.actor_id` and similar are set to null so history is never lost. In practice contacts and employees are not hard-deleted: contacts are soft-deleted, employees are deactivated.

### 7.4 How concurrent work stays correct
| Problem | Answer |
|---|---|
| The same phone number twice | unique `contacts.normalized_phone`; imports use "insert, skip if the number is there" in one statement; a deleted contact is brought back, not duplicated |
| Two owners for one contact | unique `contact_assignments.active_contact_id`; `assign` also takes a Redis lock; a lost race is `409 assignment_conflict` |
| A call sent twice (retry, bad network) | unique `(employee_id, client_call_id)`; on a race the second insert re-reads the first |
| Double tap on Sign in | `SELECT ... FOR UPDATE` on the employee row |
| Two imports at once | only one `applying` at a time (`409 import_busy`); one writer job per process |
| An import / rebalancing dies half way | a lease (`lease_owner`, `heartbeat_at`, 90 s); every step is one transaction that also moves the resume point (an absolute number); the scheduler takes over |
| Deadlock / lost connection in a long job | `retry_transient`: 4 tries, 0.4 s doubling, for MySQL errors 1205, 1213, 2006, 2013, 2014, 2055 |
| A rebalancing step meets rows somebody edits | `FOR UPDATE SKIP LOCKED`, left for the next round |

### 7.5 The scheduler (a thread inside the API process; a tick every 30 s after a 15 s delay; safe in every worker at once)
* Every tick: take over imports whose runner has vanished (no report for 90 s; an import that kept stopping 5 times is given up).
* Every 10 minutes (one worker, decided by a Redis gate): the automatic rebalancing, when `auto_rebalance` is on and somebody has stopped working.
* Every hour (one worker): remove the row-level data of imports older than 30 days; expire uploads nobody confirmed within 7 days (`cancelled`, files deleted); purge first passwords older than 30 days; mark rebalancing runs that stopped reporting (300 s) as failed; delete half-received upload files older than 24 hours.

### 7.6 The phone's own SQLite (`employee-calling.db`, Android, op-sqlite)
`kv` (server address, small settings), `cache` (the last answer of each screen, JSON), `contacts` (copy of contacts seen, for offline search and caller names), `calls` (every call made on this phone with the outcome, recording state and `server_id`), `sync_ops` (the queue of things to send: `create_call`, `call_events`, `call_update`, `disposition`, `note_create`, `callback_create`, `callback_update`, `recording_meta`, `recording_upload`). The server is always the source of truth. Kotlin opens this file read-only to show a customer's name on an incoming call.

---

## 8. Redis (sessions, caches, limits, locks)

Redis never holds the truth: lose it and the API answers from MySQL (slower), and reconnects by itself. In production the API refuses to start without it, and never falls back to a private in-memory copy.

| Key | Holds | Time to live | Cleared or replaced by |
|---|---|---|---|
| `rl:login:ip:{ip}`, `rl:login:id:{identifier}` | sign-in attempt counters | 60 s, 300 s | time; a successful sign-in clears the account counter |
| `rl:user:{id}` | requests of one person this minute | 60 s | time |
| `rl:sensitive:{kind}:u{id}` | counters of heavy actions | 60 s | time |
| `c:auth:s:{sid}` | the session and the employee (no password hash) | at most 60 s (`AUTH_CACHE_SECONDS`) | epoch `emp:{id}`; logout deletes the key |
| `c:ep:{name}` | an **epoch**: a number that grows; a remembered value carries the epochs it was made under and is ignored if one has changed | 30 days | `emp:{id}`: logout-everywhere, password change / reset, deactivate, employee or team edit. `queue:emp:{id}`: that person's calls, callbacks, assignments. `queue:all`: contact / campaign changes, imports, rebalancing. `admin:roster`: employee / team / setting changes. `settings`: SET-2 |
| `c:config:client`, `c:settings:all` | organisation settings and outcome list for phones | 300 s | epoch `settings` |
| `c:unread:{id}` | unread notification count | 30 s | notification created / read |
| `c:queue:{id}:{limit}:{offset}` | a calling queue | 20 s (`QUEUE_CACHE_SECONDS`) | epochs `queue:all` + `queue:emp:{id}` |
| `c:dash:...` | a dashboard | 15 s (`DASHBOARD_CACHE_SECONDS`) | one person: their epochs; team / org: time |
| `c:dash:contacts:...` | "still to call" figures for big organisations | fresh 60 s, kept 1 h | refreshed in the background by one worker |
| `c:analytics:{name}:{scope}:{hash}` | a panel report | 8 s (`ANALYTICS_CACHE_SECONDS`) | epochs `admin:roster`, `settings` |
| `c:lock:{key}:{epochs}` | "I am working this answer out" | 10 s | released at once |
| `c:contacts:total:{hash}` | a contact count of 20,000 or more | 60 s | epoch `queue:all` |
| `c:hb:{id}` | the last phone report of an employee | 15 min | replaced by the next report |
| `c:once:...` | "first caller in this window wins" gates: `presence:{sid}` (60 s), `heartbeat-write:{device}` (5 min), `job:auto-rebalance` (10 min), `job:housekeeping` (1 h), `swr:...` | as named | time |
| `lock:assign-contacts` | only one bulk assignment at a time | 120 s | released at once |

The redis password is set by the deploy script; Redis runs with 128 MB, `volatile-lru`, append-only file.

---

## 9. Everything else that calls the API

| Caller | What it calls |
|---|---|
| **pytest** (392 tests, `backend/tests/`, SQLite by default, MySQL 8.4 in CI) | all routes. `test_authorization_matrix.py` sends every operation as nobody / employee / manager / administrator and fails when a route is added without being classified; `test_call_hot_path.py` holds the phone's busy calls to a **statement budget** (start a call at most 8 statements, events 8, update 5, outcome 14, call list 8, queue 8). |
| **Schemathesis fuzz test** (CI job `api-fuzz`, MySQL + Redis) | every documented operation with generated odd input, as administrator and as employee, except logout, deactivate, revoke-sessions, reset-password; anything that answers a server error fails the build |
| **`scripts/loadtest.py`** (CI job `load-test`; 500 phones, 100,000 contacts) | login, `/me`, `/queue`, `/calls`, `/calls/{id}/events`, `PATCH /calls/{id}`, `/calls/{id}/disposition`, `/me/heartbeat`, `/dashboard`; as viewers: `/analytics/live`, `/analytics/employees`, `/analytics/overview`, `/calls` |
| **`scripts/scale_check.py`** (CI job `import-scale`; 300,000-row sheet) | runs the import and the equal sharing through the service code (not over HTTP), then times `/dashboard`, `/contacts` (list, name search, number search, status filter), `/employees`, `/analytics/overview`, `/analytics/live`, `/distribution/overview`, `/distribution/rebalance/preview`, `/contacts/import`, `/queue` (two pages) |
| **`scripts/selftest_sharing.py --really`** (run on the real server inside the API container) | a temporary administrator, 10 employees and test sheets: login, settings, employees, credentials, import (upload, plan, confirm, cancel), rebalance, change-password, queue; then deletes everything it made |
| **Playwright e2e** (`admin-web/e2e`, 10 spec files, real browser against a real API) | the panel pages, plus phone-like calls straight to the API (`phone.ts`: login, create call, update, events, disposition, recording, upload) |
| **Vitest / Jest** (`admin-web/tests`, `mobile/__tests__`) | the clients (`api.test.ts`, `apiClient.test.ts`, `syncEngine.test.ts`, `heartbeat.test.ts`) with a faked network |
| **CI `docker-stack` / `docker-shared` jobs**, **`deploy/*.sh`**, **`deploy.yml`** | `/health`, `/ready` (inside the container), `/api/health?deep=1`, a wrong-password `POST /auth/login` (must be `401`), a 3 MB body (must be `413`), `HEAD /api/v1/me` (must say `no-store`), a 12 MB sheet through `/api/backend/contacts/import`, `/docs` (must not be `200` in production), the first administrator's login after an install |
| **`deploy/check_caddy_limits.py`** | tries the size limits of the Caddyfile on `/api/v1/auth/login`, `/api/v1/contacts/import`, `/api/v1/recordings/12/upload` and look-alikes |
| **`api-contract` job** | exports the OpenAPI document and fails if `admin-web/src/lib/api-types.ts` is not regenerated |

---

## 10. Production wiring

| Item | Value |
|---|---|
| Public address | `https://<PUBLIC_HOST>:8445` (the host of the GitHub variable `PUBLIC_URL`); certificate from Let's Encrypt, files read by Caddy, renewed weekly by the `Certificate` workflow |
| Front door (Caddy) | `/api/v1/*` and `/health` -> API (2 MB, 5 min); `/api/{v1,backend}/recordings/<n>/upload` -> 120 MB, 10 min; `/api/{v1,backend}/contacts/import` -> 210 MB, 30 min; everything else -> panel (2 MB, 10 min). The size limit sits inside each route's own block - a site-wide limit would overrule the larger ones. `/ready` and `/docs` are not reachable from outside. |
| Containers (`deploy/shared/docker-compose.yml`, project `calling`) | `api` (uvicorn, 2 workers, `--proxy-headers`, read-only filesystem, no capabilities, 768 MB), `admin` (Next.js standalone, 384 MB, `BACKEND_URL=http://api:8000`, `COOKIE_SECURE=true`), `redis` (7, password, 192 MB), `caddy` (96 MB). No MySQL container: the database is on RDS. All with log rotation and `restart: unless-stopped`. |
| All-in-one server | `docker-compose.prod.yml` + `deploy/install.sh`: the same plus a MySQL container and ports 80 / 443 |
| Database | MySQL 8.4 on RDS, database `Calling_db`, TLS with the RDS CA bundle, a dedicated user limited to that database |
| Recordings | local volume `api_data` (`STORAGE_BACKEND=local`); S3 is supported (`STORAGE_BACKEND=s3`, `AWS_S3_BUCKET`) |
| Health | API image: `GET /health` every 30 s; panel image: `GET /api/health`; compose waits for both to be healthy before starting Caddy |
| Deploy | push to `main` -> `ci.yml` green -> `deploy.yml` builds the two images, connects with a restricted deploy key (a forced command), `deploy.sh` pulls, starts, waits for `/ready`, and the workflow then checks the public `/api/health?deep=1` and `/health`. Rolling back = run `Deploy` on an older commit. |
| Start of the API | `entrypoint.sh` -> `scripts.bootstrap` (migrate, reference data, first administrator) -> uvicorn |
| Never | load-test production (the demo / load seed scripts and the scale check refuse to run there, the load test itself does not), or touch anything on the shared server that is not ours (other containers, ports, databases) |

Settings (environment) that change how the API answers, with defaults: `APP_ENV` (`production` switches Swagger off and turns on the strict checks), `JWT_SECRET` (32+ random characters, required; **also derives the key of the stored first passwords and of the recording links - changing it makes stored first passwords unreadable and invalidates every session**), `DATABASE_URL` (MySQL only in production), `REDIS_URL`, `TRUST_PROXY_HEADERS` (true behind Caddy), `JWT_ACCESS_TTL_MINUTES` 15, `JWT_REFRESH_TTL_DAYS` 30, `AUTH_CACHE_SECONDS` 60, `CONFIG_CACHE_SECONDS` 300, `QUEUE_CACHE_SECONDS` 20, `DASHBOARD_CACHE_SECONDS` 15, `ANALYTICS_CACHE_SECONDS` 8, `RATE_LIMIT_*`, `MAX_JSON_BODY_KB` 1024, `MAX_INFLIGHT_REQUESTS` 24, `INFLIGHT_WAIT_SECONDS` 15, `MAX_CONCURRENT_UPLOADS` 6, `MAX_RECORDING_MB` 100, `RECORDING_URL_TTL_SECONDS` 300, `MAX_IMPORT_MB` 200, `IMPORT_CHUNK_ROWS` 2000, `ASSIGN_MAX_CONTACTS` 100000, `HEARTBEAT_SECONDS` 60, `SYNC_INTERVAL_SECONDS` 45, `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, `DB_POOL_TIMEOUT_SECONDS` 10, `CREDENTIAL_KEEP_DAYS` 30, `APP_TIMEZONE`. The full list with comments is [backend/app/core/config.py](../backend/app/core/config.py); capacity numbers are in [PERFORMANCE_AND_SECURITY.md](PERFORMANCE_AND_SECURITY.md).

---

## 11. Caveats found while writing this (11.1 and 11.2 were reproduced by running the project's own code locally)

**11.1 Unbinding a device does not end the phone's current access token at once.** `DELETE /employees/{id}/devices/{device_id}` (EMP-13)
revokes the device's sessions with a plain `UPDATE` and does not change the epoch `emp:{id}` that the other endpoints (revoke-sessions,
reset-password, deactivate, change-password) change. Result: right after the unbind, the old **refresh** token is dead (`401`), but the
old **access** token still answered `GET /me` with `200` until the remembered session expires - at most `AUTH_CACHE_SECONDS` (60 s).
The same probe on `revoke-sessions` answered `401` at once. Impact: a 60-second window, only for an employee with device binding on; it
ends by itself. Fix, when wanted: call `auth_cache.forget_employee(db, employee.id)` in `employee_service.unbind_device`.

**11.2 A manager can read a campaign's progress outside their team.** `GET /campaigns/{id}/progress` (CAM-10) is open to staff and is
not limited to the manager's team or to campaigns they work on. Probe: a manager whose campaign list is empty and for whom
`GET /campaigns/{id}` answers `404` still got `200` with `calls_by_employee: [{employee_id, name, calls}]` for an employee of **another
team**. Impact: names and call counts of other teams for managers (staff accounts). Fix, when wanted: in `campaign_service.progress`, restrict
the per-employee list to `visible_employee_ids`, or require the campaign to be visible.

**11.3 (for information)** Eight endpoints have no caller today (4.0). They are protected like all others; remove them or keep them for API users.
**11.4 (for information)** `GET /employees/{id}` answers `403` (not `404`) to a manager asking about somebody outside their team.

---

## 12. How this was checked, and how to keep it current
* The route list: `app.openapi()` of the real application gave 88 operations (all with `HTTPBearer` except login and refresh); the three
  hidden ones are `/health`, `/ready` and `.../stream`. Role per route follows the dependencies in `backend/app/api/v1/*.py` and agrees
  with `tests/test_authorization_matrix.py`.
* Callers: every `api.*` helper of the phone (`mobile/src/services/api/endpoints.ts`) and every call of the panel (`admin-web/src/lib/queries.ts`,
  its server routes, components) was matched against the route list by a script and by reading the screens; the phone helpers that nothing
  calls (`recording`, `unreadNotifications`) and the panel hooks that no component uses (`useEmployeeDevices`) are the ones named in 4.0.
* Database and Redis: read from the services, models and the five migrations. Statement budgets are the ones asserted in `test_call_hot_path.py`.
* Not done: no request was sent to the live server; no real phone was used; the exact SQL text MySQL receives was not captured (the
  statements above are what the code issues).
* **Keeping it current:** after adding a route, run `cd backend && python -m scripts.export_openapi ../admin-web/openapi.json` (CI's
  `api-contract` job fails otherwise) and update `PUBLIC`, `STAFF_ONLY`, `ADMIN_ONLY` in `tests/test_authorization_matrix.py` (that test
  fails until you do). Then add the route to sections 3 and 4 here.
