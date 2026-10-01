# Employee Calling & CRM Platform

Android app for employees to call assigned contacts, record outcomes, schedule callbacks and (where the device and the
law allow) attach call recordings, plus the FastAPI backend behind it.
Built from the project documentation `Employee_Calling_CRM_Platform_Project_Documentation.docx` (kept on the owner's PC, not part of this repository).

| Part | Status | Folder |
|---|---|---|
| Backend API (FastAPI, MySQL / SQLite, Redis) | **done** - 95 automated tests, run on SQLite **and** MySQL 8.4 | [backend/](backend) |
| Employee Android app (React Native, Android only) | **done** - Blinkit-style animated UI, offline-first, own phone-app call screen | [mobile/](mobile) |
| Admin Web App (Next.js) | next phase (the admin API it needs already exists) | - |
| AWS deployment | next phase (Dockerfile, compose file and S3 storage are ready) | [docker-compose.yml](docker-compose.yml) |
| CI/CD (GitHub Actions) | **done** - tests on every push; the signed release APK is built on GitHub and published as a Release | [.github/workflows/](.github/workflows), [docs/CICD.md](docs/CICD.md) |

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
2. APK फोनवर कॉपी करा (USB / WhatsApp / Drive) आणि उघडा -> "Install unknown apps" ला परवानगी द्या -> Install.
3. App उघडा. Login screen च्या **तळाशी server address** दिसतो (GitHub वर `API_URL` variable मध्ये जो PC IP ठेवला तो). वेगळा असल्यास
   त्यावर tap करा -> `http://<तुमच्या-PC-चा-IP>:8000` टाका -> **Test** -> **Save**.
4. Login: Employee ID `EMP001`, password `Employee@123` (demo). Admin: `admin@example.com` / `Admin@12345`.
5. पहिल्यांदा **Phone setup** wizard आपोआप उघडतो (Profile -> Phone setup मधूनही उघडता येतो):
   * Stage 1: Default phone app (**रेकमेंडेड**), Phone & SIM, Contacts, Call history, Call notifications -> **Grant all essential**.
   * Stage 2: lock screen / pop-up (Xiaomi), Auto-start, Floating call bubble, Battery, Microphone -> **Enable recommended**.

> Demo contacts चे नंबर **काल्पनिक** (+1 xxx 555-01xx) आहेत, म्हणून खऱ्या SIM वर "Call" दाबलं तरी कोणत्याही खऱ्या
> व्यक्तीला फोन जाणार नाही. खरा data import करताना आधी एका छोट्या group वर pilot करा.

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
backend/        FastAPI app, Alembic migrations, tests, scripts (bootstrap, demo seed, sample CSV)
mobile/         React Native (Android only). src/ = TypeScript app, android/.../calling = Kotlin phone layer
docs/           Architecture notes (telephony), CI/CD guide
scripts/        dev-backend.ps1 - one-command backend for Windows
.github/        GitHub Actions: ci.yml (tests) and android.yml (signed release APK -> Releases)
release/        APKs built on this PC (git-ignored); the official APK is on the GitHub Releases page
docker-compose.yml, .env.example    Local stack (FastAPI + MySQL 8 + Redis) as in the documentation
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
```

## Important notes (please read)

* **Recording & privacy.** Android does not let normal apps capture the other person's voice. In phone-app mode the app records
  the **microphone** during CRM calls only (the employee always; the customer when the speaker is on and the phone allows it),
  deletes a silent recording instead of uploading it, shows a red REC chip, and personal calls are never recorded. Without
  phone-app mode it only uploads a file produced by the phone's own recorder. Recording stays off until an administrator
  enables `recording` in settings. Define consent and retention first (documentation, section 24) and test your phone models.
* **Not verified on real hardware yet.** Everything was tested on an Android emulator (virtual SIM/modem) and by unit tests. Real
  SIM calls, dual-SIM, Bluetooth, the proximity sensor, microphone capture during a real call and the Xiaomi lock-screen /
  pop-up / auto-start pages need to be checked on your actual phones (Profile -> Device & telephony check).
* **Play Store.** The app uses `READ_CALL_LOG`, `ANSWER_PHONE_CALLS`, `RECORD_AUDIO` and the default-dialer role, which Google
  Play restricts. Distribute it as an internal APK / MDM rollout (fine for company-managed phones), not through the public store.
* **Security.** Never commit `.env`. Use a 32+ character `JWT_SECRET` (the API refuses to start in production without).
  Change or delete the demo accounts before any real use. The pilot APK allows plain `http://` only to local-network servers.

## Next phases

Admin Web App (Next.js + Amplify), analytics/reports, CI/CD, AWS deployment (EC2 + RDS + S3), load tests, logging of incoming
customer calls in the CRM. The backend already has the admin endpoints these need (employees, teams, contacts, import,
assignment, campaigns, calls, recordings, audit logs); see Swagger at `/docs`.
