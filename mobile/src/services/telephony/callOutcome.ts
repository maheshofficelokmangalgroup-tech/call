import type { DispositionCode } from '../api/types';

/** android.telecom.DisconnectCause codes */
export const CAUSE = { UNKNOWN: 0, ERROR: 1, LOCAL: 2, REMOTE: 3, CANCELED: 4, MISSED: 5, REJECTED: 6, BUSY: 7 } as const;

/**
 * The outcome to pre-select after a call. The employee always confirms it - this only saves a tap in the common cases, using
 * what the phone told us about why the call ended (answered, busy, invalid number, switched off, ...).
 */
export function suggestDisposition(input: { answered: boolean; causeCode: number; causeReason: string | null }): DispositionCode {
  if (input.answered) return 'CONNECTED';
  const reason = (input.causeReason ?? '').toUpperCase();
  if (input.causeCode === CAUSE.BUSY || /BUSY|CONGESTION/.test(reason)) return 'BUSY';
  if (/UNOBTAINABLE|INVALID_NUMBER|NUMBER_NOT|NOT_EXIST|UNALLOCATED|INCORRECT/.test(reason)) return 'INVALID_NUMBER';
  if (/POWER_OFF|OUT_OF_SERVICE|OUT_OF_NETWORK|UNREACHABLE|NO_SERVICE|NOT_REACHABLE|SWITCHED/.test(reason)) return 'SWITCHED_OFF';
  return 'NO_ANSWER';
}
