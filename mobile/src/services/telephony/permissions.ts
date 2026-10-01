import { PermissionsAndroid, Platform, type Permission } from 'react-native';

import { telephony, type Capabilities } from './native';

/** The ordinary runtime permissions. (Roles, overlay, battery and maker switches are in SetupStatus - see setupModel.ts.) */
export type PermissionKey = 'phone' | 'callLog' | 'contacts' | 'notifications' | 'microphone' | 'audio';

export interface PermissionInfo {
  key: PermissionKey;
  /** the call cannot be placed without it */
  required: boolean;
  permissions: Permission[];
}

const P = PermissionsAndroid.PERMISSIONS;
const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);

export const PERMISSION_INFO: PermissionInfo[] = [
  { key: 'phone', required: true, permissions: [P.CALL_PHONE, P.READ_PHONE_STATE, P.ANSWER_PHONE_CALLS] },
  { key: 'callLog', required: true, permissions: [P.READ_CALL_LOG] },
  { key: 'contacts', required: false, permissions: [P.READ_CONTACTS] },
  { key: 'notifications', required: false, permissions: apiLevel >= 33 ? [P.POST_NOTIFICATIONS] : [] },
  { key: 'microphone', required: false, permissions: [P.RECORD_AUDIO] },
  { key: 'audio', required: false, permissions: apiLevel >= 33 ? [P.READ_MEDIA_AUDIO] : [P.READ_EXTERNAL_STORAGE] },
];

export type PermissionStatus = Record<PermissionKey, boolean>;

const NONE: PermissionStatus = { phone: false, callLog: false, contacts: false, notifications: false, microphone: false, audio: false };

export function statusFromCapabilities(caps: Capabilities): PermissionStatus {
  return {
    phone: caps.permissions.callPhone && caps.permissions.readPhoneState,
    callLog: caps.permissions.readCallLog,
    contacts: caps.permissions.readContacts,
    notifications: caps.permissions.postNotifications,
    microphone: caps.permissions.recordAudio,
    audio: caps.permissions.readAudio,
  };
}

export async function readPermissionStatus(): Promise<PermissionStatus> {
  if (!telephony.isAvailable()) return NONE;
  return statusFromCapabilities(await telephony.getCapabilities());
}

export interface RequestResult {
  granted: boolean;
  /** true when Android will no longer show the dialog (the user must use Settings) */
  blocked: boolean;
}

/** Ask for one group of permissions. */
export async function requestGroup(key: PermissionKey): Promise<RequestResult> {
  const info = PERMISSION_INFO.find((p) => p.key === key);
  if (!info || info.permissions.length === 0) return { granted: true, blocked: false };
  const result = await PermissionsAndroid.requestMultiple(info.permissions);
  const values = Object.values(result);
  const core = info.permissions.filter((p) => p !== P.ANSWER_PHONE_CALLS); // ending calls from the app is optional
  const coreGranted = core.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
  return { granted: coreGranted, blocked: values.includes(PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) };
}

/** What the first "Grant all" asks for: everything a call needs plus the contact names and notifications. */
export const ESSENTIAL_KEYS: PermissionKey[] = ['phone', 'callLog', 'contacts', 'notifications'];

export async function requestEssential(): Promise<PermissionStatus> {
  for (const key of ESSENTIAL_KEYS) await requestGroup(key);
  return readPermissionStatus();
}

/** Ask for everything (also used by the telephony check). Recording-related permissions only when recording is on. */
export async function requestAll(includeRecording: boolean): Promise<PermissionStatus> {
  for (const key of ESSENTIAL_KEYS) await requestGroup(key);
  if (includeRecording) {
    await requestGroup('microphone');
    await requestGroup('audio');
  }
  return readPermissionStatus();
}

/** Minimum needed to place and track calls. */
export function canCall(status: PermissionStatus): boolean {
  return status.phone;
}
