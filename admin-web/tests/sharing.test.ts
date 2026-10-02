import { describe, expect, it } from "vitest";

import { WORK_STATE, eachText, formatEta, isWorking, rowsPerSecond } from "@/lib/sharing";

const n = (value: number) => value.toLocaleString("en-IN");

describe("who counts as working", () => {
  it("is exactly the active and the new accounts", () => {
    expect(isWorking("active")).toBe(true);
    expect(isWorking("new")).toBe(true);
    expect(isWorking("inactive")).toBe(false);
    expect(isWorking("deactivated")).toBe(false);
  });

  it("has a label and a colour for every state", () => {
    for (const state of ["active", "new", "inactive", "deactivated"] as const) {
      expect(WORK_STATE[state].label.length).toBeGreaterThan(2);
      expect(WORK_STATE[state].hint.length).toBeGreaterThan(10);
    }
    expect(WORK_STATE.inactive.tone).toBe("warn");
  });
});

describe("how many each person gets, in words", () => {
  it("says it plainly when it divides", () => {
    expect(eachText(10_000, 10, n)).toBe("10,000 contacts ÷ 10 people = 1,000 each");
    expect(eachText(5, 1, n)).toBe("5 contacts ÷ 1 person = 5 each");
  });

  it("says who gets one more when it does not", () => {
    expect(eachText(10_003, 10, n)).toBe("10,003 contacts ÷ 10 people = 1,000 each, and 3 people get one more");
    expect(eachText(11, 5, n)).toBe("11 contacts ÷ 5 people = 2 each, and 1 person gets one more");
  });

  it("says nothing when there is nobody or nothing to share", () => {
    expect(eachText(0, 5, n)).toBe("");
    expect(eachText(5, 0, n)).toBe("");
  });
});

describe("how long a job still needs", () => {
  it("is unknown until something has been done for a few seconds", () => {
    expect(formatEta(0, 1000, 30)).toBeNull();
    expect(formatEta(100, 1000, 1)).toBeNull();
    expect(formatEta(1000, 1000, 60)).toBeNull(); // finished
  });

  it("is in minutes, then in hours", () => {
    expect(formatEta(990_000, 1_000_000, 100)).toBe("less than a minute left");
    expect(formatEta(250_000, 1_000_000, 100)).toBe("about 5 min left"); // 100 s for a quarter: 300 s more
    expect(formatEta(100_000, 1_000_000, 600)).toBe("about 1 h 30 min left"); // 5,400 s more
    expect(formatEta(100_000, 1_000_000, 400)).toBe("about 1 h left"); // 3,600 s more
  });
});

describe("how fast a job goes", () => {
  const start = "2026-10-02T10:00:00Z";
  it("is the work done over the time since it started", () => {
    expect(rowsPerSecond(5_000, start, Date.parse("2026-10-02T10:00:10Z"))).toBe(500);
  });
  it("is unknown at the very start, or with nothing done", () => {
    expect(rowsPerSecond(5_000, start, Date.parse("2026-10-02T10:00:01Z"))).toBeNull();
    expect(rowsPerSecond(0, start, Date.parse("2026-10-02T10:01:00Z"))).toBeNull();
    expect(rowsPerSecond(10, null, Date.now())).toBeNull();
  });
});
