import { NativeModules } from 'react-native';

/**
 * Build-time defaults. The server URL can be changed at run time (login screen -> "Server"), which is handy for pilots:
 * point the app at your PC on the same Wi-Fi without rebuilding.
 *
 *  - Android emulator  -> the host machine is http://10.0.2.2:8000
 *  - Real phone (USB)  -> run `adb reverse tcp:8000 tcp:8000`, then use http://localhost:8000
 *  - Real phone (Wi-Fi)-> http://<PC-LAN-IP>:8000   (MOBILE_API_BASE_URL in the documentation)
 *  - Production        -> https://api.your-domain.com
 *
 * A release APK starts with the address given at build time: ./gradlew assembleRelease -PapiUrl=http://192.168.1.8:8000
 */
const builtInUrl = (NativeModules.CallingModule as { defaultApiUrl?: string } | undefined)?.defaultApiUrl;
export const DEFAULT_API_URL = __DEV__ ? 'http://10.0.2.2:8000' : builtInUrl || 'https://api.example.com';

export const API_PREFIX = '/api/v1';
export const REQUEST_TIMEOUT_MS = 20_000;
export const UPLOAD_TIMEOUT_MS = 120_000;

export const APP_NAME = 'Employee Calling';

/** Sync tuning */
export const SYNC_INTERVAL_MS = 45_000;
export const SYNC_BACKOFF_BASE_MS = 5_000;
export const SYNC_BACKOFF_MAX_MS = 15 * 60_000;
export const SYNC_MAX_ATTEMPTS = 12; // after this many failures an operation needs manual attention

/** How long to wait for Android to write the call-log entry after hang-up. */
export const CALL_LOG_POLL_MS = 700;
export const CALL_LOG_POLL_TRIES = 12;
export const DIAL_TIMEOUT_MS = 30_000;
export const RECORDING_SCAN_TRIES = 6;
export const RECORDING_SCAN_INTERVAL_MS = 4_000;
