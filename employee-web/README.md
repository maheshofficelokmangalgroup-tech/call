# Employee web app

The phone app in a browser: sign in, today's calls, contact pages, calls, outcomes, callbacks, history, notifications, profile.
React 19 · TypeScript · Vite · React Router · TanStack Query. It looks and reads like [`../mobile`](../mobile) (same colours, wording
and screens) and talks to the same API (`../backend`). The admin panel is a different app: [`../admin-web`](../admin-web).

## What is different from the phone app

| | Phone app | Web app |
|---|---|---|
| Calling | dials through a SIM, detects ringing / answer / end | "Call" registers the attempt, then hands the number to the device's phone app (a `tel:` link). The employee comes back and presses **Call ended**. On a computer the number can be copied. |
| Talk time | measured by the phone | starts from the stop-watch the page keeps and can be corrected on the outcome page |
| Recording | automatic | **not possible in a browser.** Calls made here show "Not recorded" and appear in the admin panel's recording report as *Made from the web app* |
| Offline | queues everything and syncs later | none: a banner says the server cannot be reached and the page retries |
| Phone setup, SIM choice, telephony check | yes | not applicable |

Everything else is the same: the dashboard cards open the lists they count (`/history?filter=connected`), the queue lists
contacts left over from earlier days first, an outcome is one of Connected / No Answer / Call Back / Switched Off, and **Feedback**
(Supportive / Neutral / Negative) appears only for a connected call and is saved as the first line of the notes.

## Run it

```bash
# the API with demo data (from ../backend)
python -m scripts.bootstrap && python -m scripts.seed_demo
python -m uvicorn app.main:app --port 8000

# the app (from here)
npm install
npm run dev                    # http://localhost:5173      EMP001 / Employee@123
```

The browser only ever talks to its own address: Vite forwards `/api/*` to the API (`BACKEND_URL`, default
`http://127.0.0.1:8000`), so there is no CORS to set up. `npm run dev:lan` / `npm start` also listen on the network, so a phone on the
same Wi-Fi can open `http://<this computer's address>:5173`.

```bash
npm run build                  # dist/ - static files
BACKEND_URL=http://127.0.0.1:8000 npm start      # serves dist/ and forwards /api/*, with the security headers
```

## Put it on a server

Everything for deploying is in this folder: `Dockerfile`, `deploy/Caddyfile` (the web server), `docker-compose.yml`,
`docker-compose.on-stack.yml` and `.env.example`. **Step by step: [DEPLOY.md](DEPLOY.md)** - on its own (option A) or next to the
project's own stack on the same server (option B). Deploy the API first: it must be the version that accepts the login platform
`webapp` (`backend/app/services/auth_service.py`).

The browser talks to one address only: the web server in the container serves the files and forwards `/api/v1/*` to the API, so there
is no CORS to set up. (To build for an API on another address, use `VITE_API_BASE=https://api.example.com`, add the app's address to
`EXTRA_CORS_ORIGINS` of the API and widen `connect-src` in `deploy/Caddyfile` - not needed otherwise.)

## How it works

* **Sign-in** uses the same `/auth/login` as the phone, with `platform: "webapp"`. The API opens a session for it but never registers a
  device, and refuses an account that is bound to one phone (`device_binding_enabled`) so the browser is no way around the binding.
  The admin panel uses `platform: "web"` and is for administrators and managers only.
* **Tokens** are kept in `localStorage` (so a reload or a second tab stays signed in) and renewed one at a time, also across tabs. The page loads
  no third-party script, and the server sends a strict Content-Security-Policy: that is what protects them. Signing out in one tab
  signs out the others.
* **Calls** (`src/lib/callFlow.ts`): `POST /calls` with a client-made id, a `dialing` event, then on the outcome `connected` + `ended` events
  (carrying `recording: "web"`) and `POST /calls/{id}/disposition`. All of it is safe to repeat. The call in progress is remembered in
  `localStorage`, so a reload does not lose it; a call left without an outcome shows on Home as *waiting for an outcome*.
* **Data**: `src/lib/queries.ts` (one TanStack Query hook per resource, refreshed every minute and when the tab is shown again).
* **No animation**: screens, sheets, buttons and the tab bar change at once (only the loading spinner turns).
* **Layout**: bottom tab bar on a phone, side menu on a computer; sheets slide up from the bottom on a phone and sit in the middle on a computer.

## Phones

Looked at, page by page (16 pages), at 280 (a folded Galaxy Fold), 320, 360, 375, 390, 412, 430, 768 (tablet) and 844 x 390 (a phone held
sideways); none of them needs sideways scrolling, and `e2e/responsive.spec.ts` keeps it that way for the three smallest sizes.

* **Small phones** (up to 380 px): tighter cards, the phone number and city wrap instead of showing "...", and at 300 px the dashboard cards
  put the icon above the number. **Short screens**: the dial pad shrinks so the Call button stays above the navigation bar.
* **Phone held sideways**: the call-in-progress page, the dial pad and the sign-in page use two columns; content stays out from under the camera notch.
* **iPhone**: text boxes are 16 px (a smaller one makes Safari zoom the page in when it is tapped); `100vh` fallbacks for iOS before 15.4;
  "Add to Home Screen" uses `apple-touch-icon.png`. **Android**: `icon-192.png` / `icon-512.png` in `manifest.webmanifest`.
* The app has a light design only (`color-scheme: light`), so a forced dark mode does not invert it.

**Not tested on a real device:** iPhone Safari, Android Chrome, Samsung Internet, a phone with the system font set to "largest", and a
real `tel:` hand-over to the phone app. The sizes above were checked in Microsoft Edge with a phone-sized window.

## Checks

```bash
npm run typecheck
npm run lint
npm test                       # unit and component tests (Vitest)
npm run build

# browser tests against a RUNNING app + API with the demo data (they place calls: demo data only)
BASE_URL=http://127.0.0.1:5173 PW_CHANNEL=msedge npm run e2e
```

A headless browser cannot answer the prompt a `tel:` link raises, so the browser tests set `localStorage["ec_web_no_dialer"] = "1"`,
which makes the app skip opening the dialer.
