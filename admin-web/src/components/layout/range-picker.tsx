"use client";

import { CalendarDays, Check, ChevronDown } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { inputClasses } from "@/components/ui/input";
import { PRESETS, useRange } from "@/lib/range";
import { cn, daysBetween, pluralize } from "@/lib/utils";

/** Two date fields for any period. They live inside the popover, so they start from the current period every time it opens. */
function CustomRange() {
  const { range, setCustom, tz } = useRange();
  const [from, setFrom] = React.useState(range.from);
  const [to, setTo] = React.useState(range.to);
  const valid = from && to && daysBetween(from, to) >= 1 && daysBetween(from, to) <= 366;

  return (
    <div className="mt-3 rounded-2xl border border-line bg-surface-2 p-3">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-faint">Custom range</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs font-semibold text-muted">
          From
          <input type="date" className={cn(inputClasses, "h-10")} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="space-y-1 text-xs font-semibold text-muted">
          To
          <input type="date" className={cn(inputClasses, "h-10")} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xs text-muted">
          {valid ? pluralize(daysBetween(from, to), "day") : "Choose up to 366 days"} · {tz}
        </span>
        <PopoverClose asChild>
          <Button size="sm" disabled={!valid} onClick={() => setCustom({ from, to })}>
            Apply
          </Button>
        </PopoverClose>
      </div>
    </div>
  );
}

/** "Last 7 days" button that opens the list of periods plus two date fields for anything else. */
export function RangePicker({ className }: { className?: string }) {
  const { preset, label, days, setPreset } = useRange();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" className={cn("h-10 gap-2 px-3.5", className)} aria-label={`Period: ${label}`} data-testid="range-picker">
          <CalendarDays className="size-4 text-brand" />
          <span className="hidden sm:inline">{label}</span>
          <span className="rounded-md bg-surface-3 px-1.5 text-[11px] font-bold text-muted tnum">{days}d</span>
          <ChevronDown className="size-4 text-muted" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,380px)] p-3" align="end">
        <p className="px-2 pb-2 pt-1 text-xs font-bold uppercase tracking-wide text-faint">Period</p>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map((p) => (
            <PopoverClose asChild key={p.key}>
              <button
                type="button"
                onClick={() => setPreset(p.key)}
                className={cn(
                  "flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-surface-3",
                  preset === p.key ? "bg-brand-soft text-brand-strong" : "text-ink-soft",
                )}
              >
                {p.label}
                {preset === p.key ? <Check className="size-4" strokeWidth={3} /> : null}
              </button>
            </PopoverClose>
          ))}
        </div>
        <CustomRange />
      </PopoverContent>
    </Popover>
  );
}
