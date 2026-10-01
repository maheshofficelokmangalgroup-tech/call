/**
 * The call lifecycle: permission/wrap-up guards, phone-state transitions, call-log reconciliation, outcome, recovery.
 */
import { RECORDING_SCAN_TRIES } from '../src/config/env';
import type { LocalCall } from '../src/database/calls';
import * as callsDb from '../src/database/calls';
import {
  CallPlacementFailed,
  PermissionRequired,
  WrapupPending,
  cancelAllDialTimers,
  finishCall,
  onPhoneState,
  recoverSession,
  restorePendingWrapup,
  scanForRecording,
  startCall,
  submitOutcome,
} from '../src/services/telephony/callFlow';
import { telephony } from '../src/services/telephony/native';
import * as perms from '../src/services/telephony/permissions';
import { syncEngine } from '../src/services/sync/syncEngine';
import { useAuth } from '../src/store/authStore';
import { useCallStore } from '../src/store/callStore';

jest.mock('../src/database/calls');
jest.mock('../src/services/sync/syncEngine', () => ({ syncEngine: { enqueue: jest.fn(async () => undefined) } }));
jest.mock('../src/services/telephony/permissions', () => ({ readPermissionStatus: jest.fn() }));
jest.mock('../src/services/telephony/native', () => ({
  telephony: {
    isAvailable: jest.fn(() => true),
    startListening: jest.fn(async () => true),
    placeCall: jest.fn(),
    readCallLog: jest.fn(),
    getActiveSession: jest.fn(),
    clearSession: jest.fn(async () => true),
    findRecentRecording: jest.fn(),
    getFileInfo: jest.fn(),
  },
  nativeErrorCode: (e: { code?: string }) => e?.code ?? 'UNKNOWN',
}));
jest.mock('../src/store/authStore', () => {
  const state = { employee: { id: 1, full_name: 'Test' }, config: { recording: { enabled: false } } };
  return { useAuth: Object.assign(() => state, { getState: () => state, setState: (p: object) => Object.assign(state, p) }) };
});

const db = callsDb as jest.Mocked<typeof callsDb>;
const tel = telephony as unknown as Record<string, jest.Mock>;
const enqueue = syncEngine.enqueue as jest.Mock;
const readPerms = perms.readPermissionStatus as jest.Mock;

const granted = { phone: true, callLog: true, contacts: true, notifications: true, microphone: true, audio: true };

function stored(partial: Partial<LocalCall> = {}): LocalCall {
  return {
    uuid: 'u1', serverId: null, employeeId: 1, contactId: 10, contactName: 'Asha', phone: '+919876543210', campaignId: null,
    startedAt: 1_000_000, answeredAt: null, endedAt: null, durationSec: 0, status: 'initiated', disposition: null, notes: null,
    callbackAt: null, callbackNote: null, wrapupDone: false, reconciled: false, recordingState: null, recordingUri: null,
    recordingMime: null, recordingSize: null, recordingServerId: null, recordingError: null, createdAt: 1, updatedAt: 1,
    ...partial,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useCallStore.setState({ active: null, outcomeShownFor: null });
  readPerms.mockResolvedValue(granted);
  db.getPendingWrapup.mockResolvedValue([]);
  db.insertCall.mockResolvedValue(undefined);
  db.updateCall.mockResolvedValue(undefined);
  tel.getActiveSession.mockResolvedValue(null);
  tel.readCallLog.mockResolvedValue({ found: false });
  (useAuth as unknown as { setState: (p: object) => void }).setState({ config: { recording: { enabled: false } } });
});

afterEach(() => cancelAllDialTimers());

const active = () => useCallStore.getState().active;
const flush = () => new Promise<void>((resolve) => setImmediate(() => resolve()));

