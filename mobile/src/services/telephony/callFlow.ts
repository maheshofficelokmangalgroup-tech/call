/**
 * Orchestrates one call from "tap Call" to "outcome saved" (sections 7.3, 7.4, 9).
 *
 *   startCall -> (phone goes OFFHOOK) -> (phone goes IDLE) -> finishCall reads the call log ->
 *   outcome screen -> submitOutcome -> sync queue.
 *
 * Every step is written to SQLite first, so a killed app, a dead battery or a lost connection never loses a call.
 */
import {
  CALL_LOG_POLL_MS,
  CALL_LOG_POLL_TRIES,
  DIAL_TIMEOUT_MS,
  RECORDING_SCAN_INTERVAL_MS,
  RECORDING_SCAN_TRIES,
} from '../../config/env';
import { getCall, getPendingWrapup, insertCall, updateCall, type LocalCall } from '../../database/calls';
import { useAuth } from '../../store/authStore';
import { useCallStore, type ActiveCall } from '../../store/callStore';
import { newCallId } from '../../utils/ids';
import { syncEngine } from '../sync/syncEngine';
import type { DispositionCode } from '../api/types';
import { suggestDisposition } from './callOutcome';
import { nativeErrorCode, telephony, type NativeSession, type PhoneStateEvent } from './native';
import { readPermissionStatus } from './permissions';
import { encodeMissing, missingCodeForSession, type MissingRecordingCode } from './recordingStatus';

export class PermissionRequired extends Error {
  constructor() {
    super('Phone permission is required to place calls');
    this.name = 'PermissionRequired';
  }
}

export class WrapupPending extends Error {
  readonly callUuid: string;
  constructor(callUuid: string) {
    super('Finish the previous call before starting a new one');
    this.name = 'WrapupPending';
    this.callUuid = callUuid;
  }
}

export class CallPlacementFailed extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'CallPlacementFailed';
    this.code = code;
  }
}

