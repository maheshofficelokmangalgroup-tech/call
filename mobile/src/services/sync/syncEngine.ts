/**
 * Offline-first sync (section 20): every change made on the phone is first written to SQLite and queued here with a
 * stable idempotency key (the call UUID / note & callback refs). The queue is replayed in creation order, retried with
 * exponential backoff, and the server - not the phone - stays the source of truth.
 */
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { SYNC_INTERVAL_MAX_MS, SYNC_INTERVAL_MIN_MS, SYNC_INTERVAL_MS } from '../../config/env';
import { getCall, updateCall, type LocalCall } from '../../database/calls';
import {
  completeOp,
  countOps,
  enqueueOp,
  failOp,
  failOpsForCall,
  getDueOps,
  rescheduleOp,
  retryFailedOps,
  type SyncOp,
  type SyncOpType,
} from '../../database/syncOps';
import { useSyncStore } from '../../store/syncStore';
import { api, type CallEventBody, type CallUpdateBody } from '../api/endpoints';
import { ApiError, isTransient, NetworkError } from '../api/client';
import { telephony } from '../telephony/native';
import { hasExhaustedAttempts, nextBackoffMs } from './backoff';

const iso = (ms: number) => new Date(ms).toISOString();

/** A microphone recording lives in the app's private storage; once it is safely on the server the phone's copy can go. */
function discardLocalCopy(uri: string | null): void {
  if (!uri || !uri.startsWith('file://') || !telephony.isAvailable()) return;
  void telephony.deleteFile(uri.slice('file://'.length)).catch(() => undefined);
}

/** An earlier operation this one depends on (e.g. create_call) has not reached the server yet. */
export class DependencyPending extends Error {
  constructor() {
    super('Waiting for an earlier operation to sync');
    this.name = 'DependencyPending';
  }
}

/** Permanent failure: retrying cannot help. */
export class PermanentFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentFailure';
  }
}

async function requireCall(uuid: string | null): Promise<LocalCall | null> {
  if (!uuid) return null;
  return getCall(uuid);
}

async function requireServerId(call: LocalCall): Promise<number> {
  if (call.serverId) return call.serverId;
  throw new DependencyPending();
}

function inFuture(ms: number | null | undefined): number | null {
  if (!ms) return null;
  return Math.max(ms, Date.now()); // a callback that became due while offline is simply due now
}

