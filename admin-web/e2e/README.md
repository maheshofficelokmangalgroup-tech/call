# Browser tests

Playwright drives a real browser through the real panel, which talks to a real API holding demo data. Some tests also play the part of
an employee's *phone* (`phone.ts`): they sign in to the API like the mobile app, dial, answer, hang up and upload a recording, and then
check that the panel shows it.

## Run them

```bash
# 1. an API with demo data (from ../../backend) - a throw-away database, never your real one
export DATABASE_URL=sqlite:///./var/e2e.db LOCAL_STORAGE_PATH=./var/e2e-storage REDIS_URL= RATE_LIMIT_LOGIN_PER_IP=1000
python -m scripts.bootstrap && python -m scripts.seed_demo --employees 10 --contacts 600 && python -m scripts.seed_history --rename
python -m uvicorn app.main:app --port 8002

# 2. the panel, built and started against it (from ..)
BACKEND_URL=http://127.0.0.1:8002 npm run build
PORT=3100 HOSTNAME=127.0.0.1 COOKIE_SECURE=false npm start

# 3. the tests (from ..)
npx playwright install chromium                   # once (or: PW_CHANNEL=chrome to use the Chrome that is installed)
E2E_BASE_URL=http://127.0.0.1:3100 E2E_BACKEND_URL=http://127.0.0.1:8002 npx playwright test
npx playwright test e2e/calls.spec.ts --project=desktop       # one file
npx playwright show-report                                    # after a failure: screenshots and traces
```

`desktop` runs every spec except `mobile.spec.ts`; `mobile` runs that file on a phone-sized screen.

## What is covered

| File | |
|---|---|
| `auth.spec.ts` | wrong password, the button, administrator and manager sign-in, employees refused, returning to the page asked for, no open redirects |
| `dashboard.spec.ts` | numbers equal the API's, every section, period choice is remembered, a phone's call appears live then in the latest calls, search, dark mode, manager scope |
| `employees.spec.ts` | list, search, chips, export; **creating an employee** (credentials shown once, WhatsApp link, the login really works against the API), duplicate e-mail, typed password, a new manager must change the password, **sheet import** with a login sheet, edit / reset password / deactivate / activate, profile tabs |
| `calls.spec.ts` | list, filters, sort, search, **the call panel with timing and a recording that plays** (seek, speed, download), reasons for missing recordings, CSV export |
| `recordings.spec.ts` | the library, one player at a time, still-uploading recordings, coverage, employee filter |
| `crud.spec.ts` | teams, contacts (create / edit / notes / assign / delete / **import**), campaigns, settings, audit log |
| `security.spec.ts` | no data without a session, `httpOnly` cookies, blocked routes and CSRF, security headers, manager limits, signed recording links with ranges |
| `mobile.spec.ts` | menu, cards instead of tables, no sideways scrolling on any page, full-screen call panel |

The tests create their own data with unique names, so they can be run again and again against the same database. Calls use the
fictional `555-01xx` numbers.
