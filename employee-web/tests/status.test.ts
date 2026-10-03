import { describe, expect, it } from "vitest";

import { dispositionLook, dispositionName, DEFAULT_DISPOSITIONS, DISPOSITION_LOOK, OUTCOME_CODES, contactStatusLook, CALL_STATUS_LABEL } from "@/lib/status";

describe("outcomes", () => {
  it("shows Busy as Call Back and leaves every other label alone", () => {
    expect(dispositionName("BUSY", "Busy")).toBe("Call Back");
    expect(dispositionName("NO_ANSWER", "No Answer")).toBe("No Answer");
    expect(dispositionName(null, "x")).toBe("x");
    expect(dispositionName("UNKNOWN", undefined)).toBeNull();
  });
  it("offers four outcomes after a call", () => {
    expect(OUTCOME_CODES).toEqual(["CONNECTED", "NO_ANSWER", "BUSY", "SWITCHED_OFF"]);
    expect(DEFAULT_DISPOSITIONS.map((d) => d.code)).toEqual(OUTCOME_CODES);
  });
  it("has a look for every outcome the server can send", () => {
    for (const code of ["CONNECTED", "NO_ANSWER", "BUSY", "SWITCHED_OFF", "INVALID_NUMBER", "INTERESTED", "NOT_INTERESTED", "CALLBACK", "FOLLOW_UP", "COMPLETED", "DO_NOT_CONTACT"]) {
      expect(DISPOSITION_LOOK[code as keyof typeof DISPOSITION_LOOK]).toBeDefined();
    }
    expect(dispositionLook("BUSY")?.hint).toBe("Call again later");
    expect(dispositionLook("MADE_UP")).toBeNull();
  });
});

describe("statuses", () => {
  it("labels contact statuses and falls back for unknown ones", () => {
    expect(contactStatusLook("do_not_contact").label).toBe("Do not contact");
    expect(contactStatusLook("something_new").label).toBe("something_new");
  });
  it("labels call statuses", () => {
    expect(CALL_STATUS_LABEL.completed).toBe("Connected");
    expect(CALL_STATUS_LABEL.no_answer).toBe("Not answered");
  });
});