export async function executeOp(op: SyncOp): Promise<void> {
  const p = op.payload as Record<string, any>;

  switch (op.type) {
    case 'create_call': {
      const call = await requireCall(op.callUuid);
      if (!call || call.serverId) return;
      const base = { client_call_id: call.uuid, started_at: iso(call.startedAt), campaign_id: call.campaignId };
      try {
        const created = await api.createCall({
          ...base,
          contact_id: call.contactId,
          phone_number: call.contactId ? undefined : call.phone,
        });
        await updateCall(call.uuid, { serverId: created.id });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404 && call.contactId) {
          // The contact was reassigned or removed while the phone was offline: keep the call on record by number.
          const created = await api.createCall({ ...base, campaign_id: null, phone_number: call.phone });
          await updateCall(call.uuid, { serverId: created.id });
          return;
        }
        throw error;
      }
      return;
    }

    case 'call_events': {
      const call = await requireCall(op.callUuid);
      if (!call) return;
      const serverId = await requireServerId(call);
      const events = (p.events as { type: CallEventBody['event_type']; at: number; payload?: Record<string, unknown> }[]).map((e) => ({
        event_type: e.type,
        occurred_at: iso(e.at),
        payload: e.payload ?? null,
      }));
      await api.addCallEvents(serverId, events);
      return;
    }

    case 'call_update': {
      const call = await requireCall(op.callUuid);
      if (!call) return;
      const serverId = await requireServerId(call);
      const body: CallUpdateBody = { duration_seconds: call.durationSec };
      if (call.endedAt) body.ended_at = iso(call.endedAt);
      if (call.answeredAt) body.answered_at = iso(call.answeredAt);
      if (['completed', 'no_answer', 'failed'].includes(call.status)) body.status = call.status;
      if (p.externalRef) body.external_call_reference = String(p.externalRef);
      await api.updateCall(serverId, body);
      return;
    }

    case 'disposition': {
      const call = await requireCall(op.callUuid);
      if (!call?.disposition) return;
      const serverId = await requireServerId(call);
      const callbackAt = inFuture(call.callbackAt);
      try {
        await api.setDisposition(serverId, {
          disposition_code: call.disposition,
          notes: call.notes,
          callback_at: callbackAt ? iso(callbackAt) : null,
          callback_note: call.callbackNote,
          note_client_ref: `${call.uuid}-note`,
        });
      } catch (error) {
        if (error instanceof ApiError && error.code === 'disposition_already_set') return; // replay: already recorded
        throw error;
      }
      return;
    }

    case 'note_create': {
      await api.addNote(Number(p.contactId), String(p.body), String(p.clientRef));
      return;
    }

    case 'callback_create': {
      await api.createCallback({
        contact_id: Number(p.contactId),
        scheduled_at: iso(inFuture(Number(p.scheduledAt)) as number),
        note: (p.note as string | null) ?? null,
        client_ref: String(p.clientRef),
      });
      return;
    }

    case 'callback_update': {
      const body: { scheduled_at?: string; status?: 'done' | 'cancelled'; note?: string | null } = {};
      if (p.scheduledAt) body.scheduled_at = iso(inFuture(Number(p.scheduledAt)) as number);
      if (p.status) body.status = p.status as 'done' | 'cancelled';
      if (p.note !== undefined) body.note = p.note as string | null;
      await api.updateCallback(Number(p.id), body);
      return;
    }

    case 'recording_meta': {
      const call = await requireCall(op.callUuid);
      if (!call?.recordingUri) return;
      const serverId = await requireServerId(call);
      try {
        const rec = await api.createRecording(serverId, {
          content_type: call.recordingMime ?? 'audio/mp4',
          size_bytes: call.recordingSize || Number(p.sizeBytes) || 1,
          duration_seconds: call.durationSec || null,
        });
        await updateCall(call.uuid, {
          recordingServerId: rec.id,
          recordingState: rec.upload_status === 'available' ? 'available' : 'pending',
          recordingError: null,
        });
      } catch (error) {
        if (error instanceof ApiError && error.code === 'recording_disabled') {
          await updateCall(call.uuid, { recordingState: 'failed', recordingError: 'Recording is not enabled for your organisation' });
          return;
        }
        throw error;
      }
      return;
    }

    case 'recording_upload': {
      const call = await requireCall(op.callUuid);
      if (!call?.recordingUri || call.recordingState === 'available') return;
      if (!call.recordingServerId) throw new DependencyPending();
      await updateCall(call.uuid, { recordingState: 'uploading', recordingError: null });
      try {
        await api.uploadRecording(call.recordingServerId, {
          uri: call.recordingUri,
          name: String(p.name ?? `call-${call.uuid}.m4a`),
          type: call.recordingMime ?? 'audio/mp4',
        });
        await updateCall(call.uuid, { recordingState: 'available', recordingError: null });
        discardLocalCopy(call.recordingUri);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'already_uploaded') {
          await updateCall(call.uuid, { recordingState: 'available', recordingError: null });
          discardLocalCopy(call.recordingUri);
          return;
        }
        const permanent = error instanceof ApiError && !isTransient(error);
        await updateCall(call.uuid, {
          recordingState: permanent ? 'failed' : 'pending',
          recordingError: error instanceof Error ? error.message : 'Upload failed',
        });
        throw error;
      }
      return;
    }
  }
}

type Listener = () => void;

class SyncEngine {
  private employeeId: number | null = null;
  private running = false;
  private rerun = false;
  private kickTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private intervalMs = SYNC_INTERVAL_MS;
  private appStateSub: NativeEventSubscription | null = null;
  private listeners = new Set<Listener>();

