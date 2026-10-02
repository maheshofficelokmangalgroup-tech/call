"use client";

import * as React from "react";
import { Bar, BarChart, Cell, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { TooltipCard, type RechartsTooltipProps } from "@/components/charts/chart-tooltip";
import type { HourPoint } from "@/lib/types";
import { activeHours, formatNumber, hourLabel } from "@/lib/utils";

interface Row {
  hour: number;
  calls: number;
  connected: number;
}

const AXIS = { fontSize: 11, fill: "var(--muted)" } as const;

function HourTooltip({ active, payload }: RechartsTooltipProps<Row>) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <TooltipCard
      title={`${hourLabel(row.hour)} - ${hourLabel((row.hour + 1) % 24)}`}
      rows={[
        { label: "Calls", value: formatNumber(row.calls), color: "var(--brand)" },
        { label: "Answered", value: formatNumber(row.connected), color: "var(--info)" },
      ]}
    />
  );
}

/** When in the day the calls happen: one bar per hour, the busiest hours drawn strongest. Fills the height of its card. */
export function HourlyChart({ hourly, minHeight = 260 }: { hourly: HourPoint[]; minHeight?: number }) {
  const rows = React.useMemo<Row[]>(() => {
    const [from, to] = activeHours(hourly.map((h) => h.calls));
    return hourly.filter((h) => h.hour >= from && h.hour <= to).map((h) => ({ hour: h.hour, calls: h.calls, connected: h.connected }));
  }, [hourly]);
  const peak = Math.max(1, ...rows.map((r) => r.calls));

  return (
    <div style={{ minHeight }} className="relative h-full -ml-2" role="img" aria-label="Calls by hour of the day">
      <div className="absolute inset-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 10, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="4 6" />
            <XAxis dataKey="hour" tickLine={false} axisLine={false} tick={AXIS} tickMargin={10} interval={rows.length > 14 ? 1 : 0} tickFormatter={(h: number) => hourLabel(h)} />
            <YAxis tickLine={false} axisLine={false} tick={AXIS} width={40} allowDecimals={false} tickFormatter={(v: number) => formatNumber(v)} />
            <Tooltip content={<HourTooltip />} cursor={{ fill: "var(--surface-3)", opacity: 0.7, radius: 8 }} />
            <Bar dataKey="calls" radius={[8, 8, 3, 3]} animationDuration={900}>
              {rows.map((row) => (
                <Cell key={row.hour} fill="var(--brand)" fillOpacity={row.calls === 0 ? 0.15 : 0.35 + 0.65 * (row.calls / peak)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
