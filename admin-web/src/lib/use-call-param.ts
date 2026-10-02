"use client";

import * as React from "react";

import { useUrlParam } from "@/lib/use-url-param";

/**
 * Which call is open in the side panel, kept in the address (`?call=123`) so a refresh keeps it open, the browser's back button
 * closes it and the link can be shared with another administrator.
 */
export function useCallParam(): readonly [number | null, (id: number | null) => void] {
  const [raw, setRaw] = useUrlParam("call");
  const id = raw && /^\d{1,12}$/.test(raw) ? Number(raw) : null;
  const set = React.useCallback((next: number | null) => setRaw(next === null ? null : String(next)), [setRaw]);
  return [id, set] as const;
}
