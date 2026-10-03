import { describe, expect, it } from "vitest";

import { NO_OUTCOME, RESPONSE_GROUPS, callsSummary, followupDue, groupByKey, groupCodes, groupCount, groupOf, spanText } from "@/lib/followups";
import { parseTalkKey, talkKey } from "@/components/domain/conversations-table";

// "now" = 12:00 in India on 2026-10-03 (06:30 UTC), a Saturday
const NOW = Date.parse("2026-10-03T06:30:00Z");
const at = (iso: string) => iso;

describe("response groups", () => {
  it("puts every outcome the employees can choose into exactly one group, and 'no outcome' into its own", () => {
    const codes = ["CONNECTED", "NO_ANSWER", "BUSY", "SWITCHED_OFF", "INVALID_NUMBER", "INTERESTED", "NOT_INTERESTED", "CALLBACK", "FOLLOW_UP", "COMPLETED", "DO_NOT_CONTACT", NO_OUTCOME];
    for (const code of codes) expect(RESPONSE_GROUPS.filter((g) => g.codes.includes(code)), code).toHaveLength(1);
    expect(groupOf(null).key).toBe("none");
    expect(groupOf(undefined).key).toBe("none");
    expect(groupOf("CALLBACK").key).toBe("followup");
    expect(groupOf("BUSY").key).toBe("not_reached");
    expect(groupOf("SOMETHING_NEW").key).toBe("none"); // an outcome added later is not lost, it is shown as "no outcome"
  });

  it("adds up the people of a group and asks the API for its codes", () => {
    const responses = { CALLBACK: 2, FOLLOW_UP: 3, INTERESTED: 1, NONE: 4 };
    expect(groupCount(responses, groupByKey("followup")!)).toBe(5);
    expect(groupCount(responses, groupByKey("none")!)).toBe(4);
    expect(groupCount(undefined, groupByKey("followup")!)).toBe(0);
    expect(groupCodes(groupByKey("followup")!)).toBe("CALLBACK,FOLLOW_UP");
    const total = RESPONSE_GROUPS.reduce((sum, g) => sum + groupCount(responses, g), 0);
    expect(total).toBe(10); // every person is in one group
  });
});

describe("when a follow-up is due", () => {
  it("says how late an overdue one is, in the coarsest honest unit", () => {
    expect(followupDue(at("2026-10-03T05:30:00Z"), "pending", NOW)).toMatchObject({ tone: "late", label: "Overdue 1 h" });
    expect(followupDue(at("2026-10-03T06:10:00Z"), "pending", NOW)).toMatchObject({ tone: "late", label: "Overdue 20 min" });
    expect(followupDue(at("2026-10-01T06:30:00Z"), "pending", NOW)).toMatchObject({ tone: "late", label: "Overdue 2 days" });
    expect(followupDue(at("2026-10-02T06:30:00Z"), "pending", NOW).label).toBe("Overdue 1 day");
  });

  it("tells today, tomorrow and later apart in the business time zone, not the browser's", () => {
    const today = followupDue(at("2026-10-03T14:30:00Z"), "pending", NOW); // 8 pm in India
    expect(today).toMatchObject({ tone: "today", label: "Today 8:00 PM" });
    // 20:00 UTC on the 3rd is already 1:30 am on the 4th in India: tomorrow
    expect(followupDue(at("2026-10-03T20:00:00Z"), "pending", NOW)).toMatchObject({ tone: "tomorrow", label: "Tomorrow 1:30 AM" });
    const later = followupDue(at("2026-10-07T05:00:00Z"), "pending", NOW);
    expect(later).toMatchObject({ tone: "later" });
    expect(later.label).toMatch(/^Wed 7 Oct$|^Wed 7 Oct/);
  });

  it("a finished follow-up is not late, whatever its time was", () => {
    expect(followupDue(at("2026-09-01T06:30:00Z"), "done", NOW)).toMatchObject({ tone: "closed", label: "Done" });
    expect(followupDue(at("2026-09-01T06:30:00Z"), "cancelled", NOW)).toMatchObject({ tone: "closed", label: "Cancelled" });
  });

  it("spans", () => {
    expect(spanText(0)).toBe("1 min");
    expect(spanText(59 * 60_000)).toBe("59 min");
    expect(spanText(90 * 60_000)).toBe("2 h");
    expect(spanText(47 * 3_600_000)).toBe("2 days");
  });
});

describe("small wording", () => {
  it("summarises the calls of a conversation", () => {
    expect(callsSummary(1, 0)).toBe("1 call, none answered");
    expect(callsSummary(3, 1)).toBe("3 calls, 1 answered");
  });
});

describe("the address of an open conversation", () => {
  it("round-trips an employee and a number", () => {
    expect(talkKey(7, "+919876543210")).toBe("7~+919876543210");
    expect(parseTalkKey("7~+919876543210")).toEqual({ employeeId: 7, phone: "+919876543210" });
    expect(parseTalkKey("12~9876543210")).toEqual({ employeeId: 12, phone: "9876543210" });
  });

  it("refuses anything that is not that shape (it comes from the address bar)", () => {
    for (const bad of [null, "", "7", "7~", "~+919876543210", "x~+919876543210", "7~+91abc", "7~+91 98765 43210", "7~+9198765432101234567890123456789012", "7~1", "7~+919876543210~1", "../etc/passwd"]) {
      expect(parseTalkKey(bad), String(bad)).toBeNull();
    }
  });
});
