# Employee Calling & CRM Platform - complete project documentation

| | |
|---|---|
| **Status** | **Running again since 2026-10-09.** The project was cancelled on 2026-10-05 and its containers were stopped; on 2026-10-09 the owner asked for it to be put back on the same server "as it was", and it was. On 2026-10-10 the import (every different number is a contact) and the sharing (an employee who comes later gets a fair share) were fixed on production (section 15). |
| **Final version** | `v1.3.0` (APK Release) = commit `6335c3e` on `main` (merge of pull request #9) |
| **Repository** | <https://github.com/maheshofficelokmangalgroup-tech/call> |
| **Built** | 2026-10-01 to 2026-10-03 (first commit and first APK Release `v1.0.0` on 2026-10-01; last Release `v1.3.0` on 2026-10-03; 62 commits, 9 pull requests) |
| **Written for** | the owner, and anybody who opens this repository later and has to understand, restart or reuse it |

## 0. Saransh (मराठी सारांश)

Ha project **band zala ahe** (2026-10-05). Server var che 4 Docker containers band kele ani GitHub var auto-deploy band kela; **code ani docs GitHub var rahile ahet**. Database (`Calling_db` RDS var), volumes, images ani `~/calling` server var jase hote tase ahet - kai kai rahile ani te kase kadhaycha te **section 15** madhe ahe.
Project kay hota: employees Android app madhun contacts la call kartat, outcome lihitat, callback ठरवतात; admin la web panel madhe sagla disto
(kon kiti call kela, kontya number la, response kay, kon call var ahe). 10,000 te 10 lakh contacts Excel/CSV madhun import karun working employees madhe
**barabar vatle jatat**. **Pratyek vegla phone number = ek contact** (naav var kahi farak padat nahi, fakta same number don vela yet nahi); voter list madhe "ek person che numbers
ekatra" he option tick kele tarach ek contact sagle numbers sobat. Navin employee add kela ki tyala bakichya barabar vatap milte (**section 4**). Punha suru karaycha asel tar **section 11** (Restart from
scratch) vacha; kay shikalo ani kay adhurech rahile te **section 13 ani 14** madhe ahe.

---

## 1. What the project was

A system for a team of employees who phone a large list of people (customers, voters, leads) and have to be managed while they do it.

* **Employees** use an Android app: they see today's contacts, tap Call, the app places and tracks the call, and afterwards they say how it went
  (answered, no answer, call back later ...). Everything works offline and is sent to the server later.
* **Administrators** use a web panel: a live dashboard, every employee's calls and talk time, recordings (where the phone could make them), contacts,
  campaigns, follow-ups (who spoke to whom, what each person answered, who has to be called back), a bulk import of up to a million contacts that is
  **shared equally between the employees who are working**, and an audit log.
* **The server** (FastAPI + MySQL + Redis) is the single source of truth. A very large list is checked line by line, no phone number ever gets in
  twice, **every different number is a contact of its own** (the name decides nothing), and - when asked for - the numbers of one person can be put
  together into **one contact with all their numbers**.

### The three parts

| Part | Technology | Folder |
|---|---|---|
| Backend API | Python 3.12, FastAPI, SQLAlchemy 2, Alembic, MySQL 8 (SQLite for development and fast tests), Redis | [`backend/`](../backend) |
| Employee app | React Native 0.87, TypeScript, **Android only**; a Kotlin layer for the phone (calls, call screen, recording) | [`mobile/`](../mobile) |
| Admin panel | Next.js 16, React 19, Tailwind 4, TanStack Query | [`admin-web/`](../admin-web) |
| Server and pipeline | Docker Compose, Caddy (HTTPS), GitHub Actions, GHCR images | [`deploy/`](../deploy), [`docker-compose*.yml`](../docker-compose.prod.yml), [`.github/workflows/`](../.github/workflows) |

## 2. Architecture

```
 Employee phone (Android)                         Administrator (browser)
 +-----------------------------+                  +-----------------------------+
 | React Native app            |                  | Next.js admin panel         |
 |  - queue, dialer, contacts  |                  |  - runs on the server; keeps|
 |  - own call screen (Kotlin) |                  |    the sign-in in httpOnly  |
 |  - SQLite: offline copy +   |                  |    cookies, forwards /api/  |
 |    queue of unsent work     |                  |    backend/* to the API     |
 +--------------+--------------+                  +--------------+--------------+
                |  HTTPS, JWT (15 min) + rotating refresh token  |
                v                                                 v
        +-------------------------------------------------------------+
        | Caddy (HTTPS front door; size limit per route)              |
        +------------------------------+------------------------------+
                                       v
        +-------------------------------------------------------------+
        | FastAPI  (2 workers)  - routers -> services -> SQLAlchemy   |
        |   background jobs: import / rebalancing / clean-up          |
        +-------+--------------------------------+--------------------+
                v                                v
        MySQL 8 (RDS in production)         Redis 7  (who is working, queues,
        - the truth                          caches with "epochs", heartbeat)
        recordings: private storage (local volume; S3 supported)
```

