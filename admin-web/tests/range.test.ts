import { describe, expect, it } from "vitest";

import { PRESETS, resolvePreset } from "@/lib/range";

// 01:30 on 2 October 2026 in India, still the evening of 1 October in UTC
const NOW = new Date("2026-10-01T20:00:00Z");

describe("periods", () => {
  it("offers the periods the top bar lists", () => {
    expect(PRESETS.map((p) => p.key)).toEqual(["today", "yesterday", "7d", "30d", "month", "lastMonth"]);
  });

  it("works out every period in the business time zone, not in the browser's", () => {
    expect(resolvePreset("today", "Asia/Kolkata", NOW)).toEqual({ from: "2026-10-02", to: "2026-10-02" });
    expect(resolvePreset("yesterday", "Asia/Kolkata", NOW)).toEqual({ from: "2026-10-01", to: "2026-10-01" });
    expect(resolvePreset("7d", "Asia/Kolkata", NOW)).toEqual({ from: "2026-09-26", to: "2026-10-02" });
    expect(resolvePreset("30d", "Asia/Kolkata", NOW)).toEqual({ from: "2026-09-03", to: "2026-10-02" });
    expect(resolvePreset("month", "Asia/Kolkata", NOW)).toEqual({ from: "2026-10-01", to: "2026-10-02" });
    expect(resolvePreset("lastMonth", "Asia/Kolkata", NOW)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("gives the same moment a different 'today' in another zone", () => {
    expect(resolvePreset("today", "UTC", NOW)).toEqual({ from: "2026-10-01", to: "2026-10-01" });
  });

  it("finds last month across a year end", () => {
    expect(resolvePreset("lastMonth", "Asia/Kolkata", new Date("2027-01-15T06:00:00Z"))).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("handles the first day of a month", () => {
    expect(resolvePreset("month", "Asia/Kolkata", new Date("2026-11-01T02:00:00Z"))).toEqual({ from: "2026-11-01", to: "2026-11-01" });
    expect(resolvePreset("lastMonth", "Asia/Kolkata", new Date("2026-03-01T02:00:00Z"))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});
