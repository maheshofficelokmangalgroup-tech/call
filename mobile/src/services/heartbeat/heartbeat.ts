/**
 * "I am alive, and this is how the phone is": while the app is open it reports to the server every minute or so (how often the
 * server decides - the app asks /me). The admin panel shows who is online right now, whose battery is flat, whose phone has no
 * internet, and whose phone has a permission switched off (a call that cannot be seen cannot be counted).
 *
 * Only the phone's own state is sent: battery, network, the app's version, what is waiting to be sent, which of the app's own
 * permissions are missing. Nothing about location, other apps, contacts or messages.
 */
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { api, type HeartbeatBody } from '../api/endpoints';
import { useAuth } from '../../store/authStore';
import { useCallStore } from '../../store/callStore';
import { useSyncStore } from '../../store/syncStore';
import { telephony, type Capabilities, type DeviceDetails } from '../telephony/native';

/** The server chooses the interval; these only keep a wrong value from either flooding the server or going silent. */
export const MIN_INTERVAL_SECONDS = 15;
export const MAX_INTERVAL_SECONDS = 900;
/** Used until the server has told the phone (the first sign-in before /me answers). */
export const FALLBACK_INTERVAL_SECONDS = 60;

export function clampInterval(seconds: number | null | undefined): number {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return FALLBACK_INTERVAL_SECONDS;
  return Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, Math.round(value)));
}

/**
 * The switches the app needs to see and count calls. The names are what the admin panel shows ("Not allowed: Call log").
 * Recording needs the microphone only when the organisation has recording switched on.
 */
export function missingPermissions(permissions: Capabilities['permissions'] | null | undefined, recordingEnabled: boolean): string[] {
  if (!permissions) return [];
  const missing: string[] = [];
  if (!permissions.callPhone || !permissions.readPhoneState) missing.push('phone');
  if (!permissions.readCallLog) missing.push('call_log');
  if (recordingEnabled && !permissions.recordAudio) missing.push('microphone');
  return missing;
}

interface Inputs {
  appState: AppStateStatus;
  status: { batteryPercent?: number; charging?: boolean; network?: 'wifi' | 'cellular' | 'none' | 'other' } | null;
  device: Pick<DeviceDetails, 'appVersion' | 'osVersion'> | null;
  permissions: Capabilities['permissions'] | null;
  recordingEnabled: boolean;
  pendingSync: number;
  onCall: boolean;
  now: number;
}

export function buildReport(i: Inputs): HeartbeatBody {
  const missing = missingPermissions(i.permissions, i.recordingEnabled);
  const body: HeartbeatBody = {
    app_state: i.appState === 'active' ? 'foreground' : 'background',
    pending_sync: i.pendingSync,
    on_call: i.onCall,
    client_time: new Date(i.now).toISOString(),
    missing_permissions: missing,
  };
  if (i.permissions) body.permissions_ok = missing.length === 0;
  if (i.status?.batteryPercent !== undefined) body.battery_percent = Math.max(0, Math.min(100, Math.round(i.status.batteryPercent)));
  if (i.status?.charging !== undefined) body.charging = i.status.charging;
  if (i.status?.network) body.network = i.status.network;
  if (i.device?.appVersion) body.app_version = i.device.appVersion;
  if (i.device?.osVersion) body.os_version = i.device.osVersion;
  return body;
}

class Heartbeat {
  private timer: ReturnType<typeof setInterval> | null = null;
  private appStateSub: NativeEventSubscription | null = null;
  private intervalMs = FALLBACK_INTERVAL_SECONDS * 1000;
  private inFlight = false;
  private device: DeviceDetails | null = null;

  /** Report now, then at the interval the server asked for, and again whenever the app goes to or comes back from the background. */
  start(intervalSeconds?: number | null): void {
    this.stop();
    this.intervalMs = clampInterval(intervalSeconds) * 1000;
    this.timer = setInterval(() => void this.send(), this.intervalMs);
    this.appStateSub = AppState.addEventListener('change', () => void this.send());
    void this.send();
  }

  /** The server changed its mind (an administrator edited the setting): carry on at the new pace. */
  setInterval(intervalSeconds: number | null | undefined): void {
    const next = clampInterval(intervalSeconds) * 1000;
    if (this.timer === null || next === this.intervalMs) return;
    this.start(intervalSeconds);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.appStateSub?.remove();
    this.timer = null;
    this.appStateSub = null;
  }

  async send(): Promise<void> {
    if (this.inFlight || useAuth.getState().status !== 'signedIn') return;
    this.inFlight = true;
    try {
      const native = telephony.isAvailable();
      const [status, permissions] = await Promise.all([
        native ? telephony.getDeviceStatus().catch(() => null) : Promise.resolve(null),
        native ? telephony.getCapabilities().then((c) => c.permissions).catch(() => null) : Promise.resolve(null),
      ]);
      if (native && !this.device) this.device = await telephony.getDeviceInfo().catch(() => null);
      const body = buildReport({
        appState: (AppState.currentState ?? 'active') as AppStateStatus,
        status,
        device: this.device,
        permissions,
        recordingEnabled: Boolean(useAuth.getState().config?.recording.enabled),
        pendingSync: useSyncStore.getState().pending,
        onCall: useCallStore.getState().active?.phase === 'in_progress',
        now: Date.now(),
      });
      const answer = await api.heartbeat(body);
      this.setInterval(answer.next_in_seconds);
    } catch {
      // a report that did not get through is not worth retrying: the next one is a minute away and says the same
    } finally {
      this.inFlight = false;
    }
  }
}

export const heartbeat = new Heartbeat();
