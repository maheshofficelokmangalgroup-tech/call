"use client";

import { CalendarClock, ChevronRight, Headphones, MessageSquareOff, StickyNote } from "lucide-react";
import * as React from "react";

import { EmployeeCell } from "@/components/domain/employee-cell";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { Tip } from "@/components/ui/tooltip";
import { useNow } from "@/lib/hooks";
import { DUE_TONE, callsSummary, followupDue, groupOf } from "@/lib/followups";
import { outcomeTone } from "@/lib/status";
import type { Conversation } from "@/lib/types";
import { cn, formatDuration, formatInZone, formatPhone, formatTime, timeAgo } from "@/lib/utils";

/** The identity of a conversation in the address: one employee and one phone number. */
export const talkKey = (employeeId: number, phone: string) => `${employeeId}~${phone}`;

export function parseTalkKey(raw: string | null): { employeeId: number; phone: string } | null {
  const m = raw ? /^(\d{1,12})~(\+?\d{3,31})$/.exec(raw) : null;
  return m ? { employeeId: Number(m[1]), phone: m[2]! } : null;
}

/** The latest response of a person, as a badge ("No outcome yet" when the employee has not chosen one). */
export function ResponseBadge({ code, label }: { code: string | null | undefined; label?: string | null }) {
  if (!code) return <Badge tone="outline">No outcome yet</Badge>;
  return <Badge tone={outcomeTone(code)}>{label ?? groupOf(code).label}</Badge>;
}

function FollowupCell({ row, now }: { row: Conversation; now: number }) {
  if (!row.followup) return <span className="text-faint">-</span>;
  const due = followupDue(row.followup.scheduled_at, row.followup.status, now);
  return (
    <Tip label={row.followup.note ? `${due.detail} - "${row.followup.note}"` : due.detail}>
      <span className="inline-flex items-center gap-1.5">
        <Badge tone={DUE_TONE[due.tone]} dot>
          {due.label}
        </Badge>
        {row.followups_pending > 1 ? <span className="text-xs font-semibold text-muted">+{row.followups_pending - 1}</span> : null}
      </span>
    </Tip>
  );
}

function PersonCell({ row }: { row: Conversation }) {
  return (
    <div className="min-w-0 leading-tight">
      <p className="truncate font-semibold text-ink">{row.contact_name ?? formatPhone(row.phone)}</p>
      {row.contact_name ? <p className="truncate text-xs text-muted tnum">{formatPhone(row.phone)}</p> : <p className="text-xs text-faint">dialled by hand</p>}
    </div>
  );
}

function History({ row }: { row: Conversation }) {
  return (
    <div className="flex items-center gap-1" aria-label="Latest calls">
      {row.history.map((c, i) => (
        <Tip key={i} label={`${formatInZone(c.at, { day: "numeric", month: "short" })}, ${formatTime(c.at)} - ${c.label ?? "no outcome chosen"}`}>
          <span className="size-2.5 rounded-full" style={{ background: groupOf(c.code).color }} />
        </Tip>
      ))}
    </div>
  );
}

