import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import {
  NO_DIALER_KEY,
  allowedTalkSeconds,
  callErrorMessage,
  cancelCall,
  clearActiveCall,
  getActiveCall,
  isPlainDial,
  markCallEnded,
  placeCall,
  setActiveCall,
  submitOutcome,
  telHref,
  type ActiveCall,
} from "@/lib/callFlow";

const api = vi.hoisted(() => ({
  createCall: vi.fn(),
  addCallEvents: vi.fn(),
  setDisposition: vi.fn(),
}));
vi.mock("@/lib/endpoints", () => ({ api }));

const START = Date.parse("2026-10-03T06:30:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  api.addCallEvents.mockResolvedValue({ added: 1 });
  api.setDisposition.mockResolvedValue({ id: 5 });
});

describe("dialing", () => {
  it("builds a tel link from a formatted number", () => {
    expect(telHref("+91 98765 43210")).toBe("tel:+919876543210");
    expect(telHref("+1 (415) 555-0117")).toBe("tel:+14155550117");
    expect(telHref("*#06#")).toBe("tel:*#06#");
  });
  it("leaves emergency numbers and keypad codes to the phone", () => {
    expect(isPlainDial("112")).toBe(true);
    expect(isPlainDial("100")).toBe(true);
    expect(isPlainDial("*#06#")).toBe(true);
    expect(isPlainDial("98765")).toBe(false);
    expect(isPlainDial("9876543210")).toBe(false);
    expect(isPlainDial("1")).toBe(false);
  });
  it("has a switch for browser tests", () => {
    expect(NO_DIALER_KEY).toBe("ec_web_no_dialer");
  });
});

describe("the call in progress", () => {
  const call: ActiveCall = { callId: 7, clientCallId: "abc-12345678", contactId: 3, name: "Amit More", phone: "+14155550117", startedAt: Date.now() - 60_000, endedAt: null };

  it("is remembered between pages and reloads", () => {
    expect(getActiveCall()).toBeNull();
    setActiveCall(call);
    expect(getActiveCall()).toEqual(call);
    clearActiveCall();
    expect(getActiveCall()).toBeNull();
  });
  it("remembers when the call was ended, once", () => {
    setActiveCall(call);
    const ended = markCallEnded(call, 1_000);
    expect(ended.endedAt).toBe(1_000);
    expect(markCallEnded(ended, 9_000).endedAt).toBe(1_000);
    expect(getActiveCall()?.endedAt).toBe(1_000);
  });
  it("forgets a call that has been open for hours", () => {
    setActiveCall({ ...call, startedAt: Date.now() - 5 * 3600_000 });
    expect(getActiveCall()).toBeNull();
    expect(localStorage.getItem("ec_web_active_call")).toBeNull();
  });
  it("ignores a broken record", () => {
    localStorage.setItem("ec_web_active_call", "{oops");
    expect(getActiveCall()).toBeNull();
  });
});

