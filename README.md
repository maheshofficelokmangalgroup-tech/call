# Employee Calling & CRM Platform

> **Project closed (2026-10-05).** The project was cancelled; the containers on the server were stopped and the deployment workflows were disabled.
> The code, the documents and the APK Releases stay here. **Start with [docs/PROJECT_DOCUMENTATION.md](docs/PROJECT_DOCUMENTATION.md)** - what it was, how it
> works, what was proven and what was not, what still exists outside GitHub, and how to start it again.

Android app for employees to call assigned contacts, record outcomes, schedule callbacks and (where the device and the
law allow) attach call recordings, plus the FastAPI backend behind it.
Built from the project documentation `Employee_Calling_CRM_Platform_Project_Documentation.docx` (kept on the owner's PC, not part of this repository).

| Part | Status | Folder |
|---|---|---|
| Backend API (FastAPI, MySQL, Redis) | **done** - 230+ automated tests on SQLite **and** MySQL 8.4; Redis-first (no database query to know who is calling); tested with 500 employees / 100,000 contacts | [backend/](backend), [docs/PERFORMANCE_AND_SECURITY.md](docs/PERFORMANCE_AND_SECURITY.md) |
| Employee Android app (React Native, Android only) | **done** - Blinkit-style animated UI, offline-first, own phone-app call screen | [mobile/](mobile) |
| **Admin panel** (Next.js, web) | **done** - live dashboard, every employee's calls / talk time / recordings, create employees, contacts, campaigns, audit log; light + dark, phone-friendly | [admin-web/](admin-web), [docs/ADMIN_PANEL.md](docs/ADMIN_PANEL.md) |
| **Import 10,000 - 1,000,000 contacts + equal sharing** | **done** - a sheet (CSV / Excel) is checked, no number gets in twice, the new contacts are shared **equally between the employees who are working** (somebody not seen for 2 days gets nothing; what was waiting with them is shared out again); administrators can see the password they handed out; tested on 1,000,000 rows | [docs/IMPORT_AND_DISTRIBUTION.md](docs/IMPORT_AND_DISTRIBUTION.md) |
| **Server deployment** | **done** - one command on a Linux server: HTTPS, panel, API, MySQL, Redis, nightly backups | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docker-compose.prod.yml](docker-compose.prod.yml), [deploy/](deploy) |
| CI/CD (GitHub Actions) | **done** - API (SQLite + MySQL), API fuzz + security scans + image scan, **load test (500 employees)**, app, panel (unit + real-browser tests), production Docker stacks on every push; signed APK -> Releases; images; optional auto-deploy | [.github/workflows/](.github/workflows), [docs/CICD.md](docs/CICD.md) |

---

## Admin panel (मराठी + English)

**Admin panel** madhe tumhala disate: kon employee kiti call kela, konala kela, kiti vel bolla, kadhi kela, recording aikta yete,
ata kon call var ahe (live), nave employees banvta yetat (ek-ek kinva Excel/CSV sheet madhun), contacts/campaigns, audit log, settings.

```powershell
# 1) backend (demo data sobat)
cd backend ; .\.venv\Scripts\python.exe -m scripts.seed_demo ; .\.venv\Scripts\python.exe -m scripts.seed_history --rename
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
# 2) panel
cd ..\admin-web ; npm install ; npm run dev          # -> http://localhost:3000   (admin@example.com / Admin@12345)
```

Server var deploy karayche: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) - `git clone ... && sudo bash deploy/install.sh` (domain + admin email vicharto, baki sagla apoaap).
Panel kasa vaparaycha: [docs/ADMIN_PANEL.md](docs/ADMIN_PANEL.md).

---

## APK install करा (मराठी) - सर्वात सोपा मार्ग

