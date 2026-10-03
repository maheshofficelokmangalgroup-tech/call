import { describe, expect, it } from "vitest";

import {
  activeHours,
  addDays,
  csvCell,
  daysBetween,
  formatClock,
  formatDuration,
  formatNumber,
  formatPercent,
  formatPhone,
  hourLabel,
  hueOf,
  initials,
  minuteToClock,
  percentChange,
  parseNumberList,
  pluralize,
  timeAgo,
  todayIn,
  toCsv,
} from "@/lib/utils";

describe("durations", () => {
  it("writes seconds the way people say them", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(187)).toBe("3m 07s");
    expect(formatDuration(180)).toBe("3m");
    expect(formatDuration(3725)).toBe("1h 02m");
  });

  it("has a short form for tight places", () => {
    expect(formatDuration(187, { compact: true })).toBe("3m 7s");
    expect(formatDuration(3725, { compact: true })).toBe("1h 2m");
  });

  it("copes with missing and negative values", () => {
    expect(formatDuration(null)).toBe("-");
    expect(formatDuration(undefined)).toBe("-");
    expect(formatDuration(Number.NaN)).toBe("-");
    expect(formatDuration(-5)).toBe("0s");
  });

  it("writes a player clock", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(187)).toBe("03:07");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(12.9)).toBe("00:12");
  });
});

describe("clock times", () => {
  it("turns a minute of the day into a 12-hour time", () => {
    expect(minuteToClock(0)).toBe("12:00 AM");
    expect(minuteToClock(9 * 60 + 5)).toBe("9:05 AM");
    expect(minuteToClock(12 * 60)).toBe("12:00 PM");
    expect(minuteToClock(17 * 60 + 45)).toBe("5:45 PM");
    expect(minuteToClock(null)).toBe("-");
  });

  it("labels hours", () => {
    expect(hourLabel(0)).toBe("12 AM");
    expect(hourLabel(9)).toBe("9 AM");
    expect(hourLabel(12)).toBe("12 PM");
    expect(hourLabel(23)).toBe("11 PM");
  });

  it("finds the hours worth drawing", () => {
    expect(activeHours(Array(24).fill(0))).toEqual([8, 20]);
    const early = Array(24).fill(0);
    early[6] = 3;
    early[22] = 1;
    expect(activeHours(early)).toEqual([6, 22]);
    const normal = Array(24).fill(0);
    normal[10] = 5;
    expect(activeHours(normal)).toEqual([8, 20]);
  });
});

describe("numbers", () => {
  it("groups digits the Indian way", () => {
    expect(formatNumber(1907)).toBe("1,907");
    expect(formatNumber(1234567)).toBe("12,34,567");
    expect(formatNumber(null)).toBe("-");
  });

  it("writes percentages without trailing zeros", () => {
    expect(formatPercent(60)).toBe("60%");
    expect(formatPercent(52.84, 1)).toBe("52.8%");
    expect(formatPercent(50, 1)).toBe("50%");
    expect(formatPercent(undefined)).toBe("-");
  });

  it("measures change against the previous period", () => {
    expect(percentChange(110, 100)).toBeCloseTo(10);
    expect(percentChange(90, 100)).toBeCloseTo(-10);
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(5, 0)).toBeNull(); // nothing to compare with
  });

  it("pluralizes", () => {
    expect(pluralize(1, "call")).toBe("1 call");
    expect(pluralize(2, "call")).toBe("2 calls");
    expect(pluralize(0, "person", "people")).toBe("0 people");
    expect(pluralize(1500, "contact")).toBe("1,500 contacts");
  });
});