describe('startCall', () => {
  it('needs the phone permission', async () => {
    readPerms.mockResolvedValue({ ...granted, phone: false });
    await expect(startCall({ contactId: 10, contactName: 'Asha', phone: '+919876543210' })).rejects.toBeInstanceOf(PermissionRequired);
    expect(db.insertCall).not.toHaveBeenCalled();
    expect(tel.placeCall).not.toHaveBeenCalled();
  });

  it('refuses a new call while the previous one has no outcome', async () => {
    db.getPendingWrapup.mockResolvedValue([stored({ uuid: 'old' })]);
    const error = await startCall({ contactId: 10, contactName: 'Asha', phone: '+919876543210' }).catch((e) => e);
    expect(error).toBeInstanceOf(WrapupPending);
    expect(error.callUuid).toBe('old');
    expect(tel.placeCall).not.toHaveBeenCalled();
  });

  it('saves the call first, queues it for sync, then hands it to the dialer', async () => {
    tel.placeCall.mockResolvedValue({ startedAtMs: 1_234_567 });
    const uuid = await startCall({ contactId: 10, contactName: 'Asha', phone: '+919876543210', campaignId: 3 });
    expect(db.insertCall).toHaveBeenCalledWith(expect.objectContaining({ uuid, contactId: 10, phone: '+919876543210', campaignId: 3, status: 'initiated', wrapupDone: false }));
    expect(enqueue).toHaveBeenCalledWith('create_call', {}, uuid);
    expect(tel.placeCall).toHaveBeenCalledWith('+919876543210', uuid, null);
    expect(db.updateCall).toHaveBeenCalledWith(uuid, { startedAt: 1_234_567 });
    expect(active()).toMatchObject({ uuid, phase: 'placing', startedAt: 1_234_567 });
  });

  it('records a placement failure as a failed call that needs no outcome', async () => {
    tel.placeCall.mockRejectedValue({ code: 'NO_PERMISSION', message: 'denied' });
    const error = await startCall({ contactId: null, contactName: null, phone: '+919876543210' }).catch((e) => e);
    expect(error).toBeInstanceOf(CallPlacementFailed);
    expect(error.code).toBe('NO_PERMISSION');
    expect(db.updateCall).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ status: 'failed', wrapupDone: true, reconciled: true }));
    expect(enqueue).toHaveBeenCalledWith('call_events', { events: [expect.objectContaining({ type: 'failed' })] }, expect.any(String));
    expect(active()?.phase).toBe('failed');
  });
});

