# Telephony architecture and proof of concept (documentation section 4, Phase 0)

The documentation calls cellular call control and recording the highest-risk part. This is how the app handles it and how
to validate it on your phones.

The app supports **two ways of calling**. The employee chooses once, in **Profile -> Phone setup**
("Default phone app"); the app works in both and the CRM logic (call row, outcome, sync) is identical.

| | A. Phone's own dialer (default) | B. This app is the phone app (recommended) |
|---|---|---|
| Call screen | the phone maker's screen | **the app's own call screen** (green, Blinkit-style) |
| Mute / hold / speaker / keypad | on the phone's screen | **in the app** (also on the lock screen) |
| Answered? talk time? | read from the call log afterwards | **exact**, from the call itself (connect time, disconnect cause) |
| Incoming calls | phone maker's screen | app's call screen + call-style notification, CRM name shown |
| Floating bubble while using other apps | no | yes ("Display over other apps") |
| Recording | file made by the phone's own recorder is found and uploaded | microphone recording by the app (see below) |
| Setup | none | one system dialog ("Set as default phone app") |

## A. Phone's own dialer + tracking

```
Employee taps Call
   |  1. call row saved to SQLite (+ queued for sync)                 JS  (callFlow.ts)
   |  2. ACTION_CALL intent -> the phone's own dialer places the call Kotlin (CallingModule.placeCall)
   |  3. PHONE_STATE OFFHOOK  -> "call in progress"                   Kotlin receiver + in-process listener
   |  4. PHONE_STATE IDLE     -> call ended                           (survives the app being killed: CallSessionStore)
   |  5. CallLog read         -> answered? talk time?                 Kotlin (readCallLog) polled up to ~8 s
   |  6. Outcome screen       -> the employee must pick an outcome    JS  (OutcomeScreen)
   |  7. sync queue           -> call, events, outcome, recording     JS  (syncEngine.ts)
```

* Speaker, mute and the keypad are the **phone's own** controls (the app cannot control them in this mode).
* "Connected" vs "ringing" cannot be told apart from phone state alone (OFFHOOK starts at dialing). The call log
  duration decides: `duration > 0` -> answered (suggested outcome Connected), otherwise No Answer. Voicemail counts as
  answered on the carrier side, so the employee confirms the real outcome.

## B. This app as the phone app (default dialer)

Android lets exactly one app be the phone app (`ROLE_DIALER`). The app qualifies through `MainActivity` (handles
`DIAL` / `tel:`) and `AppInCallService` (an `InCallService` with `IN_CALL_SERVICE_UI`). After the employee accepts the system
dialog, Telecom tells the service about **every** call:

```
Telecom ---- onCallAdded / onStateChanged / onCallRemoved ---> AppInCallService
                                                                   |
                                                         CallManager (Kotlin, one place)
        +---------------+-------------+------------------+--------+-----------+----------------+
   InCallActivity   notification   FloatingBubble   ProximityLock   CallRecorder   CallSessionStore
   (React UI)       (call style)   (overlay pill)   (screen off     (microphone)   (answered time, cause,
                    + foreground                      at the ear)                    recording -> JavaScript)
```

