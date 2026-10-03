import { useEffect, useState } from "react";

/** The current time in ms, refreshed every `intervalMs` (for "in 25 min" style wording and call timers). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