* **Layers in the API:** `app/api/v1/*` (routes, 93 handlers) -> `app/services/*` (the rules) -> `app/models/*` (tables). Cross-cutting: `app/core/*`
  (config, database, security, cache, errors).
* **Redis first:** the calls the phones make all day (heartbeat, queue, "who is calling") are answered from Redis; MySQL is touched when something is
  written. A cache can never be believed forever: writes bump an *epoch* (`settings`, `queue:all`, `admin:roster`, a per-employee epoch) and readers
  compare it. A direct database write bypasses that - after one, call `cache.bump(db, EPOCH)`.
* **Offline-first app:** every step of a call is written to the phone's SQLite first and then synced with an idempotency key (`client_call_id`) and
  exponential back-off, so a killed app or a lost connection never loses a call and a retry never makes a second one.
* **Roles:** `admin`, `manager` (sees the team they belong to), `employee` (sees only their own contacts and calls). Authorization is enforced in the
  services and is covered by a matrix test (`test_authorization_matrix.py`).

## 3. What each part does

### 3.1 Employee app (Android)

* Sign in with employee id or e-mail; a temporary password must be changed; tokens in the Android Keystore; the server can revoke a session; device binding.
* **Home**: progress ring towards the daily target, live numbers, next contacts. **Queue**: due callbacks first, then by priority, with retry rules for
  *no answer* / *busy*; a search over all assigned contacts.
* **Dialer and contact screen**: keypad that recognises a CRM contact; notes; callbacks; call history; (for a person with several numbers) a **Numbers**
  list with a Call button on every number, how often each was called and answered, *Main* and *Next to call*.
* **Real calls**, two ways (see [TELEPHONY.md](TELEPHONY.md)): through the phone's own dialer, or - recommended - **the app as the phone app**: its own
  call screen (mute, hold, speaker, keypad, notes, customer details), incoming-call screen over the lock screen, notification, floating call bubble, exact
  answer time and disconnect cause, SIM chooser. Either way an **outcome is required** after the call.
* **Phone setup wizard** (two stages) for every permission a phone app needs, with Xiaomi / HyperOS pages; a *Device & telephony check* screen.
* **Recording** (off until an administrator enables it): see section 13 - Android does not allow an ordinary app to record the other side of a call.
* The Kotlin layer: `CallManager`, `AppInCallService`, `CallRecorder`, `FloatingBubble`, `CallNotifications`, `CrmLookup`, `OemSettings` and others in
  `mobile/android/app/src/main/java/com/employeecalling/`.

### 3.2 Backend API

* Authentication (rotating refresh tokens, stolen-token detection, sign-in limits per address and per account), employees, teams, device binding, a heartbeat that says
  what the phone reports about itself (battery, network, permissions, unsent work).
* Contacts (search by name, **any** of the numbers, relative, voter id, pincode, address), campaigns, assignment (one active owner per contact - enforced by a
  unique index), the calling **queue**, calls and their events, outcomes (dispositions), notes, callbacks, recordings, notifications, settings, audit log.
* **Dashboard, analytics, follow-ups** (below), **bulk import and sharing**, **rebalancing**, the **password vault**.

### 3.3 Admin panel

Dashboard (live) - Employees (create one by one or from a sheet, details, password shown again, login sheet) - Calls - Recordings - **Follow-ups** -
Contacts (import wizard) - Campaigns - Teams - **Work sharing** - Audit log - Settings. Light and dark, works on a phone. Details: [ADMIN_PANEL.md](ADMIN_PANEL.md).

## 4. The rules that matter (and where they live)

