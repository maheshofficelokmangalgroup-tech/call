import { Headphones, MicOff, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { isAnswered } from "@/lib/call-utils";
import { outcomeTone, statusMeta } from "@/lib/status";
import type { Call } from "@/lib/types";

export function StatusBadge({ status }: { status: string }) {
  const meta = statusMeta(status);
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}

export function OutcomeBadge({ outcome }: { outcome: Call["disposition"] | null | undefined }) {
  if (!outcome) return <span className="text-xs text-faint">-</span>;
  return <Badge tone={outcomeTone(outcome.code)}>{outcome.label}</Badge>;
}

/** A headphones icon when the call has a playable recording; a muted mic for an answered call that has none. */
export function RecordingFlag({ call }: { call: Pick<Call, "recording" | "status"> }) {
  const status = call.recording?.upload_status;
  if (status === "available") {
    return (
      <Tip label="Recording available">
        <span data-testid="recording-flag" data-recording="available" className="inline-flex size-7 items-center justify-center rounded-full bg-brand-soft text-brand">
          <Headphones className="size-3.5" />
        </span>
      </Tip>
    );
  }
  if (status === "pending" || status === "uploading") {
    return (
      <Tip label="Recording is being uploaded">
        <span data-testid="recording-flag" data-recording="uploading" className="inline-flex size-7 animate-pulse items-center justify-center rounded-full bg-info-soft text-info">
          <Headphones className="size-3.5" />
        </span>
      </Tip>
    );
  }
  if (status === "failed") {
    return (
      <Tip label="The recording could not be uploaded">
        <span data-testid="recording-flag" data-recording="failed" className="inline-flex size-7 items-center justify-center rounded-full bg-danger-soft text-danger">
          <TriangleAlert className="size-3.5" />
        </span>
      </Tip>
    );
  }
  if (isAnswered(call.status)) {
    return (
      <Tip label="Answered, but not recorded">
        <span data-testid="recording-flag" data-recording="missing" className="inline-flex size-7 items-center justify-center rounded-full bg-surface-3 text-faint">
          <MicOff className="size-3.5" />
        </span>
      </Tip>
    );
  }
  return <span className="inline-block size-7" aria-hidden />;
}
