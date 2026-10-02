"use client";

import { motion } from "motion/react";
import * as React from "react";

import { cn } from "@/lib/utils";

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: React.ReactNode; count?: number }[];
  /** unique per control, so two of them on a page slide independently */
  name: string;
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}

/** A row of mutually exclusive choices with a pill that slides to the selected one. */
export function Segmented<T extends string>({ value, onChange, options, name, size = "md", className, "aria-label": ariaLabel }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex items-center gap-0.5 rounded-xl bg-surface-3 p-1", className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand",
              size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3.5 text-sm",
              active ? "text-ink" : "text-muted hover:text-ink",
            )}
          >
            {active ? <motion.span layoutId={`seg-${name}`} className="absolute inset-0 rounded-lg bg-surface shadow-card" transition={{ type: "spring", stiffness: 520, damping: 40 }} /> : null}
            <span className="relative">{option.label}</span>
            {option.count !== undefined ? <span className="relative rounded-full bg-surface-3 px-1.5 text-[11px] font-bold leading-5 text-ink-soft">{option.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
