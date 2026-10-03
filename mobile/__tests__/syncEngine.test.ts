/**
 * Offline sync queue (section 20): idempotent replay, ordering, dependency handling, backoff, permanent failures.
 */
import { ApiError, NetworkError } from '../src/services/api/client';
import { api } from '../src/services/api/endpoints';
import { executeOp, DependencyPending, syncEngine } from '../src/services/sync/syncEngine';
import type { LocalCall } from '../src/database/calls';
import type { SyncOp } from '../src/database/syncOps';
import * as callsDb from '../src/database/calls';
import * as opsDb from '../src/database/syncOps';
import { useSyncStore } from '../src/store/syncStore';
import { telephony } from '../src/services/telephony/native';

jest.mock('../src/database/calls');
jest.mock('../src/database/syncOps');
jest.mock('../src/services/telephony/native', () => ({ telephony: { isAvailable: jest.fn(() => true), deleteFile: jest.fn(async () => true) } }));
jest.mock('../src/services/api/endpoints', () => ({
  api: {
    createCall: jest.fn(),
    addCallEvents: jest.fn(),
    updateCall: jest.fn(),
    setDisposition: jest.fn(),
    addNote: jest.fn(),
    createCallback: jest.fn(),
    updateCallback: jest.fn(),
    createRecording: jest.fn(),
    uploadRecording: jest.fn(),
  },
}));

const calls = callsDb as jest.Mocked<typeof callsDb>;
const ops = opsDb as jest.Mocked<typeof opsDb>;
const mockApi = api as unknown as Record<string, jest.Mock>;

function call(partial: Partial<LocalCall> = {}): LocalCall {
  return {
    uuid: 'call-1', serverId: null, employeeId: 1, contactId: 10, contactName: 'Asha', phone: '+919876543210', campaignId: 2,
    startedAt: Date.UTC(2026, 9, 1, 10), answeredAt: null, endedAt: null, durationSec: 0, status: 'initiated', disposition: null,
    notes: null, callbackAt: null, callbackNote: null, wrapupDone: false, reconciled: false, recordingState: null, recordingUri: null,
    recordingMime: null, recordingSize: null, recordingServerId: null, recordingError: null, createdAt: 1, updatedAt: 1,
    ...partial,
  };
}

function op(type: SyncOp['type'], payload: Record<string, unknown> = {}, callUuid: string | null = 'call-1', extra: Partial<SyncOp> = {}): SyncOp {
  return { id: `op-${type}`, employeeId: 1, type, callUuid, payload, status: 'pending', attempts: 0, nextAttemptAt: 0, lastError: null, createdAt: 1, ...extra };
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.values(mockApi).forEach((fn) => fn.mockReset());
});