तयार APK GitHub वर आपोआप बनतो आणि **Releases** मध्ये मिळतो (64-bit Android फोन, Android 7+):
<https://github.com/maheshofficelokmangalgroup-tech/call/releases/latest> -> `EmployeeCalling-<version>.apk` डाउनलोड करा.
नेहमी-नवीन APK ची कायमची लिंक: `https://github.com/maheshofficelokmangalgroup-tech/call/releases/latest/download/EmployeeCalling.apk`
(नवीन APK कसा बनवायचा: [docs/CICD.md](docs/CICD.md) - `git tag v1.0.1 && git push origin v1.0.1`, PC वर काहीही build करावं लागत नाही).

1. **PC वर backend सुरू करा** (Docker लागत नाही):

   ```powershell
   .\scripts\dev-backend.ps1
   ```

   शेवटी `Phone (Wi-Fi) server URL:  http://192.168.x.x:8000` असं दिसेल. **फोन आणि PC एकाच Wi-Fi वर** असावेत.
   Windows Firewall ने port 8000 अडवला तर script मध्ये दिलेली एक ओळ (Administrator PowerShell मध्ये) चालवा.
2. APK फोनवर डाउनलोड करा (वरची लिंक) आणि उघडा -> "Install unknown apps" ला परवानगी द्या -> Install. Play Protect ने इशारा दिला
   (APK Play Store चा नाही) तर **Install anyway** निवडा.
3. App उघडा. Login screen च्या **तळाशी server address** दिसतो (GitHub वर `API_URL` variable मध्ये जो PC IP ठेवला तो). वेगळा असल्यास
   त्यावर tap करा -> `http://<तुमच्या-PC-चा-IP>:8000` टाका -> **Test** -> **Save**.
4. Login: Employee ID `EMP001` ... `EMP010`, password `Employee@123` (demo). Admin: `admin@example.com` / `Admin@12345`.
5. पहिल्यांदा **Phone setup** wizard आपोआप उघडतो (Profile -> Phone setup मधूनही उघडता येतो):
   * Stage 1: Default phone app (**रेकमेंडेड**), Phone & SIM, Contacts, Call history, Call notifications -> **Grant all essential**.
   * Stage 2: lock screen / pop-up (Xiaomi), Auto-start, Floating call bubble, Battery, Microphone -> **Enable recommended**.

> Demo contacts चे नंबर **काल्पनिक** (+1 xxx 555-01xx) आहेत, म्हणून खऱ्या SIM वर "Call" दाबलं तरी कोणत्याही खऱ्या
> व्यक्तीला फोन जाणार नाही. खरा data import करताना आधी एका छोट्या group वर pilot करा.

### Call recording कुठे दिसतं

* **App मध्ये:** **History** tab -> वरचा **Recordings** chip (किंवा कोणताही call) -> call वर tap -> **Call details** -> **Recording**
  card -> Play. Recording असलेल्या call वर list मध्ये headphones icon दिसतो.
* **Recording नसेल तर** तेच card **कारण** सांगतं (उदा. "The microphone captured only silence" / "The microphone permission is off")
  आणि call संपल्यावर Outcome screen वर "Not recorded" tag दिसतो. Call च्या `ended` event मध्ये (server, `GET /api/v1/calls/<id>`)
  `recording` आणि `recording_detail` ही माहितीही जाते, म्हणून administrator ला कारण दिसतं.
* **PC / server वर:** recordings private storage मध्ये राहतात - local dev मध्ये
  `backend\var\storage\recordings\<वर्ष>\<महिना>\<employee-id>\<call-id>.m4a`. Admin साठी
  `GET /api/v1/recordings/<id>/playback-url?mode=download` (Swagger: `http://<PC-IP>:8000/docs`). Recordings चं list/player असलेला
  Admin Web App पुढच्या phase मध्ये येतो.
