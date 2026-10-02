import { NOT_RECORDED_HELP } from "@/lib/status";
import type { Call, CallEvent } from "@/lib/types";

export const ANSWERED_STATUSES = ["completed", "connected"] as const;
const IN_PROGRESS_STATUSES = ["initiated", "dialing", "ringing", "connected"];

export const isAnswered = (status: string) => status === "completed" || status === "connected";
export const isInProgress = (status: string) => IN_PROGRESS_STATUSES.includes(status);

/** Seconds the phone rang before the call was answered (or gave up); null while it is still ringing. */
export function ringSeconds(call: Pick<Call, "started_at" | "answered_at" | "ended_at">): number | null {
  const stop = call.answered_at ?? call.ended_at;
  if (!stop) return null;
  const seconds = Math.round((Date.parse(stop) - Date.parse(call.started_at)) / 1000);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/** Length of the whole call, from dialling to hang-up. */
export function totalSeconds(call: Pick<Call, "started_at" | "ended_at">): number | null {
  if (!call.ended_at) return null;
  const seconds = Math.round((Date.parse(call.ended_at) - Date.parse(call.started_at)) / 1000);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export type RecordingState =
  | { kind: "available"; recordingId: number }
  | { kind: "uploading" }
  | { kind: "failed"; detail: string | null }
  | { kind: "none"; reason: string; headline: string; detail: string | null };

const HEADLINES: Record<string, string> = {
  silent: "Recorded, but silent",
  no_permission: "Microphone not allowed",
  failed: "The phone could not record",
  saved: "Not uploaded yet",
  unreported: "No report from the phone",
  unanswered: "The call was not answered",
  disabled: "Recording is switched off",
  off: "Recording was off for this call",
};

/** What the phone said about recording, taken from the call's "ended" event. */
export function recordingReportFromEvents(events: CallEvent[] | undefined): { status: string | null; detail: string | null } {
  const ended = [...(events ?? [])].reverse().find((e) => e.event_type === "ended" && e.payload && typeof e.payload.recording === "string");
  if (!ended?.payload) return { status: null, detail: null };
  const detail = typeof ended.payload.recording_detail === "string" ? ended.payload.recording_detail : null;
  return { status: ended.payload.recording as string, detail };
}

/** One answer to "where is the recording of this call, and if there is none, why not". */
export function describeRecording(call: Call, recordingEnabled = true): RecordingState {
  const rec = call.recording;
  if (rec) {
    if (rec.upload_status === "available") return { kind: "available", recordingId: rec.id };
    if (rec.upload_status === "failed") return { kind: "failed", detail: rec.failure_reason };
    return { kind: "uploading" };
  }
  if (!isAnswered(call.status)) {
    return { kind: "none", reason: "unanswered", headline: HEADLINES.unanswered!, detail: "Nobody picked up, so there was nothing to record." };
  }
  if (!recordingEnabled) {
    return { kind: "none", reason: "disabled", headline: HEADLINES.disabled!, detail: "Turn it on in Settings → Recording." };
  }
  const { status, detail } = recordingReportFromEvents(call.events);
  // a recorder that was still "starting" or "recording" when the call ended never delivered a file
  const normalized = status === "starting" || status === "recording" ? "failed" : status;
  const reason = normalized && (normalized in NOT_RECORDED_HELP || normalized === "off") ? normalized : "unreported";
  const help = NOT_RECORDED_HELP[reason] ?? "The app did not try to record this call (recording was off on the phone).";
  return { kind: "none", reason, headline: HEADLINES[reason] ?? "Not recorded", detail: reason === "failed" && detail ? `${help} Phone says: ${detail}` : help };
}

/** 1536 -> "1.5 KB", 3_200_000 -> "3.1 MB". */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function audioFormat(contentType: string): string {
  const sub = contentType.split("/")[1]?.split(";")[0] ?? contentType;
  return ({ mpeg: "MP3", mp4: "M4A", "x-m4a": "M4A", aac: "AAC", ogg: "OGG", webm: "WebM", wav: "WAV", "x-wav": "WAV", "3gpp": "3GP", amr: "AMR" } as Record<string, string>)[sub] ?? sub.toUpperCase();
}
