import type { Scalar } from '@op-engineering/op-sqlite';

import type { CallStatus } from '../services/api/types';
import { query, run } from './db';

/**
 * pending / uploading / available / failed: a recording file exists and is on its way to the server (or failed to get there).
 * unavailable: nothing was recorded - `recordingError` then holds the reason (see services/telephony/recordingStatus.ts).
 */
export type RecordingState = 'pending' | 'uploading' | 'available' | 'failed' | 'unavailable';

/** A call made from this phone. It is the local record first; the server copy is created by the sync queue. */
export interface LocalCall {
  uuid: string;
  serverId: number | null;
  employeeId: number;
  contactId: number | null;
  contactName: string | null;
  phone: string;
  campaignId: number | null;
  startedAt: number;
  answeredAt: number | null;
  endedAt: number | null;
  durationSec: number;
  status: CallStatus;
  disposition: string | null;
  notes: string | null;
  callbackAt: number | null;
  callbackNote: string | null;
  wrapupDone: boolean;
  reconciled: boolean;
  recordingState: RecordingState | null;
  recordingUri: string | null;
  recordingMime: string | null;
  recordingSize: number | null;
  recordingServerId: number | null;
  recordingError: string | null;
  createdAt: number;
  updatedAt: number;
}

type Row = Record<string, Scalar>;

const num = (v: Scalar | undefined): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: Scalar | undefined): string | null => (v === null || v === undefined ? null : String(v));

