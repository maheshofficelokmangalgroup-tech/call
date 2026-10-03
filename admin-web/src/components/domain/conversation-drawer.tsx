"use client";

import { CalendarClock, Headphones, Phone, StickyNote, UserRound } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { ResponseBadge } from "@/components/domain/conversations-table";
import { StatusBadge } from "@/components/domain/call-badges";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { DUE_TONE, followupDue } from "@/lib/followups";
import { useNow } from "@/lib/hooks";
import { useConversationTimeline } from "@/lib/queries";
import type { ConversationTimeline, NoteBrief } from "@/lib/types";
import { formatDateTime, formatDuration, formatPhone, pluralize, timeAgo } from "@/lib/utils";

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-[0.12em] text-muted">{title}</h4>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Note({ note }: { note: NoteBrief }) {
  return (
    <li className="rounded-2xl border border-line bg-accent-soft/50 p-3.5">
      <p className="whitespace-pre-wrap text-sm text-ink">{note.body}</p>
      <p className="mt-2 text-xs text-muted">
        {note.author_name ?? "Employee"} · {formatDateTime(note.created_at)}
      </p>
    </li>
  );
}

function Body({ data, onOpenCall }: { data: ConversationTimeline; onOpenCall: (id: number) => void }) {
  const now = useNow(60_000);
  const name = data.contact?.name ?? null;
  const pending = data.followups.filter((f) => f.status === "pending");
  const closed = data.followups.filter((f) => f.status !== "pending");
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line bg-surface-2 px-6 pb-5 pt-6 pr-16">
        <div className="flex flex-wrap items-center gap-2">
          {data.calls[0] ? <ResponseBadge code={data.calls.find((c) => c.response)?.response?.code} label={data.calls.find((c) => c.response)?.response?.label} /> : null}
          <Badge tone="outline">{pluralize(data.total_calls, "call")}</Badge>
          {data.contact ? <Badge tone="neutral">{data.contact.status.replace(/_/g, " ")}</Badge> : null}
        </div>
        <SheetTitle className="mt-3 truncate text-2xl">{name ?? formatPhone(data.phone)}</SheetTitle>
        <SheetDescription className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 tnum">
          <span className="inline-flex items-center gap-1.5">
            <Phone className="size-3.5" /> {formatPhone(data.phone)}
          </span>
          <Link href={`/employees/${data.employee_id}`} className="inline-flex items-center gap-1.5 font-semibold text-ink-soft hover:text-brand">
            <UserRound className="size-3.5" /> {data.employee_name} <span className="font-mono text-xs text-muted">{data.employee_code}</span>
          </Link>
        </SheetDescription>
      </header>

      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-6">
        <Section title="Follow-ups" aside={<CalendarClock className="size-4 text-faint" />}>
          {data.followups.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line-strong p-4 text-center text-sm text-muted">{data.contact ? "No follow-up was scheduled." : "A number dialled by hand has no follow-ups."}</p>
          ) : (
            <ul className="space-y-2">
              {[...pending, ...closed].map((f) => {
                const due = followupDue(f.scheduled_at, f.status, now);
                return (
                  <li key={f.id} className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-3.5">
                    <Badge tone={DUE_TONE[due.tone]} dot>
                      {due.label}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink">{f.note ?? "No note"}</p>
                      <p className="text-xs text-muted">
                        {due.detail} · scheduled {timeAgo(f.created_at)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Every call" aside={<span className="text-xs text-muted">{data.total_calls > data.calls.length ? `latest ${data.calls.length} of ${data.total_calls}` : `${data.total_calls} in total`}</span>}>
          <ol className="space-y-3" data-testid="timeline-calls">
            {data.calls.map((c) => (
              <li key={c.id} className="rounded-2xl border border-line bg-surface p-3.5" data-testid="timeline-call">
                <button type="button" onClick={() => onOpenCall(c.id)} className="flex w-full flex-wrap items-center gap-2 text-left">
                  <span className="text-sm font-bold text-ink">{formatDateTime(c.started_at)}</span>
                  <StatusBadge status={c.status} />
                  <ResponseBadge code={c.response?.code} label={c.response?.label} />
                  <span className="ml-auto text-sm font-bold text-ink tnum">{c.duration_seconds ? formatDuration(c.duration_seconds, { compact: true }) : ""}</span>
                  {c.recording_id ? (
                    <span className="inline-flex size-7 items-center justify-center rounded-full bg-brand-soft text-brand" title="Has a recording - open the call to play it">
                      <Headphones className="size-3.5" />
                    </span>
                  ) : null}
                </button>
                {c.notes.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {c.notes.map((n) => (
                      <Note key={n.id} note={n} />
                    ))}
                  </ul>
                ) : null}
                {c.callback_at ? (
                  <p className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-violet">
                    <CalendarClock className="size-3.5" /> asked to be called back {followupDue(c.callback_at, "pending", now).detail}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </Section>

        {data.other_notes.length > 0 ? (
          <Section title="Other notes about this person" aside={<StickyNote className="size-4 text-faint" />}>
            <ul className="space-y-2">
              {data.other_notes.map((n) => (
                <Note key={n.id} note={n} />
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </div>
  );
}

/** One employee and one person in a panel beside the list: every call with its outcome and notes, and the follow-ups. */
export function ConversationDrawer({ target, onClose, onOpenCall }: { target: { employeeId: number; phone: string } | null; onClose: () => void; onOpenCall: (id: number) => void }) {
  const [shown, setShown] = React.useState(target);
  if (target && (target.employeeId !== shown?.employeeId || target.phone !== shown?.phone)) setShown(target);
  const timeline = useConversationTimeline(shown?.employeeId ?? null, shown?.phone ?? null);
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent width="max-w-[580px]" aria-describedby={undefined} data-testid="conversation-drawer">
        {timeline.data ? (
          <Body data={timeline.data} onOpenCall={onOpenCall} />
        ) : timeline.isError ? (
          <>
            <SheetTitle className="sr-only">Conversation</SheetTitle>
            <ErrorState title="Could not open this conversation" message="There may be no calls any more, or you may not be allowed to see them." onRetry={() => timeline.refetch()} className="my-auto" />
          </>
        ) : (
          <>
            <SheetTitle className="sr-only">Conversation</SheetTitle>
            <div className="space-y-5 p-6">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-10 w-3/4" />
              <Skeleton className="h-48 w-full" />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
