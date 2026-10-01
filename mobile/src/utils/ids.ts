/**
 * Client-generated identifiers. They only need to be unique per employee (they are idempotency keys for the
 * sync queue), so a timestamp + random suffix is enough - no cryptographic randomness is required.
 */
function randomPart(length: number): string {
  let out = '';
  while (out.length < length) out += Math.random().toString(36).slice(2);
  return out.slice(0, length);
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomPart(10)}`;
}

export const newCallId = () => newId('call');
export const newOpId = () => newId('op');
export const newNoteRef = () => newId('note');
export const newCallbackRef = () => newId('cb');
