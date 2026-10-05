# CI/CD - APK वर build 

Four workflows live in [.github/workflows/](../.github/workflows):

| Workflow | When it runs | What it does | Time |
|---|---|---|---|
| `ci.yml` | every push to `main`, every pull request | API tests on SQLite **and MySQL 8.4**; app type-check, lint, Jest; admin panel type-check, lint, unit tests and a production build; "panel and API agree" (generated types are current); the panel in a **real browser** (Playwright) against a real API with demo data; the **production Docker stack** started and used (sign in, data, backup) | ~10-15 min |
| `android.yml` | push to `main` (app files), push of a `v*` tag, **Run workflow** button | builds the **signed release APK** (arm64) on GitHub's server | first build ~25 min, later ~8 min (cached) |
| `deploy.yml` | automatically when **CI is green on `main`** and the push changed the panel, the API or the deployment files; **Run workflow** (deploys what you type in *What to deploy*: a commit id, tag or branch; empty = the branch you picked. An older commit id is the way to **roll back**) | builds the panel and API images into `ghcr.io/<owner>/<repo>/{admin,api}`, then updates the server over SSH to exactly that commit and checks the public address | ~6-8 min |
| `certificate.yml` | every Monday, **Run workflow** | renews the server's HTTPS certificate when it has less than 30 days left | ~1 min |

Changes that only touch the panel, the server files or the docs do **not** start an APK build, and app-only changes do not start
a deployment.

### Server deployment secrets (`deploy.yml`, `certificate.yml`)

`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` (secrets) and the variable `PUBLIC_URL`
(e.g. `https://13-205-79-72.sslip.io:8445`; the workflow checks it answers after the update). Switch the automatic deployment off with
the variable `AUTO_DEPLOY=false`. The SSH key is a dedicated deploy key restricted on the server to two commands. See [DEPLOYMENT.md](DEPLOYMENT.md).

## how to download apk

* **Release (official):** repository -> **Releases** -> latest -> `EmployeeCalling-<version>.apk`.
  Fixed link that always points to the newest APK: `https://github.com/maheshofficelokmangalgroup-tech/call/releases/latest/download/EmployeeCalling.apk`
* **Every build:** repository -> **Actions** -> *Android APK* -> a run -> *Artifacts* (kept 30 days). Handy to test before releasing.

## How to build new release

```powershell
git tag v1.0.1
git push origin v1.0.1
```

GitHub builds the APK and publishes the Release `v1.0.1` by itself (about 8-25 minutes). Or use the web page:
**Actions -> Android APK -> Run workflow**, type a version (for example `1.0.1`), optionally a server address, tick **publish**.

* **Testing on a PC emulator:** *Run workflow* with `abis` = `x86_64` builds an emulator-only APK (never published). The default
  `arm64-v8a` APK is for phones; an x86_64 emulator cannot start it.
* The version name comes from the tag (`v1.0.1` -> `1.0.1`); the version code is the run number, so every build is newer than the
  previous one and installs **over** the old app (same signing key = no uninstall, no data loss).
* A Release is created only from an APK signed with the release key. If the signing secrets are missing the run stops at the first
  step with a clear message (a push to `main` without secrets still builds a *TEST* APK, signed with the public debug key).

## Secrets and  variable (Settings -> Secrets and variables -> Actions)

| Name | Kind | What |
|---|---|---|
| `KEYSTORE_BASE64` | secret | the release keystore (`mobile/android/app/release.keystore`) as one base64 line |
| `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` | secret | the values from `mobile/android/keystore.properties` |
| `API_URL` | variable | the server address the APK starts with: `https://13-205-79-72.sslip.io:8445` (the production server), or while testing `http://192.168.0.103:8000` (the PC's Wi-Fi address) |

Set them again (for example after rotating the key) with the GitHub CLI:

```powershell
gh secret set KEYSTORE_BASE64 -R <owner>/<repo> < keystore.b64      # base64 -w0 release.keystore > keystore.b64
gh secret set KEYSTORE_PASSWORD -R <owner>/<repo>
gh secret set KEY_ALIAS -R <owner>/<repo>
gh secret set KEY_PASSWORD -R <owner>/<repo>
gh variable set API_URL -R <owner>/<repo> --body "http://192.168.0.103:8000"
```

* If the PC's Wi-Fi address changes, change the `API_URL` variable (or type the address in the app: login screen -> tap the address
  -> Test -> Save). A one-off build with another address: *Run workflow* -> `api_url`.
* **Back up `release.keystore` and its passwords** (outside GitHub too). Without the same key a new APK cannot update the installed app.
* The repository is public: never print secrets in a workflow, and add only people you trust as collaborators (anyone with write
  access can run workflows that can read the secrets). Fork pull requests never receive the secrets.

## What CI checks on every pull request (`ci.yml`)

API tests on SQLite and MySQL 8.4, the generated API types, the app (types, lint, unit tests), the admin panel (unit tests, build, 77 real-browser tests), the production Docker stack **and** the shared-server stack exactly as deployed, a vulnerability scan of both images (Trivy) and of the dependencies (`pip-audit`, `npm audit`, `bandit`), an **API fuzz test** on MySQL + Redis, and a **load test** with 500 employees and 100,000 contacts (see [PERFORMANCE_AND_SECURITY.md](PERFORMANCE_AND_SECURITY.md)). A pull request does not deploy anything; only a push to `main` does.

## Why it is fast

* Only the 64-bit ARM code is compiled (`-PreactNativeArchitectures=arm64-v8a`); every current phone is arm64.
* **ccache** keeps the compiled native objects (Reanimated, worklets, screens, SVG ...) between runs and the Gradle / npm caches keep the
  downloads, so only what changed is rebuilt. Caches are written by runs on `main` and read by tag builds.
* Concurrent runs of the same branch are cancelled (a newer push replaces an older, unfinished build); tag builds are never cancelled.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Run stops with *Signing key missing* | add the four secrets above |
| *The keystore could not be opened* | `KEYSTORE_BASE64` is incomplete (use `base64 -w0`, one line) or the password / alias is wrong |
| *Server address ... does not look right* | the `API_URL` variable must be `http(s)://host[:port]` with no spaces or quotes |
| The app cannot reach the server | PC and phone must be on the same Wi-Fi, the backend must run (`scripts\dev-backend.ps1`) and Windows Firewall must allow port 8000 |
| Phone says "App not installed" | an older APK signed with a different key is installed - uninstall it once, then install the Release APK |
