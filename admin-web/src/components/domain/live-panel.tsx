"use client";

import { Headphones, PhoneCall, PhoneOutgoing, Radio } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";

import { EmployeeCell } from "@/components/domain/employee-cell";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { PRESENCE_META } from "@/components/ui/presence";
import { useNow } from "@/lib/hooks";
import { useLive } from "@/lib/queries";
import { PRESENCE_ORDER, statusMeta } from "@/lib/status";
import type { LiveCall, RecentCall } from "@/lib/types";
import { cn, formatClock, formatDuration, formatPhone, formatTime, timeAgo } from "@/lib/utils";

function OnCallRow({ call, now, onOpen }: { call: LiveCall; now: number; onOpen: (id: number) => void }) {
  const talking = call.status === "connected" && call.answered_at;
  const since = Date.parse(talking ? call.answered_at! : call.started_at);
  const seconds = Number.isFinite(since) ? Math.max(0, (now - since) / 1000) : 0;
  return (
    <motion.li layout initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 14, transition: { duration: 0.2 } }} transition={{ type: "spring", stiffness: 420, damping: 34 }}>
      <button
        type="button"
        onClick={() => onOpen(call.call_id)}
        className="group flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-left transition-colors hover:border-brand/40 hover:bg-brand-soft/40"
        data-testid="live-call"
      >
        <EmployeeCell id={call.employee_id} name={call.employee_name} subtitle={call.team_name ?? call.employee_code} presence="on_call" linked={false} className="w-48 shrink-0" />
        <div className="hidden min-w-0 flex-1 sm:block">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
            <PhoneOutgoing className="size-3.5" /> calling
          </p>
          <p className="truncate text-sm font-bold text-ink">{call.contact_name ?? formatPhone(call.phone_number)}</p>
          {call.contact_name ? <p className="truncate text-xs text-muted">{formatPhone(call.phone_number)}</p> : null}
        </div>
        <div className="ml-auto text-right">
          <p className={cn("text-lg font-extrabold leading-none tnum", talking ? "text-brand" : "text-warn")}>{formatClock(seconds)}</p>
          <p className={cn("mt-1 text-[11px] font-bold uppercase tracking-wide", talking ? "text-brand" : "text-warn")}>{talking ? "Talking" : statusMeta(call.status).label}</p>
        </div>
      </button>
    </motion.li>
  );
}

/** Who is on a call right now, with running timers. It refreshes every few seconds by itself. */
export function LivePanel({ onOpenCall }: { onOpenCall: (id: number) => void }) {
  const live = useLive();
  const now = useNow(1000);
  const data = live.data;

  return (
    <section className="flex flex-col rounded-2xl border border-line bg-surface shadow-card" data-testid="live-panel">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-5">
        <div className="flex items-center gap-3">
          <span className="relative flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <Radio className="size-5" />
            {data && data.on_call.length > 0 ? <span className="absolute -right-0.5 -top-0.5 size-3 animate-pulse rounded-full bg-danger ring-2 ring-surface" /> : null}
          </span>
          <div>
            <h3 className="text-[15px] font-bold tracking-tight text-ink">Live now</h3>
            <p className="text-[13px] text-muted">{data ? (data.on_call.length === 0 ? "Nobody is on a call at the moment" : `${data.on_call.length} on a call right now`) : "Checking..."}</p>
          </div>
        </div>
        {data ? (
          <ul className="flex flex-wrap items-center gap-1.5" aria-label="Employees by activity">
            {PRESENCE_ORDER.map((key) => (
              <li key={key} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink-soft" title={PRESENCE_META[key].label}>
                <span className={cn("size-2 rounded-full", PRESENCE_META[key].dot)} />
                {data.presence[key]}
                <span className="hidden text-muted md:inline">{PRESENCE_META[key].label}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <div className="flex-1 px-5 pb-5">
        {live.isPending ? (
          <div className="space-y-2.5">
            <Skeleton className="h-[68px]" />
            <Skeleton className="h-[68px]" />
          </div>
        ) : live.isError ? (
          <ErrorState title="Live view unavailable" message="It will try again in a few seconds." onRetry={() => live.refetch()} className="py-6" />
        ) : data && data.on_call.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-surface-2 px-4 py-9 text-center">
            <PhoneCall className="mb-2.5 size-8 text-faint" strokeWidth={1.5} />
            <p className="text-sm font-semibold text-ink-soft">All quiet</p>
            <p className="mt-0.5 text-xs text-muted">Calls appear here the moment an employee dials.</p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            <AnimatePresence initial={false} mode="popLayout">
              {data?.on_call.map((call) => <OnCallRow key={call.call_id} call={call} now={now} onOpen={onOpenCall} />)}
            </AnimatePresence>
          </ul>
        )}
      </div>

      {data?.today ? (
        <footer className="grid grid-cols-3 divide-x divide-line border-t border-line bg-surface-2 text-center">
          {[
            { label: "Calls today", value: data.today.calls.toLocaleString("en-IN") },
            { label: "Answered", value: data.today.connected.toLocaleString("en-IN") },
            { label: "Talk time today", value: formatDuration(data.today.talk_seconds, { compact: true }) },
          ].map((item) => (
            <div key={item.label} className="px-2 py-3">
              <p className="text-base font-extrabold text-ink tnum">{item.value}</p>
              <p className="text-[11px] font-semibold text-muted">{item.label}</p>
            </div>
          ))}
        </footer>
      ) : null}
    </section>
  );
}

function RecentRow({ call, onOpen }: { call: RecentCall; onOpen: (id: number) => void }) {
  const status = statusMeta(call.status);
  return (
    <li>
      <button type="button" onClick={() => onOpen(call.call_id)} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-surface-2" data-testid="recent-call">
        <Avatar name={call.employee_name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-ink-soft">
            <span className="font-bold text-ink">{call.employee_name}</span> <span className="text-muted">called</span> {call.contact_name ?? formatPhone(call.phone_number)}
          </p>
          <p className="truncate text-xs text-muted" title={formatTime(call.started_at)}>
            {status.label}
            {call.outcome ? ` · ${call.outcome}` : ""} · {timeAgo(call.started_at)}
          </p>
        </div>
        <p className="shrink-0 text-sm font-bold text-ink tnum">{call.duration_seconds > 0 ? formatDuration(call.duration_seconds, { compact: true }) : "-"}</p>
        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", call.has_recording ? "bg-brand-soft text-brand" : "text-transparent")} aria-hidden={!call.has_recording} title={call.has_recording ? "Has a recording" : undefined}>
          {call.has_recording ? <Headphones className="size-3.5" /> : null}
        </span>
      </button>
    </li>
  );
}

/** The latest finished calls across the team. */
export function RecentCalls({ onOpenCall }: { onOpenCall: (id: number) => void }) {
  const live = useLive();
  const items = live.data?.recent ?? [];
  return (
    <section className="rounded-2xl border border-line bg-surface shadow-card" data-testid="recent-calls">
      <header className="px-5 pb-2 pt-5">
        <h3 className="text-[15px] font-bold tracking-tight text-ink">Latest calls</h3>
        <p className="text-[13px] text-muted">The most recent calls of your team. Open one to see the recording.</p>
      </header>
      <div className="p-2.5">
        {live.isPending ? (
          <div className="space-y-2 p-2.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">No calls have been made yet.</p>
        ) : (
          <ul>
            {items.map((call) => (
              <RecentRow key={call.call_id} call={call} onOpen={onOpenCall} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
