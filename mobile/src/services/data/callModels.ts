import type { LocalCall, RecordingState } from '../../database/calls';
import type { CallStatus, ServerCall } from '../api/types';
import { parseIso } from '../../utils/time';

/** One row in a call list, whether the call was made on this phone, on another device, or both. */
export interface CallRowModel {
  key: string;
  localUuid: string | null;
  serverId: number | null;
  contactId: number | null;
  name: string;
  phone: string;
  startedAt: number;
  durationSec: number;
  status: CallStatus;
  disposition: string | null;
  dispositionLabel: string | null;
  /** false while operations for this call are still waiting in the sync queue */
  synced: boolean;
  recording: RecordingState | 'none';
  needsOutcome: boolean;
}

export function localToRow(call: LocalCall, unsynced: Set<string>): CallRowModel {
  return {
    key: call.uuid,
    localUuid: call.uuid,
    serverId: call.serverId,
    contactId: call.contactId,
    name: call.contactName ?? call.phone,
    phone: call.phone,
    startedAt: call.startedAt,
    durationSec: call.durationSec,
    status: call.status,
    disposition: call.disposition,
    dispositionLabel: null,
    synced: call.serverId !== null && !unsynced.has(call.uuid),
    recording: call.recordingState ?? 'none',
    needsOutcome: !call.wrapupDone && call.status !== 'failed',
  };
}

export function serverToRow(call: ServerCall): CallRowModel {
  return {
    key: `s${call.id}`,
    localUuid: null,
    serverId: call.id,
    contactId: call.contact_id,
    name: call.contact_name ?? call.phone_number,
    phone: call.phone_number,
    startedAt: parseIso(call.started_at) ?? 0,
    durationSec: call.duration_seconds,
    status: call.status,
    disposition: call.disposition?.code ?? null,
    dispositionLabel: call.disposition?.label ?? null,
    synced: true,
    recording: call.recording ? call.recording.upload_status : 'none',
    needsOutcome: call.disposition === null && call.status !== 'failed',
  };
}

/**
 * Merge phone-local calls with server calls. A call created on this phone has its local UUID as the server's
 * `client_call_id`, so the two copies are recognised and the local one (which may be newer) wins.
 */
export function mergeCalls(local: LocalCall[], server: ServerCall[], unsynced: Set<string>): CallRowModel[] {
  const localUuids = new Set(local.map((c) => c.uuid));
  const rows: CallRowModel[] = local.map((c) => localToRow(c, unsynced));
  for (const call of server) {
    if (localUuids.has(call.client_call_id)) continue;
    rows.push(serverToRow(call));
  }
  return rows.sort((a, b) => b.startedAt - a.startedAt);
}
