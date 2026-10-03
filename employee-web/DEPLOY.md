# Deploying the employee web app

The web app is **static files** (the built React app) plus a small web server (Caddy) that forwards `/api/v1/*` to the API. It has
no database and keeps nothing on the server. It is one container, built from this folder; everything it needs is in here:

| File | What it is |
|---|---|
| `Dockerfile` | builds the app with Node, then serves it with Caddy (one small image) |
| `deploy/Caddyfile` | the web server: files, `index.html` for every page address, `/api/v1/*` → the API, security headers |
| `docker-compose.yml` | run it on its own (option A) |
| `docker-compose.on-stack.yml` | run it next to the project's own stack, on the same server (option B) |
| `.env.example` | the settings (copy to `.env`) |

## Before anything: update the API first

The web app signs in with `platform: "webapp"`. **The API must be the version that knows it** (`backend/app/services/auth_service.py`:
`WEB_APP_PLATFORM`). An older API would register every browser as a phone. Deploy the backend, then the web app.

## Option A - on its own (another server, another domain, or another port)

```bash
cd employee-web
cp .env.example .env        # set API_UPSTREAM (where the API is) and SITE_ADDRESS
docker compose up -d --build
docker compose logs -f
```

| Setting (`.env`) | Meaning |
|---|---|
| `API_UPSTREAM` | the API as this container sees it, no trailing slash: `https://calling.example.com` (its public address) or `http://api:8000` |
| `SITE_ADDRESS` | `:80` = plain http (office network; employees open `http://<server>:<HTTP_PORT>`), or a domain such as `app.example.com` = **HTTPS by itself** (the domain must point at this server and ports 80/443 must be free) |
| `HTTP_PORT`, `HTTPS_PORT` | ports on the server (keep 80/443 for a domain) |
| `ACME_EMAIL` | e-mail for the certificate (domain only) |
| `APP_VERSION` | shown on the Profile page |

Check it: open the address, sign in with an employee ID. `docker compose ps` should say `healthy`.

> **Sign-in limit when the API is on another server.** The API limits sign-ins to **30 per minute per address** (`RATE_LIMIT_LOGIN_PER_IP`).
> In option A the API's own front door sees only *this* server's address, so every employee who signs in through the web app counts
> as one address: 300 employees starting work at 9:00 would be told "Too many attempts". On the API server add
> `RATE_LIMIT_LOGIN_PER_IP=600` to `.env.production` and run `bash deploy/update.sh`. The per-account limit (10 tries per 5 minutes)
> still stops password guessing. Option B does not need this.

## Option B - next to the project's stack, on the same server

The stack's front door (Caddy) owns ports 80 and 443, so the web app gets a **domain of its own** (for example `app.example.com`,
pointing at the same server) and the front door hands it over. The visitor's real address then reaches the API, so the sign-in limit
counts every employee separately.

1. Start the web app on the stack's Docker network (no port is published):

   ```bash
   cd employee-web
   docker compose -f docker-compose.on-stack.yml up -d --build
   ```

2. In `deploy/Caddyfile` (the stack's front door), add a block **after** the existing one:

   ```caddy
   app.example.com {
   	reverse_proxy employee-web:80
   }
   ```

3. Load it: `bash deploy/update.sh` (it tries the new Caddyfile in a throw-away container first and then restarts the front door),
   or `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --force-recreate --no-deps caddy`.

Caddy gets the certificate for `app.example.com` by itself (the domain must already point at the server).

## Updating and going back

```bash
git pull
docker compose up -d --build          # (option A)   or   docker compose -f docker-compose.on-stack.yml up -d --build   (option B)
```

To go back to an earlier version: `git checkout <commit>` and run the same command. Employees keep their sign-in across an update
(the session lives in the API and in their browser). A page that was open during the update asks for files of the old version; they
are gone after a reload - nothing is lost.

## Trying it without Docker (a demo, or this PC)

```bash
npm ci
npm run build
BACKEND_URL=http://127.0.0.1:8000 npm start     # serves dist/ on :5173, forwards /api/*, sends the security headers
```

## What was checked, and what was not

Checked on the machine this was written on: the app builds with exactly the commands the Dockerfile runs (`npm ci`, `npm run build`),
80 unit tests, 12 browser tests (phone and computer size) against this web server and the current API, and the Caddyfile with a real
Caddy (valid, formatted, serves the app and every page address, answers 404 for a missing file under `/assets/`, forwards the API,
keeps the visitor's address in `X-Forwarded-For` when a front door passes it on).

**Not run:** `docker build` and `docker compose` - that machine has no Docker - so the Dockerfile and both compose files are written
to the documented behaviour and have not been started. Run option A or B once on the server and look at `docker compose ps` and the
logs before telling employees. The web app is also **not** part of the project's CI or of the GitHub deploy workflow (`.github/`): it
is built on the server, not as a prebuilt image.

## Good to know

* **HTTPS** is recommended (the sign-in goes over the network). The app works on plain http too (an office network), including the
  Call button (a `tel:` link) and copying the number.
* **No recordings.** A browser cannot record a phone call; calls made here show *Not recorded* and the admin panel's recording report
  lists them as *Made from the web app*.
* **Accounts bound to one phone** (device binding in the admin panel) cannot sign in to the web app - by design.
* Settings are read when the container starts: change `.env`, then `docker compose up -d`.
