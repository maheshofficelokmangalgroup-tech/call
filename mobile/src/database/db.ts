/**
 * Local SQLite store (op-sqlite). It holds the cached queue/contacts, calls made on this phone and the sync queue.
 * The server is always the source of truth; this database lets the app keep working without connectivity.
 */
import { open, type DB, type Scalar } from '@op-engineering/op-sqlite';

let db: DB | null = null;
let initPromise: Promise<void> | null = null;

const MIGRATIONS: string[][] = [
  // v1
  [
    `CREATE TABLE IF NOT EXISTS kv (
       key TEXT PRIMARY KEY NOT NULL,
       value TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS cache (
       key TEXT PRIMARY KEY NOT NULL,
       json TEXT NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS contacts (
       id INTEGER PRIMARY KEY NOT NULL,
       phone TEXT NOT NULL,
       name TEXT NOT NULL,
       json TEXT NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone)`,
    `CREATE TABLE IF NOT EXISTS calls (
       uuid TEXT PRIMARY KEY NOT NULL,
       server_id INTEGER,
       employee_id INTEGER NOT NULL,
       contact_id INTEGER,
       contact_name TEXT,
       phone TEXT NOT NULL,
       campaign_id INTEGER,
       started_at INTEGER NOT NULL,
       answered_at INTEGER,
       ended_at INTEGER,
       duration INTEGER NOT NULL DEFAULT 0,
       status TEXT NOT NULL,
       disposition TEXT,
       notes TEXT,
       callback_at INTEGER,
       callback_note TEXT,
       wrapup_done INTEGER NOT NULL DEFAULT 0,
       reconciled INTEGER NOT NULL DEFAULT 0,
       recording_state TEXT,
       recording_uri TEXT,
       recording_mime TEXT,
       recording_size INTEGER,
       recording_server_id INTEGER,
       recording_error TEXT,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_calls_started ON calls(started_at)`,
    `CREATE INDEX IF NOT EXISTS idx_calls_employee ON calls(employee_id, started_at)`,
    `CREATE TABLE IF NOT EXISTS sync_ops (
       id TEXT PRIMARY KEY NOT NULL,
       employee_id INTEGER NOT NULL,
       type TEXT NOT NULL,
       call_uuid TEXT,
       payload TEXT NOT NULL,
       status TEXT NOT NULL DEFAULT 'pending',
       attempts INTEGER NOT NULL DEFAULT 0,
       next_attempt_at INTEGER NOT NULL DEFAULT 0,
       last_error TEXT,
       created_at INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_ops(status, next_attempt_at)`,
  ],
  // v2: a person can have several numbers - each one finds the person (the dialer, an incoming call)
  [
    `CREATE TABLE IF NOT EXISTS contact_phones (
       phone TEXT NOT NULL,
       contact_id INTEGER NOT NULL,
       PRIMARY KEY (phone, contact_id)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_contact_phones_contact ON contact_phones(contact_id)`,
  ],
];

export function getDb(): DB {
  if (!db) throw new Error('The local database has not been initialised yet');
  return db;
}

export function initDatabase(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const opened = open({ name: 'employee-calling.db' });
      const version = await readUserVersion(opened);
      for (let v = version; v < MIGRATIONS.length; v++) {
        await opened.transaction(async (tx) => {
          for (const statement of MIGRATIONS[v]) await tx.execute(statement);
          await tx.execute(`PRAGMA user_version = ${v + 1}`);
        });
      }
      db = opened;
    })().catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

async function readUserVersion(handle: DB): Promise<number> {
  const result = await handle.execute('PRAGMA user_version');
  const row = result.rows?.[0] as Record<string, Scalar> | undefined;
  return row ? Number(row.user_version ?? 0) : 0;
}

export async function query<T = Record<string, Scalar>>(sql: string, params: Scalar[] = []): Promise<T[]> {
  const result = await getDb().execute(sql, params);
  return (result.rows ?? []) as unknown as T[];
}

export async function run(sql: string, params: Scalar[] = []): Promise<{ rowsAffected: number }> {
  const result = await getDb().execute(sql, params);
  return { rowsAffected: result.rowsAffected ?? 0 };
}

/**
 * Drop the server-derived cache on sign-out. Calls made on this phone and the sync queue are deliberately kept
 * (and stay tagged with their employee) so nothing the employee did is lost if it had not synced yet.
 */
export async function clearServerCache(): Promise<void> {
  const database = getDb();
  await database.transaction(async (tx) => {
    await tx.execute('DELETE FROM cache');
    await tx.execute('DELETE FROM contacts');
    await tx.execute('DELETE FROM contact_phones');
  });
}
