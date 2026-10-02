/**
 * Typed wrapper around the Kotlin modules (android/.../calling). Two ways of calling exist (docs/TELEPHONY.md):
 *  - the phone's own dialer (ACTION_CALL): these calls track it, read the call log and locate recordings;
 *  - this app as the phone app: the native in-call service reports every call and takes commands (mute, hold, ...).
 */
import { DeviceEventEmitter, NativeModules, type EmitterSubscription } from 'react-native';

export interface Capabilities {
  sdkInt: number;
  androidRelease: string;
  manufacturer: string;
  model: string;
  hasTelephony: boolean;
  simState: string;
  networkOperator: string | null;
  permissions: {
    callPhone: boolean;
    readPhoneState: boolean;
    readCallLog: boolean;
    answerPhoneCalls: boolean;
    readAudio: boolean;
    postNotifications: boolean;
    readContacts: boolean;
    recordAudio: boolean;
  };
  defaultDialer: string | null;
  isDefaultDialer: boolean;
}

/** What the phone says about itself in the heartbeat (nothing about location or other apps). */
export interface DeviceStatusReading {
  batteryPercent?: number;
  charging?: boolean;
  network: 'wifi' | 'cellular' | 'none' | 'other';
}

export interface DeviceDetails {
  deviceUid: string;
  manufacturer: string;
  model: string;
  osVersion: string;
  appVersion: string;
}

/** Settings that are not ordinary runtime permissions (roles, overlay, battery, maker-specific switches). */
export interface SetupStatus {
  isDefaultDialer: boolean;
  dialerRoleAvailable: boolean;
  overlay: boolean;
  batteryUnrestricted: boolean;
  fullScreenApplicable: boolean;
  fullScreenAllowed: boolean;
  isXiaomi: boolean;
  needsAutostart: boolean;
  /** null = this phone does not let apps read the switch */
  miuiLockScreen: boolean | null;
  miuiPopups: boolean | null;
  manufacturer: string;
  model: string;
}

export type SettingKind =
  | 'overlay'
  | 'battery'
  | 'batterySaver'
  | 'fullScreen'
  | 'miuiPermissions'
  | 'autostart'
  | 'appDetails'
  | 'defaultApps'
  | 'notifications';

export interface SimAccount {
  id: string;
  label: string;
  number: string | null;
  slot: number;
  isDefault: boolean;
}

export interface NativeSession {
  id: string;
  number: string;
  startedAtMs: number;
  offhookAtMs: number | null;
  endedAtMs: number | null;
  /** when the other side picked up (only known when this app is the phone app) */
  answeredAtMs: number | null;
  source: 'phone' | 'dialer';
  /** android.telecom.DisconnectCause code, -1 when unknown */
  causeCode: number;
  causeReason: string | null;
  recordingStatus: 'recording' | 'saved' | 'silent' | 'failed' | 'no_permission' | null;
  recordingPath: string | null;
  recordingDurationMs: number;
  /** one technical line about the recording (microphone source, loudest sound, why the recorder failed) */
  recordingDetail?: string | null;
}

export interface CallLogEntry {
  found: boolean;
  id?: number;
  dateMs?: number;
  durationSec?: number;
}

export interface FoundRecording {
  uri: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  dateAddedMs: number;
  durationMs: number;
  relativePath: string;
}

export interface RecentAudio {
  name: string;
  addedMs: number;
  sizeBytes: number;
  path: string | null;
}

export type PhoneState = 'IDLE' | 'RINGING' | 'OFFHOOK' | 'UNKNOWN';

export interface PhoneStateEvent {
  state: PhoneState;
  timestampMs: number;
  sessionId: string | null;
  sessionChanged: boolean;
}

export type PlayerState = 'preparing' | 'playing' | 'paused' | 'completed' | 'stopped' | 'error';

export interface PlayerEvent {
  state: PlayerState;
  positionMs: number;
  durationMs: number;
  message?: string;
}

