"use client";

import { motion } from "motion/react";
import * as React from "react";

import { cn } from "@/lib/utils";

/** The frame every chart sits in: title, one line of explanation, optional controls on the right. */
export function ChartCard({
  title,
  description,
  actions,
  children,
  className,
  delay = 0,
  testId,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  delay?: number;
  testId?: string;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn("flex flex-col rounded-2xl border border-line bg-surface shadow-card", className)}
      data-testid={testId}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pb-1 pt-5">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold tracking-tight text-ink">{title}</h3>
          {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
        </div>
        {actions}
      </header>
      <div className="flex-1 p-5 pt-3">{children}</div>
    </motion.section>
  );
}
