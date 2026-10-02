"use client";

import { motion } from "motion/react";
import * as React from "react";

import { WEEKDAYS, activeHours, cn, formatNumber, hourLabel } from "@/lib/utils";

const shade = (level: number) => (level <= 0 ? "var(--surface-3)" : `color-mix(in oklab, var(--brand) ${Math.round((0.18 + 0.82 * level) * 100)}%, var(--surface-3))`);

/** Calls per weekday and hour. `values[weekday][hour]`, Monday first. Darker means busier; only the hours in use are drawn. */
export function Heatmap({ values }: { values: number[][] }) {
  const max = React.useMemo(() => Math.max(1, ...values.flat()), [values]);
  const total = React.useMemo(() => values.flat().reduce((a, b) => a + b, 0), [values]);
  const hours = React.useMemo(() => {
    const perHour = Array.from({ length: 24 }, (_, h) => values.reduce((sum, row) => sum + (row[h] ?? 0), 0));
    const [from, to] = activeHours(perHour);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }, [values]);
  const [hover, setHover] = React.useState<{ day: number; hour: number } | null>(null);

  if (total === 0) return <p className="py-14 text-center text-sm text-muted">No calls in this period yet.</p>;

  const hoverCount = hover ? (values[hover.day]?.[hover.hour] ?? 0) : null;
  const step = hours.length > 14 ? 3 : 2;
  const columns = { gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))` };

  return (
    <div data-testid="heatmap">
      <p className="mb-3 h-5 text-sm text-muted" aria-live="polite">
        {hover ? (
          <>
            <span className="font-bold text-ink">
              {WEEKDAYS[hover.day]} {hourLabel(hover.hour)}
            </span>{" "}
            - {formatNumber(hoverCount)} {hoverCount === 1 ? "call" : "calls"}
          </>
        ) : (
          "Hover a square to see the number of calls."
        )}
      </p>
      <div className="overflow-x-auto pb-1" onMouseLeave={() => setHover(null)}>
        <div className="min-w-[420px]">
          <div className="grid gap-[3px] pb-1.5 pl-10 text-[10px] font-semibold text-faint" style={columns}>
            {hours.map((h, i) => (
              <span key={h} className="whitespace-nowrap text-center">
                {i % step === 0 ? hourLabel(h).replace(" ", "") : ""}
              </span>
            ))}
          </div>
          {values.map((row, day) => (
            <div key={day} className="mb-[3px] flex items-center gap-2">
              <span className="w-8 shrink-0 text-xs font-semibold text-muted">{WEEKDAYS[day]}</span>
              <div className="grid flex-1 gap-[3px]" style={columns}>
                {hours.map((hour, col) => {
                  const count = row[hour] ?? 0;
                  const active = hover?.day === day && hover.hour === hour;
                  return (
                    <motion.button
                      key={hour}
                      type="button"
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: (day * hours.length + col) * 0.003, duration: 0.3 }}
                      onMouseEnter={() => setHover({ day, hour })}
                      onFocus={() => setHover({ day, hour })}
                      aria-label={`${WEEKDAYS[day]} ${hourLabel(hour)}: ${count} calls`}
                      className={cn("aspect-[1.25] rounded-md outline-none transition-transform", active && "scale-110 ring-2 ring-ink/70")}
                      style={{ background: shade(count === 0 ? 0 : Math.sqrt(count / max)) }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 text-[11px] font-semibold text-faint">
        Fewer
        {[0, 0.25, 0.5, 0.75, 1].map((l) => (
          <span key={l} className="size-3 rounded-[4px]" style={{ background: shade(l) }} />
        ))}
        More
      </div>
    </div>
  );
}