describe('phone-state handling', () => {
  async function dialing() {
    tel.placeCall.mockResolvedValue({ startedAtMs: 1_000_000 });
    const uuid = await startCall({ contactId: 10, contactName: 'Asha', phone: '+919876543210' });
    db.getCall.mockResolvedValue(stored({ uuid }));
    return uuid;
  }

  it('OFFHOOK moves the call to in_progress', async () => {
    const uuid = await dialing();
    await onPhoneState({ state: 'OFFHOOK', timestampMs: 1_002_000, sessionId: uuid, sessionChanged: true });
    expect(active()).toMatchObject({ phase: 'in_progress', offhookAt: 1_002_000 });
    expect(db.updateCall).toHaveBeenCalledWith(uuid, { status: 'dialing' });
  });

  it('ignores events of other sessions and duplicate broadcasts', async () => {
    const uuid = await dialing();
    await onPhoneState({ state: 'OFFHOOK', timestampMs: 1, sessionId: 'someone-else', sessionChanged: true });
    await onPhoneState({ state: 'OFFHOOK', timestampMs: 1, sessionId: uuid, sessionChanged: false });
    expect(active()?.phase).toBe('placing');
  });

  it('IDLE after an answered call reads the call log and asks for an outcome (suggesting Connected)', async () => {
    const uuid = await dialing();
    await onPhoneState({ state: 'OFFHOOK', timestampMs: 1_002_000, sessionId: uuid, sessionChanged: true });
    tel.readCallLog.mockResolvedValue({ found: true, id: 77, dateMs: 1_001_000, durationSec: 62 });
    tel.getActiveSession.mockResolvedValue({ id: uuid, number: '+919876543210', startedAtMs: 1_000_000, offhookAtMs: 1_002_000, endedAtMs: 1_070_000 });
    await onPhoneState({ state: 'IDLE', timestampMs: 1_070_000, sessionId: uuid, sessionChanged: true });

    // ended = the moment the phone went idle; answered = ended minus the talk time the call log reports
    expect(db.updateCall).toHaveBeenCalledWith(uuid, expect.objectContaining({ durationSec: 62, status: 'completed', reconciled: true, endedAt: 1_070_000, answeredAt: 1_070_000 - 62_000 }));
    const events = (enqueue.mock.calls.find((c) => c[0] === 'call_events' && c[1].events.some((e: { type: string }) => e.type === 'ended')) as unknown[])[1] as { events: { type: string }[] };
    expect(events.events.map((e) => e.type)).toEqual(['dialing', 'connected', 'ended']);
    expect(enqueue).toHaveBeenCalledWith('call_update', { externalRef: 'calllog-77' }, uuid);
    expect(tel.clearSession).toHaveBeenCalledWith(uuid);
    expect(active()).toMatchObject({ phase: 'needs_outcome', answered: true, suggested: 'CONNECTED', durationSec: 62 });
  });

  it('an unanswered call (duration 0) suggests No Answer', async () => {
    const uuid = await dialing();
    tel.readCallLog.mockResolvedValue({ found: true, id: 78, dateMs: 1_001_000, durationSec: 0 });
    await onPhoneState({ state: 'OFFHOOK', timestampMs: 1_002_000, sessionId: uuid, sessionChanged: true });
    await onPhoneState({ state: 'IDLE', timestampMs: 1_030_000, sessionId: uuid, sessionChanged: true });
    // a call nobody picked up still ended when the phone went idle, not when dialing began
    expect(db.updateCall).toHaveBeenCalledWith(uuid, expect.objectContaining({ durationSec: 0, status: 'no_answer', answeredAt: null, endedAt: 1_030_000 }));
    expect(active()).toMatchObject({ phase: 'needs_outcome', answered: false, suggested: 'NO_ANSWER' });
  });

  it('falls back to phone-state times when the call log cannot be read', async () => {
    const uuid = await dialing();
    tel.readCallLog.mockRejectedValue({ code: 'NO_PERMISSION' });
    await finishCall(uuid, 1_045_000);
    expect(db.updateCall).toHaveBeenCalledWith(uuid, expect.objectContaining({ endedAt: 1_045_000, durationSec: 0, reconciled: true }));
    expect(active()?.phase).toBe('needs_outcome');
  });

  describe('when this app is the phone app (the in-call service owns the call)', () => {
    const dialerSession = (uuid: string, patch: Record<string, unknown> = {}) => ({
      id: uuid,
      number: '+919876543210',
      startedAtMs: 1_000_000,
      offhookAtMs: 1_002_000,
      endedAtMs: 1_070_000,
      answeredAtMs: 1_010_000,
      source: 'dialer',
      causeCode: 3,
      causeReason: null,
      recordingStatus: null,
      recordingPath: null,
      recordingDurationMs: 0,
      ...patch,
    });

    it('takes the answer time and the end from the service and never reads the call log', async () => {
      const uuid = await dialing();
      tel.getActiveSession.mockResolvedValue(dialerSession(uuid));
      await onPhoneState({ state: 'OFFHOOK', timestampMs: 1_002_000, sessionId: uuid, sessionChanged: true });
      await onPhoneState({ state: 'IDLE', timestampMs: 1_070_000, sessionId: uuid, sessionChanged: true });

      expect(tel.readCallLog).not.toHaveBeenCalled();
      expect(db.updateCall).toHaveBeenCalledWith(uuid, expect.objectContaining({ durationSec: 60, status: 'completed', endedAt: 1_070_000, answeredAt: 1_010_000, reconciled: true }));
      expect(active()).toMatchObject({ phase: 'needs_outcome', answered: true, suggested: 'CONNECTED', durationSec: 60 });
      const events = (enqueue.mock.calls.find((c) => c[0] === 'call_events' && c[1].events.some((e: { type: string }) => e.type === 'ended')) as unknown[])[1] as { events: { type: string; payload?: { source: string } }[] };
      expect(events.events.map((e) => e.type)).toEqual(['dialing', 'connected', 'ended']);
      expect(events.events[2].payload?.source).toBe('in_call_service');
    });

    it('uses the disconnect cause to suggest the outcome of an unanswered call', async () => {
      const uuid = await dialing();
      tel.getActiveSession.mockResolvedValue(dialerSession(uuid, { answeredAtMs: null, causeCode: 7, causeReason: 'BUSY' }));
      await onPhoneState({ state: 'OFFHOOK', timestampMs: 1_002_000, sessionId: uuid, sessionChanged: true });
      await onPhoneState({ state: 'IDLE', timestampMs: 1_030_000, sessionId: uuid, sessionChanged: true });
      expect(db.updateCall).toHaveBeenCalledWith(uuid, expect.objectContaining({ durationSec: 0, status: 'no_answer', answeredAt: null }));
      expect(active()).toMatchObject({ answered: false, suggested: 'BUSY' });
    });

    it('queues the microphone recording the service made for upload', async () => {
      const uuid = await dialing();
      tel.getActiveSession.mockResolvedValue(dialerSession(uuid, { recordingStatus: 'saved', recordingPath: '/data/files/recordings/x.m4a', recordingDurationMs: 60_000 }));
      tel.getFileInfo.mockResolvedValue({ exists: true, size: 48_000 });
      await onPhoneState({ state: 'OFFHOOK', timestampMs: 1_002_000, sessionId: uuid, sessionChanged: true });
      await onPhoneState({ state: 'IDLE', timestampMs: 1_070_000, sessionId: uuid, sessionChanged: true });
      await flush(); // the upload is queued in the background

      expect(db.updateCall).toHaveBeenCalledWith(uuid, expect.objectContaining({ recordingUri: 'file:///data/files/recordings/x.m4a', recordingMime: 'audio/mp4', recordingSize: 48_000, recordingState: 'pending' }));
      expect(enqueue).toHaveBeenCalledWith('recording_meta', { sizeBytes: 48_000 }, uuid);
      expect(enqueue).toHaveBeenCalledWith('recording_upload', { name: `call-${uuid}.m4a` }, uuid);
    });

    it('does not claim a recording when the service could not capture one - it keeps the reason instead', async () => {
      const uuid = await dialing();
      tel.getActiveSession.mockResolvedValue(dialerSession(uuid, { recordingStatus: 'silent', recordingDetail: 'source MIC, loudest sound 0 of 32767, 14 s' }));
      await onPhoneState({ state: 'OFFHOOK', timestampMs: 1_002_000, sessionId: uuid, sessionChanged: true });
      await onPhoneState({ state: 'IDLE', timestampMs: 1_070_000, sessionId: uuid, sessionChanged: true });
      await flush();
      expect(enqueue).not.toHaveBeenCalledWith('recording_meta', expect.anything(), uuid);
      expect(enqueue).not.toHaveBeenCalledWith('recording_upload', expect.anything(), uuid);
      expect(db.updateCall).toHaveBeenCalledWith(uuid, { recordingState: 'unavailable', recordingError: 'silent|source MIC, loudest sound 0 of 32767, 14 s' });
    });

    it('remembers a missing microphone permission as the reason', async () => {
      const uuid = await dialing();
      tel.getActiveSession.mockResolvedValue(dialerSession(uuid, { recordingStatus: 'no_permission' }));
      await onPhoneState({ state: 'OFFHOOK', timestampMs: 1_002_000, sessionId: uuid, sessionChanged: true });
      await onPhoneState({ state: 'IDLE', timestampMs: 1_070_000, sessionId: uuid, sessionChanged: true });
      expect(db.updateCall).toHaveBeenCalledWith(uuid, { recordingState: 'unavailable', recordingError: 'no_permission' });
    });

    it('has the reason on the call before the outcome screen opens', async () => {
      const uuid = await dialing();
      tel.getActiveSession.mockResolvedValue(dialerSession(uuid, { recordingStatus: 'failed', recordingDetail: 'MIC refused (IllegalStateException)' }));
      const order: string[] = [];
      db.updateCall.mockImplementation(async (_uuid, patch) => {
        if (patch.recordingState === 'unavailable') order.push('reason saved');
      });
      const unsubscribe = useCallStore.subscribe((state) => {
        if (state.active?.phase === 'needs_outcome') order.push('outcome screen');
      });
      await onPhoneState({ state: 'OFFHOOK', timestampMs: 1_002_000, sessionId: uuid, sessionChanged: true });
      await onPhoneState({ state: 'IDLE', timestampMs: 1_070_000, sessionId: uuid, sessionChanged: true });
      unsubscribe();
      expect(order).toEqual(['reason saved', 'outcome screen']);
    });

    it('does not mention a recording for a call that was never recorded (recording off, personal or unanswered)', async () => {
      const uuid = await dialing();
      tel.getActiveSession.mockResolvedValue(dialerSession(uuid, { recordingStatus: null }));
      await onPhoneState({ state: 'OFFHOOK', timestampMs: 1_002_000, sessionId: uuid, sessionChanged: true });
      await onPhoneState({ state: 'IDLE', timestampMs: 1_070_000, sessionId: uuid, sessionChanged: true });
      expect(db.updateCall).not.toHaveBeenCalledWith(uuid, expect.objectContaining({ recordingState: expect.anything() }));
    });

    it('tells the server what the recording did, so an administrator can see why a call has none', async () => {
      const uuid = await dialing();
      tel.getActiveSession.mockResolvedValue(dialerSession(uuid, { recordingStatus: 'silent', recordingDetail: 'source MIC, loudest sound 3 of 32767, 14 s' }));
      await onPhoneState({ state: 'OFFHOOK', timestampMs: 1_002_000, sessionId: uuid, sessionChanged: true });
      await onPhoneState({ state: 'IDLE', timestampMs: 1_070_000, sessionId: uuid, sessionChanged: true });
      const sent = enqueue.mock.calls.find((c) => c[0] === 'call_events' && c[1].events.some((e: { type: string }) => e.type === 'ended')) as unknown[];
      const ended = (sent[1] as { events: { type: string; payload: Record<string, unknown> }[] }).events.find((e) => e.type === 'ended');
      expect(ended?.payload).toMatchObject({ source: 'in_call_service', recording: 'silent', recording_detail: 'source MIC, loudest sound 3 of 32767, 14 s' });
    });

    it('treats a recording file that vanished as "not recorded", not as a recording', async () => {
      const uuid = await dialing();
      tel.getActiveSession.mockResolvedValue(dialerSession(uuid, { recordingStatus: 'saved', recordingPath: '/data/files/recordings/x.m4a', recordingDurationMs: 60_000 }));
      tel.getFileInfo.mockResolvedValue({ exists: false, size: 0 });
      await onPhoneState({ state: 'OFFHOOK', timestampMs: 1_002_000, sessionId: uuid, sessionChanged: true });
      await onPhoneState({ state: 'IDLE', timestampMs: 1_070_000, sessionId: uuid, sessionChanged: true });
      expect(enqueue).not.toHaveBeenCalledWith('recording_meta', expect.anything(), uuid);
      expect(db.updateCall).toHaveBeenCalledWith(uuid, { recordingState: 'unavailable', recordingError: 'failed|the recording file is missing or empty' });
    });
  });

  it('never reconciles the same call twice', async () => {
    const uuid = await dialing();
    db.getCall.mockResolvedValue(stored({ uuid, reconciled: true }));
    await finishCall(uuid, 1_045_000);
    expect(enqueue).not.toHaveBeenCalledWith('call_update', expect.anything(), uuid);
  });
});

