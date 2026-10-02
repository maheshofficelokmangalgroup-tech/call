"use client";

import { AlertTriangle, CheckCircle2, Clock3, Hash, Loader2, MicOff, PhoneCall, PhoneIncoming, PhoneOff, PhoneOutgoing, RefreshCw, StickyNote, Timer, TriangleAlert, Trash2, type LucideIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { AudioPlayer } from "@/components/domain/audio-player";
import { OutcomeBadge, StatusBadge } from "@/components/domain/call-badges";
import { EmployeeCell } from "@/components/domain/employee-cell";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { audioFormat, describeRecording, formatBytes, isInProgress, ringSeconds, totalSeconds } from "@/lib/call-utils";
import { errorMessage } from "@/lib/api";
import { useCall, useDeleteRecording, useMe } from "@/lib/queries";
import type { Call, CallEvent } from "@/lib/types";
import { cn, formatDate, formatDateTime, formatDuration, formatPhone, formatTime, formatTimeSeconds, timeAgo } from "@/lib/utils";

const EVENT_META: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  initiated: { label: "Call started", icon: PhoneOutgoing, tone: "bg-info-soft text-info" },
  dialing: { label: "Dialing", icon: PhoneOutgoing, tone: "bg-info-soft text-info" },
  ringing: { label: "Ringing", icon: PhoneIncoming, tone: "bg-warn-soft text-warn" },
  connected: { label: "Answered", icon: PhoneCall, tone: "bg-brand-soft text-brand" },
  ended: { label: "Call ended", icon: PhoneOff, tone: "bg-surface-3 text-ink-soft" },
  failed: { label: "Call failed", icon: AlertTriangle, tone: "bg-danger-soft text-danger" },
  disposition: { label: "Outcome saved", icon: CheckCircle2, tone: "bg-teal-soft text-teal" },
  reconciled: { label: "Matched with the phone's call log", icon: RefreshCw, tone: "bg-violet-soft text-violet" },
  app_resumed: { label: "App was reopened", icon: RefreshCw, tone: "bg-surface-3 text-ink-soft" },
  note: { label: "Note added", icon: StickyNote, tone: "bg-accent-soft text-[#8a6a00] dark:text-accent" },
};

