import type { IconName } from "@/components/Icon";
import { AMBER_TEXT, GREY_SOFT, colors } from "./theme";
import type { CallStatus, DispositionCode } from "./types";

export interface Look {
  label: string;
  color: string;
  bg: string;
}

export const CONTACT_STATUS: Record<string, Look> = {
  new: { label: "New", color: colors.greenDark, bg: colors.greenSoft },
  in_progress: { label: "In progress", color: colors.blue, bg: colors.blueSoft },
  callback: { label: "Callback", color: AMBER_TEXT, bg: colors.orangeSoft },
  follow_up: { label: "Follow-up", color: colors.purple, bg: colors.purpleSoft },
  interested: { label: "Interested", color: colors.greenDark, bg: colors.greenSoft },
  not_interested: { label: "Not interested", color: colors.muted, bg: GREY_SOFT },
  completed: { label: "Completed", color: colors.greenDark, bg: colors.greenSoft },
  invalid: { label: "Invalid number", color: colors.red, bg: colors.redSoft },
  unreachable: { label: "Unreachable", color: colors.muted, bg: GREY_SOFT },
  do_not_contact: { label: "Do not contact", color: colors.red, bg: colors.redSoft },
};

export function contactStatusLook(status: string): Look {
  return CONTACT_STATUS[status] ?? { label: status, color: colors.muted, bg: GREY_SOFT };
}

export interface DispositionLook {
  icon: IconName;
  tone: string;
  soft: string;
  hint: string;
}

export const DISPOSITION_LOOK: Record<DispositionCode, DispositionLook> = {
  CONNECTED: { icon: "phone-call", tone: colors.green, soft: colors.greenSoft, hint: "Spoke to the person" },
  NO_ANSWER: { icon: "phone-missed", tone: colors.red, soft: colors.redSoft, hint: "Rang, nobody picked up" },
  BUSY: { icon: "phone-off", tone: colors.orange, soft: colors.orangeSoft, hint: "Call again later" },
  SWITCHED_OFF: { icon: "smartphone", tone: colors.muted, soft: GREY_SOFT, hint: "Phone switched off / unreachable" },
  INVALID_NUMBER: { icon: "x", tone: colors.red, soft: colors.redSoft, hint: "Wrong or non-existent number" },
  INTERESTED: { icon: "flame", tone: "#EA580C", soft: "#FFEDD5", hint: "Wants to know more" },
  NOT_INTERESTED: { icon: "minus", tone: colors.muted, soft: GREY_SOFT, hint: "Politely declined" },
  CALLBACK: { icon: "calendar-clock", tone: colors.blue, soft: colors.blueSoft, hint: "Asked to be called back" },
  FOLLOW_UP: { icon: "phone-forward", tone: colors.purple, soft: colors.purpleSoft, hint: "Needs a follow-up call" },
  COMPLETED: { icon: "badge-check", tone: colors.green, soft: colors.greenSoft, hint: "Nothing more to do" },
  DO_NOT_CONTACT: { icon: "shield", tone: colors.red, soft: colors.redSoft, hint: "Asked not to be called again" },
};

export function dispositionLook(code: string | null | undefined): DispositionLook | null {
  return code ? (DISPOSITION_LOOK[code as DispositionCode] ?? null) : null;
}

/** Wording shown to the employee for an outcome. The stored code (and the server's label) do not change. */
const DISPOSITION_NAME: Partial<Record<DispositionCode, string>> = { BUSY: "Call Back" };

export function dispositionName(code: string | null | undefined, serverLabel?: string | null): string | null {
  return (code ? DISPOSITION_NAME[code as DispositionCode] : undefined) ?? serverLabel ?? null;
}

export const CALL_STATUS_LABEL: Record<CallStatus, string> = {
  initiated: "Starting",
  dialing: "Dialing",
  ringing: "Ringing",
  connected: "Connected",
  completed: "Connected",
  no_answer: "Not answered",
  failed: "Failed",
};

/** Outcomes the employee can choose after a call. A suggestion outside this list maps to the closest one. */
export const OUTCOME_CODES: DispositionCode[] = ["CONNECTED", "NO_ANSWER", "BUSY", "SWITCHED_OFF"];

/** Used only until the server's list has arrived (the server is the source of truth for outcomes). */
export const DEFAULT_DISPOSITIONS = [
  { id: 1, code: "CONNECTED", label: "Connected", category: "connected", requires_callback: false, sort_order: 1 },
  { id: 2, code: "NO_ANSWER", label: "No Answer", category: "not_connected", requires_callback: false, sort_order: 2 },
  { id: 3, code: "BUSY", label: "Busy", category: "not_connected", requires_callback: false, sort_order: 3 },
  { id: 4, code: "SWITCHED_OFF", label: "Switched Off", category: "not_connected", requires_callback: false, sort_order: 4 },
] as const;

export const PRIORITY_LABEL: Record<number, Look> = {
  1: { label: "High", color: colors.red, bg: colors.redSoft },
  2: { label: "Medium", color: colors.blue, bg: colors.blueSoft },
  3: { label: "Low", color: colors.muted, bg: GREY_SOFT },
};
