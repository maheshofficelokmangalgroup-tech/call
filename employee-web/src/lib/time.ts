/** Date/time helpers. The server sends ISO-8601 (UTC); the UI shows the browser's local time. */
import { pad2 } from "./format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function parseIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

export function formatClock(ms: number): string {
  const d = new Date(ms);
  let h = d.getHours();
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${pad2(d.getMinutes())} ${suffix}`;
}

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

/** "Today", "Yesterday", "Tomorrow" or "12 Oct" (adds the year when it is not the current one). */
export function formatDayLabel(ms: number, now = Date.now()): string {
  const dayMs = 86_400_000;
  const diff = Math.round((startOfDay(ms) - startOfDay(now)) / dayMs);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  const d = new Date(ms);
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** "Today, 3:30 PM" / "Tomorrow, 10:00 AM" / "12 Oct, 4:15 PM" */
export function formatDateTime(ms: number, now = Date.now()): string {
  return `${formatDayLabel(ms, now)}, ${formatClock(ms)}`;
}

/** "just now", "5 min ago", "2 h ago", "yesterday", "12 Oct" */
export function timeAgo(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24 && isSameDay(ms, now)) return `${h} h ago`;
  return formatDayLabel(ms, now);
}

/** Relative wording for a callback: "in 25 min", "overdue by 10 min", "at 3:30 PM". */
export function describeCallbackTime(ms: number, now = Date.now()): string {
  const diffMin = Math.round((ms - now) / 60_000);
  if (diffMin < -1) {
    const late = -diffMin;
    if (late < 60) return `overdue by ${late} min`;
    if (late < 24 * 60) return `overdue by ${Math.floor(late / 60)} h`;
    return `overdue since ${formatDayLabel(ms, now)}`;
  }
  if (diffMin <= 1) return "now";
  if (diffMin < 60) return `in ${diffMin} min`;
  return isSameDay(ms, now) ? `at ${formatClock(ms)}` : formatDateTime(ms, now);
}

/** Preset callback times offered on the outcome screen and when rescheduling. */
export function callbackPresets(now = Date.now()): { key: string; label: string; at: number }[] {
  const in30 = now + 30 * 60_000;
  const in1h = now + 60 * 60_000;
  const in3h = now + 3 * 60 * 60_000;
  const tomorrow10 = startOfDay(now) + 86_400_000 + 10 * 3_600_000;
  const tomorrow4 = startOfDay(now) + 86_400_000 + 16 * 3_600_000;
  return [
    { key: "30m", label: "In 30 min", at: in30 },
    { key: "1h", label: "In 1 hour", at: in1h },
    { key: "3h", label: "In 3 hours", at: in3h },
    { key: "tm10", label: "Tomorrow 10 AM", at: tomorrow10 },
    { key: "tm4", label: "Tomorrow 4 PM", at: tomorrow4 },
  ];
}

/** The value an <input type="datetime-local"> understands ("2026-10-03T16:30"), in the browser's local time. */
export function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Inverse of toLocalInputValue; null for an empty or invalid value. */
export function fromLocalInputValue(value: string): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}