// ---------------------------------------------------------------------------- live calls (phone-app mode)
export type LiveState = 'connecting' | 'select_sim' | 'dialing' | 'ringing' | 'active' | 'holding' | 'disconnecting' | 'disconnected';
export type AudioRoute = 'earpiece' | 'speaker' | 'bluetooth' | 'wired';

export interface LiveCall {
  id: string;
  number: string;
  /** device-contact name or caller-ID name; JavaScript replaces it with the CRM name when it knows one */
  name: string | null;
  subtitle: string | null;
  incoming: boolean;
  state: LiveState;
  addedAtMs: number;
  connectedAtMs: number;
  endedAtMs: number;
  /** the CRM call this belongs to; null for personal calls (never logged, never recorded) */
  sessionId: string | null;
  recording: 'off' | 'starting' | 'recording' | 'saved' | 'silent' | 'failed';
  hd: boolean;
  wifi: boolean;
  canHold: boolean;
  account: string | null;
  causeCode: number;
  causeReason: string | null;
  sims: { id: string; label: string }[];
}

export interface LiveSnapshot {
  calls: LiveCall[];
  primaryId: string | null;
  muted: boolean;
  route: AudioRoute;
  routes: AudioRoute[];
  defaultDialer: boolean;
  recordingEnabled: boolean;
  ts: number;
}

export type CallAction = 'answer' | 'reject' | 'hangup' | 'hold' | 'unhold' | 'swap' | 'mute' | 'route' | 'dtmf' | 'selectSim' | 'closeUi';

export const EMPTY_SNAPSHOT: LiveSnapshot = { calls: [], primaryId: null, muted: false, route: 'earpiece', routes: ['earpiece', 'speaker'], defaultDialer: false, recordingEnabled: false, ts: 0 };

interface CallingNative {
  getCapabilities(): Promise<Capabilities>;
  getDeviceInfo(): Promise<DeviceDetails>;
  getDeviceStatus(): Promise<DeviceStatusReading>;
  getSetupStatus(): Promise<SetupStatus>;
  openSetting(kind: SettingKind): Promise<boolean>;
  requestDefaultDialer(): Promise<boolean>;
  getSimAccounts(): Promise<SimAccount[]>;
  placeCall(number: string, sessionId: string, accountKey: string | null): Promise<{ startedAtMs: number }>;
  isEmergencyNumber(number: string): Promise<boolean>;
  placePlainCall(number: string): Promise<boolean>;
  endCall(): Promise<boolean>;
  getActiveSession(): Promise<NativeSession | null>;
  clearSession(sessionId: string | null): Promise<boolean>;
  getPhoneState(): Promise<PhoneState>;
  startListening(): Promise<boolean>;
  stopListening(): Promise<boolean>;
  readCallLog(number: string, sinceMs: number): Promise<CallLogEntry>;
  findRecentRecording(startedAtMs: number, endedAtMs: number): Promise<FoundRecording | null>;
  listRecentAudio(limit: number): Promise<RecentAudio[]>;
  openAppSettings(): Promise<boolean>;
  openDialer(number: string): Promise<boolean>;
  getCallSnapshot(): Promise<string>;
  callAction(action: CallAction, callId: string | null, arg: string | null): Promise<boolean>;
  setCallDisplay(callId: string, name: string | null, subtitle: string | null): void;
  inCallUiReady(): void;
  setRecordingEnabled(enabled: boolean): void;
  setBubbleEnabled(enabled: boolean): void;
  takePendingDial(): Promise<string | null>;
  lookupContactName(number: string): Promise<string | null>;
  getFileInfo(path: string): Promise<{ exists: boolean; size: number }>;
  deleteFile(path: string): Promise<boolean>;
}

interface AudioNative {
  play(url: string): void;
  pause(): void;
  resume(): void;
  seekTo(positionMs: number): void;
  stop(): void;
}

const calling = NativeModules.CallingModule as CallingNative | undefined;
const audio = NativeModules.AudioPlayerModule as AudioNative | undefined;

function requireCalling(): CallingNative {
  if (!calling) throw new Error('The calling module is not available in this build');
  return calling;
}

