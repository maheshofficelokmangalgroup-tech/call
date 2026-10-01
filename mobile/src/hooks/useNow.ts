import { useEffect, useState } from 'react';

/** The current time, refreshed every [intervalMs] while [enabled] (call timers). */
export function useNow(intervalMs = 500, enabled = true): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, enabled]);
  return now;
}