function Tile({ label, value, hint, icon: Icon, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon: LucideIcon; tone?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3.5">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted">
        <span className={cn("flex size-6 items-center justify-center rounded-lg", tone ?? "bg-surface-3 text-ink-soft")}>
          <Icon className="size-3.5" />
        </span>
        {label}
      </div>
      <p className="mt-2 text-lg font-extrabold leading-tight text-ink tnum">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
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

function Timeline({ call, events }: { call: Call; events: CallEvent[] }) {
  const start = Date.parse(call.started_at);
  return (
    <ol className="relative">
      {events.map((event, index) => {
        const meta = EVENT_META[event.event_type] ?? { label: event.event_type, icon: Clock3, tone: "bg-surface-3 text-ink-soft" };
        const Icon = meta.icon;
        const offset = Math.max(0, Math.round((Date.parse(event.occurred_at) - start) / 1000));
        const code = event.event_type === "disposition" && typeof event.payload?.code === "string" ? event.payload.code : null;
        return (
          <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
            {index < events.length - 1 ? <span className="absolute left-[15px] top-8 h-[calc(100%-2rem)] w-px bg-line" aria-hidden /> : null}
            <span className={cn("relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full", meta.tone)}>
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm font-semibold text-ink">
                {meta.label}
                {code ? <span className="ml-2 font-mono text-xs font-medium text-muted">{code}</span> : null}
              </p>
              <p className="text-xs text-muted tnum">
                {formatTimeSeconds(event.occurred_at)} · {offset === 0 ? "at the start" : `+${formatDuration(offset)}`}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function RecordingSection({ call, canManage, recordingEnabled, onDeleted }: { call: Call; canManage: boolean; recordingEnabled: boolean; onDeleted: () => void }) {
  const state = describeRecording(call, recordingEnabled);
  const del = useDeleteRecording();
  const [confirm, setConfirm] = React.useState(false);
  const rec = call.recording;

  return (
    <Section
      title="Recording"
      aside={
        state.kind === "available" && canManage ? (
          <Button variant="ghost" size="xs" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setConfirm(true)}>
            <Trash2 className="size-3.5" /> Delete
          </Button>
        ) : undefined
      }
    >
      {state.kind === "available" ? (
        <div className="space-y-2.5">
          <AudioPlayer recordingId={state.recordingId} durationHint={rec?.duration_seconds ?? call.duration_seconds} canDownload={canManage} />
          {rec ? (
            <p className="px-1 text-xs text-muted">
              {audioFormat(rec.content_type)} · {formatBytes(rec.size_bytes)} · uploaded {timeAgo(rec.uploaded_at ?? rec.created_at)}
            </p>
          ) : null}
        </div>
      ) : state.kind === "uploading" ? (
        <div className="flex items-start gap-3 rounded-2xl border border-info/30 bg-info-soft p-4 text-sm text-info">
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
          <p>
            <span className="font-bold">Still uploading.</span> The phone has made a recording and is sending it. It will appear here as soon as it arrives.
          </p>
        </div>
      ) : state.kind === "failed" ? (
        <div className="flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <p>
            <span className="font-bold">The upload failed.</span> {state.detail ?? "The phone could not send the recording."}
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface-2 p-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-muted">
            <MicOff className="size-4" />
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-bold text-ink">{state.headline}</p>
            {state.detail ? <p className="mt-0.5 text-muted">{state.detail}</p> : null}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        danger
        title="Delete this recording?"
        description="The audio file is removed from the server for good. The call itself and its notes stay."
        confirmLabel="Delete recording"
        onConfirm={async () => {
          try {
            await del.mutateAsync(rec!.id);
            toast.success("Recording deleted");
            onDeleted();
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
        }}
      />
    </Section>
  );
}

function CallDetails({ call, canManage, recordingEnabled, onClose }: { call: Call; canManage: boolean; recordingEnabled: boolean; onClose: () => void }) {
  const ring = ringSeconds(call);
  const total = totalSeconds(call);
  const live = isInProgress(call.status);
  const events = [...call.events].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || a.id - b.id);

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line bg-surface-2 px-6 pb-5 pt-6 pr-16">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={call.status} />
          <OutcomeBadge outcome={call.disposition} />
          {live ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-brand">
              <span className="relative flex size-2">
                <span className="absolute inset-0 animate-pulse-ring rounded-full bg-brand" />
                <span className="relative size-2 rounded-full bg-brand" />
              </span>
              Live
            </span>
          ) : null}
        </div>
        <SheetTitle className="mt-3 truncate text-2xl">{call.contact_name ?? formatPhone(call.phone_number)}</SheetTitle>
        <SheetDescription className="mt-1">
          {call.contact_name ? `${formatPhone(call.phone_number)} · ` : "Number dialled by hand · "}
          {formatDate(call.started_at)}
        </SheetDescription>
      </header>

      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-6">
        <Section title="Called by">
          <div className="rounded-2xl border border-line bg-surface p-3.5">
            <EmployeeCell id={call.employee_id} name={call.employee_name ?? `Employee ${call.employee_id}`} subtitle="Open their profile" size="md" />
          </div>
        </Section>

        <Section title="Timing">
          <div className="grid grid-cols-2 gap-3">
            <Tile label="Started" value={formatTime(call.started_at)} hint={formatDateTime(call.started_at)} icon={Clock3} tone="bg-info-soft text-info" />
            <Tile
              label="Talk time"
              value={call.duration_seconds > 0 ? formatDuration(call.duration_seconds) : live ? "In progress" : "0s"}
              hint={call.answered_at ? `answered at ${formatTime(call.answered_at)}` : "never answered"}
              icon={PhoneCall}
              tone="bg-brand-soft text-brand"
            />
            <Tile label="Rang for" value={ring === null ? "-" : formatDuration(ring)} hint={call.answered_at ? "before it was picked up" : "before it ended"} icon={Timer} tone="bg-warn-soft text-warn" />
            <Tile label="Ended" value={call.ended_at ? formatTime(call.ended_at) : "-"} hint={total !== null ? `${formatDuration(total)} in total` : live ? "still going on" : undefined} icon={PhoneOff} tone="bg-surface-3 text-ink-soft" />
          </div>
          {call.attempt_number > 1 ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted">
              <Hash className="size-3.5" /> This was attempt number {call.attempt_number} for this contact.
            </p>
          ) : null}
        </Section>

        <RecordingSection call={call} canManage={canManage} recordingEnabled={recordingEnabled} onDeleted={onClose} />

        {call.notes.length > 0 ? (
          <Section title={`Notes (${call.notes.length})`}>
            <ul className="space-y-2.5">
              {call.notes.map((note) => (
                <li key={note.id} className="rounded-2xl border border-line bg-accent-soft/50 p-3.5">
                  <p className="whitespace-pre-wrap text-sm text-ink">{note.body}</p>
                  <p className="mt-2 text-xs text-muted">
                    {note.author_name ?? "Employee"} · {formatDateTime(note.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {events.length > 0 ? (
          <Section title="What happened">
            <Timeline call={call} events={events} />
          </Section>
        ) : null}
      </div>
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <div className="space-y-6 p-6" aria-busy>
      <Skeleton className="h-6 w-28 rounded-full" />
      <Skeleton className="h-9 w-3/4" />
      <Skeleton className="h-20 w-full" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-36 w-full" />
    </div>
  );
}

/** Everything about one call in a panel that slides over the list: who, when, how long, notes, the recording and what happened. */
export function CallDrawer({ callId, onClose }: { callId: number | null; onClose: () => void }) {
  // keep showing the last call while the panel slides away, instead of flashing a skeleton
  const [shown, setShown] = React.useState<number | null>(callId);
  if (callId !== null && callId !== shown) setShown(callId);

  const call = useCall(shown);
  const me = useMe();
  const canManage = me.data?.employee.role === "admin";
  const recordingEnabled = me.data?.config.recording.enabled ?? true;

  return (
    <Sheet open={callId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent width="max-w-[560px]" aria-describedby={undefined} data-testid="call-drawer">
        {call.data ? (
          <CallDetails key={call.data.id} call={call.data} canManage={canManage} recordingEnabled={recordingEnabled} onClose={onClose} />
        ) : call.isError ? (
          <>
            <SheetTitle className="sr-only">Call details</SheetTitle>
            <ErrorState title="Could not open this call" message="It may have been removed, or you may not be allowed to see it." onRetry={() => call.refetch()} className="my-auto" />
          </>
        ) : (
          <>
            <SheetTitle className="sr-only">Call details</SheetTitle>
            <DrawerSkeleton />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