| Rule | Where |
|---|---|
| **A conversation** = employee x phone number; its *latest response* = the outcome of the latest call that has one. A **follow-up** = a callback (pending / done / cancelled; overdue = pending and due). | `services/followup_service.py`, [ADMIN_PANEL.md](ADMIN_PANEL.md) |
| **Eleven outcomes** are defined by the server: Connected, No answer, Busy, Switched off, Invalid number, Interested, Not interested, Callback, Follow-up, Completed, Do not contact. Some need a callback time. (The app's outcome screen currently offers four of them: Connected, No answer, Busy, Switched off.) | `services/reference_data.py`, `services/call_service.py` |
| **Retry rules**: a contact that did not answer comes back after a configurable wait (settings). | `services/settings_service.py`, `services/queue_service.py` |
| **Who is working**: seen within `inactive_after_days` (default 2) by a sign-in, a token renewal or a heartbeat; a new account counts as working. | `services/activity.py` |
| **Equal sharing**: *n* contacts between *k* people = *n ÷ k* each, the remainder one each to the lightest. *Even out the work* is the alternative. Somebody who is not working gets nothing; what was waiting with them is shared out again (by hand, or automatically every 10 minutes). | `services/distribution.py`, `services/rebalance_service.py`, [IMPORT_AND_DISTRIBUTION.md](IMPORT_AND_DISTRIBUTION.md) |
| **Everybody gets the same, also somebody who comes later**: the contacts nobody has called yet (still `new`, no callback) are shared again equally between everybody who is working (difference at most one; who gives, gives the newest; nothing that was started on moves). By hand (*Give everybody the same*) or by itself within a minute when a working employee owns no contact at all (setting `auto_level`, default on). | `services/level_service.py`, [IMPORT_AND_DISTRIBUTION.md](IMPORT_AND_DISTRIBUTION.md) |
| **No number twice**: three levels - inside the sheet, against the contacts, and a unique index at the moment of writing. The phone number alone decides - never the name: every different number is a contact. | `services/import_service.py`, table `contact_phones` |
| **One person, many numbers** (voter list) - **only when asked for** (`group_people`): rows with the same name, relative, age, gender, pincode and address are one person; two EPIC numbers are two people; a number on rows of different people goes to the first row; a contact lists at most 20 numbers and a person with more gets a second contact, so no number is lost. The number to dial next is the one answered last time, else the one tried the fewest times. | `services/import_rows.py`, `services/import_service.py`, `services/contact_numbers.py` |
| **A wrongly added sheet can be taken away**: only the contacts nobody has touched (no call, note, callback; still `new`); the numbers are free again. | `services/import_undo.py`, `scripts/remove_import.py` |
| **Password vault**: a handed-out first password is stored encrypted (Fernet, key derived from `JWT_SECRET`) so an administrator can look at it again, until the employee chooses their own, the account is deactivated, or 30 days pass. Every look is audited. | `services/credential_vault.py` |
| **Audit log** is append-only; audit rows are never deleted on purpose. | `services/audit_service.py` |

## 5. Data model

26 tables, 7 Alembic migrations (`0001` initial schema ... `0007` people with many numbers).

| Group | Tables |
|---|---|
| People and access | `roles`, `teams`, `employees`, `employee_sessions` (refresh tokens), `employee_devices`, `employee_credentials` (the vault) |
| Contacts | `contacts` (+ voter columns `relative_name, age, gender, epic_no, pincode, address`, `person_key`), `contact_phones` (every number; **unique** `normalized_phone`), `contact_assignments` (one active owner: unique `active_contact_id`), `campaigns`, `campaign_contacts`, `campaign_assignees` |
| Calling | `calls`, `call_events`, `call_dispositions`, `call_notes`, `callbacks` |
| Recordings | `recordings`, `recording_access_logs` |
| Import and sharing | `imports` (resumable: lease + heartbeat + absolute resume offset), `import_rows`, `distribution_runs` |
| System | `notifications`, `audit_logs`, `settings` |

## 6. API

93 route handlers under `/api/v1`, grouped as `auth`, `me`, `employees`, `teams`, `contacts`, `contacts/import`, `campaigns`, `queue`, `calls`,
`callbacks`, `recordings`, `notifications`, `dashboard`, `analytics` (employees, **followups**, conversations, live), `distribution`, `settings`, `audit-logs`.
The machine-readable description is generated, not written by hand:

```bash
cd backend && python -m scripts.export_openapi openapi.json     # the whole API as OpenAPI 3
```

and the admin panel's TypeScript types are generated from it (`admin-web/src/lib/api-types.ts`). CI fails when the file is not current. **Generate it with
the dependency versions of `backend/requirements.txt`** (a clean virtual environment); an older FastAPI writes a slightly different file and CI rejects it.
`/docs` (Swagger) is on in development and off in production.

## 7. Security

* Passwords hashed (bcrypt), sign-ins rate limited, refresh tokens rotate and a stolen one is detected, sessions can be revoked, optional device binding.
* The panel keeps the sign-in in `httpOnly` cookies and sends state-changing calls only with a header a foreign site cannot add (CSRF); recordings are
  played through short-lived signed links and every listen is audited.
* Uploads: extension and size checked while the file arrives, private random file names, free disk checked first; `.xlsx` macros, passwords, zip bombs and
  XML entity bombs are refused before anything is unpacked; formulas are never evaluated; the lists of problem lines neutralise spreadsheet formulas.
* The production stack: no extra Linux capabilities, `no-new-privileges`, read-only API filesystem, Redis with a password, a database user that reaches only
  its own database, TLS to the database verified with the RDS bundle, a per-route request-size limit in Caddy.
* CI scans: known vulnerabilities in the dependencies (`pip-audit`, `npm audit`), static analysis (`bandit`), an API fuzz test of thousands of generated
  requests, and a container-image scan.
* Never commit `.env`; `JWT_SECRET` must be 32+ characters (the API refuses to start in production without). Details: [PERFORMANCE_AND_SECURITY.md](PERFORMANCE_AND_SECURITY.md).

## 8. Performance and capacity (measured)

| What | Result | Where measured |
|---|---|---|
| 500 employees, 100,000 contacts, 500 phones calling for 150 s | 13,155 requests, **0 errors**, p95 300 ms | CI load test (MySQL + Redis, production layout) |
| 150 phones with a call every ~2.5 s (about 5x a real day) | 122 requests/s sustained, 0 errors | CI |
| Import of **1,000,000 rows** (66 MB), 100,000 contacts before | check 216 s, add 268 s, **44,098 or 44,099 each** (20 employees), 215 MB peak | local MySQL 8.4 |
| Voter list of **209,395 rows** (8 columns) | **53,304 people with 161,244 numbers**; `123 bad + 48,528 repeats + 160,744 numbers = 209,395`; check 25.8 s, add **14.8 s**; 206 MB peak | local MySQL 8.4 |
| The same real list **by number** (the default since 2026-10-09; 209,395 rows) | **129,675 contacts = the 129,675 different numbers** (0 differences, one number per contact), shared 63,837 / 63,838; check 40.4 s, add 26.1 s; a third employee joins and everybody has 42,558 or 42,559 in 6.9 s; 185 MB peak | local MySQL 8.4 (`scripts/number_check.py`) |
| 300,000-row import | add 62 s (4,261 contacts/s), 159 MB peak | local MySQL 8.4, CI |
| Production, 20,000 lines on the shared 2-vCPU server and RDS | check 4.2 s, add 9.3 s, exactly equal | production self-test |
| Production, the real 209,395-row list by number (2026-10-10) | check 60.6 s, adding about 110 s (about 1,200 contacts/s); **129,675 contacts, exactly the numbers of the file** (hash compared), shared 64,838 / 64,837; API 190 MiB | production, CLI inside the API container |

The server was shared (2 vCPU, 3.8 GB, other projects on it; RDS `max_connections` 61): the system uses at most 9 database connections. Never load-test a shared
production.

## 9. Tests and CI

Final counts: **backend 497 tests** (the same suite on SQLite and on MySQL 8.4), **app 161 Jest tests**, **panel 116 Vitest tests** plus a Playwright browser
suite that drives the real panel against a real API (and plays the part of an employee's phone), `bandit`, `pip-audit`.

`.github/workflows/`:

| Workflow | What |
|---|---|
| `ci.yml` (12 jobs) | API on SQLite and MySQL 8.4; app types / lint / tests; panel types / lint / tests / build; "panel and API agree"; browser tests; the production Docker stack and the shared-server stack (with a real 12 MB sheet through the front door); security scan; load test; API fuzz; **import at scale** (300,000 rows, an Excel file, a voter list put together by person, and a voter list by number with a late employee) |
| `android.yml` | the signed release APK (arm64) -> Releases; an x86_64 build for an emulator (never published) |
| `deploy.yml` | after CI is green on `main`: images -> SSH to the server -> pull exactly that commit -> restart -> wait until healthy -> check the public address; **a bad deploy puts the running version back by itself** |
| `certificate.yml` | renews the HTTPS certificate every Monday when it has less than 30 days left |

Also in the repository: scripts that prove things on a real database - `scripts/scale_check.py`, `scripts/voter_check.py`, `scripts/number_check.py` (a list by
number: the numbers in the database must be exactly the numbers of the file), `scripts/loadtest.py`, `scripts/selftest_sharing.py` (a self-cleaning test for a live
server); and `scripts/remove_import.py` (take a wrongly added sheet away again).

## 10. How it was deployed

"Shared-server mode": an existing EC2 Ubuntu server that also ran other projects, and an RDS MySQL shared with them. Only this project's own parts were used:

* containers `calling-api`, `calling-admin`, `calling-redis`, `calling-caddy` (Compose project `calling`) under `~/calling`; one HTTPS port of its own (**8445**);
* a database `Calling_db` and a dedicated user `calling_app` that could reach only that database (connection limit 12);
* images built by GitHub Actions (GHCR) and only pulled by the server; a restricted SSH deploy key (`command="…/ci-entry.sh",restrict`) that could run two things;
* a Let's Encrypt certificate for `13-205-79-72.sslip.io` (the IP with dashes - a free name). At first it was obtained and renewed by this project (certbot, through the
  server's nginx, renewed weekly). Since the restart (2026-10-09) the **Caddy of another project** on the server owns ports 80 and 443 and keeps a certificate for the same
  host name; this project uses **that** certificate through a read-only mount of the one folder (`deploy/shared/link-external-cert.sh`, see [DEPLOYMENT.md](DEPLOYMENT.md)).

The full description is [DEPLOYMENT.md](DEPLOYMENT.md); the pipeline is [CICD.md](CICD.md).

## 11. Restart from scratch

**A. On a PC (development).**

```powershell
.\scripts\dev-backend.ps1                      # API on http://localhost:8000 (SQLite, demo data)
cd admin-web ; npm install ; npm run dev       # panel on http://localhost:3000   (admin@example.com / Admin@12345 - demo only)
cd mobile ; npm install ; npx react-native start ; npx react-native run-android
```

**B. A server of its own** (everything in Docker): `sudo bash deploy/install.sh` - it asks for the domain and an administrator e-mail and does the rest
([DEPLOYMENT.md](DEPLOYMENT.md), first sections).

**C. A shared server with RDS**: `deploy/shared/` - create the database user (`create-database-user.sh`), write the settings (`setup.sh`), issue the
certificate (`issue-cert.sh` - or, when another project owns ports 80 / 443 and keeps a certificate for the same host name, `link-external-cert.sh`), then `deploy.sh`;
add the four `DEPLOY_*` secrets to GitHub and put the restricted key line into `~/.ssh/authorized_keys`.

**D. The APK.** Pushing a `v*` tag, or *Actions -> Android APK -> Run workflow*, builds a signed APK on GitHub. It needs the four signing secrets
(`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`) and the variable `API_URL`. **The keystore is the one thing that cannot be rebuilt:**
an APK signed with another key cannot be installed over the old app. A secret on GitHub cannot be read back; the original is `mobile/android/app/release.keystore`
on the owner's PC (git-ignored). It is listed in the shutdown record (section 15).

**E. The data.** The production database `Calling_db` was not deleted at the shutdown, and the restart on 2026-10-09 used it as it was (section 15). If it is dropped, a restart
begins with an empty database (`python -m scripts.bootstrap` creates the schema and the first administrator).

## 12. Release history

All APKs are signed with the same key (certificate SHA-256 `1730774eedb923e4cdc826f68e81ca2b9f826927ab4f7e7cabd785381122f185`), so each installs over the previous one.

| Version | Published (UTC) | What |
|---|---|---|
| 1.0.0 | 2026-10-01 07:55 | first signed APK; it starts with a PC on the office network (`http://192.168.0.103:8000`): queue, dialer, own call screen, offline sync, outcomes, callbacks |
| 1.0.1 | 2026-10-01 10:35 | a second build the same day (the commit log between `v1.0.0` and `v1.0.1` lists the fixes) |
| 1.1.0 | 2026-10-02 06:34 | the first APK that starts with the production server (`https://13-205-79-72.sslip.io:8445`) |
| 1.2.0 | 2026-10-02 13:45 | Redis-first API, the phone's heartbeat, security hardening, load / fuzz / security checks in CI, the reviewed UI updates (pull requests #1 and #2) |
| 1.3.0 | 2026-10-03 12:45 | everything after: bulk import with equal sharing, rebalancing and the password vault (#4); the front-door fixes (#5, #6, #7, #3); the follow-up dashboard (#8); **one person = one contact with all numbers**, the voter list, a 26x faster import, the app shows every number (#9) |

Pull requests merged into `main`: #1 (with #2), #4, #6, #5, #7, #3, #8, #9, in that order; after the last Release: #10 (the closing documentation), #11 (the shared certificate),
#12 (the restart record) and #13 (import by number, a fair share for an employee who comes later) - none of them changes the app, so `v1.3.0` is still the one to install.

## 13. Known limits (stated honestly)

* **Call recording.** Android does not let an ordinary app capture a phone call: during a call most phones give the microphone only silence. The app
  *tries* in phone-app mode, deletes a silent file instead of uploading it and says why there is none. A recording of **every** call needs cloud telephony
  (Exotel / Knowlarity / MyOperator / Twilio): the call is connected from their servers, and they record both sides. An accessibility-service hack was left out on purpose
  (Play Protect blocks such APKs). See [TELEPHONY.md](TELEPHONY.md).
* **Not verified on real hardware.** Everything was tested on an Android emulator (virtual SIM and modem) and by tests. A real SIM call, dual-SIM, Bluetooth, the
  proximity sensor, and the Xiaomi lock-screen pages were **not** checked on phones - in particular none of the people-with-many-numbers features. The people that
  used the production system (two employee phones) used the earlier versions.
* **Play Store.** The app uses restricted permissions (`READ_CALL_LOG`, `ANSWER_PHONE_CALLS`, `RECORD_AUDIO`, the default-dialer role): distribute it as an
  internal APK / MDM, not through the public store.
* **The app cannot mark a "wrong number".** The server supports the outcome *Invalid number* and treats it per number, but the app's outcome screen does not offer
  it (it is folded into *Switched off*). The numbers of a person simply take turns, the least-called first.
* **With the option *Put the numbers of one person together*, a person is the same person only when name, relative, age, gender, pincode and address agree**
  (capitals and spaces aside). Age and gender are part of the identity: the same voter with a different age in another list is a new person. Two EPIC
  numbers are two people. Without the option (the default) the name is never looked at.
* **The equal sharing of a late employee only moves contacts nobody has started on** (still `new`, no callback). What an employee has already worked on
  stays with them, so a person who has done a lot of work can end up with more *in total* than the others, and a new employee is given a share of the
  *waiting* contacts only.
* **A million rows was not run on the shared RDS** (it would have taken ~6-7 minutes of writes on a shared database); it was proven locally. 209,395 rows of the
  real shape were proven locally; 20,000 rows on the real server.
* The app is Android only; there is no iOS build and no push notifications (phones poll and sync).
* **Not merged:** the branch `ui/calm-animations-and-fixes` (a calmer-animations variant of the app UI). It was cut before several newer changes and would have
  deleted newer code on `main`; it is kept on GitHub only as a reference.

## 14. What was learned (traps worth knowing)

1. **Caddy `request_body` nesting.** A site-wide `request_body { max_size }` is applied first and a larger limit inside a route cannot raise it (the smaller wins).
   Every sheet above 2 MB was refused until each limit was written *inside its own `handle` block*. `deploy/check_caddy_limits.py` now starts the real Caddy and tries it.
2. **A single-file bind mount is not updated by `git checkout`.** A new inode appears; the running container keeps the old file; Compose sees nothing to recreate.
   A changed Caddyfile therefore did nothing until `deploy.sh` was made to validate it in a throw-away container and recreate Caddy at every deploy.
3. **pymysql `executemany` and `on_duplicate_key_update`.** SQLAlchemy writes `VALUES (...) AS new ON DUPLICATE KEY ...`; pymysql's regular expression for batching
   does not know `AS new`, backtracks for seconds, and then sends **every row as its own statement**. The fix is a clause element rendered without the alias
   (`app/core/dbutil.py: KeepExistingRow`): adding 209,395 rows went from 386 s to 15 s. `tests/test_dbutil.py` guards it.
4. **Direct database writes bypass cache epochs.** Writing a `Setting` row directly left the 5-minute Redis copy stale. After a direct write, `cache.bump(db, EPOCH)`.
5. **A rate of 0 in a test is not proof.** The self-test and the browser checks of the real server were run through the **public URL**, because testing from inside
   the container never touches Caddy or the panel - that is how the two front-door bugs above were found.
6. **Generated API types depend on the library versions** that generate them (section 6).
7. **Do not infer infrastructure behaviour from one deploy.** A wrong conclusion about Compose recreating Caddy was written into a pull request and had to be corrected.
8. **Windows:** a deep native build folder stops at 260 characters (`-PnativeBuildDir=C:/rncxx`); never put a junction (`mklink /J`) inside a git worktree - removing the
   worktree follows it and deletes the target's files.
9. **Time zones:** the dashboards use the business timezone (`APP_TIMEZONE`, Asia/Kolkata); tests that use "now + 1 hour" fail in the last hour of the day.

10. **A shared server changes under you.** Between the shutdown and the restart the web server on ports 80 / 443 was replaced by another project's Caddy and a working copy (`~/calling`, with the settings and the certificate) was deleted by hand. Nothing of this project had been touched, but the way it got its certificate was gone. Keep the settings that cannot be recreated (the database password) where they can be read again, and prefer a certificate that does not depend on a port that somebody else may take over.

5. **Merging rows by name silently loses numbers (found 2026-10-09).** A list of 209,395 rows with 129,675 different numbers was added as 27,692 contacts: rows with
   the same name, relative, age, gender, pincode and address were merged into one person, and a person could list only 20 numbers, so 14,323 numbers were dropped
   without a word (one person had 124). The default is now one contact per different number, putting people together is an option, and even then a person with
   more numbers than fit gets another contact. `scripts/number_check.py` works out the expected numbers from the file alone and compares them with the database.
6. **A code ahead of the ids blocks every new employee.** `EMP` codes are `newest id + 1`; two administrators adding somebody at the same moment (the browser tests
   do) left a code *ahead* of the ids, and then every later *Add employee* answered "employee ID already exists" for good. The next code now skips codes that are taken,
   and a code that was made by the server (not typed) and is taken a moment later by somebody else is retried instead of refused.
7. **A sheet is shared between the people who are working at that moment.** Somebody who comes later got nothing, while a colleague kept thousands of contacts
   nobody had called. Now the waiting contacts are shared out again (the *level* service), by hand or by itself.

## 15. Shutdown and restart record

### Shutdown (2026-10-05)

The owner cancelled the project on 2026-10-05 and asked for it to be stopped on the server, with the code and the documents kept on GitHub only. The owner chose
**not** to sign in to AWS for this, so only what could be done from the server and from GitHub was done.

**Done (2026-10-05):**

* On the server `13.205.79.72`, the four containers of this project - `calling-api-1`, `calling-admin-1`, `calling-redis-1`, `calling-caddy-1` - were stopped
  and removed with `docker compose --env-file .env down` (from `~/calling/deploy/shared`; **no** `-v`, **no** `prune`). The Compose network `calling_default`
  went with them. Port **8445** no longer listens and `https://13-205-79-72.sslip.io:8445` no longer answers. The nine containers of the other projects on the
  server were not touched and kept running.
* On GitHub the **Deploy** and **Certificate** workflows were disabled, so a push cannot start the server again and the weekly certificate job does not try to
  reach it. CI and the Android build stay active. The code, the documents and all five APK Releases (`v1.0.0` ... `v1.3.0`) stay on GitHub.

**Not done - still in place (nothing was deleted):**

| What | Where | Note |
|---|---|---|
| The database `Calling_db` and the user `calling_app` | the shared RDS (`padavidhar-production-mysql`, ap-south-1) | Holds the production data (3 employees, 2 contacts, 7 calls, the audit log; no recordings). **Never delete the RDS instance - other projects use it.** To remove this project only: `DROP DATABASE Calling_db; DROP USER 'calling_app'@'%';` as the RDS master user |
| Docker volumes `calling_api_data`, `calling_caddy_data`, `calling_caddy_config`, `calling_redis_data` | the server | about 2.4 MB in all; `docker volume rm` each |
| Docker images `ghcr.io/maheshofficelokmangalgroup-tech/call/{api,admin}:sha-*` (and the base images `caddy:2`, `redis:7-alpine`) | the server | up to about 2 GB (layers are shared); `docker rmi` them. Never `docker system prune` on that server |
| `~/calling` (a clone of this repository, `deploy/shared/.env` with this project's secrets, the Let's Encrypt certificate in `deploy/shared/letsencrypt`) | the server | `rm -rf ~/calling` |
| The restricted deploy key (`command="/home/ubuntu/calling/deploy/shared/ci-entry.sh",restrict ssh-ed25519 ...`) | the server's `~/.ssh/authorized_keys` | delete that one line (the line of another project's key `github-actions-deploy` must stay) |
| The inbound rule for port **8445** | the EC2 security group of the server | close it in the AWS console |
| The secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, the signing secrets (`KEYSTORE_*`, `KEY_*`) and the variables `API_URL`, `PUBLIC_URL` | GitHub: Settings -> Secrets and variables -> Actions | harmless while the Deploy workflow is disabled. The signing key cannot be read back from GitHub |
| The APK signing keystore, `mobile/android/app/release.keystore`, and the original project document `Employee_Calling_CRM_Platform_Project_Documentation.docx` | the owner's PC (git-ignored) | the only copies; keep them if the app may ever be released again |

**To start it again** (all that was removed are the containers): on the server `cd ~/calling/deploy/shared && bash deploy.sh` brings the stack back with the
same database, volumes and certificate (the certificate has 90 days: run `bash renew-cert.sh` if it is older); enable the **Deploy** and **Certificate** workflows in
GitHub (*Actions*) to have it update itself again.

### Restart (2026-10-09)

On 2026-10-09 the owner asked for the project to be deployed again on the same server, "as it was", and gave the RDS master password for the one step that needs it.

**What was found:** nothing of this project had been deleted at the RDS or in Docker (database, volumes, images were as left), **but `~/calling` on the server was gone** - the
shell history of the server's `ubuntu` account shows `rm -rf calling/` and `sudo rm -rf calling/` on 2026-10-05 / 06, not done by the shutdown - and with it the settings file
(`.env`: the database password, `JWT_SECRET`, the Redis password) and the Let's Encrypt certificate. The server had also been restarted (2026-10-07), and **ports 80 / 443 now
belonged to the Caddy of another project** (`lmf-caddy`, project lokmangal-foundation) instead of the nginx the webroot certificate way goes through. The old database password
was not recoverable.

**What was done:**

1. `~/calling` was cloned again from GitHub and `deploy/shared/setup.sh` wrote a new `.env` with fresh secrets (so sign-ins made before are invalid: phones and the panel sign in
   again; the vault of first passwords held no entries).
2. The password of the database user `calling_app` was **reset** with the RDS master password (`create-database-user.sh`, the password given on standard input, used once, stored
   nowhere); the database `Calling_db` was untouched: Alembic `0007`, 26 tables, 3 employees, 2 contacts, 7 calls, the audit log - all there.
3. **The certificate:** a new one from Let's Encrypt was impossible without touching the other project (ports 80 / 443), but its Caddy already holds a valid certificate for
   the same host name `13-205-79-72.sslip.io` (valid to 2027-01-04). A small change was made for this (pull request #11): `deploy/shared/link-external-cert.sh` mounts **only that
   one folder, read-only**, `deploy.sh` and `renew-cert.sh` understand it, and CI tries it with the real Caddy. Nothing of the other project was changed or restarted.
4. `deploy.sh` started the four containers (images `sha-6335c3e`, then `sha-8ffcf7d` through the pipeline); the GitHub workflows **Deploy** and **Certificate** were enabled again and
   each was run once: the Deploy workflow built both images, updated the server through the restricted key and checked the public address; the Certificate workflow made Caddy
   load the certificate files again.

**Proven afterwards:** `https://13-205-79-72.sslip.io:8445` answers with a certificate that verifies; the production self-test (temporary administrator, ten temporary employees, sheets
and a voter list; it removes everything it made) passed every check and left the database exactly as it was; a browser check through the public address (sign-in, follow-ups, contacts, two
voter lists checked and cancelled) passed except one test script timing slip (the drawer was counted before it had loaded - the screenshot shows its numbers); the other projects on the
server kept running and were not restarted.

**What the owner accepts with this:** the certificate belongs to the other project - it must keep running and renewing it (about 30 days before the end, around 2026-12-05); if that
project stops using the host name, the certificate expires and this one has to be replaced (a real domain, or the other project's help to serve the Let's Encrypt challenge).
The RDS master password was written in a chat during the restart: it is worth changing. The APK `v1.3.0` needs nothing: it starts with the same address.

### Fix of the import and of the sharing (2026-10-10)

The owner reported two problems: a list of 2,09,395 rows had added only 27,692 contacts, and an employee who was added after the contacts were shared out got none.

**What was found (production, read-only):** import #30 (`Kolhapur -1.xlsx`, 209,395 rows) held 27,692 contacts with 115,352 numbers, all owned by EMP001; the second employee (EMP002)
had 0. The file has **129,675 different numbers** (79,720 rows repeat one). Rows of the same *person* (same name, relative, age, gender, pincode and address) had been put together
into one contact, and a contact lists at most 20 numbers: 14,323 numbers were dropped without a word (one person had 124). The second employee got nothing because a sheet is
shared between the people who are working *at that moment* and nothing ever shared again afterwards.

**What was changed (pull request #13, merge commit 47631a3, CI 12/12):** every different number is a contact of its own and the name decides nothing; putting the numbers of one person
together is an option that never drops a number; the contacts nobody has started on are shared again equally between everybody who is working - by hand (*Work sharing -> Give
everybody the same*) or by itself within a minute when a working employee has no contact at all (setting `auto_level`); `scripts/remove_import.py` takes a wrongly added sheet away;
`scripts/number_check.py` proves a list; a new employee could not be added after a code was ahead of the ids (fixed).

**What was done on production (with the owner's approval of each step):**

1. Deploy of `sha-47631a3` (Deploy workflow green, no migration). Within 19 seconds of the start the server shared the contacts by itself: **13,846 of the 27,693 waiting contacts went
   from EMP001 to EMP002** (before: 27,694 / 0).
2. `remove_import 30`: the dry run showed 27,692 contacts, **0 that anybody had touched**, 13,846 with each employee; `--yes` removed them with their 115,352 numbers. The 2 test
   contacts (import #13) stayed.
3. The same file was added again by number (import #31) from the command line inside the API container, from a copy that lived only in the container's memory disk (same sha256 as
   the original, removed afterwards): 209,395 rows, 0 bad, 79,720 repeats skipped, **129,675 contacts** given out **64,838 / 64,837** (EMP002 / EMP001).

**Proven afterwards:** the sha256 of the sorted numbers of import #31 on production equals the sha256 of the sorted different numbers of the file worked out separately from the
file alone (no number was printed or copied); every contact has exactly one number; 129,677 contacts and 129,677 different numbers in all (the 2 test contacts too); the
waiting contacts are 64,838 with each employee; the API log since the deploy has no error.

**Worth knowing:** the equal sharing only moves contacts nobody has started on, so somebody who has already called a lot can have more in total; the list of the rows that were
not added (here the repeated numbers) is kept 7 days in the import folder by design and then removed; the 2 test contacts are still there (delete them in the panel if not wanted).

## 16. Map of the other documents

| File | What |
|---|---|
| [`../README.md`](../README.md) | overview, how to install the APK, how to run everything on a PC |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | servers: all-in-one, shared server with RDS, CI/CD, troubleshooting |
| [`CICD.md`](CICD.md) | the four workflows, secrets, releases |
| [`ADMIN_PANEL.md`](ADMIN_PANEL.md) | what the administrator can do |
| [`IMPORT_AND_DISTRIBUTION.md`](IMPORT_AND_DISTRIBUTION.md) | import, equal sharing, rebalancing, the vault, people with many numbers, measured scale |
| [`PERFORMANCE_AND_SECURITY.md`](PERFORMANCE_AND_SECURITY.md) | how a request is served, protection, capacity, settings |
| [`TELEPHONY.md`](TELEPHONY.md) | calls on Android, the phone app mode, recording, permissions, emulator testing |
| `backend/`, `admin-web/e2e/README.md` | tests and how to run them |