describe('submitOutcome', () => {
  it('saves the outcome locally, queues it and clears the active call', async () => {
    db.getCall.mockResolvedValue(stored({ status: 'completed' }));
    useCallStore.setState({ active: { uuid: 'u1', contactId: 10, contactName: 'Asha', phone: 'p', campaignId: null, startedAt: 1, offhookAt: 2, endedAt: 3, phase: 'needs_outcome', durationSec: 10, answered: true, suggested: 'CONNECTED', error: null } });
    await submitOutcome('u1', { code: 'CALLBACK', notes: '  call after lunch ', callbackAt: 5_000_000, callbackNote: ' 3pm ' });
    expect(db.updateCall).toHaveBeenCalledWith('u1', expect.objectContaining({ disposition: 'CALLBACK', notes: 'call after lunch', callbackAt: 5_000_000, callbackNote: '3pm', wrapupDone: true }));
    expect(enqueue).toHaveBeenCalledWith('disposition', {}, 'u1');
    expect(active()).toBeNull();
  });

  it('fails loudly for an unknown call', async () => {
    db.getCall.mockResolvedValue(null);
    await expect(submitOutcome('nope', { code: 'CONNECTED' })).rejects.toThrow('Call not found');
  });
});

describe('recovery after the app was closed', () => {
  it('finishes a call that ended while the JS runtime was not running', async () => {
    db.getCall.mockResolvedValue(stored());
    tel.getActiveSession.mockResolvedValue({ id: 'u1', number: '+919876543210', startedAtMs: 1_000_000, offhookAtMs: 1_001_000, endedAtMs: 1_050_000 });
    tel.readCallLog.mockResolvedValue({ found: true, id: 5, dateMs: 1_001_000, durationSec: 40 });
    await recoverSession();
    expect(active()).toMatchObject({ uuid: 'u1', phase: 'needs_outcome', answered: true });
  });

  it('drops a native session that has no matching local call', async () => {
    db.getCall.mockResolvedValue(null);
    tel.getActiveSession.mockResolvedValue({ id: 'ghost', number: '1', startedAtMs: 1, offhookAtMs: null, endedAtMs: null });
    await recoverSession();
    expect(tel.clearSession).toHaveBeenCalledWith('ghost');
    expect(active()).toBeNull();
  });

  it('brings back a reconciled call that never got its outcome', async () => {
    db.getPendingWrapup.mockResolvedValue([stored({ uuid: 'late', reconciled: true, durationSec: 30, status: 'completed' })]);
    const call = await restorePendingWrapup();
    expect(call?.uuid).toBe('late');
    expect(active()).toMatchObject({ uuid: 'late', phase: 'needs_outcome', suggested: 'CONNECTED' });
  });
});

