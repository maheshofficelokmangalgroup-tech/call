import type { BadgeTone } from "@/components/ui/badge";
import type { WorkState } from "@/lib/types";

/** How an employee's "work state" is shown. The rule itself (seen within N days) lives on the server; this is only wording. */
export const WORK_STATE: Record<WorkState, { label: string; tone: BadgeTone; hint: string }> = {
  active: { label: "Working", tone: "brand", hint: "Seen recently." },
  new: { label: "New", tone: "info", hint: "The account is new and has not signed in yet. It counts as working." },
  inactive: { label: "Not working", tone: "warn", hint: "Not seen for as many days as the setting says. Gets nothing, and what was not worked on is taken back." },
  deactivated: { label: "Switched off", tone: "neutral", hint: "The account is deactivated." },
};

export const isWorking = (state: WorkState) => state === "active" || state === "new";

/** "about 3 min", "about 1 h 20 min" - how long a job that has done `done` of `total` in `elapsedSeconds` still needs. */
export function formatEta(done: number, total: number, elapsedSeconds: number): string | null {
  if (!(done > 0) || !(total > done) || !(elapsedSeconds > 2)) return null;
  const remaining = ((total - done) / done) * elapsedSeconds;
  if (remaining < 45) return "less than a minute left";
  const minutes = Math.round(remaining / 60);
  if (minutes < 60) return `about ${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `about ${hours} h${rest ? ` ${rest} min` : ""} left`;
}

/** "10,000 contacts ÷ 10 people = 1,000 each" - with the remainder said plainly when it does not divide. */
export function eachText(total: number, people: number, formatNumber: (n: number) => string): string {
  if (people <= 0 || total <= 0) return "";
  const base = Math.floor(total / people);
  const extra = total % people;
  if (extra === 0) return `${formatNumber(total)} contacts ÷ ${people} ${people === 1 ? "person" : "people"} = ${formatNumber(base)} each`;
  return `${formatNumber(total)} contacts ÷ ${people} people = ${formatNumber(base)} each, and ${extra} ${extra === 1 ? "person gets" : "people get"} one more`;
}

/** Rows read or added per second since `startIso`, or null while it is too early to say. */
export function rowsPerSecond(done: number, startIso: string | null | undefined, now: number): number | null {
  if (!startIso || !(done > 0)) return null;
  const seconds = (now - Date.parse(startIso)) / 1000;
  return seconds > 2 ? done / seconds : null;
}
