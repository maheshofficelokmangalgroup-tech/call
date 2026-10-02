"use client";

import { motion } from "motion/react";

import { cn } from "@/lib/utils";

/** A slim bar that fills from the left when it appears. `value` is a percentage (it is clamped to 0-100). */
export function ProgressBar({
  value,
  tone = "brand",
  className,
  label,
}: {
  value: number;
  tone?: "brand" | "accent" | "info" | "danger" | "violet" | "warn";
  className?: string;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const color = { brand: "bg-brand", accent: "bg-accent", info: "bg-info", danger: "bg-danger", violet: "bg-violet", warn: "bg-warn" }[tone];
  return (
    <div role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label} className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-3", className)}>
      <motion.div className={cn("h-full rounded-full", color)} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
    </div>
  );
}