describe('executeOp', () => {
  it('create_call sends the local UUID as the idempotency key and stores the server id', async () => {
    calls.getCall.mockResolvedValue(call());
    mockApi.createCall.mockResolvedValue({ id: 99 });
    await executeOp(op('create_call'));
    expect(mockApi.createCall).toHaveBeenCalledWith(expect.objectContaining({ client_call_id: 'call-1', contact_id: 10, campaign_id: 2 }));
    expect(calls.updateCall).toHaveBeenCalledWith('call-1', { serverId: 99 });
  });

  it('create_call sends the number that was dialled with the contact (a person with several numbers: the server records that one)', async () => {
    calls.getCall.mockResolvedValue(call({ phone: '+919123456789' }));
    mockApi.createCall.mockResolvedValue({ id: 98 });
    await executeOp(op('create_call'));
    expect(mockApi.createCall).toHaveBeenCalledWith(expect.objectContaining({ contact_id: 10, phone_number: '+919123456789' }));
  });

  it('create_call is a no-op when the call already has a server id (replay)', async () => {
    calls.getCall.mockResolvedValue(call({ serverId: 5 }));
    await executeOp(op('create_call'));
    expect(mockApi.createCall).not.toHaveBeenCalled();
  });

  it('create_call falls back to a manual call when the contact was reassigned meanwhile', async () => {
    calls.getCall.mockResolvedValue(call());
    mockApi.createCall.mockRejectedValueOnce(new ApiError(404, 'not_found', 'Contact not found.')).mockResolvedValueOnce({ id: 11 });
    await executeOp(op('create_call'));
    expect(mockApi.createCall).toHaveBeenLastCalledWith(expect.objectContaining({ phone_number: '+919876543210', campaign_id: null }));
    expect(mockApi.createCall.mock.calls[1][0].contact_id).toBeUndefined();
    expect(calls.updateCall).toHaveBeenCalledWith('call-1', { serverId: 11 });
  });

  it('operations that need the server id wait for create_call', async () => {
    calls.getCall.mockResolvedValue(call({ serverId: null, disposition: 'CONNECTED' }));
    await expect(executeOp(op('call_events', { events: [{ type: 'ended', at: 1 }] }))).rejects.toBeInstanceOf(DependencyPending);
    await expect(executeOp(op('call_update'))).rejects.toBeInstanceOf(DependencyPending);
    await expect(executeOp(op('disposition'))).rejects.toBeInstanceOf(DependencyPending);
  });

  it('call_update reports what the device measured', async () => {
    calls.getCall.mockResolvedValue(call({ serverId: 7, endedAt: Date.UTC(2026, 9, 1, 10, 2), answeredAt: Date.UTC(2026, 9, 1, 10, 1), durationSec: 60, status: 'completed' }));
    await executeOp(op('call_update', { externalRef: 'calllog-5' }));
    expect(mockApi.updateCall).toHaveBeenCalledWith(7, {
      duration_seconds: 60,
      ended_at: '2026-10-01T10:02:00.000Z',
      answered_at: '2026-10-01T10:01:00.000Z',
      status: 'completed',
      external_call_reference: 'calllog-5',
    });
  });

  it('disposition treats "already recorded" as success (idempotent replay)', async () => {
    calls.getCall.mockResolvedValue(call({ serverId: 7, disposition: 'NO_ANSWER', notes: 'n' }));
    mockApi.setDisposition.mockRejectedValue(new ApiError(409, 'disposition_already_set', 'already'));
    await expect(executeOp(op('disposition'))).resolves.toBeUndefined();
    expect(mockApi.setDisposition).toHaveBeenCalledWith(7, expect.objectContaining({ disposition_code: 'NO_ANSWER', notes: 'n', note_client_ref: 'call-1-note', callback_at: null }));
  });

  it('disposition never sends a callback time in the past', async () => {
    const past = Date.now() - 3 * 3_600_000;
    calls.getCall.mockResolvedValue(call({ serverId: 7, disposition: 'CALLBACK', callbackAt: past }));
    mockApi.setDisposition.mockResolvedValue({});
    const before = Date.now();
    await executeOp(op('disposition'));
    const sent = Date.parse(mockApi.setDisposition.mock.calls[0][1].callback_at);
    expect(sent).toBeGreaterThanOrEqual(before);
  });

  it('other server errors propagate so the engine can decide', async () => {
    calls.getCall.mockResolvedValue(call({ serverId: 7, disposition: 'CONNECTED' }));
    mockApi.setDisposition.mockRejectedValue(new ApiError(422, 'callback_required', 'Choose when to call back.'));
    await expect(executeOp(op('disposition'))).rejects.toMatchObject({ code: 'callback_required' });
  });

  it('note_create and callback_create carry their client refs', async () => {
    await executeOp(op('note_create', { contactId: 10, body: 'hello', clientRef: 'note-1' }, null));
    expect(mockApi.addNote).toHaveBeenCalledWith(10, 'hello', 'note-1');
    await executeOp(op('callback_create', { contactId: 10, scheduledAt: Date.now() + 60_000, note: null, clientRef: 'cb-1' }, null));
    expect(mockApi.createCallback).toHaveBeenCalledWith(expect.objectContaining({ contact_id: 10, client_ref: 'cb-1' }));
  });

  it('recording metadata then upload move the local state machine', async () => {
    calls.getCall.mockResolvedValue(call({ serverId: 7, recordingUri: 'content://media/1', recordingMime: 'audio/mp4', recordingSize: 1234, durationSec: 30 }));
    mockApi.createRecording.mockResolvedValue({ id: 55, upload_status: 'pending' });
    await executeOp(op('recording_meta', { sizeBytes: 1234 }));
    expect(mockApi.createRecording).toHaveBeenCalledWith(7, { content_type: 'audio/mp4', size_bytes: 1234, duration_seconds: 30 });
    expect(calls.updateCall).toHaveBeenCalledWith('call-1', { recordingServerId: 55, recordingState: 'pending', recordingError: null });

    calls.updateCall.mockClear();
    calls.getCall.mockResolvedValue(call({ serverId: 7, recordingUri: 'content://media/1', recordingMime: 'audio/mp4', recordingServerId: 55 }));
    mockApi.uploadRecording.mockResolvedValue({});
    await executeOp(op('recording_upload', { name: 'rec.m4a' }));
    expect(calls.updateCall).toHaveBeenNthCalledWith(1, 'call-1', { recordingState: 'uploading', recordingError: null });
    expect(calls.updateCall).toHaveBeenLastCalledWith('call-1', { recordingState: 'available', recordingError: null });
  });

  it('deletes its own copy of a microphone recording once it is on the server (media-store files are kept)', async () => {
    calls.getCall.mockResolvedValue(call({ serverId: 7, recordingUri: 'file:///data/user/0/app/files/recordings/x.m4a', recordingMime: 'audio/mp4', recordingServerId: 55 }));
    mockApi.uploadRecording.mockResolvedValue({});
    await executeOp(op('recording_upload', { name: 'x.m4a' }));
    expect(telephony.deleteFile).toHaveBeenCalledWith('/data/user/0/app/files/recordings/x.m4a');

    (telephony.deleteFile as jest.Mock).mockClear();
    calls.getCall.mockResolvedValue(call({ serverId: 7, recordingUri: 'content://media/9', recordingMime: 'audio/mp4', recordingServerId: 55 }));
    await executeOp(op('recording_upload', { name: 'y.m4a' }));
    expect(telephony.deleteFile).not.toHaveBeenCalled();
  });

  it('a recording upload that fails offline goes back to pending, a rejected one to failed', async () => {
    calls.getCall.mockResolvedValue(call({ serverId: 7, recordingUri: 'content://media/1', recordingServerId: 55 }));
    mockApi.uploadRecording.mockRejectedValueOnce(new NetworkError());
    await expect(executeOp(op('recording_upload', { name: 'r.m4a' }))).rejects.toBeInstanceOf(NetworkError);
    expect(calls.updateCall).toHaveBeenLastCalledWith('call-1', expect.objectContaining({ recordingState: 'pending' }));

    mockApi.uploadRecording.mockRejectedValueOnce(new ApiError(422, 'unsupported_media_type', 'Not audio'));
    await expect(executeOp(op('recording_upload', { name: 'r.m4a' }))).rejects.toBeInstanceOf(ApiError);
    expect(calls.updateCall).toHaveBeenLastCalledWith('call-1', expect.objectContaining({ recordingState: 'failed' }));
  });

  it('recording disabled by the organisation is recorded locally and not retried', async () => {
    calls.getCall.mockResolvedValue(call({ serverId: 7, recordingUri: 'content://media/1' }));
    mockApi.createRecording.mockRejectedValue(new ApiError(403, 'recording_disabled', 'off'));
    await expect(executeOp(op('recording_meta', { sizeBytes: 5 }))).resolves.toBeUndefined();
    expect(calls.updateCall).toHaveBeenCalledWith('call-1', expect.objectContaining({ recordingState: 'failed' }));
  });
});

