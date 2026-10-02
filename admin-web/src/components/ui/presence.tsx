import { cn } from "@/lib/utils";
import type { Presence } from "@/lib/types";

export const PRESENCE_META: Record<Presence, { label: string; dot: string; text: string; pulse?: boolean }> = {
  on_call: { label: "On a call", dot: "bg-brand", text: "text-brand-strong", pulse: true },
  online: { label: "Online", dot: "bg-info", text: "text-info", pulse: true },
  idle: { label: "Idle", dot: "bg-warn", text: "text-warn" },
  offline: { label: "Offline", dot: "bg-faint", text: "text-muted" },
  inactive: { label: "Inactive", dot: "bg-danger", text: "text-danger" },
};

/** A coloured dot that pulses while the person is active. */
export function PresenceDot({ presence, className }: { presence: Presence; className?: string }) {
  const meta = PRESENCE_META[presence];
  return (
    <span className={cn("relative inline-flex size-2.5", className)} aria-hidden>
      {meta.pulse ? <span className={cn("absolute inset-0 animate-pulse-ring rounded-full", meta.dot)} /> : null}
      <span className={cn("relative size-2.5 rounded-full ring-2 ring-surface", meta.dot)} />
    </span>
  );
}

export function PresenceLabel({ presence, className }: { presence: Presence; className?: string }) {
  const meta = PRESENCE_META[presence];
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm font-semibold", meta.text, className)}>
      <PresenceDot presence={presence} />
      {meta.label}
    </span>
  );
}
