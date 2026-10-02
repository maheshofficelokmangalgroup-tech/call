"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { motion } from "motion/react";
import type { LucideIcon } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** What a list shows when there is nothing in it - with a pointer to what to do next. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}
    >
      <div className="relative mb-5">
        <div className="absolute inset-0 -z-10 scale-150 rounded-full bg-brand-soft blur-xl" />
        <div className="flex size-16 items-center justify-center rounded-2xl border border-line bg-surface text-brand shadow-pop">
          <Icon className="size-7" strokeWidth={1.75} />
        </div>
      </div>
      <h3 className="text-base font-bold text-ink">{title}</h3>
      {description ? <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </motion.div>
  );
}

export function ErrorState({ title = "Could not load this", message, onRetry, className }: { title?: string; message?: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-danger-soft text-danger">
        <AlertTriangle className="size-6" />
      </div>
      <h3 className="text-base font-bold text-ink">{title}</h3>
      {message ? <p className="mt-1.5 max-w-sm text-sm text-muted">{message}</p> : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw className="size-4" /> Try again
        </Button>
      ) : null}
    </div>
  );
}
