/**
 * Why a call has no recording, in words an employee can act on.
 *
 * Android does not let ordinary apps record the other side of a phone call, so "this call was not recorded" is a normal
 * outcome, not an error - but silence about it made people look for a recording that never existed. The reason is kept on the
 * call (LocalCall.recordingError, state "unavailable") as  "<code>|<technical detail>"  and turned into text here, so the wording
 * can improve without a database migration.
 */
import type { NativeSession } from './native';

export type MissingRecordingCode =
  | 'no_permission' // phone-app mode: the microphone permission is off
  | 'silent' // phone-app mode: the microphone only delivered silence (the phone blocks it during calls)
  | 'failed' // phone-app mode: the recorder could not start / finish
  | 'no_file' // phone's own dialer: the phone's call recorder left no file
  | 'no_media_access'; // phone's own dialer: no permission to look for that file

export interface MissingRecording {
  code: MissingRecordingCode;
  /** the one-line reason */
  title: string;
  /** what the employee can do about it */
  advice: string;
  /** technical line for the person who looks into it (microphone source, loudest sound ...) */
  detail: string | null;
  /** the Phone setup screen is where this gets fixed */
  fixInSetup: boolean;
}

const TEXT: Record<MissingRecordingCode, { title: string; advice: string; fixInSetup: boolean }> = {
  no_permission: {
    title: 'The microphone permission is off',
    advice: 'Allow the microphone in Phone setup. Calls made after that can be recorded.',
    fixInSetup: true,
  },
  silent: {
    title: 'The phone gave the app only silence',
    advice:
      'Android lets only the phone itself record while a call is on - most phones give other apps no sound at all, so nothing is wrong with your settings. A silent file is never saved or uploaded. If your company needs every call recorded, it needs a cloud-telephony recording service.',
    fixInSetup: false,
  },
  failed: {
    title: 'The phone would not start the recorder',
    advice: 'Try again on the next call. If it keeps happening, run Device & telephony check in your profile and share the report.',
    fixInSetup: false,
  },
  no_file: {
    title: "The phone's call recorder left no file",
    advice:
      "While the phone's own dialer makes the call, the phone records it, not this app. Turn on automatic call recording in your phone's Phone app settings, or make calls through this app after setting it as your phone app.",
    fixInSetup: true,
  },
  no_media_access: {
    title: "The app may not look for the phone's recording",
    advice: 'Allow access to audio files in Phone setup so the recording your phone made can be found.',
    fixInSetup: true,
  },
};

const CODES = Object.keys(TEXT) as MissingRecordingCode[];

/** What goes into LocalCall.recordingError for a call that was not recorded. */
export function encodeMissing(code: MissingRecordingCode, detail?: string | null): string {
  const clean = detail?.replace(/\s+/g, ' ').trim();
  return clean ? `${code}|${clean.slice(0, 240)}` : code;
}

/** Reads the value written by [encodeMissing]; null when it is not a "not recorded" reason. */
export function decodeMissing(value: string | null | undefined): MissingRecording | null {
  if (!value) return null;
  const cut = value.indexOf('|');
  const code = (cut === -1 ? value : value.slice(0, cut)) as MissingRecordingCode;
  if (!CODES.includes(code)) return null;
  const detail = cut === -1 ? '' : value.slice(cut + 1).trim();
  return { code, ...TEXT[code], detail: detail || null };
}

/** The reason for a recording the in-call service tried to make, or null when there is nothing to report. */
export function missingCodeForSession(status: NativeSession['recordingStatus'] | undefined): MissingRecordingCode | null {
  switch (status) {
    case 'no_permission':
      return 'no_permission';
    case 'silent':
      return 'silent';
    case 'failed':
      return 'failed';
    default:
      return null; // saved / still recording / never attempted (recording off, personal call, call not answered)
  }
}
