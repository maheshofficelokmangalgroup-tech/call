"use client";

import { Headphones, Info, MicOff } from "lucide-react";
import { motion } from "motion/react";
import * as React from "react";

import { Tip } from "@/components/ui/tooltip";
import { NOT_RECORDED_HELP } from "@/lib/status";
import type { RecordingInsight } from "@/lib/types";
import { cn, formatNumber } from "@/lib/utils";

function Ring({ percent }: { percent: number }) {
  const size = 132;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, percent));
  const color = pct >= 80 ? "var(--brand)" : pct >= 40 ? "var(--warn)" : "var(--danger)";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${Math.round(pct)} percent of answered calls have a recording`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - pct / 100) }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-[28px] font-extrabold leading-none text-ink tnum">
          {Math.round(pct)}
          <span className="text-base text-muted">%</span>
        </p>
        <p className="mt-1 text-[11px] font-semibold text-muted">recorded</p>
      </div>
    </div>
  );
}

/** How many answered calls have a recording, and for the others, why not. */
export function RecordingCoverage({ insight, className }: { insight: RecordingInsight; className?: string }) {
  const missing = insight.not_recorded.reduce((sum, r) => sum + r.count, 0);
  const max = Math.max(1, ...insight.not_recorded.map((r) => r.count));
  const mostlySilent = insight.not_recorded.find((r) => r.reason === "silent");

  if (!insight.enabled) {
    return (
      <div className={cn("flex items-start gap-3 rounded-2xl border border-warn/30 bg-warn-soft p-4 text-sm text-warn", className)}>
        <MicOff className="mt-0.5 size-4 shrink-0" />
        <p>
          <span className="font-bold">Recording is switched off.</span> No call is being recorded. Turn it on in Settings.
        </p>
      </div>
    );
  }

  if (insight.answered_calls === 0) {
    return <p className={cn("py-10 text-center text-sm text-muted", className)}>There are no answered calls in this period yet.</p>;
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-6">
        <Ring percent={insight.coverage_percent} />
        <div className="min-w-0 flex-1 basis-48 space-y-2.5">
          <div className="flex items-center gap-3 rounded-xl bg-brand-soft px-3.5 py-2.5">
            <Headphones className="size-4 text-brand" />
            <p className="flex-1 text-sm font-semibold text-brand-strong">With recording</p>
            <p className="text-base font-extrabold text-brand-strong tnum">{formatNumber(insight.recorded_calls)}</p>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-surface-3 px-3.5 py-2.5">
            <MicOff className="size-4 text-muted" />
            <p className="flex-1 text-sm font-semibold text-ink-soft">Without recording</p>
            <p className="text-base font-extrabold text-ink tnum">{formatNumber(missing)}</p>
          </div>
          <p className="px-1 text-xs text-muted">Out of {formatNumber(insight.answered_calls)} answered calls. Unanswered calls have nothing to record.</p>
        </div>
      </div>

      {insight.not_recorded.length > 0 ? (
        <div className="mt-6">
          <h4 className="mb-2.5 text-xs font-bold uppercase tracking-[0.12em] text-muted">Why some calls have no recording</h4>
          <ul className="space-y-3">
            {insight.not_recorded.map((reason) => (
              <li key={reason.reason}>
                <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5 font-semibold text-ink-soft">
                    <span className="truncate">{reason.label}</span>
                    {NOT_RECORDED_HELP[reason.reason] ? (
                      <Tip label={NOT_RECORDED_HELP[reason.reason]}>
                        <button type="button" aria-label={`What does "${reason.label}" mean?`} className="text-faint transition-colors hover:text-ink">
                          <Info className="size-3.5" />
                        </button>
                      </Tip>
                    ) : null}
                  </span>
                  <span className="font-bold text-ink tnum">{formatNumber(reason.count)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <motion.div className="h-full rounded-full bg-warn" initial={{ width: 0 }} animate={{ width: `${(reason.count / max) * 100}%` }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {mostlySilent && mostlySilent.count >= missing / 2 ? (
        <p className="mt-5 flex items-start gap-2.5 rounded-xl border border-line bg-surface-2 p-3.5 text-xs leading-relaxed text-muted">
          <Info className="mt-0.5 size-3.5 shrink-0 text-info" />
          <span>
            <span className="font-bold text-ink-soft">Most phones cannot record the other person.</span> Android gives ordinary apps only silence while a call is on. For recordings that always work, connect a cloud-telephony provider
            (see <span className="font-mono">docs/TELEPHONY.md</span>).
          </span>
        </p>
      ) : null}
    </div>
  );
}