/** Call was tapped again while the previous tap is still setting its call up. */
export class CallStartInProgress extends Error {
  constructor() {
    super('A call is already being started');
    this.name = 'CallStartInProgress';
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const store = () => useCallStore.getState();

function employeeId(): number {
  const employee = useAuth.getState().employee;
  if (!employee) throw new Error('Not signed in');
  return employee.id;
}

function toActive(call: LocalCall, phase: ActiveCall['phase']): ActiveCall {
  return {
    uuid: call.uuid,
    contactId: call.contactId,
    contactName: call.contactName,
    phone: call.phone,
    campaignId: call.campaignId,
    startedAt: call.startedAt,
    offhookAt: null,
    endedAt: call.endedAt,
    phase,
    durationSec: call.durationSec,
    answered: call.durationSec > 0,
    suggested: null,
    error: null,
  };
}

export interface StartCallInput {
  contactId: number | null;
  contactName: string | null;
  phone: string;
  campaignId?: number | null;
  /** which SIM to use on a dual-SIM phone (see sim.ts); null lets the phone decide */
  accountKey?: string | null;
}

/** true while a call is being set up (from the permission check until it is handed to the dialer or has failed) */
let starting = false;

/**
 * One call start at a time. A second tap on Call that lands while the first is still being set up would otherwise pass the
 * "previous call needs an outcome" check too (neither call row is saved yet): two call rows, two calls queued for the
 * server, two dialer intents - and the orphaned first row then blocks every later call as "needs an outcome".
 */
export async function startCall(input: StartCallInput): Promise<string> {
  if (starting) throw new CallStartInProgress();
  starting = true;
  try {
    return await placeNewCall(input);
  } finally {
    starting = false;
  }
}

async function placeNewCall(input: StartCallInput): Promise<string> {
  const status = await readPermissionStatus();
  if (!status.phone) throw new PermissionRequired();

  const pending = await getPendingWrapup(employeeId());
  if (pending.length) throw new WrapupPending(pending[0].uuid);

  const now = Date.now();
  const call: LocalCall = {
    uuid: newCallId(),
    serverId: null,
    employeeId: employeeId(),
    contactId: input.contactId,
    contactName: input.contactName,
    phone: input.phone,
    campaignId: input.campaignId ?? null,
    startedAt: now,
    answeredAt: null,
    endedAt: null,
    durationSec: 0,
    status: 'initiated',
    disposition: null,
    notes: null,
    callbackAt: null,
    callbackNote: null,
    wrapupDone: false,
    reconciled: false,
    recordingState: null,
    recordingUri: null,
    recordingMime: null,
    recordingSize: null,
    recordingServerId: null,
    recordingError: null,
    createdAt: now,
    updatedAt: now,
  };
  await insertCall(call);
  store().setActive(toActive(call, 'placing'));
  await syncEngine.enqueue('create_call', {}, call.uuid);

  try {
    await telephony.startListening().catch(() => false);
    const placed = await telephony.placeCall(input.phone, call.uuid, input.accountKey ?? null);
    await updateCall(call.uuid, { startedAt: placed.startedAtMs });
    store().patchActive(call.uuid, { startedAt: placed.startedAtMs });
  } catch (error) {
    const code = nativeErrorCode(error);
    const message = friendlyPlacementError(code, error);
    await failCall(call.uuid, message);
    throw new CallPlacementFailed(code, message);
  }

  watchDialTimeout(call.uuid);
  return call.uuid;
}

function friendlyPlacementError(code: string, error: unknown): string {
  switch (code) {
    case 'NO_PERMISSION':
      return 'Phone permission was denied. Allow it in Settings to place calls.';
    case 'NO_TELEPHONY':
      return 'This device cannot place phone calls.';
    case 'INVALID_NUMBER':
      return 'This phone number is not valid.';
    case 'NO_DIALER':
      return 'No phone app was found on this device.';
    default:
      return error instanceof Error ? error.message : 'The call could not be started.';
  }
}

/** The call never happened (could not be placed / phone never went off-hook). No outcome is needed. */
async function failCall(uuid: string, reason: string): Promise<void> {
  clearDialTimer(uuid);
  const now = Date.now();
  await updateCall(uuid, { status: 'failed', endedAt: now, reconciled: true, wrapupDone: true });
  await syncEngine.enqueue('call_events', { events: [{ type: 'failed', at: now, payload: { reason } }] }, uuid);
  await syncEngine.enqueue('call_update', {}, uuid);
  await telephony.clearSession(uuid).catch(() => undefined);
  store().patchActive(uuid, { phase: 'failed', error: reason, endedAt: now });
}

const dialTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearDialTimer(uuid: string): void {
  const timer = dialTimers.get(uuid);
  if (timer) clearTimeout(timer);
  dialTimers.delete(uuid);
}

/** Stop every pending dial watchdog (used when signing out and by the tests). */
export function cancelAllDialTimers(): void {
  dialTimers.forEach((timer) => clearTimeout(timer));
  dialTimers.clear();
}

/** If the phone never reports OFFHOOK the dialer refused the call (no SIM, airplane mode, ...). */
function watchDialTimeout(uuid: string): void {
  clearDialTimer(uuid);
  dialTimers.set(
    uuid,
    setTimeout(() => {
      dialTimers.delete(uuid);
      void checkDialTimeout(uuid);
    }, DIAL_TIMEOUT_MS),
  );
}

async function checkDialTimeout(uuid: string): Promise<void> {
  const active = store().active;
  if (!active || active.uuid !== uuid || active.phase !== 'placing') return;
  const session = await telephony.getActiveSession().catch(() => null);
  if (session && session.id === uuid && session.offhookAtMs) {
    await onPhoneState({ state: 'OFFHOOK', timestampMs: session.offhookAtMs, sessionId: uuid, sessionChanged: true });
    if (session.endedAtMs) await finishCall(uuid, session.endedAtMs);
    return;
  }
  await failCall(uuid, 'The phone did not start the call. Check the SIM card and network, then try again.');
}

/** Wired to the native phone-state events by <CallWatcher/>. */
export async function onPhoneState(event: PhoneStateEvent): Promise<void> {
  const active = store().active;
  if (!active || !event.sessionId || event.sessionId !== active.uuid || !event.sessionChanged) return;

  if (event.state === 'OFFHOOK' && active.phase === 'placing') {
    clearDialTimer(active.uuid);
    store().patchActive(active.uuid, { phase: 'in_progress', offhookAt: event.timestampMs });
    await updateCall(active.uuid, { status: 'dialing' });
  } else if (event.state === 'IDLE' && (active.phase === 'placing' || active.phase === 'in_progress')) {
    await finishCall(active.uuid, event.timestampMs);
  }
}

async function readCallLogWithRetry(phone: string, sinceMs: number) {
  for (let attempt = 0; attempt < CALL_LOG_POLL_TRIES; attempt++) {
    try {
      const entry = await telephony.readCallLog(phone, sinceMs);
      if (entry.found) return entry;
    } catch (error) {
      if (nativeErrorCode(error) === 'NO_PERMISSION') return null; // cannot read the log: fall back to phone-state times
    }
    await sleep(CALL_LOG_POLL_MS);
  }
  return null;
}

const finishing = new Set<string>();

export async function finishCall(uuid: string, endedAtMs: number): Promise<void> {
  if (finishing.has(uuid)) return;
  finishing.add(uuid);
  clearDialTimer(uuid);
  try {
    const call = await getCall(uuid);
    if (!call || call.reconciled) return;
    store().patchActive(uuid, { phase: 'finishing', endedAt: endedAtMs });

    const found = await telephony.getActiveSession().catch(() => null);
    const session = found?.id === uuid ? found : null;
    // The phone-app mode knows exactly when the other side answered and why the call ended; otherwise ask the call log.
    const native = session?.source === 'dialer';
    const entry = native ? null : await readCallLogWithRetry(call.phone, call.startedAt);

    // The phone going idle is the real hang-up time. The call log's `date` is when dialing began and its duration only
    // covers the talk time, so the moment the other side picked up is derived backwards from the hang-up.
    const endedAt = Math.max(endedAtMs, call.startedAt);
    let answeredAt: number | null = null;
    let durationSec = 0;
    if (native) {
      if (session?.answeredAtMs) {
        answeredAt = Math.min(session.answeredAtMs, endedAt);
        durationSec = Math.max(1, Math.round((endedAt - answeredAt) / 1000));
      }
    } else {
      durationSec = entry?.durationSec ?? 0;
      answeredAt = durationSec > 0 ? Math.max(call.startedAt, endedAt - durationSec * 1000) : null;
    }
    const answered = durationSec > 0;
    const offhookAt = session ? session.offhookAtMs : store().active?.offhookAt ?? null;

    await updateCall(uuid, {
      endedAt,
      answeredAt,
      durationSec,
      status: answered ? 'completed' : 'no_answer',
      reconciled: true,
    });

    const events: { type: string; at: number; payload?: Record<string, unknown> }[] = [];
    if (offhookAt) events.push({ type: 'dialing', at: offhookAt });
    if (answeredAt) events.push({ type: 'connected', at: answeredAt });
    const source = native ? 'in_call_service' : entry ? 'call_log' : 'phone_state';
    // The server keeps what the microphone recording did too, so an administrator can see why a call has no recording.
    const recordingNote =
      native && session?.recordingStatus
        ? { recording: session.recordingStatus, ...(session.recordingDetail ? { recording_detail: session.recordingDetail.slice(0, 240) } : {}) }
        : {};
    events.push({ type: 'ended', at: endedAt, payload: { source, ...(native && session?.causeReason ? { reason: session.causeReason } : {}), ...recordingNote } });
    await syncEngine.enqueue('call_events', { events }, uuid);
    await syncEngine.enqueue('call_update', { externalRef: entry?.id ? `calllog-${entry.id}` : null }, uuid);
    await telephony.clearSession(uuid).catch(() => undefined);

    const suggested: DispositionCode = native
      ? suggestDisposition({ answered, causeCode: session?.causeCode ?? -1, causeReason: session?.causeReason ?? null })
      : answered
        ? 'CONNECTED'
        : 'NO_ANSWER';

    // The in-call service's own recording is already finished: attach it (or the reason there is none) before the outcome
    // screen opens, so that screen already knows whether this call was recorded.
    if (native && session) await attachOwnRecording(uuid, session);
    store().patchActive(uuid, { phase: 'needs_outcome', durationSec, answered, endedAt, suggested });

    // The phone's own recorder may need a few seconds to write its file: look for it in the background.
    if (!native && answered && useAuth.getState().config?.recording.enabled) void scanForRecording(uuid);
  } finally {
    finishing.delete(uuid);
  }
}

/** On launch / resume: pick up a call whose events happened while the JS runtime was not running. */
export async function recoverSession(): Promise<void> {
  if (!telephony.isAvailable() || !useAuth.getState().employee) return;
  const session = await telephony.getActiveSession().catch(() => null);
  if (!session) return;
  const call = await getCall(session.id);
  if (!call || call.reconciled) {
    await telephony.clearSession(session.id).catch(() => undefined);
    return;
  }
  if (!store().active || store().active?.uuid !== call.uuid) store().setActive(toActive(call, session.offhookAtMs ? 'in_progress' : 'placing'));
  if (session.endedAtMs) {
    await finishCall(call.uuid, session.endedAtMs);
  } else if (session.offhookAtMs) {
    store().patchActive(call.uuid, { phase: 'in_progress', offhookAt: session.offhookAtMs });
  } else if (Date.now() - session.startedAtMs > DIAL_TIMEOUT_MS) {
    await failCall(call.uuid, 'The phone did not start the call.');
  } else {
    watchDialTimeout(call.uuid);
  }
}

/** A call reconciled earlier but never wrapped up (app was closed): bring it back as the active call. */
export async function restorePendingWrapup(): Promise<LocalCall | null> {
  const employee = useAuth.getState().employee;
  if (!employee) return null;
  const pending = await getPendingWrapup(employee.id);
  const call = pending.find((c) => c.reconciled);
  if (!call) return null;
  if (!store().active || store().active?.uuid !== call.uuid) {
    store().setActive({
      ...toActive(call, 'needs_outcome'),
      answered: call.durationSec > 0,
      suggested: call.durationSec > 0 ? 'CONNECTED' : 'NO_ANSWER',
    });
  }
  return call;
}

export interface OutcomeInput {
  code: DispositionCode;
  notes?: string | null;
  callbackAt?: number | null;
  callbackNote?: string | null;
}

export async function submitOutcome(uuid: string, input: OutcomeInput): Promise<void> {
  const call = await getCall(uuid);
  if (!call) throw new Error('Call not found');
  const notes = input.notes?.trim() || null;
  await updateCall(uuid, {
    disposition: input.code,
    notes,
    callbackAt: input.callbackAt ?? null,
    callbackNote: input.callbackNote?.trim() || null,
    wrapupDone: true,
    status: call.status === 'initiated' || call.status === 'dialing' ? (input.code === 'NO_ANSWER' ? 'no_answer' : 'completed') : call.status,
  });
  await syncEngine.enqueue('disposition', {}, uuid);
  if (useCallStore.getState().active?.uuid === uuid) store().setActive(null);
}

// ---------------------------------------------------------------- recordings
/** Remembers, on the call, that nothing was recorded and why - the call details and the outcome screen show it. */
async function markNotRecorded(uuid: string, code: MissingRecordingCode, detail?: string | null): Promise<void> {
  try {
    await updateCall(uuid, { recordingState: 'unavailable', recordingError: encodeMissing(code, detail) });
  } catch {
    // only an explanation is lost
  }
}

/**
 * The microphone recording the in-call service made (phone-app mode): queue it for upload like any other recording. When the
 * service could not record, the reason is stored instead - never a recording that does not exist.
 */
export async function attachOwnRecording(uuid: string, session: NativeSession): Promise<void> {
  if (session.recordingStatus === 'saved' && session.recordingPath) {
    try {
      const info = await telephony.getFileInfo(session.recordingPath);
      if (!info.exists || info.size < 1024) {
        await markNotRecorded(uuid, 'failed', 'the recording file is missing or empty');
        return;
      }
      await updateCall(uuid, {
        recordingUri: `file://${session.recordingPath}`,
        recordingMime: 'audio/mp4',
        recordingSize: info.size,
        recordingState: 'pending',
        recordingError: null,
      });
      await syncEngine.enqueue('recording_meta', { sizeBytes: info.size }, uuid);
      await syncEngine.enqueue('recording_upload', { name: `call-${uuid}.m4a` }, uuid);
    } catch {
      // the file stays on the phone; nothing is claimed about it
    }
    return;
  }
  const code = missingCodeForSession(session.recordingStatus);
  if (code) await markNotRecorded(uuid, code, session.recordingDetail);
}

/** Look for the file the phone's own call recorder produced (it may take a few seconds to appear). */
export async function scanForRecording(uuid: string): Promise<void> {
  const call = await getCall(uuid);
  if (!call || call.recordingUri || !call.endedAt) return;
  for (let attempt = 0; attempt < RECORDING_SCAN_TRIES; attempt++) {
    try {
      const found = await telephony.findRecentRecording(call.startedAt, call.endedAt);
      if (found) {
        await updateCall(uuid, {
          recordingUri: found.uri,
          recordingMime: found.mimeType,
          recordingSize: found.sizeBytes,
          recordingState: 'pending',
          recordingError: null,
        });
        await syncEngine.enqueue('recording_meta', { sizeBytes: found.sizeBytes }, uuid);
        await syncEngine.enqueue('recording_upload', { name: found.displayName || `call-${uuid}.m4a` }, uuid);
        return;
      }
    } catch (error) {
      if (nativeErrorCode(error) === 'NO_PERMISSION') {
        await markNotRecorded(uuid, 'no_media_access');
        return;
      }
    }
    await sleep(RECORDING_SCAN_INTERVAL_MS);
  }
  // Nothing found: the device did not record this call. No recording record is created on the server (section 7.7); the
  // call only remembers why, so the employee is not left looking for a recording that does not exist.
  await markNotRecorded(uuid, 'no_file');
}

/** Re-queue an upload that failed (user tapped Retry). */
export async function retryRecordingUpload(uuid: string): Promise<void> {
  const call = await getCall(uuid);
  if (!call?.recordingUri) return;
  await updateCall(uuid, { recordingState: 'pending', recordingError: null });
  if (!call.recordingServerId) await syncEngine.enqueue('recording_meta', { sizeBytes: call.recordingSize ?? 0 }, uuid);
  await syncEngine.enqueue('recording_upload', { name: `call-${uuid}.m4a` }, uuid);
}
