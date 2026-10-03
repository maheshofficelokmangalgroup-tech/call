import type { BadgeTone } from "@/components/ui/badge";
import { DEFAULT_TZ, addDays, formatInZone, todayIn } from "@/lib/utils";

/** The key of "no outcome chosen yet" in a count of responses (the API's NO_RESPONSE). */
export const NO_OUTCOME = "NONE";

/** What the customers answered, grouped the way an administrator thinks about them (the codes are the outcomes the employees choose). */
export interface ResponseGroup {
  key: "interested" | "followup" | "not_interested" | "talked" | "not_reached" | "bad" | "none";
  label: string;
  tone: BadgeTone;
  color: string;
  codes: string[];
  hint: string;
}

export const RESPONSE_GROUPS: ResponseGroup[] = [
  { key: "interested", label: "Interested", tone: "teal", color: "#0d9488", codes: ["INTERESTED"], hint: "Their latest response was Interested." },
  { key: "followup", label: "Follow-up promised", tone: "violet", color: "#7c3aed", codes: ["CALLBACK", "FOLLOW_UP"], hint: "Asked to be called back, or the employee set a follow-up." },
  { key: "not_interested", label: "Not interested", tone: "warn", color: "#d97a00", codes: ["NOT_INTERESTED"], hint: "Their latest response was Not interested." },
  { key: "talked", label: "Spoke", tone: "brand", color: "#0c831f", codes: ["CONNECTED", "COMPLETED"], hint: "Somebody answered and the call was marked Connected or Completed." },
  { key: "not_reached", label: "Not reached", tone: "neutral", color: "#94a299", codes: ["NO_ANSWER", "BUSY", "SWITCHED_OFF"], hint: "No answer, busy or switched off." },
  { key: "bad", label: "Wrong number / do not call", tone: "danger", color: "#dc2f3d", codes: ["INVALID_NUMBER", "DO_NOT_CONTACT"], hint: "Invalid number, or the person asked not to be called." },
  { key: "none", label: "No outcome chosen", tone: "outline", color: "#cdd5c6", codes: [NO_OUTCOME], hint: "The call ended but the employee has not chosen an outcome yet." },
];

export const groupByKey = (key: string): ResponseGroup | undefined => RESPONSE_GROUPS.find((g) => g.key === key);

/** The group an outcome code belongs to (no code = no outcome chosen yet). */
export const groupOf = (code: string | null | undefined): ResponseGroup => RESPONSE_GROUPS.find((g) => g.codes.includes(code ?? NO_OUTCOME)) ?? RESPONSE_GROUPS[RESPONSE_GROUPS.length - 1]!;

/** How many people are in a group, from the API's count of people by latest response. */
export const groupCount = (responses: Record<string, number> | undefined, group: ResponseGroup): number => group.codes.reduce((sum, code) => sum + (responses?.[code] ?? 0), 0);

/** The `response` value the API wants for a group ("CALLBACK,FOLLOW_UP"). */
export const groupCodes = (group: ResponseGroup): string => group.codes.join(",");

// ------------------------------------------------------------------------------------------------- when a follow-up is due
export type DueTone = "late" | "today" | "tomorrow" | "later" | "closed";

export interface Due {
  label: string;
  detail: string;
  tone: DueTone;
}

/** "5 min", "3 h", "2 days": how long ago something was due, in the coarsest unit that is still honest. */
export function spanText(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** What to say about a scheduled follow-up: late, today, tomorrow or later - or that it is finished. */
export function followupDue(iso: string, status: string, now: number = Date.now(), tz: string = DEFAULT_TZ): Due {
  const clock = formatInZone(iso, { hour: "numeric", minute: "2-digit", hour12: true }, tz).toUpperCase();
  const date = formatInZone(iso, { day: "numeric", month: "short" }, tz);
  if (status === "done") return { label: "Done", detail: `closed on ${date}`, tone: "closed" };
  if (status === "cancelled") return { label: "Cancelled", detail: `closed on ${date}`, tone: "closed" };
  const at = new Date(iso).getTime();
  if (at <= now) return { label: `Overdue ${spanText(now - at)}`, detail: `was due ${date}, ${clock}`, tone: "late" };
  const today = todayIn(tz, new Date(now));
  const day = todayIn(tz, new Date(at));
  if (day === today) return { label: `Today ${clock}`, detail: `due today at ${clock}`, tone: "today" };
  if (day === addDays(today, 1)) return { label: `Tomorrow ${clock}`, detail: `due tomorrow at ${clock}`, tone: "tomorrow" };
  const weekday = formatInZone(iso, { weekday: "short" }, tz);
  return { label: `${weekday} ${date}`, detail: `due ${weekday} ${date}, ${clock}`, tone: "later" };
}

export const DUE_TONE: Record<DueTone, BadgeTone> = { late: "danger", today: "warn", tomorrow: "info", later: "neutral", closed: "outline" };

/** "3 calls, 1 answered" - the calls of a conversation in a few words. */
export function callsSummary(calls: number, answered: number): string {
  const total = `${calls} call${calls === 1 ? "" : "s"}`;
  return answered > 0 ? `${total}, ${answered} answered` : `${total}, none answered`;
}