* **Call screen** - `InCallActivity` is its own Android task (like a phone app's call screen), may appear above the lock
  screen, and hosts the React root `InCallRoot` (`src/InCallRoot.tsx`, `src/components/call/*`). A plain native stand-in
  (`InCallFallbackView`) is on screen from the first millisecond and is removed once the React UI reports ready
  (`inCallUiReady`), so an incoming call can always be answered even while JavaScript is still starting.
* **Incoming calls** - a call-style notification (Answer / Decline) with a full-screen intent: it takes over the lock
  screen, and is a heads-up banner while the phone is in use. The CRM name is looked up from the local contact cache
  natively (`CrmLookup`), so the banner says "Rahul Shinde", not a number. A second call while one is going on shows
  "Call waiting" with Answer / Decline, and a held call can be swapped back.
* **Controls** - mute, hold/resume, speaker (cycles phone -> speaker -> Bluetooth when connected), in-call keypad (DTMF),
  note (kept on the call and pre-filled on the outcome screen), customer details, end call, and a SIM chooser when a
  dual-SIM phone asks which SIM to use.
* **Accuracy** - `connectTimeMillis` gives the exact answer time; the disconnect cause pre-selects the outcome
  (busy -> Busy, unobtainable -> Invalid number, power off / out of service -> Switched off, otherwise No answer). The
  employee still confirms it.
* **Personal calls** - calls that were not started from the CRM queue/dialer (a friend calling, a number tapped in another
  app) get the same call screen but are **never logged to the CRM and never recorded**.
* **Emergency numbers and service codes** (112, 100, 108, `*#06#`...) are placed by the phone itself, never as CRM calls.
* **Safety nets** - the ongoing-call notification (Hang up) is a foreground service of type `phoneCall`; if the in-call
  service stays silent the radio's IDLE still ends the CRM session after 4 s.

### Recording (microphone) - what it can and cannot do

**Read this first: on current Android a normal app is usually given silence while a call is on.** Android's own documentation
([Sharing audio input](https://developer.android.com/media/platform/sharing-audio-input)) says that during a voice call "the call
always receives audio", and that only a pre-installed app holding `CAPTURE_AUDIO_OUTPUT` (the phone's own recorder) or an
*accessibility service* can capture it. The `VOICE_CALL` source is blocked for ordinary apps since Android 10. So the app tries,
and when the microphone delivers only silence the call says so instead of keeping an empty file.

* **Why there is no accessibility-service workaround here:** call-recorder apps use one, but Google Play Protect's *enhanced fraud
  protection* (live in India) blocks installing an APK that declares an accessibility service when it comes from a browser,
  messaging app or file manager - so adding one could stop employees from installing the app at all. Google Play itself bans it too.
* **Dependable recording on every phone needs a cloud-telephony provider** (Exotel, Knowlarity, MyOperator, Twilio ...): the call
  is bridged through the provider, which records both sides on its server; the backend then stores the file with the call. That is
  the production answer for a CRM that must record every call (documentation section 4).

When an administrator enables `settings.recording.enabled`, mode B tries to record the **microphone** during CRM calls only
(`CallRecorder`, foreground service type `microphone`, AAC/m4a, ~6 KB/s):

* what is captured depends on the phone: some give the app the employee's voice (and the customer when the speaker is on), most
  give silence. Nothing is assumed per brand - **it has not been verified on Xiaomi/HyperOS**; make one test call per model and
  read the result on the call details;
* the amplitude is sampled during the call: a recording that is silent is **deleted and never uploaded** (section 7.7:
  no recording record unless a real recording exists);
* a red **REC** chip is on the call screen while the recorder runs ("Not recording" when it could not start), and the
  consent notice from the server is shown in Phone setup;
* the file is uploaded through the same private, signed pipeline as before, then deleted from the phone.

#### Where a recording shows up - and what a missing one says

* **Employee app:** History -> the **Recordings** chip (or any call) -> the call -> **Call details** -> **Recording** card with a play
  button. A recorded call has a headphones icon in the list.
* **A call without a recording says why.** The call keeps the reason (`recording_state = unavailable`, reason in
  `recording_error`) and shows it on the Outcome screen ("Not recorded") and in the Recording card, with what to do:

  | Reason | Meaning | Advice shown |
  |---|---|---|
  | `no_permission` | microphone permission off | Open Phone setup |
  | `silent` | the microphone delivered only silence (loudest sound below the threshold) | Android gives most apps no sound during a call; recording every call needs cloud telephony |
  | `failed` | the recorder could not start or finish (or the file vanished) | try the next call; run the Device & telephony check |
  | `no_file` | phone's own dialer mode: the phone's call recorder left no file | turn on auto call recording in the Phone app, or make calls through this app |
  | `no_media_access` | phone's own dialer mode: no permission to look for that file | allow audio-file access in Phone setup |

* **For the administrator:** the call's `ended` event on the server carries `recording` (the in-call service's status) and
  `recording_detail` (microphone source, loudest sound 0-32767, seconds) - `GET /api/v1/calls/<id>` shows them in `events`.
* **Files on the server:** local development storage is `backend/var/storage/recordings/<year>/<month>/<employee id>/<call id>.m4a`
  (private S3 bucket in production). Administrators fetch a short-lived link with
  `GET /api/v1/recordings/<id>/playback-url?mode=download` (Swagger UI: `http://<server>:8000/docs`); every link issued is logged.
  The admin web app (next phase) gets a Recordings page.

In mode A the app does not record: it looks in the media library for a file made by the phone's built-in call recorder
(`Recordings/Call`, `MIUI/sound_recorder/call_rec`, `Call`...) and uploads that. If none exists, no recording record is
created. If you need guaranteed two-sided recording on every phone, use a compliant VoIP/telephony provider (section 4).

## Phone setup (permissions) - what each switch is for

The wizard (Profile -> Phone setup, and automatically once after the first sign-in) has two stages. Nothing blocks the
app; calls need only "Phone & SIM access".

| Stage | Step | Why | Without it |
|---|---|---|---|
| 1 | Default phone app | the app's own call screen and controls | mode A (phone's dialer) |
| 1 | Phone & SIM (CALL_PHONE, READ_PHONE_STATE, ANSWER_PHONE_CALLS) | place calls, detect start/end | calling is blocked |
| 1 | Contacts (READ_CONTACTS) | show names of people who call back | numbers instead of names |
| 1 | Call history (READ_CALL_LOG) | real duration in mode A | falls back to phone-state times |
| 1 | Call notifications (POST_NOTIFICATIONS) | incoming-call banners, ongoing-call controls, reminders | none shown |
| 2 | Show on lock screen *(Xiaomi)* | call screen over the lock screen | calls only show after unlocking |
| 2 | Background pop-up windows *(Xiaomi)* | call banners / screen while using other apps | |
| 2 | Full-screen call alerts *(Android 14+)* | incoming call takes over a locked screen | heads-up banner only |
| 2 | Auto-start & background protection *(Xiaomi, Oppo, Vivo, Huawei...)* | the phone stops killing the app | calls/callbacks can be missed after a restart |
| 2 | Floating call bubble (SYSTEM_ALERT_WINDOW) | call pill over other apps | notification only |
| 2 | Reliable background calls (battery optimisation) | battery saver cannot put the app to sleep | |
| 2 | Call recording (RECORD_AUDIO) | microphone recording in mode B | no recording |
| 2 | Phone recorder files (READ_MEDIA_AUDIO) *(only if recording is on)* | find the phone recorder's file in mode A | |

Xiaomi/HyperOS keeps the lock-screen, pop-up and auto-start switches on its own screens; the app opens the right page and
reads the switch back where the phone allows it (otherwise the employee confirms it). These could **not** be exercised on
a real Xiaomi phone while building - check them on yours.

## Phase 0: validate each phone model

Profile -> **Device & telephony check**. It verifies, step by step: SIM state, every permission, that the phone-state
listener registers, then **Place test call** (use a second phone of yours): watches OFFHOOK/IDLE events, reads the call log
entry (duration) and looks for a recording file, and lists the newest audio files with their folders. **Share report** sends
the result as text. Run it on every model planned for the fleet before the pilot; pilot with a small group before all 300.

## Testing on the Android emulator

The emulator has a virtual modem:

```powershell
adb emu gsm call 5551234        # simulate an INCOMING call (shows the incoming-call notification / screen)
adb emu gsm accept 5551234      # answer a call
adb emu gsm busy 5551234
adb emu gsm cancel 5551234      # hang up
```

Make the app the phone app on an emulator (without the dialog):
`adb shell cmd role add-role-holder --user 0 android.app.role.DIALER com.employeecalling`.
