"use client";

import { Loader2, Play, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";

import { AudioPlayer } from "@/components/domain/audio-player";
import { EmployeeCell } from "@/components/domain/employee-cell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { audioFormat, formatBytes } from "@/lib/call-utils";
import type { Call } from "@/lib/types";
import { cn, formatDuration, formatInZone, formatPhone, formatTime } from "@/lib/utils";

/** One recorded call: a play button, who called whom and when, and a player that unfolds underneath. */
export function RecordingRow({ call, expanded, onToggle, onOpen, canDownload, showEmployee = true }: { call: Call; expanded: boolean; onToggle: () => void; onOpen: () => void; canDownload: boolean; showEmployee?: boolean }) {
  const rec = call.recording!;
  const ready = rec.upload_status === "available";
  return (
    <li className={cn("overflow-hidden rounded-2xl border bg-surface shadow-card transition-colors", expanded ? "border-brand/50" : "border-line")} data-testid="recording-row">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-3.5 sm:flex-nowrap">
        <button
          type="button"
          onClick={onToggle}
          disabled={!ready}
          aria-expanded={expanded}
          aria-label={ready ? `Listen to the call with ${call.contact_name ?? call.phone_number}` : "Recording is not ready"}
          data-testid="recording-play"
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full transition-all",
            ready ? "bg-brand text-white shadow-[0_6px_14px_-6px_var(--brand)] hover:scale-105 active:scale-95 dark:text-[#04130a]" : "bg-surface-3 text-faint",
          )}
        >
          {rec.upload_status === "uploading" || rec.upload_status === "pending" ? <Loader2 className="size-5 animate-spin" /> : rec.upload_status === "failed" ? <TriangleAlert className="size-5" /> : <Play className="ml-0.5 size-5 fill-current" />}
        </button>

        <div className="grid min-w-0 flex-1 gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_200px]">
          {showEmployee ? <EmployeeCell id={call.employee_id} name={call.employee_name ?? `Employee ${call.employee_id}`} size="sm" /> : <span className="hidden sm:block" />}
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold text-ink">{call.contact_name ?? formatPhone(call.phone_number)}</p>
            <p className="truncate text-xs text-muted">
              {formatInZone(call.started_at, { weekday: "short", day: "numeric", month: "short" })} · {formatTime(call.started_at)}
              {call.contact_name ? ` · ${formatPhone(call.phone_number)}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 sm:justify-end">
            <Badge tone="neutral" className="tnum">
              {formatDuration(rec.duration_seconds ?? call.duration_seconds)}
            </Badge>
            {ready ? (
              <span className="hidden text-xs text-muted lg:inline">
                {audioFormat(rec.content_type)} · {formatBytes(rec.size_bytes)}
              </span>
            ) : (
              <Badge tone={rec.upload_status === "failed" ? "danger" : "info"}>{rec.upload_status === "failed" ? "Upload failed" : "Uploading"}</Badge>
            )}
          </div>
        </div>

        <Button variant="ghost" size="sm" onClick={onOpen} className="shrink-0">
          Details
        </Button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && ready ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
            <div className="border-t border-line bg-surface-2 p-3.5">
              <AudioPlayer recordingId={rec.id} durationHint={rec.duration_seconds ?? call.duration_seconds} canDownload={canDownload} className="bg-surface" />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </li>
  );
}
