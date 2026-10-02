"use client";

import { Crown } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import * as React from "react";

import { Avatar } from "@/components/ui/avatar";
import type { EmployeeMetrics } from "@/lib/types";
import { cn, formatDuration, formatNumber, formatPercent } from "@/lib/utils";

const MEDAL = ["bg-accent text-[#2a2100]", "bg-[#c9d1c6] text-[#27302a]", "bg-[#e0a76a] text-[#3a2308]"];

/** Employees ranked by calls in the period. */
export function Leaderboard({ people }: { people: EmployeeMetrics[] }) {
  const ranked = people.filter((p) => p.calls > 0);
  const max = Math.max(1, ...ranked.map((p) => p.calls));
  if (ranked.length === 0) return <p className="py-12 text-center text-sm text-muted">Nobody has made a call in this period.</p>;

  return (
    <ol className="space-y-1.5" data-testid="leaderboard">
      {ranked.map((p, i) => (
        <motion.li key={p.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.05, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
          <Link href={`/employees/${p.id}`} className="group flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-surface-2">
            <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold", i < 3 ? MEDAL[i] : "bg-surface-3 text-muted")}>{i === 0 ? <Crown className="size-3.5" /> : i + 1}</span>
            <Avatar name={p.full_name} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-sm font-semibold text-ink transition-colors group-hover:text-brand">{p.full_name}</p>
                <p className="shrink-0 text-sm font-extrabold text-ink tnum">{formatNumber(p.calls)}</p>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
                <motion.div className="h-full rounded-full bg-gradient-to-r from-brand to-[#53d36b]" initial={{ width: 0 }} animate={{ width: `${(p.calls / max) * 100}%` }} transition={{ delay: 0.25 + i * 0.05, duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
              </div>
              <p className="mt-1 text-xs text-muted">
                {formatPercent(p.answer_rate)} answered · {formatDuration(p.talk_seconds, { compact: true })} talk time
              </p>
            </div>
          </Link>
        </motion.li>
      ))}
    </ol>
  );
}
