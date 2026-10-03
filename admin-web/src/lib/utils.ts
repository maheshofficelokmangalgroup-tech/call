import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ------------------------------------------------------------------------------------------------- numbers & time
const nf = new Intl.NumberFormat("en-IN");
const nfCompact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });

export const formatNumber = (n: number | null | undefined) => (n == null ? "-" : nf.format(Math.round(n)));
export const formatCompact = (n: number | null | undefined) => (n == null ? "-" : nfCompact.format(n));
export const formatPercent = (n: number | null | undefined, digits = 0) =>
  n == null ? "-" : `${n.toFixed(digits).replace(/\.0+$/, "")}%`;

/** 3725 -> "1h 2m", 187 -> "3m 7s", 45 -> "45s", 0 -> "0s". */
export function formatDuration(seconds: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (seconds == null || Number.isNaN(seconds)) return "-";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return opts.compact ? `${h}h ${m}m` : `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return opts.compact || sec === 0 ? `${m}m${sec ? ` ${sec}s` : ""}` : `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/** 187 -> "03:07", 3725 -> "1:02:05" - for players and live timers. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Minute of the day (0-1439) -> "10:30 AM". */
export function minuteToClock(minute: number | null | undefined): string {
  if (minute == null) return "-";
  const h24 = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function hourLabel(hour: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${suffix}`;
}

/** Change against a previous value, as a percentage; null when there is nothing to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

// ------------------------------------------------------------------------------------------------- dates (business timezone)
export const DEFAULT_TZ = "Asia/Kolkata";

export function formatInZone(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions, tz = DEFAULT_TZ): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-IN", { timeZone: tz, ...opts }).format(d);
}

export const formatTime = (iso: string | null | undefined, tz = DEFAULT_TZ) =>
  formatInZone(iso, { hour: "numeric", minute: "2-digit", hour12: true }, tz);

export const formatTimeSeconds = (iso: string | null | undefined, tz = DEFAULT_TZ) =>
  formatInZone(iso, { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }, tz);

export const formatDate = (iso: string | null | undefined, tz = DEFAULT_TZ) =>
  formatInZone(iso, { day: "numeric", month: "short", year: "numeric" }, tz);

export const formatDateTime = (iso: string | null | undefined, tz = DEFAULT_TZ) =>
  formatInZone(iso, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }, tz);

/** "just now", "5 min ago", "3 h ago", "yesterday", "12 Sep". */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "never";
  const diff = Math.max(0, now - t) / 1000;
  if (diff < 45) return "just now";
  if (diff < 90) return "1 min ago";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 172800) return "yesterday";
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)} days ago`;
  return formatDate(iso);
}

/** Today's date (YYYY-MM-DD) in the given timezone. */
export function todayIn(tz = DEFAULT_TZ, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000) + 1;
}

export function formatDay(day: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", ...opts }).format(new Date(`${day}T00:00:00Z`));
}

// ------------------------------------------------------------------------------------------------- people & phones
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return Array.from(parts[0]!)[0]!.toUpperCase();
  return (Array.from(parts[0]!)[0]! + Array.from(parts[parts.length - 1]!)[0]!).toUpperCase();
}

/** Stable hue (0-359) from a string, so every person keeps the same avatar colour. */
export function hueOf(seed: string | null | undefined): number {
  let h = 0;
  for (const ch of seed ?? "") h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % 360;
}

/** +919876543210, 919876543210 and 9876543210 -> "+91 98765 43210"; other numbers are left alone. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "-";
  const m = /^(?:\+?91)?([6-9]\d{4})(\d{5})$/.exec(phone.replace(/[\s-]/g, ""));
  if (m) return `+91 ${m[1]} ${m[2]}`;
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone);
  if (us) return `+1 (${us[1]}) ${us[2]}-${us[3]}`;
  return phone;
}

/** The numbers typed into one box: one on each line (commas and semicolons work too); at most 19 besides the main number. */
export function parseNumberList(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 19);
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** First and last hour worth drawing: the hours that have calls, widened to at least `min`-`max` so charts keep a familiar shape. */
export function activeHours(perHour: number[], min = 8, max = 20): [number, number] {
  let first = 24;
  let last = -1;
  perHour.forEach((n, hour) => {
    if (n > 0) {
      first = Math.min(first, hour);
      last = Math.max(last, hour);
    }
  });
  return last < 0 ? [min, max] : [Math.min(min, first), Math.max(max, last)];
}

/** Download a text file generated in the browser (credential sheets, reports). */
export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob(["﻿", text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copy text to the clipboard. Falls back to a hidden textarea where the clipboard API is unavailable (plain-HTTP intranet installs). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      // some browsers leave this promise waiting for a permission nobody will answer: do not wait for ever
      await Promise.race([navigator.clipboard.writeText(text), new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("clipboard timeout")), 1500))]);
      return true;
    }
  } catch {
    /* fall through to the textarea method */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Neutralise spreadsheet formulas in a CSV cell (cells starting with = + - @ are executed by Excel). */
export function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}
