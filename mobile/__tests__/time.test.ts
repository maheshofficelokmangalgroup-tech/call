import { callbackPresets, describeCallbackTime, formatClock, formatDateTime, formatDayLabel, isSameDay, parseIso, startOfDay, timeAgo } from '../src/utils/time';

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

describe('parseIso', () => {
  it('parses ISO strings and rejects garbage', () => {
    expect(parseIso('2026-10-01T10:00:00Z')).toBe(Date.parse('2026-10-01T10:00:00Z'));
    expect(parseIso(null)).toBeNull();
    expect(parseIso('not a date')).toBeNull();
  });
});

describe('formatClock', () => {
  it('uses a 12 hour clock', () => {
    expect(formatClock(at(2026, 10, 1, 0, 5))).toBe('12:05 AM');
    expect(formatClock(at(2026, 10, 1, 12, 0))).toBe('12:00 PM');
    expect(formatClock(at(2026, 10, 1, 15, 30))).toBe('3:30 PM');
  });
});

describe('day labels', () => {
  const now = at(2026, 10, 15, 11, 0);
  it('says Today / Yesterday / Tomorrow', () => {
    expect(formatDayLabel(at(2026, 10, 15, 8), now)).toBe('Today');
    expect(formatDayLabel(at(2026, 10, 14, 23), now)).toBe('Yesterday');
    expect(formatDayLabel(at(2026, 10, 16, 1), now)).toBe('Tomorrow');
  });
  it('shows the date otherwise and the year only when it differs', () => {
    expect(formatDayLabel(at(2026, 10, 3), now)).toBe('3 Oct');
    expect(formatDayLabel(at(2025, 12, 25), now)).toBe('25 Dec 2025');
  });
  it('combines day and time', () => {
    expect(formatDateTime(at(2026, 10, 16, 10, 0), now)).toBe('Tomorrow, 10:00 AM');
  });
  it('knows same-day and start-of-day', () => {
    expect(isSameDay(at(2026, 10, 15, 1), at(2026, 10, 15, 23))).toBe(true);
    expect(isSameDay(at(2026, 10, 15, 23), at(2026, 10, 16, 0))).toBe(false);
    expect(startOfDay(at(2026, 10, 15, 13, 45))).toBe(at(2026, 10, 15));
  });
});

describe('timeAgo', () => {
  const now = at(2026, 10, 15, 12, 0);
  it('is relative', () => {
    expect(timeAgo(now - 10_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(timeAgo(at(2026, 10, 14, 9), now)).toBe('Yesterday');
  });
});

describe('describeCallbackTime', () => {
  const now = at(2026, 10, 15, 12, 0);
  it('describes overdue, imminent and upcoming callbacks', () => {
    expect(describeCallbackTime(now - 10 * 60_000, now)).toBe('overdue by 10 min');
    expect(describeCallbackTime(now - 3 * 3_600_000, now)).toBe('overdue by 3 h');
    expect(describeCallbackTime(now + 30_000, now)).toBe('now');
    expect(describeCallbackTime(now + 25 * 60_000, now)).toBe('in 25 min');
    expect(describeCallbackTime(at(2026, 10, 15, 16, 30), now)).toBe('at 4:30 PM');
    expect(describeCallbackTime(at(2026, 10, 16, 10, 0), now)).toBe('Tomorrow, 10:00 AM');
  });
});

describe('callbackPresets', () => {
  it('offers ascending, future times', () => {
    const now = at(2026, 10, 15, 12, 0);
    const presets = callbackPresets(now);
    expect(presets.map((p) => p.key)).toEqual(['30m', '1h', '3h', 'tm10', 'tm4']);
    expect(presets.every((p) => p.at > now)).toBe(true);
    const times = presets.map((p) => p.at);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(new Date(presets[3].at).getHours()).toBe(10);
    expect(new Date(presets[3].at).getDate()).toBe(16);
  });
});
