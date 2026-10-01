import { query, run } from './db';

// ---- key/value settings (server URL, flags, ...) ---------------------------------------------
export async function getKv(key: string): Promise<string | null> {
  const rows = await query<{ value: string | null }>('SELECT value FROM kv WHERE key = ?', [key]);
  return rows.length ? rows[0].value : null;
}

export async function setKv(key: string, value: string): Promise<void> {
  await run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

export async function deleteKv(key: string): Promise<void> {
  await run('DELETE FROM kv WHERE key = ?', [key]);
}

// ---- JSON cache for server responses (queue, dashboard, ...) ---------------------------------
export interface Cached<T> {
  data: T;
  updatedAt: number;
}

export async function getCache<T>(key: string): Promise<Cached<T> | null> {
  const rows = await query<{ json: string; updated_at: number }>('SELECT json, updated_at FROM cache WHERE key = ?', [key]);
  if (!rows.length) return null;
  try {
    return { data: JSON.parse(rows[0].json) as T, updatedAt: Number(rows[0].updated_at) };
  } catch {
    return null;
  }
}

export async function setCache<T>(key: string, data: T): Promise<void> {
  await run(
    'INSERT INTO cache (key, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at',
    [key, JSON.stringify(data), Date.now()],
  );
}

export async function deleteCachePrefix(prefix: string): Promise<void> {
  await run('DELETE FROM cache WHERE key LIKE ?', [`${prefix}%`]);
}