* **मर्यादा (महत्त्वाची):** Android च्या official documentation नुसार call चालू असताना सामान्य app ला microphone चा आवाज मिळत नाही
  ("the call always receives audio" - फक्त phone चा स्वतःचा recorder आणि accessibility service ला मिळतो). म्हणून बहुतेक phones वर
  app ला फक्त **silence** मिळतो; तेव्हा रिकामी फाईल जतन/upload केली जात नाही आणि call वर कारण दिसतं. Xiaomi/HyperOS वर हे अजून
  तपासलेलं नाही - एक test call करून call details बघा. Accessibility वाला उपाय मुद्दाम घातलेला नाही: भारतात Google Play Protect
  तसा APK browser मधून install होऊ देत नाही. **प्रत्येक call ची खात्रीशीर recording** हवी असेल तर cloud telephony (Exotel /
  Knowlarity / MyOperator / Twilio) लागते - call त्यांच्या server वरून जोडली जाते आणि ते दोन्ही बाजूंचा आवाज record करतात.

## Developers: कसं चालवायचं / build करायचं

```powershell
# backend
.\scripts\dev-backend.ps1                  # API http://localhost:8000, docs /docs

# app (emulator किंवा USB फोन)
cd mobile
npm install
npx react-native start                     # Metro, एका terminal मध्ये
npx react-native run-android               # दुसऱ्या terminal मध्ये

# release APK, PC वर (JS bundle आत embedded, Metro लागत नाही) - RAM कमी असेल तर GitHub वर build करा (खाली)
cd mobile\android
.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a -PnativeBuildDir=C:/rncxx -PapiUrl=http://192.168.1.8:8000
#   -> mobile\android\app\build\outputs\apk\release\app-release.apk
#   (-PnativeBuildDir: on Windows the default native build folder is too deep and Ninja stops at 260 characters)
```

**GitHub वर build (शिफारस):** `.github/workflows/android.yml` APK GitHub च्या server वर बनवतो (laptop चा RAM वापरला जात नाही).
`main` वर push -> signed APK "Actions" मध्ये artifact म्हणून; `v*` tag push -> **Release** मध्ये APK. सविस्तर: [docs/CICD.md](docs/CICD.md).

* **Server address:** emulator वर debug build `http://10.0.2.2:8000` वापरतो. Release APK `-PapiUrl` ने दिलेल्या address ने सुरू होतो
  आणि login screen वर बदलता येतो. `http://` फक्त office network (192.168.x.x, 10.x.x.x, localhost...) साठी चालतं; internet वरील
  server साठी `https://` आवश्यक आहे (app स्वतःच नाकारतो).
* **Release signing:** `mobile/android/keystore.properties` (git मध्ये जात नाही) आणि `mobile/android/app/release.keystore`.
  **ही दोन्ही फाईल्स सुरक्षित backup करा** - हरवल्या तर नंतरचे updates जुन्या app वर install होणार नाहीत.
  नवीन keystore: `mobile/android/keystore.properties.example` बघा.

---

## What the employee app does

* Login with Employee ID or email, forced password change for temporary passwords, secure token storage (Android Keystore),
  server-side session revocation and device binding.
* **Home**: progress ring towards the daily target, live stats, next contacts, confetti when the target is reached.
* **Queue**: due callbacks first, then priority contacts (retry rules for no answer / busy), search over all assigned contacts.
* **Dialer + contact detail**: phone-like keypad, number -> contact match, notes, callbacks, call history, recordings.
  Emergency numbers and service codes are placed by the phone itself, never as CRM calls.
* **Phone setup wizard** (two stages): every permission and switch a phone app needs, with Xiaomi/HyperOS specific pages.
* **Real calls, two ways** - see [docs/TELEPHONY.md](docs/TELEPHONY.md):
  * the phone's own dialer (works everywhere, no setup), or
  * **this app as the phone app** (recommended): its own green call screen with mute / hold / speaker / keypad, note and
    customer details during the call, incoming-call screen over the lock screen, call-style notification, floating call
    bubble, exact answer time and disconnect cause, SIM chooser on dual-SIM phones.
  Either way the app **requires an outcome** after the call (11 outcomes, callback time where needed).
