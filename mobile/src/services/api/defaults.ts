import type { Disposition } from './types';

/** Used only until the server's list has been downloaded once (the server is the source of truth for outcomes). */
export const DEFAULT_DISPOSITIONS: Disposition[] = [
  { id: 1, code: 'CONNECTED', label: 'Connected', category: 'connected', requires_callback: false, sort_order: 1 },
  { id: 2, code: 'NO_ANSWER', label: 'No Answer', category: 'not_connected', requires_callback: false, sort_order: 2 },
  { id: 3, code: 'BUSY', label: 'Busy', category: 'not_connected', requires_callback: false, sort_order: 3 },
  { id: 4, code: 'SWITCHED_OFF', label: 'Switched Off', category: 'not_connected', requires_callback: false, sort_order: 4 },
  { id: 5, code: 'INVALID_NUMBER', label: 'Invalid Number', category: 'not_connected', requires_callback: false, sort_order: 5 },
  { id: 6, code: 'INTERESTED', label: 'Interested', category: 'connected', requires_callback: false, sort_order: 6 },
  { id: 7, code: 'NOT_INTERESTED', label: 'Not Interested', category: 'connected', requires_callback: false, sort_order: 7 },
  { id: 8, code: 'CALLBACK', label: 'Callback', category: 'connected', requires_callback: true, sort_order: 8 },
  { id: 9, code: 'FOLLOW_UP', label: 'Follow-up', category: 'connected', requires_callback: true, sort_order: 9 },
  { id: 10, code: 'COMPLETED', label: 'Completed', category: 'connected', requires_callback: false, sort_order: 10 },
  { id: 11, code: 'DO_NOT_CONTACT', label: 'Do Not Contact', category: 'other', requires_callback: false, sort_order: 11 },
];
