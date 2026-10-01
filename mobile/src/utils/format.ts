/** Formatting helpers (pure functions, unit tested). */

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 83 -> "01:23", 3725 -> "1:02:05" */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
}

/** 83 -> "1m 23s", 45 -> "45s", 3700 -> "1h 1m" */
export function formatDurationWords(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
}

/**
 * "+919876543210" -> "+91 98765 43210". Other countries fall back to grouping in threes.
 * Only used for display; the canonical number stays in E.164.
 */
export function formatPhone(e164: string): string {
  if (!e164) return '';
  const digits = e164.replace(/[^\d+]/g, '');
  if (digits.startsWith('+91') && digits.length === 13) {
    const n = digits.slice(3);
    return `+91 ${n.slice(0, 5)} ${n.slice(5)}`;
  }
  if (digits.startsWith('+1') && digits.length === 12) {
    const n = digits.slice(2);
    return `+1 (${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  }
  if (digits.startsWith('+')) {
    const cc = digits.slice(0, digits.length > 11 ? 3 : 2);
    const rest = digits.slice(cc.length).replace(/(\d{3})(?=\d)/g, '$1 ');
    return `${cc} ${rest}`.trim();
  }
  if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  return digits;
}

/** Keypad entry display: keeps what the user typed, with a space after 5 digits for 10-digit numbers. */
export function formatDialerInput(raw: string): string {
  if (/^\d{6,10}$/.test(raw)) return `${raw.slice(0, 5)} ${raw.slice(5)}`;
  return raw;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = Array.from(parts[0])[0] ?? '?';
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] : '';
  return (first + last).toUpperCase();
}

const AVATAR_PALETTE: readonly [string, string][] = [
  ['#E6F4E8', '#0C831F'],
  ['#FFF7DA', '#B7860B'],
  ['#E8F0FE', '#2563EB'],
  ['#F1EAFE', '#7C3AED'],
  ['#FDECEE', '#E23744'],
  ['#E2F6F5', '#0E9F9A'],
  ['#FEF3DC', '#C2710C'],
];

/** Stable colour pair (background, foreground) for a name. */
export function avatarColors(name: string): readonly [string, string] {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function titleCase(text: string): string {
  return text.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
