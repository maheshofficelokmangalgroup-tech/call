"use client";

import * as React from "react";

import { useLocalStorage } from "@/lib/use-local-storage";
import { addDays, daysBetween, formatDay, todayIn } from "@/lib/utils";
import type { DateRange } from "@/lib/types";

export type PresetKey = "today" | "yesterday" | "7d" | "30d" | "month" | "lastMonth" | "custom";

export const PRESETS: { key: Exclude<PresetKey, "custom">; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "lastMonth", label: "Last month" },
];

const STORAGE_KEY = "ec-admin-range";

export function resolvePreset(key: Exclude<PresetKey, "custom">, tz: string, now = new Date()): DateRange {
  const today = todayIn(tz, now);
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "lastMonth": {
      const firstThis = `${today.slice(0, 8)}01`;
      const lastPrev = addDays(firstThis, -1);
      return { from: `${lastPrev.slice(0, 8)}01`, to: lastPrev };
    }
  }
}

interface RangeState {
  preset: PresetKey;
  custom?: DateRange;
}

export interface RangeContextValue {
  range: DateRange;
  preset: PresetKey;
  days: number;
  label: string;
  tz: string;
  setPreset: (key: Exclude<PresetKey, "custom">) => void;
  setCustom: (range: DateRange) => void;
}

const RangeContext = React.createContext<RangeContextValue | null>(null);

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function parseStored(raw: string): RangeState {
  try {
    const parsed = JSON.parse(raw) as RangeState;
    if (parsed.preset === "custom" && parsed.custom && DAY.test(parsed.custom.from) && DAY.test(parsed.custom.to)) return parsed;
    if (PRESETS.some((p) => p.key === parsed.preset)) return { preset: parsed.preset };
  } catch {
    /* empty or corrupt value: use the default */
  }
  return { preset: "7d" };
}

/** The period every page of the panel looks at. It is remembered between visits and always uses the business timezone. */
export function RangeProvider({ tz, children }: { tz: string; children: React.ReactNode }) {
  const [stored, store] = useLocalStorage(STORAGE_KEY, "");
  const state = React.useMemo(() => parseStored(stored), [stored]);

  const value = React.useMemo<RangeContextValue>(() => {
    const range = state.preset === "custom" && state.custom ? state.custom : resolvePreset(state.preset === "custom" ? "7d" : state.preset, tz);
    const preset = state.preset === "custom" && !state.custom ? "7d" : state.preset;
    const label = preset === "custom" ? (range.from === range.to ? formatDay(range.from, { day: "numeric", month: "short", year: "numeric" }) : `${formatDay(range.from)} - ${formatDay(range.to)}`) : (PRESETS.find((p) => p.key === preset)?.label ?? "");
    return {
      range,
      preset,
      days: daysBetween(range.from, range.to),
      label,
      tz,
      setPreset: (key) => store(JSON.stringify({ preset: key } satisfies RangeState)),
      setCustom: (r) => store(JSON.stringify({ preset: "custom", custom: r.from <= r.to ? r : { from: r.to, to: r.from } } satisfies RangeState)),
    };
  }, [state, tz, store]);

  return <RangeContext.Provider value={value}>{children}</RangeContext.Provider>;
}

export function useRange(): RangeContextValue {
  const ctx = React.useContext(RangeContext);
  if (!ctx) throw new Error("useRange must be used inside <RangeProvider>");
  return ctx;
}
