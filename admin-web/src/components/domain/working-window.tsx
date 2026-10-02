"use client";

import { motion } from "motion/react";
import * as React from "react";

import { hourLabel, minuteToClock } from "@/lib/utils";

const FROM = 6 * 60; // the day is drawn from 6 AM ...
const TO = 22 * 60; // ... to 10 PM

const pct = (minute: number) => Math.max(0, Math.min(100, ((minute - FROM) / (TO - FROM)) * 100));

/** The hours an employee usually works: from the average time of the first call to the average time of the last one. */
export function WorkingWindow({ firstMinute, lastMinute }: { firstMinute: number | null; lastMinute: number | null }) {
  if (firstMinute === null || lastMinute === null) return <p className="py-6 text-sm text-muted">No calls in this period, so there is no pattern to show yet.</p>;
  const left = pct(firstMinute);
  const right = pct(lastMinute);
  const width = Math.max(2, right - left);

  return (
    <div>
      <div className="relative h-3 rounded-full bg-surface-3">
        {[8, 12, 16, 20].map((h) => (
          <span key={h} className="absolute top-0 h-3 w-px bg-line-strong/70" style={{ left: `${pct(h * 60)}%` }} aria-hidden />
        ))}
        <motion.div
          className="absolute top-0 h-3 rounded-full bg-gradient-to-r from-brand to-[#53d36b]"
          style={{ left: `${left}%` }}
          initial={{ width: 0 }}
          animate={{ width: `${width}%` }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
        />
      </div>
      <div className="mt-2 flex justify-between text-[11px] font-semibold text-faint">
        {[6, 10, 14, 18, 22].map((h) => (
          <span key={h}>{hourLabel(h)}</span>
        ))}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-surface-2 p-3">
          <dt className="text-xs font-semibold text-muted">Usually starts calling</dt>
          <dd className="mt-0.5 text-lg font-extrabold text-ink tnum">{minuteToClock(firstMinute)}</dd>
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <dt className="text-xs font-semibold text-muted">Usually finishes</dt>
          <dd className="mt-0.5 text-lg font-extrabold text-ink tnum">{minuteToClock(lastMinute)}</dd>
        </div>
      </dl>
    </div>
  );
}
