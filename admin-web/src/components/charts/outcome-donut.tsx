"use client";

import { motion } from "motion/react";
import * as React from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { TooltipCard, type RechartsTooltipProps } from "@/components/charts/chart-tooltip";
import type { OutcomeCount } from "@/lib/types";
import { NO_OUTCOME_COLOR, OUTCOME_COLOR } from "@/lib/status";
import { cn, formatNumber, formatPercent } from "@/lib/utils";

interface Slice {
  key: string;
  label: string;
  count: number;
  color: string;
}

const FALLBACKS = ["#2563eb", "#7c3aed", "#0d9488", "#db2777", "#d97a00", "#3fae52"];

function toSlices(outcomes: OutcomeCount[]): Slice[] {
  return outcomes
    .filter((o) => o.count > 0)
    .map((o, i) => ({
      key: o.code ?? "none",
      label: o.label,
      count: o.count,
      color: o.code ? (OUTCOME_COLOR[o.code] ?? FALLBACKS[i % FALLBACKS.length]!) : NO_OUTCOME_COLOR,
    }));
}

function SliceTooltip({ active, payload }: RechartsTooltipProps<Slice>) {
  const slice = payload?.[0]?.payload;
  if (!active || !slice) return null;
  return <TooltipCard rows={[{ label: slice.label, value: formatNumber(slice.count), color: slice.color }]} />;
}

/** How the calls ended (what the employee chose after each call): a ring with the legend underneath, or beside it in `wide` mode. */
export function OutcomeDonut({ outcomes, centerLabel = "calls", wide = false }: { outcomes: OutcomeCount[]; centerLabel?: string; wide?: boolean }) {
  const slices = React.useMemo(() => toSlices(outcomes), [outcomes]);
  const total = slices.reduce((sum, s) => sum + s.count, 0);
  const [active, setActive] = React.useState<string | null>(null);

  if (total === 0) {
    return <p className="py-16 text-center text-sm text-muted">No finished calls in this period.</p>;
  }

  const shown = active ? slices.find((s) => s.key === active) : null;

  return (
    <div className={cn("flex flex-col items-center gap-5", wide && "sm:flex-row sm:gap-8")}>
      <div className="relative size-[190px] shrink-0" role="img" aria-label="Call outcomes">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="count"
              nameKey="label"
              innerRadius={62}
              outerRadius={92}
              paddingAngle={slices.length > 1 ? 3 : 0}
              cornerRadius={7}
              stroke="none"
              startAngle={90}
              endAngle={-270}
              animationDuration={1000}
              onMouseEnter={(_, index) => setActive(slices[index]?.key ?? null)}
              onMouseLeave={() => setActive(null)}
            >
              {slices.map((s) => (
                <Cell key={s.key} fill={s.color} fillOpacity={active && active !== s.key ? 0.35 : 1} style={{ transition: "fill-opacity .2s", outline: "none" }} />
              ))}
            </Pie>
            <Tooltip content={<SliceTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <motion.p key={shown?.key ?? "total"} initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} className="text-[28px] font-extrabold leading-none text-ink tnum">
            {formatNumber(shown ? shown.count : total)}
          </motion.p>
          <p className="mt-1 max-w-[100px] truncate text-xs font-semibold text-muted">{shown ? shown.label : centerLabel}</p>
        </div>
      </div>

      <ul className="w-full min-w-0 flex-1 space-y-0.5">
        {slices.slice(0, 7).map((s) => (
          <li
            key={s.key}
            onMouseEnter={() => setActive(s.key)}
            onMouseLeave={() => setActive(null)}
            className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors hover:bg-surface-2", active === s.key && "bg-surface-2")}
          >
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate font-medium text-ink-soft">{s.label}</span>
            <span className="font-bold text-ink tnum">{formatNumber(s.count)}</span>
            <span className="w-11 text-right text-xs text-muted tnum">{formatPercent((s.count / total) * 100, 0)}</span>
          </li>
        ))}
        {slices.length > 7 ? <li className="px-2.5 pt-1 text-xs text-muted">+ {slices.length - 7} more outcomes</li> : null}
      </ul>
    </div>
  );
}
