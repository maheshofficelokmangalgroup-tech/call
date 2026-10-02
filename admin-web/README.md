# Admin panel

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · TanStack Query · Recharts · Motion · Radix UI.
What it does for people: [../docs/ADMIN_PANEL.md](../docs/ADMIN_PANEL.md). How to run it on a server: [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md).

## Run it

```bash
# the API with demo data (from ../backend)
python -m scripts.seed_demo && python -m scripts.seed_history --rename
python -m uvicorn app.main:app --port 8000

# the panel
cp .env.example .env.local      # BACKEND_URL=http://127.0.0.1:8000
npm install
npm run dev                     # http://localhost:3000   admin@example.com / Admin@12345
```

`npm run build && npm start` runs the production build (the same one the Docker image contains).

## How it is built

* **The browser never holds a token.** Signing in goes through `src/app/api/auth/*`; the access and refresh tokens live in `httpOnly`
  cookies. Everything else goes through `src/app/api/backend/[...path]` - a proxy that adds the token, renews it once (concurrent
  requests share one refresh), forwards the call to FastAPI and streams the answer (recordings with `Range` support). It refuses the
  backend's own `auth/*` routes and any change that lacks the `x-requested-with: admin-web` header (CSRF).
* **Only staff may sign in** (administrators and managers). The backend enforces it for the `web` channel; the panel checks again.
* **Data**: `src/lib/queries.ts` (TanStack Query hooks, one per backend resource), types generated from the API's OpenAPI document
  (`src/lib/api-types.ts` - regenerate with `python -m scripts.export_openapi ../admin-web/openapi.json` in `backend/`, then
  `npx openapi-typescript openapi.json -o src/lib/api-types.ts`; CI fails when they drift apart).
* **Time**: the API sends UTC; dates are shown in the business time zone (`Asia/Kolkata` by default, from the server's settings).
* **Design**: tokens in `src/app/globals.css` (light + dark), primitives in `src/components/ui`, features in `src/components/domain`
  and `src/components/views`, charts in `src/components/charts`.

## Checks

```bash
npm run typecheck        # tsc, also covers tests and e2e
npm run lint             # eslint (max-warnings=0 in CI)
npm test                 # unit + component tests (Vitest)
npm run build            # production build; prerenders every page
npm run e2e              # browser tests, see e2e/README.md
```
