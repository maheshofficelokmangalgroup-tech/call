import type { Scalar } from '@op-engineering/op-sqlite';

import { newOpId } from '../utils/ids';
import { query, run } from './db';

export type SyncOpType =
  | 'create_call'
  | 'call_events'
  | 'call_update'
  | 'disposition'
  | 'note_create'
  | 'callback_create'
  | 'callback_update'
  | 'recording_meta'
  | 'recording_upload';

export type SyncOpStatus = 'pending' | 'failed';

export interface SyncOp {
  id: string;
  employeeId: number;
  type: SyncOpType;
  callUuid: string | null;
  payload: Record<string, unknown>;
  status: SyncOpStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  createdAt: number;
}

type Row = Record<string, Scalar>;

function toOp(r: Row): SyncOp {
  return {
    id: String(r.id),
    employeeId: Number(r.employee_id),
    type: String(r.type) as SyncOpType,
    callUuid: r.call_uuid === null ? null : String(r.call_uuid),
    payload: JSON.parse(String(r.payload)) as Record<string, unknown>,
    status: String(r.status) as SyncOpStatus,
    attempts: Number(r.attempts),
    nextAttemptAt: Number(r.next_attempt_at),
    lastError: r.last_error === null ? null : String(r.last_error),
    createdAt: Number(r.created_at),
  };
}

export async function enqueueOp(
  employeeId: number,
  type: SyncOpType,
  payload: Record<string, unknown>,
  callUuid: string | null = null,
): Promise<SyncOp> {
  const op: SyncOp = {
    id: newOpId(),
    employeeId,
    type,
    callUuid,
    payload,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    createdAt: Date.now(),
  };
  await run(
    `INSERT INTO sync_ops (id, employee_id, type, call_uuid, payload, status, attempts, next_attempt_at, last_error, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [op.id, employeeId, op.type, op.callUuid, JSON.stringify(op.payload), op.status, 0, 0, null, op.createdAt],
  );
  return op;
}

/** Operations that are due, oldest first (creation order is the dependency order). */
export async function getDueOps(employeeId: number, now: number): Promise<SyncOp[]> {
  const rows = await query<Row>(
    `SELECT * FROM sync_ops WHERE employee_id = ? AND status = 'pending' AND next_attempt_at <= ? ORDER BY created_at, rowid`,
    [employeeId, now],
  );
  return rows.map(toOp);
}

export async function getAllOps(employeeId: number): Promise<SyncOp[]> {
  const rows = await query<Row>('SELECT * FROM sync_ops WHERE employee_id = ? ORDER BY created_at, rowid', [employeeId]);
  return rows.map(toOp);
}

export async function countOps(employeeId: number): Promise<{ pending: number; failed: number; nextAttemptAt: number | null }> {
  const rows = await query<{ status: string; n: number; next: number | null }>(
    'SELECT status, COUNT(*) AS n, MIN(next_attempt_at) AS next FROM sync_ops WHERE employee_id = ? GROUP BY status',
    [employeeId],
  );
  let pending = 0;
  let failed = 0;
  let next: number | null = null;
  for (const r of rows) {
    if (r.status === 'pending') {
      pending = Number(r.n);
      next = r.next === null ? null : Number(r.next);
    } else if (r.status === 'failed') {
      failed = Number(r.n);
    }
  }
  return { pending, failed, nextAttemptAt: next };
}

export async function completeOp(id: string): Promise<void> {
  await run('DELETE FROM sync_ops WHERE id = ?', [id]);
}

export async function rescheduleOp(id: string, attempts: number, nextAttemptAt: number, error: string): Promise<void> {
  await run('UPDATE sync_ops SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?', [
    attempts,
    nextAttemptAt,
    error.slice(0, 500),
    id,
  ]);
}

export async function failOp(id: string, attempts: number, error: string): Promise<void> {
  await run("UPDATE sync_ops SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?", [attempts, error.slice(0, 500), id]);
}

/** Fail every other pending operation of a call (used when the server refused to create the call at all). */
export async function failOpsForCall(callUuid: string, reason: string): Promise<void> {
  await run("UPDATE sync_ops SET status = 'failed', last_error = ? WHERE call_uuid = ? AND status = 'pending'", [reason.slice(0, 500), callUuid]);
}

/** Give failed operations another chance (the employee pressed "Retry"). */
export async function retryFailedOps(employeeId: number): Promise<number> {
  const result = await run(
    "UPDATE sync_ops SET status = 'pending', attempts = 0, next_attempt_at = 0 WHERE status = 'failed' AND employee_id = ?",
    [employeeId],
  );
  return result.rowsAffected;
}

/** Calls that still have work waiting in the sync queue (pending or failed). */
export async function getUnsyncedCallUuids(employeeId: number): Promise<Set<string>> {
  const rows = await query<{ call_uuid: string }>(
    'SELECT DISTINCT call_uuid FROM sync_ops WHERE employee_id = ? AND call_uuid IS NOT NULL',
    [employeeId],
  );
  return new Set(rows.map((r) => String(r.call_uuid)));
}

export async function hasPendingOpForCall(callUuid: string, types?: SyncOpType[]): Promise<boolean> {
  const params: Scalar[] = [callUuid];
  let sql = "SELECT COUNT(*) AS n FROM sync_ops WHERE call_uuid = ? AND status = 'pending'";
  if (types?.length) {
    sql += ` AND type IN (${types.map(() => '?').join(',')})`;
    params.push(...types);
  }
  const rows = await query<{ n: number }>(sql, params);
  return Number(rows[0]?.n ?? 0) > 0;
}
