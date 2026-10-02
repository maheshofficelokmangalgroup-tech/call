import { describe, expect, it } from "vitest";

import { audioFormat, describeRecording, formatBytes, isAnswered, isInProgress, recordingReportFromEvents, ringSeconds, totalSeconds } from "@/lib/call-utils";
import type { Call } from "@/lib/types";

function call(overrides: Partial<Call> = {}): Call {
  return {
    id: 1,
    answered_at: "2026-10-01T10:00:08Z",
    attempt_number: 1,
    campaign_id: null,
    client_call_id: "c-1",
    contact_id: null,
    contact_name: null,
    created_at: "2026-10-01T10:00:00Z",
    direction: "outgoing",
    disposition: null,
    disposition_at: null,
    duration_seconds: 52,
    employee_id: 3,
    ended_at: "2026-10-01T10:01:00Z",
    events: [],
    notes: [],
    phone_number: "+919876543210",
    started_at: "2026-10-01T10:00:00Z",
    status: "completed",
    updated_at: "2026-10-01T10:01:00Z",
    ...overrides,
  } as Call;
}

const recording = (upload_status: string) =>
  ({ id: 9, call_id: 1, content_type: "audio/mp4", created_at: "2026-10-01T10:01:10Z", duration_seconds: 52, failure_reason: upload_status === "failed" ? "Checksum mismatch" : null, size_bytes: 1000, uid: "u", upload_status, uploaded_at: null }) as Call["recording"];

const ended = (payload: Record<string, unknown>) => ({ id: 5, event_type: "ended", occurred_at: "2026-10-01T10:01:00Z", payload });

describe("call timing", () => {
  it("tells how long the phone rang before it was answered", () => {
    expect(ringSeconds(call())).toBe(8);
  });

  it("uses the end of the call when nobody answered", () => {
    expect(ringSeconds(call({ answered_at: null, status: "no_answer", ended_at: "2026-10-01T10:00:25Z" }))).toBe(25);
  });

  it("has no ring time while the call is still going on", () => {
    expect(ringSeconds(call({ answered_at: null, ended_at: null, status: "ringing" }))).toBeNull();
    expect(totalSeconds(call({ ended_at: null }))).toBeNull();
  });

  it("measures the whole call from dialling to hang-up", () => {
    expect(totalSeconds(call())).toBe(60);
  });

  it("knows which statuses count as answered or in progress", () => {
    expect(isAnswered("completed")).toBe(true);
    expect(isAnswered("connected")).toBe(true);
    expect(isAnswered("no_answer")).toBe(false);
    expect(isInProgress("ringing")).toBe(true);
    expect(isInProgress("connected")).toBe(true);
    expect(isInProgress("completed")).toBe(false);
  });
});

describe("what the phone said about recording", () => {
  it("reads the last report from the call's end event", () => {
    expect(recordingReportFromEvents([ended({ recording: "silent", recording_detail: "only silence" })])).toEqual({ status: "silent", detail: "only silence" });
    expect(recordingReportFromEvents([ended({ recording: "failed" }), ended({ recording: "saved" })]).status).toBe("saved");
    expect(recordingReportFromEvents([])).toEqual({ status: null, detail: null });
    expect(recordingReportFromEvents(undefined)).toEqual({ status: null, detail: null });
  });
});

describe("where is the recording of this call?", () => {
  it("offers a recording that is available", () => {
    expect(describeRecording(call({ recording: recording("available") }))).toEqual({ kind: "available", recordingId: 9 });
  });

  it("says when it is still arriving or failed to arrive", () => {
    expect(describeRecording(call({ recording: recording("uploading") })).kind).toBe("uploading");
    expect(describeRecording(call({ recording: recording("pending") })).kind).toBe("uploading");
    expect(describeRecording(call({ recording: recording("failed") }))).toEqual({ kind: "failed", detail: "Checksum mismatch" });
  });

  it("explains why an unanswered call has none", () => {
    const state = describeRecording(call({ status: "no_answer", answered_at: null }));
    expect(state).toMatchObject({ kind: "none", reason: "unanswered" });
  });

  it("explains that recording is switched off", () => {
    expect(describeRecording(call(), false)).toMatchObject({ kind: "none", reason: "disabled" });
  });

  it.each([
    ["silent", "Recorded, but silent"],
    ["no_permission", "Microphone not allowed"],
    ["failed", "The phone could not record"],
    ["saved", "Not uploaded yet"],
  ])("turns the phone's report '%s' into '%s'", (report, headline) => {
    const state = describeRecording(call({ events: [ended({ recording: report })] as Call["events"] }));
    expect(state).toMatchObject({ kind: "none", reason: report, headline });
    expect((state as { detail: string }).detail.length).toBeGreaterThan(20);
  });

  it("treats a recorder that never finished as a failure, and keeps the phone's own words", () => {
    const state = describeRecording(call({ events: [ended({ recording: "recording", recording_detail: "stopped by the system" })] as Call["events"] }));
    expect(state).toMatchObject({ reason: "failed" });
    expect((state as { detail: string }).detail).toContain("stopped by the system");
  });

  it("falls back to 'no report' for an older app", () => {
    expect(describeRecording(call())).toMatchObject({ kind: "none", reason: "unreported", headline: "No report from the phone" });
    expect(describeRecording(call({ events: [ended({ recording: "something-new" })] as Call["events"] }))).toMatchObject({ reason: "unreported" });
  });
});

describe("file facts", () => {
  it("writes sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(141_000)).toBe("138 KB");
    expect(formatBytes(3_200_000)).toBe("3.1 MB");
    expect(formatBytes(null)).toBe("-");
  });

  it("names audio formats", () => {
    expect(audioFormat("audio/mpeg")).toBe("MP3");
    expect(audioFormat("audio/mp4")).toBe("M4A");
    expect(audioFormat("audio/wav")).toBe("WAV");
    expect(audioFormat("audio/amr")).toBe("AMR");
    expect(audioFormat("audio/x-unknown")).toBe("X-UNKNOWN");
  });
});