  start(employeeId: number, intervalSeconds?: number | null): void {
    this.stop();
    this.employeeId = employeeId;
    this.intervalMs = clampSyncInterval(intervalSeconds);
    this.interval = setInterval(() => this.kick(), this.intervalMs);
    this.appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') this.kick();
    });
    void this.refreshCounts();
    this.kick();
  }

  /** The server changed the pace (an administrator edited the setting): carry on at the new one. */
  setIntervalSeconds(intervalSeconds: number | null | undefined): void {
    const next = clampSyncInterval(intervalSeconds);
    if (this.employeeId === null || next === this.intervalMs) return;
    this.intervalMs = next;
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => this.kick(), next);
  }

  stop(): void {
    this.employeeId = null;
    if (this.interval) clearInterval(this.interval);
    if (this.kickTimer) clearTimeout(this.kickTimer);
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.appStateSub?.remove();
    this.interval = this.kickTimer = this.wakeTimer = null;
    this.appStateSub = null;
  }

  /** Called after something was added to the queue or connectivity may have returned. */
  kick(): void {
    if (this.employeeId === null || this.kickTimer) return;
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null;
      void this.run();
    }, 60);
  }

  /** Queue an operation and try to send it right away. */
  async enqueue(type: SyncOpType, payload: Record<string, unknown>, callUuid: string | null = null): Promise<void> {
    if (this.employeeId === null) throw new Error('Not signed in');
    await enqueueOp(this.employeeId, type, payload, callUuid);
    await this.refreshCounts();
    this.kick();
  }

  onSynced(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async retryFailed(): Promise<void> {
    if (this.employeeId === null) return;
    await retryFailedOps(this.employeeId);
    await this.refreshCounts();
    this.kick();
  }

  /** Run now and wait for completion (pull-to-refresh, "Sync now"). */
  async syncNow(): Promise<void> {
    await this.run();
  }

  async refreshCounts(): Promise<void> {
    if (this.employeeId === null) return;
    const counts = await countOps(this.employeeId);
    useSyncStore.getState().patch({ pending: counts.pending, failed: counts.failed });
  }

  private async run(): Promise<void> {
    if (this.employeeId === null) return;
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    const store = useSyncStore.getState();
    store.patch({ running: true });
    let progressed = false;
    let offline = false;
    let lastError: string | null = null;

    try {
      const ops = await getDueOps(this.employeeId, Date.now());
      for (const op of ops) {
        try {
          await executeOp(op);
          await completeOp(op.id);
          progressed = true;
        } catch (error) {
          const attempts = op.attempts + 1;
          const message = error instanceof Error ? error.message : 'Sync failed';
          if (error instanceof DependencyPending) {
            await rescheduleOp(op.id, op.attempts, Date.now() + 20_000, message);
            continue;
          }
          if (isTransient(error)) {
            lastError = message;
            if (hasExhaustedAttempts(attempts)) await failOp(op.id, attempts, message);
            else await rescheduleOp(op.id, attempts, Date.now() + nextBackoffMs(attempts), message);
            offline = error instanceof NetworkError;
            break; // the server is unreachable or struggling: keep the remaining operations in order for next time
          }
          lastError = message;
          await failOp(op.id, attempts, message);
          if (op.type === 'create_call' && op.callUuid) {
            await failOpsForCall(op.callUuid, 'The server did not accept this call');
          }
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Sync failed';
    } finally {
      this.running = false;
      const counts = await countOps(this.employeeId ?? -1).catch(() => ({ pending: 0, failed: 0, nextAttemptAt: null as number | null }));
      useSyncStore.getState().patch({
        running: false,
        pending: counts.pending,
        failed: counts.failed,
        lastError,
        online: !offline,
        lastSyncAt: progressed || (!lastError && !offline) ? Date.now() : useSyncStore.getState().lastSyncAt,
      });
      if (progressed) this.listeners.forEach((l) => l());
      this.scheduleWake(counts.nextAttemptAt, counts.pending);
      if (this.rerun) {
        this.rerun = false;
        this.kick();
      }
    }
  }

  private scheduleWake(nextAttemptAt: number | null, pending: number): void {
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
    if (!pending || nextAttemptAt === null || this.employeeId === null) return;
    const delay = Math.max(1500, nextAttemptAt - Date.now());
    this.wakeTimer = setTimeout(() => this.kick(), Math.min(delay, 10 * 60_000));
  }
}

/** The server's pace, kept within sensible limits (a wrong setting must not make the phone hammer the server or go silent). */
export function clampSyncInterval(seconds: number | null | undefined): number {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return SYNC_INTERVAL_MS;
  return Math.min(SYNC_INTERVAL_MAX_MS, Math.max(SYNC_INTERVAL_MIN_MS, Math.round(value * 1000)));
}

export const syncEngine = new SyncEngine();
