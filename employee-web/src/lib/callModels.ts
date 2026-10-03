import { parseIso } from "./time";
import type { CallStatus, ServerCall } from "./types";

/** One row in a call list. */
export interface CallRowModel {
  key: string;
  serverId: number;
  contactId: number | null;
  name: string;
  phone: string;
  startedAt: number;
  durationSec: number;
  status: CallStatus;
  disposition: string | null;
  dispositionLabel: string | null;
  /** upload state of the recording, or "none" (calls made from the web are never recorded) */
  recording: "none" | "pending" | "uploading" | "available" | "failed";
  needsOutcome: boolean;
}

export function serverToRow(call: ServerCall): CallRowModel {
  return {
    key: `c${call.id}`,
    serverId: call.id,
    contactId: call.contact_id,
    name: call.contact_name ?? call.phone_number,
    phone: call.phone_number,
    startedAt: parseIso(call.started_at) ?? 0,
    durationSec: call.duration_seconds,
    status: call.status,
    disposition: call.disposition?.code ?? null,
    dispositionLabel: call.disposition?.label ?? null,
    recording: call.recording ? call.recording.upload_status : "none",
    needsOutcome: call.disposition === null && call.status !== "failed",
  };
}

/** A recording exists (or is on its way to the server). */
export const hasRecording = (row: CallRowModel) => row.recording === "available" || row.recording === "pending" || row.recording === "uploading";

/** The outcome the employee recorded counts too: a call saved as "Connected" is a connected call. */
export const isConnected = (row: CallRowModel) => row.status === "completed" || row.status === "connected" || row.disposition === "CONNECTED";
