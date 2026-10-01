/**
 * The live view of calls when this app is the phone app. The Kotlin in-call service pushes a full snapshot on every change;
 * both React roots (the main app and the call screen) read it from this store. Commands go back through callControls.
 */
import { create } from 'zustand';

import { EMPTY_SNAPSHOT, telephony, type AudioRoute, type LiveCall, type LiveSnapshot } from './native';

interface LiveStore {
  snapshot: LiveSnapshot;
  /** false until the first snapshot arrived (so the call screen can tell "still loading" from "no call") */
  ready: boolean;
  apply: (snapshot: LiveSnapshot) => void;
}

export const useLiveCalls = create<LiveStore>((set, get) => ({
  snapshot: EMPTY_SNAPSHOT,
  ready: false,
  apply: (snapshot) => {
    // events and the initial read can cross each other: never go back to an older state
    if (get().ready && snapshot.ts < get().snapshot.ts) return;
    set({ snapshot, ready: true });
  },
}));

let started = false;

/** Idempotent. Call it from every React root that shows calls. */
export function startLiveCallSync(): void {
  if (started || !telephony.isAvailable()) return;
  started = true;
  telephony.onCallState((snapshot) => useLiveCalls.getState().apply(snapshot));
  telephony
    .getCallSnapshot()
    .then((snapshot) => useLiveCalls.getState().apply(snapshot))
    .catch(() => useLiveCalls.getState().apply(EMPTY_SNAPSHOT));
}

// ------------------------------------------------------------------------------------------------ selectors
export function primaryCall(s: LiveSnapshot): LiveCall | null {
  return s.calls.find((c) => c.id === s.primaryId) ?? null;
}

/** A second incoming call ringing while another one is going on. */
export function waitingCall(s: LiveSnapshot): LiveCall | null {
  return s.calls.find((c) => c.id !== s.primaryId && c.incoming && c.state === 'ringing') ?? null;
}

/** A call that is on hold while the primary one is going on. */
export function heldCall(s: LiveSnapshot): LiveCall | null {
  return s.calls.find((c) => c.id !== s.primaryId && c.state === 'holding') ?? null;
}

export function isLive(call: LiveCall): boolean {
  return call.state !== 'disconnected';
}

/** Seconds on the clock: running while connected, frozen at the end. */
export function callSeconds(call: LiveCall, now: number): number {
  if (call.connectedAtMs <= 0) return 0;
  const end = call.state === 'disconnected' && call.endedAtMs > 0 ? call.endedAtMs : now;
  return Math.max(0, Math.floor((end - call.connectedAtMs) / 1000));
}

export function statusLabel(call: LiveCall): string {
  switch (call.state) {
    case 'connecting':
      return 'Connecting…';
    case 'select_sim':
      return 'Choose a SIM';
    case 'dialing':
      return 'Dialling…';
    case 'ringing':
      return 'Incoming call';
    case 'active':
      return 'Connected';
    case 'holding':
      return 'On hold';
    case 'disconnecting':
      return 'Ending…';
    default:
      return 'Call ended';
  }
}

const ROUTE_ORDER: AudioRoute[] = ['earpiece', 'speaker', 'bluetooth', 'wired'];

/** The route a tap on the audio button should switch to (cycles through what the phone offers). */
export function nextRoute(current: AudioRoute, available: AudioRoute[]): AudioRoute {
  const usable = ROUTE_ORDER.filter((r) => available.includes(r) || r === current);
  if (usable.length < 2) return current;
  return usable[(usable.indexOf(current) + 1) % usable.length];
}

// ------------------------------------------------------------------------------------------------ commands
const send = (action: Parameters<typeof telephony.callAction>[0], callId: string | null = null, arg: string | null = null) => {
  if (!telephony.isAvailable()) return;
  void telephony.callAction(action, callId, arg).catch(() => undefined);
};

export const callControls = {
  answer: (callId?: string) => send('answer', callId ?? null),
  reject: (callId?: string) => send('reject', callId ?? null),
  hangup: (callId?: string) => send('hangup', callId ?? null),
  hold: (callId?: string) => send('hold', callId ?? null),
  unhold: (callId?: string) => send('unhold', callId ?? null),
  swap: () => send('swap'),
  setMuted: (muted: boolean) => send('mute', null, String(muted)),
  setRoute: (route: AudioRoute) => send('route', null, route),
  dtmf: (digit: string) => send('dtmf', null, digit),
  selectSim: (callId: string, accountKey: string) => send('selectSim', callId, accountKey),
  /** Close the call screen; with `toApp` the main app is brought forward (to record the outcome). */
  closeScreen: (toApp: boolean) => send('closeUi', null, toApp ? 'main' : null),
};
