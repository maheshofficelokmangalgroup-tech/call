import { describe, expect, it } from "vitest";

import { callbackPresets, describeCallbackTime, formatDayLabel, formatDateTime, fromLocalInputValue, isSameDay, parseIso, startOfDay, timeAgo, toLocalInputValue } from "@/lib/time";

// local noon on 2026-10-03 (the tests do not depend on the machine's time zone)
const NOON = new Date(2026, 9, 3, 12, 0, 0).getTime();
const MIN = 60_000;
const DAY = 86_400_000;

describe("parsing", () => {
  it("reads ISO times and rejects rubbish", () => {
    expect(parseIso("2026-10-03T06:30:00Z")).toBe(Date.parse("2026-10-03T06:30:00Z"));
    expect(parseIso(null)).toBeNull();
    expect(parseIso("not a date")).toBeNull();
  });
});

describe("day labels", () => {
  it("says today, yesterday and tomorrow", () => {
    expect(formatDayLabel(NOON, NOON)).toBe("Today");
    expect(formatDayLabel(NOON - DAY, NOON)).toBe("Yesterday");
    expect(formatDayLabel(NOON + DAY, NOON)).toBe("Tomorrow");
  });
  it("names other days and adds the year only when it differs", () => {
    expect(formatDayLabel(new Date(2026, 9, 12, 12).getTime(), NOON)).toBe("12 Oct");
    expect(formatDayLabel(new Date(2025, 11, 25, 12).getTime(), NOON)).toBe("25 Dec 2025");
  });
  it("joins the day and the clock", () => {
    expect(formatDateTime(new Date(2026, 9, 3, 15, 30).getTime(), NOON)).toBe("Today, 3:30 PM");
    expect(formatDateTime(new Date(2026, 9, 4, 0, 5).getTime(), NOON)).toBe("Tomorrow, 12:05 AM");
  });
  it("compares days in local time", () => {
    expect(isSameDay(startOfDay(NOON), NOON + 5 * 60 * MIN)).toBe(true);
    expect(isSameDay(NOON, NOON + DAY)).toBe(false);
  });
});

describe("relative wording", () => {
  it("says how long ago", () => {
    expect(timeAgo(NOON - 20_000, NOON)).toBe("just now");
    expect(timeAgo(NOON - 5 * MIN, NOON)).toBe("5 min ago");
    expect(timeAgo(NOON - 2 * 60 * MIN, NOON)).toBe("2 h ago");
    expect(timeAgo(NOON - DAY, NOON)).toBe("Yesterday");
  });
  it("describes a callback", () => {
    expect(describeCallbackTime(NOON + 25 * MIN, NOON)).toBe("in 25 min");
    expect(describeCallbackTime(NOON - 10 * MIN, NOON)).toBe("overdue by 10 min");
    expect(describeCallbackTime(NOON - 3 * 60 * MIN, NOON)).toBe("overdue by 3 h");
    expect(describeCallbackTime(NOON + 30_000, NOON)).toBe("now");
    expect(describeCallbackTime(new Date(2026, 9, 3, 18, 0).getTime(), NOON)).toBe("at 6:00 PM");
    expect(describeCallbackTime(new Date(2026, 9, 5, 10, 0).getTime(), NOON)).toBe("5 Oct, 10:00 AM");
  });
  it("offers five presets in the future", () => {
    const presets = callbackPresets(NOON);
    expect(presets).toHaveLength(5);
    expect(presets.every((p) => p.at > NOON)).toBe(true);
    expect(presets[0].at).toBe(NOON + 30 * MIN);
    expect(new Date(presets[3].at).getHours()).toBe(10);
  });
});

describe("date and time fields", () => {
  it("round-trips through the value a datetime-local input uses", () => {
    const value = toLocalInputValue(new Date(2026, 9, 3, 16, 5).getTime());
    expect(value).toBe("2026-10-03T16:05");
    expect(fromLocalInputValue(value)).toBe(new Date(2026, 9, 3, 16, 5).getTime());
  });
  it("treats an empty or broken field as nothing", () => {
    expect(fromLocalInputValue("")).toBeNull();
    expect(fromLocalInputValue("nope")).toBeNull();
  });
});
