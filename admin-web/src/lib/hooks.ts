"use client";

import * as React from "react";

/** The current time, refreshed every `intervalMs` - for live timers ("on the call for 02:41"). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** A value that follows `value` after it has stopped changing for `delay` ms - for search boxes that query the server. */
export function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/**
 * State that starts over from `initial` whenever `key` changes (a new filter, another page of a list ...).
 * It is worked out while rendering, so there is no extra render with the old value in it. Pass a stable `initial`.
 */
export function useKeyedState<T>(initial: T, key: string): [T, (next: T | ((current: T) => T)) => void] {
  const [state, setState] = React.useState<{ key: string; value: T }>({ key, value: initial });
  const value = state.key === key ? state.value : initial;
  const set = React.useCallback(
    (next: T | ((current: T) => T)) => {
      setState((prev) => {
        const base = prev.key === key ? prev.value : initial;
        return { key, value: typeof next === "function" ? (next as (current: T) => T)(base) : next };
      });
    },
    [key, initial],
  );
  return [value, set];
}

/** Page number of a list; it goes back to 1 whenever the filters in `deps` change. */
export function usePageReset(deps: React.DependencyList): [number, (page: number) => void] {
  const [page, setPage] = useKeyedState(1, JSON.stringify(deps));
  return [page, setPage];
}

const noop = () => () => undefined;

/** false while the page is rendered on the server and during hydration, true afterwards - for things that only exist in the browser. */
export function useIsClient(): boolean {
  return React.useSyncExternalStore(noop, () => true, () => false);
}
