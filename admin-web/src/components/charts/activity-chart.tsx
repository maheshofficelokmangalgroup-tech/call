"use client";

import * as React from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { TooltipCard, type RechartsTooltipProps } from "@/components/charts/chart-tooltip";
import { Segmented } from "@/components/ui/segmented";
import type { DayPoint } from "@/lib/types";
import { formatDay, formatDuration, formatNumber } from "@/lib/utils";

type Metric = "calls" | "talk";

interface Row {
  date: string;
  calls: number;
  connected: number;
  talkMinutes: number;
  talkSeconds: number;
}

const AXIS = { fontSize: 11, fill: "var(--muted)" } as const;

function DayTooltip({ active, payload }: RechartsTooltipProps<Row>) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <TooltipCard
      title={formatDay(row.date, { weekday: "long", day: "numeric", month: "short" })}
      rows={[
        { label: "Calls", value: formatNumber(row.calls), color: "var(--brand)" },
        { label: "Answered", value: formatNumber(row.connected), color: "var(--info)" },
        { label: "Talk time", value: formatDuration(row.talkSeconds, { compact: true }), color: "var(--violet)" },
      ]}
    />
  );
}

export type ActivityMetric = Metric;

export function ActivityToggle({ metric, onChange }: { metric: Metric; onChange: (m: Metric) => void }) {
  return (
    <Segmented
      name="activity-metric"
      size="sm"
      value={metric}
      onChange={onChange}
      aria-label="Chart metric"
      options={[
        { value: "calls", label: "Calls" },
        { value: "talk", label: "Talk time" },
      ]}
    />
  );
}

/** Calls (or talk time) for every day of the period, with the answered calls drawn over them. Fills the height of its card. */
export function ActivityChart({ series, metric, minHeight = 300 }: { series: DayPoint[]; metric: Metric; minHeight?: number }) {
  const uid = React.useId().replace(/:/g, "");
  const rows = React.useMemo<Row[]>(
    () => series.map((d) => ({ date: d.date, calls: d.calls, connected: d.connected, talkSeconds: d.talk_seconds, talkMinutes: Math.round(d.talk_seconds / 60) })),
    [series],
  );
  const dense = rows.length > 45;
  const main = metric === "calls" ? "var(--brand)" : "var(--violet)";

  return (
    <div style={{ minHeight }} className="relative -ml-2 h-full" role="img" aria-label="Daily activity chart">
      <div className="absolute inset-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`${uid}-main`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={main} stopOpacity={0.4} />
                <stop offset="100%" stopColor={main} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id={`${uid}-sub`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--info)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--info)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="4 6" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tick={AXIS}
              tickMargin={10}
              minTickGap={dense ? 28 : 14}
              tickFormatter={(d: string) => formatDay(d, rows.length <= 8 ? { weekday: "short", day: "numeric" } : { day: "numeric", month: "short" })}
            />
            <YAxis tickLine={false} axisLine={false} tick={AXIS} width={44} allowDecimals={false} tickFormatter={(v: number) => (metric === "talk" ? `${v}m` : formatNumber(v))} />
            <Tooltip content={<DayTooltip />} cursor={{ stroke: "var(--line-strong)", strokeDasharray: "4 4" }} />
            {metric === "calls" ? (
              <>
                <Area type="monotone" dataKey="calls" stroke={main} strokeWidth={2.5} fill={`url(#${uid}-main)`} activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--surface)" }} animationDuration={900} />
                <Area type="monotone" dataKey="connected" stroke="var(--info)" strokeWidth={2} fill={`url(#${uid}-sub)`} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} animationDuration={1100} />
              </>
            ) : (
              <Area type="monotone" dataKey="talkMinutes" stroke={main} strokeWidth={2.5} fill={`url(#${uid}-main)`} activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--surface)" }} animationDuration={900} />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