/** One row per employee and person: what they said last, what the employee wrote, and when the next call is due. */
export function ConversationsTable({
  rows,
  loading,
  showEmployee = true,
  onOpen,
  dimmed = false,
  skeletonRows = 8,
}: {
  rows: Conversation[];
  loading?: boolean;
  showEmployee?: boolean;
  onOpen: (row: Conversation) => void;
  dimmed?: boolean;
  skeletonRows?: number;
}) {
  const now = useNow(60_000);
  const columns = showEmployee ? 7 : 6;
  return (
    <>
      {/* phones */}
      <div className="grid gap-2.5 md:hidden">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
          : rows.map((row) => (
              <button key={`${row.employee_id}-${row.phone}`} type="button" onClick={() => onOpen(row)} className="rounded-2xl border border-line bg-surface p-3.5 text-left shadow-card active:bg-surface-2" data-testid="conversation-card">
                <div className="flex items-start justify-between gap-3">
                  <PersonCell row={row} />
                  <ResponseBadge code={row.response?.code} label={row.response?.label} />
                </div>
                <p className="mt-1.5 text-xs text-muted">
                  {showEmployee ? `${row.employee_name} · ` : ""}
                  {callsSummary(row.calls, row.answered)} · {timeAgo(row.last_call_at)}
                </p>
                {row.last_note ? <p className="mt-2 line-clamp-2 text-sm text-ink-soft">{row.last_note.body}</p> : null}
                {row.followup ? (
                  <div className="mt-2">
                    <FollowupCell row={row} now={now} />
                  </div>
                ) : null}
              </button>
            ))}
      </div>

      {/* desktop */}
      <TableWrap className={cn("hidden md:block", dimmed && "opacity-70 transition-opacity")}>
        <Table className="min-w-[980px]" data-testid="conversations-table">
          <THead>
            <TR>
              {showEmployee ? <TH>Employee</TH> : null}
              <TH>Person called</TH>
              <TH>Calls</TH>
              <TH>Response</TH>
              <TH>What the employee wrote</TH>
              <TH>Next follow-up</TH>
              <TH className="w-8" aria-label="Open" />
            </TR>
          </THead>
          <tbody>
            {loading
              ? Array.from({ length: skeletonRows }).map((_, i) => (
                  <TR key={i}>
                    <TD colSpan={columns}>
                      <Skeleton className="h-10 w-full" />
                    </TD>
                  </TR>
                ))
              : rows.map((row) => (
                  <tr
                    key={`${row.employee_id}-${row.phone}`}
                    onClick={() => onOpen(row)}
                    onKeyDown={(e) => e.key === "Enter" && onOpen(row)}
                    tabIndex={0}
                    data-testid="conversation-row"
                    className="group cursor-pointer border-t border-line transition-colors first:border-t-0 hover:bg-surface-2 focus-visible:bg-surface-2"
                  >
                    {showEmployee ? (
                      <TD className="max-w-[190px]">
                        <EmployeeCell id={row.employee_id} name={row.employee_name} subtitle={row.team_name ?? undefined} size="xs" linked={false} />
                      </TD>
                    ) : null}
                    <TD className="max-w-[230px]">
                      <PersonCell row={row} />
                    </TD>
                    <TD>
                      <div className="leading-tight">
                        <p className="whitespace-nowrap text-sm font-semibold text-ink">{callsSummary(row.calls, row.answered)}</p>
                        <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                          <History row={row} />
                          <span className="whitespace-nowrap">{timeAgo(row.last_call_at)}</span>
                          {row.talk_seconds > 0 ? <span className="whitespace-nowrap tnum">· {formatDuration(row.talk_seconds, { compact: true })}</span> : null}
                          {row.has_recording ? (
                            <Tip label="The latest call has a recording">
                              <Headphones className="size-3.5 text-brand" />
                            </Tip>
                          ) : null}
                        </div>
                      </div>
                    </TD>
                    <TD>
                      <div className="space-y-1">
                        <ResponseBadge code={row.response?.code} label={row.response?.label} />
                        {row.response && !row.last_call_has_outcome ? <p className="text-[11px] text-muted">newest call: no outcome yet</p> : null}
                      </div>
                    </TD>
                    <TD className="max-w-[280px]">
                      {row.last_note ? (
                        <div className="flex items-start gap-1.5">
                          <StickyNote className="mt-0.5 size-3.5 shrink-0 text-faint" />
                          <p className="line-clamp-2 text-sm text-ink-soft" title={row.last_note.body}>
                            {row.last_note.body}
                            {row.notes > 1 ? <span className="ml-1 text-xs font-semibold text-muted">+{row.notes - 1} more</span> : null}
                          </p>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-faint">
                          <MessageSquareOff className="size-3.5" /> no note
                        </span>
                      )}
                    </TD>
                    <TD>
                      <FollowupCell row={row} now={now} />
                    </TD>
                    <TD className="pr-3 text-faint transition-colors group-hover:text-brand">
                      <ChevronRight className="size-4" />
                    </TD>
                  </tr>
                ))}
          </tbody>
        </Table>
      </TableWrap>
    </>
  );
}

export function NoConversations({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-surface-3 text-muted">
        <CalendarClock className="size-6" />
      </span>
      <p className="text-base font-bold text-ink">{filtered ? "Nobody matches these filters" : "Nobody was called in this period"}</p>
      <p className="mt-1 max-w-sm text-sm text-muted">{filtered ? "Try removing a filter, or pick a longer period at the top." : "People appear here as soon as an employee calls them from the mobile app."}</p>
    </div>
  );
}
