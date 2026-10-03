import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OutcomeScreen } from "@/screens/OutcomeScreen";

const submit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/callFlow", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/callFlow")>()), submitOutcome: submit }));

const server = vi.hoisted(() => ({
  call: null as unknown,
  dispositions: ["CONNECTED", "NO_ANSWER", "BUSY", "SWITCHED_OFF", "INVALID_NUMBER", "INTERESTED", "NOT_INTERESTED", "CALLBACK", "FOLLOW_UP", "COMPLETED", "DO_NOT_CONTACT"].map((code, i) => ({
    id: i + 1,
    code,
    label: code === "BUSY" ? "Busy" : code.replace(/_/g, " "),
    category: i === 0 ? "connected" : "not_connected",
    requires_callback: code === "CALLBACK" || code === "FOLLOW_UP",
    sort_order: i + 1,
  })),
}));

vi.mock("@/lib/auth", () => ({
  useSession: () => ({ employee: { id: 1, full_name: "Employee 001" }, config: { dispositions: server.dispositions } }),
}));

vi.mock("@/lib/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries")>()),
  useCall: () => ({ data: server.call, isError: false, error: null }),
  useQueue: () => ({ data: { items: [{ contact: { id: 99, name: "Next Person" } }], total: 1, dueCallbacks: 0 } }),
}));

const STARTED = Date.now() - 125_000;

function showOutcome() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/outcome/5"]}>
        <Routes>
          <Route path="/outcome/:id" element={<OutcomeScreen />} />
          <Route path="*" element={<div>somewhere else</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

/** What the in-call page leaves behind when the employee presses "Call ended". */
function callEndedJustNow() {
  localStorage.setItem("ec_web_active_call", JSON.stringify({ callId: 5, clientCallId: "abc-12345678", contactId: 3, name: "Amit More", phone: "+14155550117", startedAt: STARTED, endedAt: STARTED + 120_000 }));
}

beforeEach(() => {
  vi.clearAllMocks();
  submit.mockResolvedValue({ id: 5 });
  server.call = {
    id: 5,
    started_at: new Date(STARTED).toISOString(),
    contact_id: 3,
    contact_name: "Amit More",
    phone_number: "+14155550117",
    disposition: null,
    status: "initiated",
  };
});

describe("outcome page", () => {
  it("offers four outcomes and calls Busy 'Call Back'", () => {
    callEndedJustNow();
    showOutcome();
    for (const code of ["CONNECTED", "NO_ANSWER", "BUSY", "SWITCHED_OFF"]) expect(screen.getByTestId(`disposition-${code}`)).toBeInTheDocument();
    expect(screen.getByTestId("disposition-BUSY")).toHaveTextContent("Call Back");
    for (const code of ["INVALID_NUMBER", "INTERESTED", "NOT_INTERESTED", "CALLBACK", "FOLLOW_UP", "COMPLETED", "DO_NOT_CONTACT"]) {
      expect(screen.queryByTestId(`disposition-${code}`)).toBeNull();
    }
  });

  it("shows feedback and talk time only for a connected call", async () => {
    callEndedJustNow();
    const user = showOutcome();
    expect(screen.queryByTestId("feedback-supportive")).toBeNull();
    expect(screen.queryByTestId("talk-time")).toBeNull();

    await user.click(screen.getByTestId("disposition-CONNECTED"));
    for (const key of ["supportive", "neutral", "negative"]) expect(screen.getByTestId(`feedback-${key}`)).toBeInTheDocument();
    expect(screen.getByTestId("talk-time")).toBeInTheDocument();

    await user.click(screen.getByTestId("disposition-NO_ANSWER"));
    expect(screen.queryByTestId("feedback-supportive")).toBeNull();
    expect(screen.queryByTestId("talk-time")).toBeNull();
  });

  it("cannot be saved before an outcome is chosen", () => {
    callEndedJustNow();
    showOutcome();
    expect(screen.getByTestId("outcome-save")).toBeDisabled();
    expect(screen.getByTestId("outcome-save-next")).toBeDisabled();
  });

  it("saves a connected call with its feedback, notes and the time on the clock", async () => {
    callEndedJustNow();
    const user = showOutcome();
    await user.click(screen.getByTestId("disposition-CONNECTED"));
    await user.click(screen.getByTestId("feedback-supportive"));
    await user.type(screen.getByTestId("outcome-notes"), "Wants the festival offer");
    await user.click(screen.getByTestId("outcome-save"));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const [call, input] = submit.mock.calls[0];
    expect(call).toBe(server.call);
    expect(input).toMatchObject({ code: "CONNECTED", notes: "Feedback: Supportive\nWants the festival offer", callbackAt: null, endedAt: STARTED + 120_000 });
    expect(input.talkSeconds).toBe(120); // the clock ran from the start to "Call ended"
    expect(await screen.findByTestId("saved")).toBeInTheDocument();
  });

  it("lets the feedback be taken back, and drops it when the outcome changes", async () => {
    callEndedJustNow();
    const user = showOutcome();
    await user.click(screen.getByTestId("disposition-CONNECTED"));
    await user.click(screen.getByTestId("feedback-negative"));
    await user.click(screen.getByTestId("feedback-negative")); // press again: none
    await user.click(screen.getByTestId("feedback-neutral"));
    await user.click(screen.getByTestId("disposition-NO_ANSWER"));
    await user.click(screen.getByTestId("outcome-save"));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0][1]).toMatchObject({ code: "NO_ANSWER", notes: "", talkSeconds: 0 });
  });

  it("uses the typed talk time instead of the clock", async () => {
    callEndedJustNow();
    const user = showOutcome();
    await user.click(screen.getByTestId("disposition-CONNECTED"));
    await user.clear(screen.getByTestId("talk-min"));
    await user.type(screen.getByTestId("talk-min"), "1");
    await user.clear(screen.getByTestId("talk-sec"));
    await user.type(screen.getByTestId("talk-sec"), "10");
    await user.click(screen.getByTestId("outcome-save"));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0][1].talkSeconds).toBe(70);
  });

  it("starts a call that was left waiting with no talk time and ends it when the talk was over", async () => {
    // no record from the in-call page: the employee came back from the reminder on Home
    const user = showOutcome();
    expect(screen.getByText("Call waiting for an outcome")).toBeInTheDocument();
    await user.click(screen.getByTestId("disposition-CONNECTED"));
    expect(screen.getByTestId("talk-min")).toHaveValue(0);
    expect(screen.getByTestId("talk-sec")).toHaveValue(0);
    await user.clear(screen.getByTestId("talk-min"));
    await user.type(screen.getByTestId("talk-min"), "2");
    await user.click(screen.getByTestId("outcome-save"));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    const input = submit.mock.calls[0][1];
    expect(input.talkSeconds).toBe(120);
    expect(input.endedAt).toBe(STARTED + 120_000); // started + the talk time, not "now"
  });

  it("goes to the call's page when its outcome was already recorded elsewhere", () => {
    server.call = { ...(server.call as object), disposition: { code: "CONNECTED", label: "Connected", category: "connected" } };
    showOutcome();
    expect(screen.getByText("somewhere else")).toBeInTheDocument();
  });

  it("keeps the page and says so when saving fails", async () => {
    callEndedJustNow();
    submit.mockRejectedValueOnce(new Error("offline"));
    const user = showOutcome();
    await user.click(screen.getByTestId("disposition-NO_ANSWER"));
    await user.click(screen.getByTestId("outcome-save"));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("outcome-save")).not.toBeDisabled());
    expect(screen.queryByTestId("saved")).toBeNull();
    expect(screen.getByTestId("outcome")).toBeInTheDocument();
  });
});