describe('engine run loop', () => {
  async function runOnce(due: SyncOp[]) {
    ops.getDueOps.mockResolvedValue(due);
    ops.countOps.mockResolvedValue({ pending: 0, failed: 0, nextAttemptAt: null });
    syncEngine.start(1);
    await syncEngine.syncNow();
    syncEngine.stop();
  }

  it('processes operations in order and removes them once sent', async () => {
    calls.getCall.mockResolvedValue(call());
    mockApi.createCall.mockImplementation(async () => {
      calls.getCall.mockResolvedValue(call({ serverId: 9 }));
      return { id: 9 };
    });
    await runOnce([op('create_call'), op('call_update')]);
    expect(ops.completeOp).toHaveBeenCalledTimes(2);
    expect(ops.completeOp.mock.calls.map((c) => c[0])).toEqual(['op-create_call', 'op-call_update']);
    expect(useSyncStore.getState().online).toBe(true);
  });

  it('stops at the first network failure, backs off and keeps the rest for later', async () => {
    calls.getCall.mockResolvedValue(call());
    mockApi.createCall.mockRejectedValue(new NetworkError());
    await runOnce([op('create_call'), op('call_update', {}, 'call-1', { id: 'op-2' })]);
    expect(ops.rescheduleOp).toHaveBeenCalledTimes(1);
    const [id, attempts, next] = ops.rescheduleOp.mock.calls[0];
    expect(id).toBe('op-create_call');
    expect(attempts).toBe(1);
    expect(next).toBeGreaterThan(Date.now());
    expect(ops.completeOp).not.toHaveBeenCalled();
    expect(useSyncStore.getState().online).toBe(false);
    expect(mockApi.updateCall).not.toHaveBeenCalled(); // order preserved: the second op was not attempted
  });

  it('marks a rejected create_call as failed together with the rest of that call', async () => {
    calls.getCall.mockResolvedValue(call());
    mockApi.createCall.mockRejectedValue(new ApiError(409, 'contact_do_not_contact', 'Do not contact'));
    await runOnce([op('create_call')]);
    expect(ops.failOp).toHaveBeenCalledWith('op-create_call', 1, 'Do not contact');
    expect(ops.failOpsForCall).toHaveBeenCalledWith('call-1', expect.any(String));
  });

  it('delays (without counting an attempt) an operation whose dependency has not synced', async () => {
    calls.getCall.mockResolvedValue(call({ serverId: null }));
    await runOnce([op('call_update')]);
    expect(ops.rescheduleOp).toHaveBeenCalledWith('op-call_update', 0, expect.any(Number), expect.any(String));
    expect(ops.failOp).not.toHaveBeenCalled();
  });

  it('gives up on an operation after too many transient failures', async () => {
    calls.getCall.mockResolvedValue(call());
    mockApi.createCall.mockRejectedValue(new ApiError(503, 'http_503', 'unavailable'));
    await runOnce([op('create_call', {}, 'call-1', { attempts: 11 })]);
    expect(ops.failOp).toHaveBeenCalledWith('op-create_call', 12, 'unavailable');
  });
});
