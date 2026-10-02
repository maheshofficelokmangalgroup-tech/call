"use client";

import { motion } from "motion/react";
import * as React from "react";

import { formatNumber } from "@/lib/utils";

/** Today's calls against the daily target, as a ring that fills up (it keeps counting past 100%). */
export function TargetRing({ calls, target }: { calls: number; target: number }) {
  const size = 148;
  const stroke = 13;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = target > 0 ? calls / target : 0;
  const pct = Math.min(1, ratio);
  const done = target > 0 && calls >= target;

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={target > 0 ? `${calls} of ${target} calls today` : `${calls} calls today`}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={done ? "var(--brand)" : "var(--info)"}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference * (1 - pct) }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-[32px] font-extrabold leading-none text-ink tnum">{formatNumber(calls)}</p>
          <p className="mt-1 text-xs font-semibold text-muted">{target > 0 ? `of ${formatNumber(target)} calls` : "calls today"}</p>
        </div>
      </div>
      <div className="min-w-0 flex-1 basis-40">
        {target > 0 ? (
          <>
            <p className="text-2xl font-extrabold text-ink tnum">{Math.round(ratio * 100)}%</p>
            <p className="text-sm text-muted">{done ? (calls > target ? `Target beaten by ${formatNumber(calls - target)} calls` : "Target reached") : `${formatNumber(target - calls)} more calls to reach today's target`}</p>
          </>
        ) : (
          <p className="text-sm text-muted">No daily target is set for this person.</p>
        )}
      </div>
    </div>
  );
}
