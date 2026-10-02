/**
 * The heartbeat: what the phone reports about itself, how often (the server decides), and that a failed report never hurts.
 */
import { AppState } from 'react-native';

import { api } from '../src/services/api/endpoints';
import { clampSyncInterval } from '../src/services/sync/syncEngine';
import {
  buildReport,
  clampInterval,
  FALLBACK_INTERVAL_SECONDS,
  heartbeat,
  MAX_INTERVAL_SECONDS,
  MIN_INTERVAL_SECONDS,
  missingPermissions,
} from '../src/services/heartbeat/heartbeat';
import { telephony } from '../src/services/telephony/native';
import { useAuth } from '../src/store/authStore';
import { useCallStore } from '../src/store/callStore';
import { useSyncStore } from '../src/store/syncStore';

jest.mock('../src/services/api/endpoints', () => ({ api: { heartbeat: jest.fn() } }));
jest.mock('../src/store/authStore', () => ({ useAuth: { getState: jest.fn() } }));
jest.mock('../src/services/telephony/native', () => ({
  telephony: {
    isAvailable: jest.fn(() => true),
    getDeviceStatus: jest.fn(),
    getCapabilities: jest.fn(),
    getDeviceInfo: jest.fn(),
  },
}));
jest.mock('../src/services/sync/syncEngine', () => {
  const actual = jest.requireActual('../src/services/sync/syncEngine');
  return { ...actual, syncEngine: { start: jest.fn(), stop: jest.fn(), setIntervalSeconds: jest.fn() } };
});

const mockApi = api as unknown as { heartbeat: jest.Mock };
const mockTelephony = telephony as unknown as Record<string, jest.Mock>;
const mockAuth = useAuth as unknown as { getState: jest.Mock };

const ALL_ALLOWED = { callPhone: true, readPhoneState: true, readCallLog: true, answerPhoneCalls: true, readAudio: true, postNotifications: true, readContacts: true, recordAudio: true };

function signedIn(recording = false) {
  mockAuth.getState.mockReturnValue({ status: 'signedIn', config: { recording: { enabled: recording } } });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  heartbeat.stop();
  signedIn();
  mockTelephony.isAvailable.mockReturnValue(true);
  mockTelephony.getDeviceStatus.mockResolvedValue({ batteryPercent: 64, charging: false, network: 'wifi' });
  mockTelephony.getCapabilities.mockResolvedValue({ permissions: ALL_ALLOWED });
  mockTelephony.getDeviceInfo.mockResolvedValue({ appVersion: '1.2.0', osVersion: 'Android 14 (API 34)' });
  mockApi.heartbeat.mockResolvedValue({ server_time: '2026-10-02T10:00:00Z', next_in_seconds: 60 });
  useSyncStore.getState().patch({ pending: 0 });
  useCallStore.getState().setActive(null);
});

afterEach(() => {
  heartbeat.stop();
  jest.useRealTimers();
});

describe('how often', () => {
  it('follows the server within sensible limits', () => {
    expect(clampInterval(120)).toBe(120);
    expect(clampInterval(1)).toBe(MIN_INTERVAL_SECONDS);
    expect(clampInterval(99999)).toBe(MAX_INTERVAL_SECONDS);
    expect(clampInterval(undefined)).toBe(FALLBACK_INTERVAL_SECONDS);
    expect(clampInterval(null)).toBe(FALLBACK_INTERVAL_SECONDS);
    expect(clampInterval(Number.NaN)).toBe(FALLBACK_INTERVAL_SECONDS);
    expect(clampInterval(-5)).toBe(FALLBACK_INTERVAL_SECONDS);
  });

  it('the sync pace follows the server too, in milliseconds and within limits', () => {
    expect(clampSyncInterval(30)).toBe(30_000);
    expect(clampSyncInterval(1)).toBe(10_000);
    expect(clampSyncInterval(100_000)).toBe(15 * 60_000);
    expect(clampSyncInterval(undefined)).toBe(45_000);
  });
});

describe('which switches the app needs', () => {
  it('nothing is missing when everything is allowed', () => {
    expect(missingPermissions(ALL_ALLOWED, true)).toEqual([]);
  });
  it('names what is missing in the words the admin panel shows', () => {
    expect(missingPermissions({ ...ALL_ALLOWED, readCallLog: false }, false)).toEqual(['call_log']);
    expect(missingPermissions({ ...ALL_ALLOWED, callPhone: false, readPhoneState: false }, false)).toEqual(['phone']);
  });
  it('asks for the microphone only when the organisation records calls', () => {
    expect(missingPermissions({ ...ALL_ALLOWED, recordAudio: false }, false)).toEqual([]);
    expect(missingPermissions({ ...ALL_ALLOWED, recordAudio: false }, true)).toEqual(['microphone']);
  });
  it('says nothing when the phone could not be asked', () => {
    expect(missingPermissions(null, true)).toEqual([]);
  });
});