* **Offline first**: everything is saved to SQLite and synced with idempotency keys and exponential backoff; a killed app
  or a dropped connection never loses a call.
* **Recordings** (off until the organisation enables it): microphone recording in phone-app mode (see the note below), or the
  file made by the phone's own call recorder; uploaded privately, played back through a short-lived signed URL.
* Device & telephony check screen (the Phase 0 proof of concept) to validate calling on each phone model.

## Project layout

```
backend/        FastAPI app, Alembic migrations, tests, scripts (bootstrap, demo data + history, reset_password, sample CSV)
mobile/         React Native (Android only). src/ = TypeScript app, android/.../calling = Kotlin phone layer
admin-web/      The admin panel: Next.js 16, React 19, Tailwind 4. src/ = app, tests/ = unit tests, e2e/ = browser tests
deploy/         Server installer, update / backup / restore scripts, Caddyfile (HTTPS front door)
docs/           Telephony notes, CI/CD guide, admin panel guide, deployment guide, speed / capacity / security
scripts/        dev-backend.ps1 - one-command backend for Windows
.github/        GitHub Actions: ci.yml (all tests + Docker smoke test), android.yml (signed APK -> Releases), images.yml, deploy.yml
release/        APKs built on this PC (git-ignored); the official APK is on the GitHub Releases page
docker-compose.yml, .env.example    Local stack (FastAPI + MySQL 8 + Redis)
docker-compose.prod.yml             Production stack (+ admin panel + HTTPS), see docs/DEPLOYMENT.md
```

## Running the tests

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest                       # SQLite (fast)
$env:TEST_DATABASE_URL="mysql+pymysql://root@127.0.0.1:3306/calling_test?charset=utf8mb4"
.\.venv\Scripts\python.exe -m pytest                       # same 95 tests on MySQL 8

cd ..\mobile
npm test                                                   # Jest: API client, sync engine, call flow, setup model, helpers
npx tsc --noEmit ; npx eslint src                          # type check + lint

cd ..\admin-web
npm run typecheck ; npm run lint ; npm test                # panel: types, lint, unit tests (Vitest)
npm run build                                              # production build
# browser tests (Playwright) need the API with demo data and the built panel running - see admin-web/e2e/README.md
```

## Important notes (please read)

* **Recording & privacy.** Android does not let normal apps capture a phone call: while a call is on, most phones give an ordinary
  app only silence from the microphone. In phone-app mode the app *tries* to record the **microphone** during CRM calls only, deletes
  a silent recording instead of uploading it, says on the call why there is none, shows a red REC chip while the recorder runs, and
  personal calls are never recorded. Without phone-app mode it only uploads a file produced by the phone's own recorder. Recording
  stays off until an administrator enables `recording` in settings. Define consent and retention first (documentation, section 24).
  For recordings of **every** call use a cloud-telephony provider (see [docs/TELEPHONY.md](docs/TELEPHONY.md)).
* **Not verified on real hardware yet.** Everything was tested on an Android emulator (virtual SIM/modem) and by unit tests. Real
  SIM calls, dual-SIM, Bluetooth, the proximity sensor, microphone capture during a real call and the Xiaomi lock-screen /
  pop-up / auto-start pages need to be checked on your actual phones (Profile -> Device & telephony check).
* **Play Store.** The app uses `READ_CALL_LOG`, `ANSWER_PHONE_CALLS`, `RECORD_AUDIO` and the default-dialer role, which Google
  Play restricts. Distribute it as an internal APK / MDM rollout (fine for company-managed phones), not through the public store.
* **Security.** Never commit `.env`. Use a 32+ character `JWT_SECRET` (the API refuses to start in production without).
  Change or delete the demo accounts before any real use. The pilot APK allows plain `http://` only to local-network servers.

## Next phases

Cloud telephony for recordings of every call ([docs/TELEPHONY.md](docs/TELEPHONY.md)), logging of incoming customer calls in the
CRM, load tests, push notifications. Swagger for the API is at `/docs` (off in production).
