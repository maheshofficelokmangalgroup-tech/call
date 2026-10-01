import type { Contact } from '../services/api/types';
import { getDb, query, run } from './db';

interface Row {
  json: string;
}

/** Keep a local copy of contacts the employee has seen (queue, lists) for offline use and dialer look-ups. */
export async function upsertContacts(contacts: Contact[]): Promise<void> {
  if (!contacts.length) return;
  const now = Date.now();
  await getDb().transaction(async (tx) => {
    for (const c of contacts) {
      await tx.execute(
        `INSERT INTO contacts (id, phone, name, json, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET phone = excluded.phone, name = excluded.name, json = excluded.json, updated_at = excluded.updated_at`,
        [c.id, c.phone, c.name, JSON.stringify(c), now],
      );
    }
  });
}

export async function findContactByPhone(phone: string): Promise<Contact | null> {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return null;
  const suffix = digits.slice(-10);
  const rows = await query<Row>('SELECT json FROM contacts WHERE replace(replace(phone, "+", ""), " ", "") LIKE ? LIMIT 1', [`%${suffix}`]);
  return rows.length ? (JSON.parse(rows[0].json) as Contact) : null;
}

export async function getLocalContact(id: number): Promise<Contact | null> {
  const rows = await query<Row>('SELECT json FROM contacts WHERE id = ?', [id]);
  return rows.length ? (JSON.parse(rows[0].json) as Contact) : null;
}

export async function searchLocalContacts(text: string, limit = 50): Promise<Contact[]> {
  const like = `%${text.trim().toLowerCase().replace(/[%_]/g, '')}%`;
  const rows = await query<Row>(
    'SELECT json FROM contacts WHERE lower(name) LIKE ? OR phone LIKE ? ORDER BY name COLLATE NOCASE LIMIT ?',
    [like, like, limit],
  );
  return rows.map((r) => JSON.parse(r.json) as Contact);
}

export async function clearContacts(): Promise<void> {
  await run('DELETE FROM contacts');
}