export function rowToCall(r: Row): LocalCall {
  return {
    uuid: String(r.uuid),
    serverId: num(r.server_id),
    employeeId: Number(r.employee_id),
    contactId: num(r.contact_id),
    contactName: str(r.contact_name),
    phone: String(r.phone),
    campaignId: num(r.campaign_id),
    startedAt: Number(r.started_at),
    answeredAt: num(r.answered_at),
    endedAt: num(r.ended_at),
    durationSec: Number(r.duration ?? 0),
    status: String(r.status) as CallStatus,
    disposition: str(r.disposition),
    notes: str(r.notes),
    callbackAt: num(r.callback_at),
    callbackNote: str(r.callback_note),
    wrapupDone: Number(r.wrapup_done) === 1,
    reconciled: Number(r.reconciled) === 1,
    recordingState: str(r.recording_state) as RecordingState | null,
    recordingUri: str(r.recording_uri),
    recordingMime: str(r.recording_mime),
    recordingSize: num(r.recording_size),
    recordingServerId: num(r.recording_server_id),
    recordingError: str(r.recording_error),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export async function insertCall(call: LocalCall): Promise<void> {
  await run(
    `INSERT INTO calls (uuid, server_id, employee_id, contact_id, contact_name, phone, campaign_id, started_at, answered_at, ended_at,
       duration, status, disposition, notes, callback_at, callback_note, wrapup_done, reconciled, recording_state, recording_uri,
       recording_mime, recording_size, recording_server_id, recording_error, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      call.uuid, call.serverId, call.employeeId, call.contactId, call.contactName, call.phone, call.campaignId, call.startedAt,
      call.answeredAt, call.endedAt, call.durationSec, call.status, call.disposition, call.notes, call.callbackAt, call.callbackNote,
      call.wrapupDone ? 1 : 0, call.reconciled ? 1 : 0, call.recordingState, call.recordingUri, call.recordingMime,
      call.recordingSize, call.recordingServerId, call.recordingError, call.createdAt, call.updatedAt,
    ],
  );
}

const COLUMN_FOR: Record<keyof LocalCall, string> = {
  uuid: 'uuid',
  serverId: 'server_id',
  employeeId: 'employee_id',
  contactId: 'contact_id',
  contactName: 'contact_name',
  phone: 'phone',
  campaignId: 'campaign_id',
  startedAt: 'started_at',
  answeredAt: 'answered_at',
  endedAt: 'ended_at',
  durationSec: 'duration',
  status: 'status',
  disposition: 'disposition',
  notes: 'notes',
  callbackAt: 'callback_at',
  callbackNote: 'callback_note',
  wrapupDone: 'wrapup_done',
  reconciled: 'reconciled',
  recordingState: 'recording_state',
  recordingUri: 'recording_uri',
  recordingMime: 'recording_mime',
  recordingSize: 'recording_size',
  recordingServerId: 'recording_server_id',
  recordingError: 'recording_error',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

export async function updateCall(uuid: string, patch: Partial<Omit<LocalCall, 'uuid'>>): Promise<void> {
  const keys = Object.keys(patch) as (keyof LocalCall)[];
  if (!keys.length) return;
  const sets: string[] = [];
  const params: Scalar[] = [];
  for (const key of keys) {
    let value = patch[key as keyof typeof patch] as unknown;
    if (typeof value === 'boolean') value = value ? 1 : 0;
    sets.push(`${COLUMN_FOR[key]} = ?`);
    params.push((value ?? null) as Scalar);
  }
  sets.push('updated_at = ?');
  params.push(Date.now(), uuid);
  await run(`UPDATE calls SET ${sets.join(', ')} WHERE uuid = ?`, params);
}

export async function getCall(uuid: string): Promise<LocalCall | null> {
  const rows = await query<Row>('SELECT * FROM calls WHERE uuid = ?', [uuid]);
  return rows.length ? rowToCall(rows[0]) : null;
}

export async function getCallByServerId(serverId: number): Promise<LocalCall | null> {
  const rows = await query<Row>('SELECT * FROM calls WHERE server_id = ?', [serverId]);
  return rows.length ? rowToCall(rows[0]) : null;
}

/** Calls whose outcome has not been recorded yet (blocks the queue until the employee wraps up). */
export async function getPendingWrapup(employeeId: number): Promise<LocalCall[]> {
  const rows = await query<Row>(
    `SELECT * FROM calls WHERE employee_id = ? AND wrapup_done = 0 AND status != 'failed' ORDER BY started_at DESC`,
    [employeeId],
  );
  return rows.map(rowToCall);
}

export async function listRecentCalls(employeeId: number, limit = 200): Promise<LocalCall[]> {
  const rows = await query<Row>('SELECT * FROM calls WHERE employee_id = ? ORDER BY started_at DESC LIMIT ?', [employeeId, limit]);
  return rows.map(rowToCall);
}

export async function listCallsForContact(employeeId: number, contactId: number): Promise<LocalCall[]> {
  const rows = await query<Row>(
    'SELECT * FROM calls WHERE employee_id = ? AND contact_id = ? ORDER BY started_at DESC LIMIT 50',
    [employeeId, contactId],
  );
  return rows.map(rowToCall);
}

/**
 * Contacts whose outcome was recorded on this phone but has not reached the server yet. The queue hides them so a
 * contact you just finished does not pop back up while the change is still waiting to sync.
 */
export async function getContactIdsWithPendingOutcome(employeeId: number): Promise<Set<number>> {
  const rows = await query<{ contact_id: number }>(
    `SELECT DISTINCT contact_id FROM calls
     WHERE employee_id = ? AND contact_id IS NOT NULL AND wrapup_done = 1 AND disposition IS NOT NULL
       AND uuid IN (SELECT call_uuid FROM sync_ops WHERE employee_id = ? AND type = 'disposition')`,
    [employeeId, employeeId],
  );
  return new Set(rows.map((r) => Number(r.contact_id)));
}

export async function listCallsWithRecordingWork(): Promise<LocalCall[]> {
  const rows = await query<Row>(`SELECT * FROM calls WHERE recording_state IN ('pending','uploading','failed') ORDER BY started_at`);
  return rows.map(rowToCall);
}

export async function countCallsSince(employeeId: number, sinceMs: number): Promise<{ total: number; wrapped: number }> {
  const rows = await query<{ total: number; wrapped: number }>(
    `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN wrapup_done = 1 THEN 1 ELSE 0 END), 0) AS wrapped
     FROM calls WHERE employee_id = ? AND started_at >= ?`,
    [employeeId, sinceMs],
  );
  return { total: Number(rows[0]?.total ?? 0), wrapped: Number(rows[0]?.wrapped ?? 0) };
}
