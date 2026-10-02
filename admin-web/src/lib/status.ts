import type { BadgeTone } from "@/components/ui/badge";

/** Colour and wording used for call statuses and outcomes everywhere in the panel. */
export const STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  completed: { label: "Answered", tone: "brand" },
  connected: { label: "On the call", tone: "brand" },
  no_answer: { label: "Not answered", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
  initiated: { label: "Starting", tone: "info" },
  dialing: { label: "Dialing", tone: "info" },
  ringing: { label: "Ringing", tone: "info" },
};

export const statusMeta = (status: string) => STATUS_META[status] ?? { label: status, tone: "neutral" as BadgeTone };

export const OUTCOME_TONE: Record<string, BadgeTone> = {
  CONNECTED: "brand",
  COMPLETED: "brand",
  INTERESTED: "teal",
  CALLBACK: "info",
  FOLLOW_UP: "violet",
  NOT_INTERESTED: "warn",
  NO_ANSWER: "neutral",
  BUSY: "warn",
  SWITCHED_OFF: "neutral",
  INVALID_NUMBER: "danger",
  DO_NOT_CONTACT: "danger",
};

export const outcomeTone = (code: string | null | undefined): BadgeTone => (code ? (OUTCOME_TONE[code] ?? "neutral") : "outline");

/** Stable chart colours per outcome, in the order the legend uses them. */
export const OUTCOME_COLOR: Record<string, string> = {
  CONNECTED: "#0c831f",
  COMPLETED: "#3fae52",
  INTERESTED: "#0d9488",
  CALLBACK: "#2563eb",
  FOLLOW_UP: "#7c3aed",
  NOT_INTERESTED: "#d97a00",
  NO_ANSWER: "#94a299",
  BUSY: "#f8cb46",
  SWITCHED_OFF: "#647268",
  INVALID_NUMBER: "#dc2f3d",
  DO_NOT_CONTACT: "#db2777",
};
export const NO_OUTCOME_COLOR = "#cdd5c6";

export const PRESENCE_ORDER = ["on_call", "online", "idle", "offline", "inactive"] as const;

/** Why a call has no recording, in words an administrator can act on (the codes come from the phones). */
export const NOT_RECORDED_HELP: Record<string, string> = {
  silent: "Android gives most apps nothing but silence while a call is on, so the phone discarded the empty recording.",
  no_permission: "The employee has not allowed the microphone for the app (Profile → Phone setup).",
  failed: "The phone refused to start or finish the recorder.",
  saved: "The phone made a recording but it has not been uploaded yet (the phone may be offline).",
  unreported: "The phone did not report anything - an older app version, or the call was made with the phone's own dialer.",
};

export const CONTACT_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  new: { label: "New", tone: "info" },
  in_progress: { label: "In progress", tone: "violet" },
  callback: { label: "Callback", tone: "warn" },
  follow_up: { label: "Follow-up", tone: "violet" },
  interested: { label: "Interested", tone: "teal" },
  not_interested: { label: "Not interested", tone: "neutral" },
  completed: { label: "Completed", tone: "brand" },
  invalid: { label: "Invalid number", tone: "danger" },
  unreachable: { label: "Unreachable", tone: "neutral" },
  do_not_contact: { label: "Do not contact", tone: "danger" },
};

export const contactStatus = (status: string) => CONTACT_STATUS[status] ?? { label: status, tone: "neutral" as BadgeTone };

export const PRIORITY_LABEL: Record<number, string> = { 1: "High", 2: "Normal", 3: "Low" };

export const CAMPAIGN_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  active: { label: "Running", tone: "brand" },
  paused: { label: "Paused", tone: "warn" },
  completed: { label: "Finished", tone: "info" },
  archived: { label: "Archived", tone: "outline" },
};
