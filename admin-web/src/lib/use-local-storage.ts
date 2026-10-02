"use client";

import * as React from "react";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // private mode or blocked storage: behave as if nothing was saved
  }
}

/**
 * A string kept in localStorage that every component using the same key sees. On the server (and while the page hydrates)
 * it is `fallback`, so the first paint matches; the saved value follows right after.
 */
export function useLocalStorage(key: string, fallback: string): [string, (value: string) => void] {
  const value = React.useSyncExternalStore(
    subscribe,
    () => read(key) ?? fallback,
    () => fallback,
  );
  const set = React.useCallback(
    (next: string) => {
      try {
        window.localStorage.setItem(key, next);
      } catch {
        /* the choice is simply not remembered */
      }
      emit();
    },
    [key],
  );
  return [value, set];
}
