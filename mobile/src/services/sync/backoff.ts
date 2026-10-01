import { SYNC_BACKOFF_BASE_MS, SYNC_BACKOFF_MAX_MS, SYNC_MAX_ATTEMPTS } from '../../config/env';

/** Exponential backoff with +/-25% jitter: 5s, 10s, 20s ... capped at 15 minutes. */
export function nextBackoffMs(attempts: number, random: () => number = Math.random): number {
  const exponential = Math.min(SYNC_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts), SYNC_BACKOFF_MAX_MS);
  return Math.round(exponential * (0.75 + random() * 0.5));
}

export function hasExhaustedAttempts(attempts: number): boolean {
  return attempts >= SYNC_MAX_ATTEMPTS;
}
