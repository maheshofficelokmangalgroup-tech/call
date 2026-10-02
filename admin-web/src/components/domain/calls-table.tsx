"use client";

import { ChevronRight, PhoneOutgoing, PhoneOff } from "lucide-react";
import { motion } from "motion/react";
import * as React from "react";

import { OutcomeBadge, RecordingFlag, StatusBadge } from "@/components/domain/call-badges";
import { EmployeeCell } from "@/components/domain/employee-cell";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { isAnswered, isInProgress, ringSeconds } from "@/lib/call-utils";
import type { Call } from "@/lib/types";
import { cn, formatDuration, formatInZone, formatPhone, formatTime } from "@/lib/utils";

function WhenCell({ iso }: { iso: string }) {
  return (
    <div className="leading-tight">
      <p className="whitespace-nowrap font-semibold text-ink tnum">{formatTime(iso)}</p>
      <p className="whitespace-nowrap text-xs text-muted">{formatInZone(iso, { weekday: "short", day: "numeric", month: "short" })}</p>
    </div>
  );
}

function ContactCell({ call }: { call: Call }) {
  return (
    <div className="min-w-0 leading-tight">
      <p className="truncate font-semibold text-ink">{call.contact_name ?? formatPhone(call.phone_number)}</p>
      {call.contact_name ? <p className="truncate text-xs text-muted tnum">{formatPhone(call.phone_number)}</p> : <p className="text-xs text-faint">dialled by hand</p>}
    </div>
  );
}

function TalkCell({ call }: { call: Call }) {
  if (isInProgress(call.status)) return <span className="text-xs font-bold text-brand">in progress</span>;
  if (!isAnswered(call.status)) {
    const ring = ringSeconds(call);
    return <span className="whitespace-nowrap text-xs text-muted">{ring !== null ? `rang ${formatDuration(ring)}` : "-"}</span>;
  }
  return <span className="whitespace-nowrap font-bold text-ink tnum">{formatDuration(call.duration_seconds)}</span>;
}

/** A page of calls: one row each with the time, who was called, how it went, how long it lasted and whether it was recorded. */
export function CallsTable({
  calls,
  loading,
  showEmployee = true,
  onOpen,
  skeletonRows = 8,
  dimmed = false,
}: {
  calls: Call[];
  loading?: boolean;
  showEmployee?: boolean;
  onOpen: (id: number) => void;
  skeletonRows?: number;
  dimmed?: boolean;
}) {
  const columns = showEmployee ? 8 : 7;
  return (
    <>
      {/* phones */}
      <div className="grid gap-2.5 md:hidden">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)
          : calls.map((call) => (
              <button key={call.id} type="button" onClick={() => onOpen(call.id)} className="rounded-2xl border border-line bg-surface p-3.5 text-left shadow-card active:bg-surface-2" data-testid="call-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-ink">{call.contact_name ?? formatPhone(call.phone_number)}</p>
                    <p className="truncate text-xs text-muted">
                      {showEmployee ? `${call.employee_name ?? "Employee"} · ` : ""}
                      {formatTime(call.started_at)} · {formatInZone(call.started_at, { day: "numeric", month: "short" })}
                    </p>
                  </div>
                  <RecordingFlag call={call} />
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <StatusBadge status={call.status} />
                  <OutcomeBadge outcome={call.disposition} />
                  <span className="ml-auto text-sm font-bold text-ink tnum">{isAnswered(call.status) ? formatDuration(call.duration_seconds) : ""}</span>
                </div>
              </button>
            ))}
      </div>

      {/* desktop */}
      <TableWrap className={cn("hidden md:block", dimmed && "opacity-70 transition-opacity")}>
        <Table className="min-w-[860px]" data-testid="calls-table">
          <THead>
            <TR>
              <TH>When</TH>
              {showEmployee ? <TH>Employee</TH> : null}
              <TH>Called</TH>
              <TH>Result</TH>
              <TH className="text-right">Talk time</TH>
              <TH>Outcome</TH>
              <TH className="text-center">Recording</TH>
              <TH className="w-8" aria-label="Open" />
            </TR>
          </THead>
          <tbody>
            {loading
              ? Array.from({ length: skeletonRows }).map((_, i) => (
                  <TR key={i}>
                    <TD colSpan={columns}>
                      <Skeleton className="h-9 w-full" />
                    </TD>
                  </TR>
                ))
              : calls.map((call, i) => (
                  <motion.tr
                    key={call.id}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i, 14) * 0.02, duration: 0.25 }}
                    onClick={() => onOpen(call.id)}
                    onKeyDown={(e) => e.key === "Enter" && onOpen(call.id)}
                    tabIndex={0}
                    data-testid="call-row"
                    className="group cursor-pointer border-t border-line transition-colors first:border-t-0 hover:bg-surface-2 focus-visible:bg-surface-2"
                  >
                    <TD>
                      <WhenCell iso={call.started_at} />
                    </TD>
                    {showEmployee ? (
                      <TD className="max-w-[190px]">
                        <EmployeeCell id={call.employee_id} name={call.employee_name ?? `Employee ${call.employee_id}`} size="xs" />
                      </TD>
                    ) : null}
                    <TD className="max-w-[240px]">
                      <ContactCell call={call} />
                    </TD>
                    <TD>
                      <StatusBadge status={call.status} />
                    </TD>
                    <TD className="text-right">
                      <TalkCell call={call} />
                    </TD>
                    <TD>
                      <OutcomeBadge outcome={call.disposition} />
                    </TD>
                    <TD className="text-center">
                      <RecordingFlag call={call} />
                    </TD>
                    <TD className="pr-3 text-faint transition-colors group-hover:text-brand">
                      <ChevronRight className="size-4" />
                    </TD>
                  </motion.tr>
                ))}
          </tbody>
        </Table>
      </TableWrap>
    </>
  );
}

/** Used under a table when a filter leaves nothing to show. */
export function NoCalls({ filtered }: { filtered: boolean }) {
  const Icon = filtered ? PhoneOff : PhoneOutgoing;
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-surface-3 text-muted">
        <Icon className="size-6" />
      </span>
      <p className="text-base font-bold text-ink">{filtered ? "No calls match these filters" : "No calls in this period"}</p>
      <p className="mt-1 max-w-sm text-sm text-muted">{filtered ? "Try removing a filter, or pick a longer period at the top." : "Calls appear here as soon as an employee dials from the mobile app."}</p>
    </div>
  );
}