describe("the phone's own call recorder (calls placed through the phone's dialer)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    db.getCall.mockResolvedValue(stored({ endedAt: 1_070_000, durationSec: 60, status: 'completed', reconciled: true }));
  });
  afterEach(() => jest.useRealTimers());

  it('queues the file the phone recorded', async () => {
    tel.findRecentRecording.mockResolvedValue({ uri: 'content://media/audio/1', mimeType: 'audio/mpeg', sizeBytes: 90_000, displayName: 'call.mp3' });
    const done = scanForRecording('u1');
    await jest.advanceTimersByTimeAsync(1_000);
    await done;
    expect(db.updateCall).toHaveBeenCalledWith('u1', expect.objectContaining({ recordingUri: 'content://media/audio/1', recordingState: 'pending' }));
    expect(enqueue).toHaveBeenCalledWith('recording_meta', { sizeBytes: 90_000 }, 'u1');
    expect(enqueue).toHaveBeenCalledWith('recording_upload', { name: 'call.mp3' }, 'u1');
  });

  it('remembers that no file turned up once the search is over - and creates no recording', async () => {
    tel.findRecentRecording.mockResolvedValue(null);
    const done = scanForRecording('u1');
    await jest.advanceTimersByTimeAsync(120_000);
    await done;
    expect(tel.findRecentRecording).toHaveBeenCalledTimes(RECORDING_SCAN_TRIES);
    expect(db.updateCall).toHaveBeenCalledWith('u1', { recordingState: 'unavailable', recordingError: 'no_file' });
    expect(enqueue).not.toHaveBeenCalledWith('recording_meta', expect.anything(), 'u1');
  });

  it('says so when the app is not allowed to look for the file', async () => {
    tel.findRecentRecording.mockRejectedValue({ code: 'NO_PERMISSION' });
    await scanForRecording('u1');
    expect(tel.findRecentRecording).toHaveBeenCalledTimes(1);
    expect(db.updateCall).toHaveBeenCalledWith('u1', { recordingState: 'unavailable', recordingError: 'no_media_access' });
  });

  it('leaves a call that already has a recording alone', async () => {
    db.getCall.mockResolvedValue(stored({ endedAt: 1_070_000, recordingUri: 'file:///x.m4a', recordingState: 'pending' }));
    await scanForRecording('u1');
    expect(tel.findRecentRecording).not.toHaveBeenCalled();
    expect(db.updateCall).not.toHaveBeenCalled();
  });
});