describe("dates in the business time zone", () => {
  it("knows which day it is in India when it is still yesterday in UTC", () => {
    const lateEveningUtc = new Date("2026-10-01T20:00:00Z"); // 01:30 the next morning in Kolkata
    expect(todayIn("Asia/Kolkata", lateEveningUtc)).toBe("2026-10-02");
    expect(todayIn("UTC", lateEveningUtc)).toBe("2026-10-01");
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // leap year
    expect(addDays("2026-10-01", -6)).toBe("2026-09-25");
  });

  it("counts the days of a period, both ends included", () => {
    expect(daysBetween("2026-10-01", "2026-10-01")).toBe(1);
    expect(daysBetween("2026-09-25", "2026-10-01")).toBe(7);
    expect(daysBetween("2026-02-01", "2026-03-01")).toBe(29);
  });

  it("says how long ago something happened", () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    expect(timeAgo("2026-10-01T11:59:50Z", now)).toBe("just now");
    expect(timeAgo("2026-10-01T11:55:00Z", now)).toBe("5 min ago");
    expect(timeAgo("2026-10-01T09:00:00Z", now)).toBe("3 h ago");
    expect(timeAgo("2026-09-30T10:00:00Z", now)).toBe("yesterday");
    expect(timeAgo("2026-09-28T12:00:00Z", now)).toBe("3 days ago");
    expect(timeAgo(null, now)).toBe("never");
  });
});

describe("people and phone numbers", () => {
  it("makes initials", () => {
    expect(initials("Aarav Patil")).toBe("AP");
    expect(initials("  rahul   kumar   sharma ")).toBe("RS");
    expect(initials("Madonna")).toBe("M");
    expect(initials("")).toBe("?");
    expect(initials(null)).toBe("?");
    expect(initials("राहुल शर्मा")).toBe("रश");
  });

  it("gives the same person the same colour every time", () => {
    expect(hueOf("Aarav Patil")).toBe(hueOf("Aarav Patil"));
    expect(hueOf("Aarav Patil")).not.toBe(hueOf("Sneha Kulkarni"));
    expect(hueOf("x")).toBeGreaterThanOrEqual(0);
    expect(hueOf("x")).toBeLessThan(360);
  });

  it("writes phone numbers readably", () => {
    expect(formatPhone("+919876543210")).toBe("+91 98765 43210");
    expect(formatPhone("9876543210")).toBe("+91 98765 43210");
    expect(formatPhone("91 98765-43210")).toBe("+91 98765 43210");
    expect(formatPhone("5876543210")).toBe("5876543210"); // not an Indian mobile number: left alone
    expect(formatPhone("+14155550123")).toBe("+1 (415) 555-0123");
    expect(formatPhone("+442071234567")).toBe("+442071234567");
    expect(formatPhone(null)).toBe("-");
  });
});

describe("the other numbers of a person", () => {
  it("takes one number on each line, and commas and semicolons as well", () => {
    expect(parseNumberList("98 7654 3211\n98 7654 3212")).toEqual(["98 7654 3211", "98 7654 3212"]);
    expect(parseNumberList("9876543211, 9876543212;9876543213")).toEqual(["9876543211", "9876543212", "9876543213"]);
  });
  it("leaves out empty lines and spaces around a number", () => {
    expect(parseNumberList("\n  9876543211  \n\n ,; \n")).toEqual(["9876543211"]);
    expect(parseNumberList("")).toEqual([]);
  });
  it("takes at most 19 (a person has 20 numbers with the main one)", () => {
    const many = Array.from({ length: 30 }, (_, i) => `98765432${String(i).padStart(2, "0")}`).join("\n");
    expect(parseNumberList(many)).toHaveLength(19);
  });
});

describe("spreadsheets", () => {
  it("defuses cells that a spreadsheet would run as formulas", () => {
    for (const bad of ["=SUM(A1:A9)", "+91 98765", "-2+3", "@cmd", "\tx"]) expect(csvCell(bad).startsWith("'")).toBe(true);
    expect(csvCell("Rahul")).toBe("Rahul");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(null)).toBe("");
  });

  it("quotes cells with commas, quotes and line breaks", () => {
    expect(csvCell("Patil, Aarav")).toBe('"Patil, Aarav"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("joins rows with Windows line endings so Excel opens them cleanly", () => {
    expect(toCsv([["a", "b"], [1, "x,y"]])).toBe('a,b\r\n1,"x,y"');
  });
});
