import { newCallbackRef, newNoteRef } from '../../utils/ids';
import { syncEngine } from '../sync/syncEngine';

/** Queue a contact note. Returns the client reference used as the idempotency key. */
export async function queueNote(contactId: number, body: string): Promise<string> {
  const clientRef = newNoteRef();
  await syncEngine.enqueue('note_create', { contactId, body, clientRef });
  return clientRef;
}

/** Queue a new callback for a contact. */
export async function queueCallback(contactId: number, scheduledAt: number, note: string | null): Promise<string> {
  const clientRef = newCallbackRef();
  await syncEngine.enqueue('callback_create', { contactId, scheduledAt, note, clientRef });
  return clientRef;
}

export async function queueCallbackUpdate(id: number, patch: { scheduledAt?: number; status?: 'done' | 'cancelled'; note?: string | null }): Promise<void> {
  await syncEngine.enqueue('callback_update', { id, ...patch });
}
