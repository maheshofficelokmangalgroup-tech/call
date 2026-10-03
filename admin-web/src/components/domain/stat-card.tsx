"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import * as React from "react";

import { NumberTicker } from "@/components/ui/number-ticker";
import { Sparkline } from "@/components/ui/sparkline";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, percentChange } from "@/lib/utils";

const TONES = {
  brand: { bg: "bg-brand-soft", fg: "text-brand", color: "var(--brand)" },
  info: { bg: "bg-info-soft", fg: "text-info", color: "var(--info)" },
  violet: { bg: "bg-violet-soft", fg: "text-violet", color: "var(--violet)" },
  warn: { bg: "bg-warn-soft", fg: "text-warn", color: "var(--warn)" },
  teal: { bg: "bg-teal-soft", fg: "text-teal", color: "var(--teal)" },
  pink: { bg: "bg-pink-soft", fg: "text-pink", color: "var(--pink)" },
  danger: { bg: "bg-danger-soft", fg: "text-danger", color: "var(--danger)" },
} as const;

export type StatTone = keyof typeof TONES;

/** Change against the previous period, e.g. "+12.4%". `inverse`: a drop is good news (no-answer calls, pending wrap-ups). */
export function Delta({ current, previous, inverse = false, className }: { current: number; previous: number; inverse?: boolean; className?: string }) {
  const change = percentChange(current, previous);
  if (change === null) return <span className={cn("text-xs font-semibold text-muted", className)}>new</span>;
  const flat = Math.abs(change) < 0.05;
  const up = change > 0;
  const good = flat ? null : inverse ? !up : up;
  const Icon = flat ? ArrowRight : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-bold tnum",
        good === null ? "bg-surface-3 text-muted" : good ? "bg-brand-soft text-brand-strong" : "bg-danger-soft text-danger",
        className,
      )}
      title={`${Math.round(previous).toLocaleString("en-IN")} in the previous period`}
    >
      <Icon className="size-3.5" strokeWidth={2.6} />
      {flat ? "0%" : `${up ? "+" : ""}${change.toFixed(Math.abs(change) >= 100 ? 0 : 1)}%`}
    </span>
  );
}

interface StatCardProps {
  label: string;
  icon: LucideIcon;
  tone?: StatTone;
  value: number;
  format?: (n: number) => string;
  previous?: number;
  inverse?: boolean;
  caption?: React.ReactNode;
  trend?: number[];
  loading?: boolean;
  index?: number;
  testId?: string;
}

/** One headline number with its change against the previous period and a mini trend. */
export function StatCard({ label, icon: Icon, tone = "brand", value, format, previous, inverse, caption, trend, loading, index = 0, testId }: StatCardProps) {
  const t = TONES[tone];
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      className="card-lift group @container relative overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-card"
      data-testid={testId}
    >
      <div className="pointer-events-none absolute -right-6 -top-6 size-24 rounded-full opacity-[0.12] blur-2xl transition-opacity duration-300 group-hover:opacity-25" style={{ background: t.color }} />
      <div className="flex items-start justify-between gap-3">
        <div className={cn("flex size-10 items-center justify-center rounded-xl", t.bg, t.fg)}>
          <Icon className="size-5" strokeWidth={2.2} />
        </div>
        {previous !== undefined && !loading ? <Delta current={value} previous={previous} inverse={inverse} /> : null}
      </div>
      <p className="mt-4 text-[13px] font-semibold text-muted">{label}</p>
      <div className="mt-1 flex items-end justify-between gap-3">
        {loading ? (
          <Skeleton className="h-9 w-24" />
        ) : (
          <p className="whitespace-nowrap text-[30px] font-extrabold leading-none tracking-tight text-ink tnum" data-testid={testId ? `${testId}-value` : undefined}>
            <NumberTicker value={value} format={format} />
          </p>
        )}
        {trend && trend.length > 1 && !loading ? <Sparkline values={trend} color={t.color} width={64} height={34} className="hidden shrink-0 @[215px]:block" /> : null}
      </div>
      {caption ? <div className="mt-2 text-xs text-muted">{caption}</div> : null}
    </motion.div>
  );
}