describe("placing a call", () => {
  it("registers a call to a contact and remembers it", async () => {
    api.createCall.mockResolvedValue({ id: 11, contact_id: 3, contact_name: "Amit More", phone_number: "+14155550117", started_at: new Date(START).toISOString() });
    const active = await placeCall({ contactId: 3, contactName: "Amit More", phone: "+14155550117", campaignId: 2 }, START);
    const body = api.createCall.mock.calls[0][0];
    expect(body).toMatchObject({ contact_id: 3, campaign_id: 2, started_at: new Date(START).toISOString() });
    expect(body.phone_number).toBeUndefined(); // the server dials the contact's stored number
    expect(body.client_call_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(active).toMatchObject({ callId: 11, contactId: 3, name: "Amit More", endedAt: null, startedAt: START });
    expect(getActiveCall(START)).toMatchObject({ callId: 11 });
    // the timeline shows the call was dialled from the web app
    expect(api.addCallEvents).toHaveBeenCalledWith(11, [expect.objectContaining({ event_type: "dialing", payload: { source: "web_app" } })]);
  });

  it("sends a typed number as typed", async () => {
    api.createCall.mockResolvedValue({ id: 12, contact_id: null, contact_name: null, phone_number: "+919876543210", started_at: new Date(START).toISOString() });
    const active = await placeCall({ phone: "9876543210" }, START);
    expect(api.createCall.mock.calls[0][0]).toMatchObject({ contact_id: null, phone_number: "9876543210" });
    expect(active.name).toBe("9876543210");
    expect(active.phone).toBe("+919876543210");
  });

  it("does not remember a call the server refused", async () => {
    api.createCall.mockRejectedValue(new ApiError(409, "contact_do_not_contact", "no"));
    await expect(placeCall({ contactId: 3, phone: "+14155550117" }, START)).rejects.toBeInstanceOf(ApiError);
    expect(getActiveCall()).toBeNull();
  });

  it("can be cancelled when the number was never dialled", async () => {
    setActiveCall({ callId: 11, clientCallId: "abc-12345678", contactId: 3, name: "A", phone: "+1", startedAt: START, endedAt: null });
    await cancelCall(getActiveCall(START)!, START + 5_000);
    expect(getActiveCall(START)).toBeNull();
    expect(api.addCallEvents).toHaveBeenCalledWith(11, [expect.objectContaining({ event_type: "failed", payload: { reason: "not_placed", source: "web_app" } })]);
  });

  it("explains the errors an employee can fix", () => {
    expect(callErrorMessage(new ApiError(409, "contact_do_not_contact", "x"))).toMatch(/not to be called/);
    expect(callErrorMessage(new ApiError(422, "bad_started_at", "x"))).toMatch(/clock/);
    expect(callErrorMessage(new ApiError(422, "invalid_phone", "x"))).toMatch(/valid phone number/);
    expect(callErrorMessage(new ApiError(500, "boom", "Server said no"))).toBe("Server said no");
    expect(callErrorMessage(new Error("Oops"))).toBe("Oops");
  });
});

describe("recording the outcome", () => {
  const call = { id: 11, started_at: new Date(START).toISOString() };

  it("limits the talk time to the time the call took (plus the server's margin)", () => {
    expect(allowedTalkSeconds(START, START + 120_000, 90)).toBe(90);
    expect(allowedTalkSeconds(START, START + 120_000, 500)).toBe(150);
    expect(allowedTalkSeconds(START, START + 120_000, -5)).toBe(0);
    expect(allowedTalkSeconds(START, START, 10)).toBe(10);
  });

  it("reports an answered call with its talk time", async () => {
    await submitOutcome(call, { code: "CONNECTED", notes: "  Feedback: Supportive\nWants details  ", callbackAt: null, talkSeconds: 90, endedAt: START + 120_000 });
    const events = api.addCallEvents.mock.calls[0][1];
    expect(events.map((e: { event_type: string }) => e.event_type)).toEqual(["connected", "ended"]);
    expect(events[0].occurred_at).toBe(new Date(START + 30_000).toISOString()); // answered 90 s before it ended
    expect(events[1]).toMatchObject({ occurred_at: new Date(START + 120_000).toISOString(), payload: { source: "web_app", recording: "web" } });
    expect(api.setDisposition).toHaveBeenCalledWith(11, {
      disposition_code: "CONNECTED",
      notes: "Feedback: Supportive\nWants details",
      callback_at: null,
      note_client_ref: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it("reports an unanswered call without a talk time, whatever was typed", async () => {
    await submitOutcome(call, { code: "NO_ANSWER", notes: "", callbackAt: null, talkSeconds: 45, endedAt: START + 20_000 });
    expect(api.addCallEvents.mock.calls[0][1].map((e: { event_type: string }) => e.event_type)).toEqual(["ended"]);
    expect(api.setDisposition.mock.calls[0][1]).toMatchObject({ disposition_code: "NO_ANSWER", notes: null });
  });

  it("never dates the answer before the call began, even for an impossible talk time", async () => {
    await submitOutcome(call, { code: "CONNECTED", notes: "", callbackAt: null, talkSeconds: 9_999, endedAt: START + 60_000 });
    const connected = api.addCallEvents.mock.calls[0][1][0];
    expect(connected.event_type).toBe("connected");
    expect(connected.occurred_at).toBe(new Date(START).toISOString());
  });

  it("sends a callback time as an instant", async () => {
    const at = START + 3 * 3600_000;
    await submitOutcome(call, { code: "BUSY", notes: "", callbackAt: at, talkSeconds: 0, endedAt: START + 10_000 });
    expect(api.setDisposition.mock.calls[0][1].callback_at).toBe(new Date(at).toISOString());
  });

  it("never reports the call as ending before it started", async () => {
    await submitOutcome(call, { code: "NO_ANSWER", notes: "", callbackAt: null, talkSeconds: 0, endedAt: START - 5_000 });
    expect(api.addCallEvents.mock.calls[0][1][0].occurred_at).toBe(new Date(START).toISOString());
  });
});
