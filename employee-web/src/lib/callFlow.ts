/**
 * Placing a call from the browser and recording how it went.
 *
 * A browser cannot dial through a SIM, so "Call" registers the attempt with the server and then hands the number to the
 * device's own phone app (a tel: link). The employee comes back, says the call is over and records the outcome - the same steps
 * as in the phone app, minus the automatic call detection and the recording.
 */
import { ApiError } from "./api";
import { api } from "./endpoints";
import { newId } from "./ids";
import { clamp } from "./format";
import { parseIso } from "./time";
import type { DispositionCode, ServerCall } from "./types";

// ------------------------------------------------------------------ the call in progress
export interface ActiveCall {
  callId: number;
  clientCallId: string;
  contactId: number | null;
  name: string;
  phone: string;
  startedAt: number;
  /** set when the employee says the call is over */
  endedAt: number | null;
}

const ACTIVE_KEY = "ec_web_active_call";
/** A call still marked "in progress" after this long was abandoned; it stays on Home as "waiting for an outcome". */
const ACTIVE_MAX_AGE_MS = 4 * 60 * 60 * 1000;

export function getActiveCall(now = Date.now()): ActiveCall | null {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const call = JSON.parse(raw) as ActiveCall;
    if (typeof call.callId !== "number" || typeof call.startedAt !== "number") return null;
    if (now - call.startedAt > ACTIVE_MAX_AGE_MS) {
      clearActiveCall();
      return null;
    }
    return { ...call, endedAt: call.endedAt ?? null };
  } catch {
    return null;
  }
}

export function setActiveCall(call: ActiveCall): void {
  try {
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(call));
  } catch {
    /* storage blocked: the call still works, it just cannot be resumed after a reload */
  }
}

export function clearActiveCall(): void {
  try {
    localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}

/** The employee says the call is over: remember when. */
export function markCallEnded(call: ActiveCall, now = Date.now()): ActiveCall {
  const ended = { ...call, endedAt: call.endedAt ?? now };
  setActiveCall(ended);
  return ended;
}

// ------------------------------------------------------------------ dialing
/** "+91 98765 43210" -> "tel:+919876543210". Keypad characters (* and #) are kept. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+*#]/g, "")}`;
}

/**
 * Set by the browser tests: a headless browser cannot answer the "open this app?" prompt a tel: link raises, and the prompt
 * stops the page from receiving clicks.
 */
export const NO_DIALER_KEY = "ec_web_no_dialer";

/** Hand the number to the device's phone app. */
export function openDialer(phone: string): void {
  try {
    if (localStorage.getItem(NO_DIALER_KEY) === "1") return;
  } catch {
    /* storage blocked: dial as usual */
  }
  window.location.href = telHref(phone);
}

/** Numbers the phone itself must dial: emergency services and keypad codes are never a CRM call. */
const EMERGENCY = new Set(["100", "101", "102", "108", "112", "911", "999"]);

export function isPlainDial(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return /[*#]/.test(value) || (digits.length >= 2 && digits.length <= 6 && EMERGENCY.has(digits));
}

export interface StartCallInput {
  contactId?: number | null;
  contactName?: string | null;
  phone: string;
  campaignId?: number | null;
}

/** Register the attempt with the server and remember it as the call in progress. */
export async function placeCall(input: StartCallInput, now = Date.now()): Promise<ActiveCall> {
  const clientCallId = newId();
  const call = await api.createCall({
    client_call_id: clientCallId,
    contact_id: input.contactId ?? null,
    // with a contact the server dials its stored number; a typed number is sent as typed and normalised by the server
    phone_number: input.contactId ? undefined : input.phone,
    campaign_id: input.campaignId ?? null,
    started_at: new Date(now).toISOString(),
  });
  const active: ActiveCall = {
    callId: call.id,
    clientCallId,
    contactId: call.contact_id,
    name: call.contact_name ?? input.contactName ?? input.phone,
    phone: call.phone_number || input.phone,
    startedAt: parseIso(call.started_at) ?? now,
    endedAt: null,
  };
  setActiveCall(active);
  // best effort: the timeline of the call shows that it was dialled from the web app
  void api.addCallEvents(call.id, [{ event_type: "dialing", occurred_at: new Date(active.startedAt).toISOString(), payload: { source: "web_app" } }]).catch(() => undefined);
  return active;
}

/** The employee did not actually dial: close the attempt so it does not wait for an outcome. */
export async function cancelCall(call: ActiveCall, now = Date.now()): Promise<void> {
  clearActiveCall();
  await api.addCallEvents(call.callId, [{ event_type: "failed", occurred_at: new Date(Math.max(now, call.startedAt)).toISOString(), payload: { reason: "not_placed", source: "web_app" } }]);
}

export function callErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "contact_do_not_contact":
        return "This contact asked not to be called.";
      case "bad_started_at":
        return "This computer's clock looks wrong. Turn on automatic date and time, then try again.";
      case "invalid_phone":
        return "Enter a valid phone number.";
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : "The call could not be started.";
}

// ------------------------------------------------------------------ the outcome
export interface OutcomeInput {
  code: DispositionCode;
  notes: string;
  /** when to call back (ms), for outcomes that need it */
  callbackAt: number | null;
  /** talk time in seconds (only used for a connected call) */
  talkSeconds: number;
  /** when the call ended (ms); defaults to now */
  endedAt?: number | null;
}

/** The talk time the server will accept: no longer than the time between starting and ending the call (plus its 30 s margin). */
export function allowedTalkSeconds(startedAt: number, endedAt: number, wanted: number): number {
  const window = Math.max(0, Math.floor((endedAt - startedAt) / 1000)) + 30;
  return clamp(Math.floor(wanted), 0, window);
}

/**
 * Report the end of the call and its outcome. Safe to repeat after a failure: the events carry fixed timestamps and the server
 * ignores duplicates, and recording the same outcome twice is a no-op there.
 */
export async function submitOutcome(call: Pick<ServerCall, "id" | "started_at">, input: OutcomeInput): Promise<ServerCall> {
  const startedAt = parseIso(call.started_at) ?? Date.now();
  const endedAt = Math.max(input.endedAt ?? Date.now(), startedAt);
  const talk = input.code === "CONNECTED" ? allowedTalkSeconds(startedAt, endedAt, input.talkSeconds) : 0;

  const events: Parameters<typeof api.addCallEvents>[1] = [];
  // answered `talk` seconds before the end - but never before the call began (the allowed talk time carries a 30 s margin)
  if (talk > 0) events.push({ event_type: "connected", occurred_at: new Date(Math.max(startedAt, endedAt - talk * 1000)).toISOString(), payload: { source: "web_app" } });
  // "recording: web" is how reports explain why this call has no recording (a browser cannot record a phone call)
  events.push({ event_type: "ended", occurred_at: new Date(endedAt).toISOString(), payload: { source: "web_app", recording: "web" } });
  await api.addCallEvents(call.id, events);

  return api.setDisposition(call.id, {
    disposition_code: input.code,
    notes: input.notes.trim() || null,
    callback_at: input.callbackAt !== null ? new Date(input.callbackAt).toISOString() : null,
    note_client_ref: newId(),
  });
}