describe('the report', () => {
  const base = { appState: 'active' as const, status: { batteryPercent: 64, charging: false, network: 'wifi' as const }, device: { appVersion: '1.2.0', osVersion: '14' }, permissions: ALL_ALLOWED, recordingEnabled: false, pendingSync: 3, onCall: false, now: Date.UTC(2026, 9, 2, 10) };

  it('says how the phone is', () => {
    expect(buildReport(base)).toEqual({
      app_state: 'foreground',
      pending_sync: 3,
      on_call: false,
      client_time: '2026-10-02T10:00:00.000Z',
      missing_permissions: [],
      permissions_ok: true,
      battery_percent: 64,
      charging: false,
      network: 'wifi',
      app_version: '1.2.0',
      os_version: '14',
    });
  });
  it('knows when the app is in the background', () => {
    expect(buildReport({ ...base, appState: 'background' }).app_state).toBe('background');
    expect(buildReport({ ...base, appState: 'inactive' }).app_state).toBe('background');
  });
  it('keeps the battery within 0-100 and leaves out what it does not know', () => {
    expect(buildReport({ ...base, status: { batteryPercent: 140, network: 'cellular' } }).battery_percent).toBe(100);
    const unknown = buildReport({ ...base, status: null, device: null, permissions: null });
    expect(unknown).not.toHaveProperty('battery_percent');
    expect(unknown).not.toHaveProperty('network');
    expect(unknown).not.toHaveProperty('app_version');
    expect(unknown).not.toHaveProperty('permissions_ok'); // not asked: not claimed
  });
  it('reports a missing permission', () => {
    const report = buildReport({ ...base, permissions: { ...ALL_ALLOWED, readCallLog: false } });
    expect(report.permissions_ok).toBe(false);
    expect(report.missing_permissions).toEqual(['call_log']);
  });
});

describe('sending', () => {
  it('reports at once, then at the pace the server gives', async () => {
    mockApi.heartbeat.mockResolvedValue({ server_time: 'x', next_in_seconds: 30 });
    heartbeat.start(30);
    await jest.advanceTimersByTimeAsync(0);
    expect(mockApi.heartbeat).toHaveBeenCalledTimes(1);
    expect(mockApi.heartbeat.mock.calls[0][0]).toMatchObject({ battery_percent: 64, network: 'wifi', app_version: '1.2.0', permissions_ok: true });
    await jest.advanceTimersByTimeAsync(30_000);
    expect(mockApi.heartbeat).toHaveBeenCalledTimes(2);
  });

  it('is silent when nobody is signed in', async () => {
    mockAuth.getState.mockReturnValue({ status: 'signedOut', config: null });
    await heartbeat.send();
    expect(mockApi.heartbeat).not.toHaveBeenCalled();
  });

  it('never sends two reports at the same time', async () => {
    let finish: (v: unknown) => void = () => undefined;
    mockApi.heartbeat.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const first = heartbeat.send();
    const second = heartbeat.send();
    await jest.advanceTimersByTimeAsync(0);
    finish({ server_time: 'x', next_in_seconds: 60 });
    await Promise.all([first, second]);
    expect(mockApi.heartbeat).toHaveBeenCalledTimes(1);
  });

  it('a report that fails changes nothing and is not retried', async () => {
    mockApi.heartbeat.mockRejectedValue(new Error('offline'));
    await expect(heartbeat.send()).resolves.toBeUndefined();
    expect(mockApi.heartbeat).toHaveBeenCalledTimes(1);
  });

  it('still reports when the phone cannot be asked about itself', async () => {
    mockTelephony.getDeviceStatus.mockRejectedValue(new Error('no module'));
    mockTelephony.getCapabilities.mockRejectedValue(new Error('no module'));
    await heartbeat.send();
    expect(mockApi.heartbeat).toHaveBeenCalledTimes(1);
    expect(mockApi.heartbeat.mock.calls[0][0].app_state).toBeDefined();
  });

  it('carries what is waiting to be sent and whether a call is on', async () => {
    useSyncStore.getState().patch({ pending: 7 });
    useCallStore.getState().setActive({
      uuid: 'c1', contactId: null, contactName: null, phone: '+911234567890', campaignId: null, startedAt: 1, offhookAt: 2, endedAt: null,
      phase: 'in_progress', durationSec: 0, answered: false, suggested: null, error: null,
    });
    await heartbeat.send();
    expect(mockApi.heartbeat.mock.calls[0][0]).toMatchObject({ pending_sync: 7, on_call: true });
  });

  it('follows a new pace given in the answer', async () => {
    heartbeat.start(60);
    await jest.advanceTimersByTimeAsync(0);
    mockApi.heartbeat.mockClear();
    mockApi.heartbeat.mockResolvedValue({ server_time: 'x', next_in_seconds: 20 });
    await heartbeat.send(); // the answer says: every 20 seconds
    await jest.advanceTimersByTimeAsync(0);
    mockApi.heartbeat.mockClear();
    await jest.advanceTimersByTimeAsync(20_000);
    expect(mockApi.heartbeat).toHaveBeenCalled();
  });

  it('reports again when the app goes to the background', async () => {
    const listeners: ((state: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, listener: (state: string) => void) => {
      listeners.push(listener);
      return { remove: jest.fn() };
    }) as unknown as typeof AppState.addEventListener);
    heartbeat.start(60);
    await jest.advanceTimersByTimeAsync(0);
    mockApi.heartbeat.mockClear();
    listeners.forEach((l) => l('background'));
    await jest.advanceTimersByTimeAsync(0);
    expect(mockApi.heartbeat).toHaveBeenCalledTimes(1);
  });
});