export function parseSnapshot(json: string | null | undefined): LiveSnapshot {
  if (!json) return EMPTY_SNAPSHOT;
  try {
    const parsed = JSON.parse(json) as Partial<LiveSnapshot>;
    return { ...EMPTY_SNAPSHOT, ...parsed, calls: parsed.calls ?? [], routes: parsed.routes ?? EMPTY_SNAPSHOT.routes };
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

export const telephony = {
  isAvailable: () => Boolean(calling),
  getCapabilities: () => requireCalling().getCapabilities(),
  getDeviceInfo: () => requireCalling().getDeviceInfo(),
  getDeviceStatus: () => requireCalling().getDeviceStatus(),
  getSetupStatus: () => requireCalling().getSetupStatus(),
  openSetting: (kind: SettingKind) => requireCalling().openSetting(kind),
  requestDefaultDialer: () => requireCalling().requestDefaultDialer(),
  getSimAccounts: () => requireCalling().getSimAccounts(),
  placeCall: (number: string, sessionId: string, accountKey: string | null = null) => requireCalling().placeCall(number, sessionId, accountKey),
  isEmergencyNumber: (number: string) => requireCalling().isEmergencyNumber(number),
  placePlainCall: (number: string) => requireCalling().placePlainCall(number),
  endCall: () => requireCalling().endCall(),
  getActiveSession: () => requireCalling().getActiveSession(),
  clearSession: (sessionId: string | null) => requireCalling().clearSession(sessionId),
  getPhoneState: () => requireCalling().getPhoneState(),
  startListening: () => requireCalling().startListening(),
  stopListening: () => requireCalling().stopListening(),
  readCallLog: (number: string, sinceMs: number) => requireCalling().readCallLog(number, sinceMs),
  findRecentRecording: (startedAtMs: number, endedAtMs: number) => requireCalling().findRecentRecording(startedAtMs, endedAtMs),
  listRecentAudio: (limit = 15) => requireCalling().listRecentAudio(limit),
  openAppSettings: () => requireCalling().openAppSettings(),
  openDialer: (number: string) => requireCalling().openDialer(number),
  getCallSnapshot: async () => parseSnapshot(await requireCalling().getCallSnapshot()),
  callAction: (action: CallAction, callId: string | null = null, arg: string | null = null) => requireCalling().callAction(action, callId, arg),
  setCallDisplay: (callId: string, name: string | null, subtitle: string | null) => calling?.setCallDisplay(callId, name, subtitle),
  inCallUiReady: () => calling?.inCallUiReady(),
  setRecordingEnabled: (enabled: boolean) => calling?.setRecordingEnabled(enabled),
  setBubbleEnabled: (enabled: boolean) => calling?.setBubbleEnabled(enabled),
  takePendingDial: () => requireCalling().takePendingDial(),
  lookupContactName: (number: string) => requireCalling().lookupContactName(number),
  getFileInfo: (path: string) => requireCalling().getFileInfo(path),
  deleteFile: (path: string) => requireCalling().deleteFile(path),
  onPhoneState: (listener: (event: PhoneStateEvent) => void): EmitterSubscription =>
    DeviceEventEmitter.addListener('CallingPhoneState', listener),
  onCallState: (listener: (snapshot: LiveSnapshot) => void): EmitterSubscription =>
    DeviceEventEmitter.addListener('CallingCallState', (event: { json?: string }) => listener(parseSnapshot(event?.json))),
  onDialRequest: (listener: () => void): EmitterSubscription => DeviceEventEmitter.addListener('CallingDialRequest', listener),
};

export const audioPlayer = {
  isAvailable: () => Boolean(audio),
  play: (url: string) => audio?.play(url),
  pause: () => audio?.pause(),
  resume: () => audio?.resume(),
  seekTo: (ms: number) => audio?.seekTo(ms),
  stop: () => audio?.stop(),
  onEvent: (listener: (event: PlayerEvent) => void): EmitterSubscription => DeviceEventEmitter.addListener('AudioPlayerState', listener),
};

/** Error codes the Kotlin layer rejects with. */
export function nativeErrorCode(error: unknown): string {
  return (error as { code?: string })?.code ?? 'UNKNOWN';
}
