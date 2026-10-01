import { suggestDisposition } from '../src/services/telephony/callOutcome';
import { callSeconds, heldCall, nextRoute, primaryCall, statusLabel, waitingCall, useLiveCalls } from '../src/services/telephony/liveCalls';
import { EMPTY_SNAPSHOT, type LiveCall, type LiveSnapshot } from '../src/services/telephony/native';

const call = (patch: Partial<LiveCall> = {}): LiveCall => ({
  id: 'c1',
  number: '+919876543210',
  name: null,
  subtitle: null,
  incoming: false,
  state: 'dialing',
  addedAtMs: 1_000,
  connectedAtMs: 0,
  endedAtMs: 0,
  sessionId: null,
  recording: 'off',
  hd: false,
  wifi: false,
  canHold: true,
  account: null,
  causeCode: -1,
  causeReason: null,
  sims: [],
  ...patch,
});

const snapshot = (calls: LiveCall[], primaryId: string | null, ts = 10): LiveSnapshot => ({ ...EMPTY_SNAPSHOT, calls, primaryId, ts });

describe('call selectors', () => {
  it('finds the primary, the waiting (ringing) and the held call', () => {
    const active = call({ id: 'a', state: 'active', connectedAtMs: 5_000 });
    const ringing = call({ id: 'r', state: 'ringing', incoming: true });
    const held = call({ id: 'h', state: 'holding' });
    const s = snapshot([active, ringing, held], 'a');
    expect(primaryCall(s)?.id).toBe('a');
    expect(waitingCall(s)?.id).toBe('r');
    expect(heldCall(s)?.id).toBe('h');
  });

  it('a ringing call that is the primary is not "waiting"', () => {
    const ringing = call({ id: 'r', state: 'ringing', incoming: true });
    expect(waitingCall(snapshot([ringing], 'r'))).toBeNull();
  });
});

describe('callSeconds / statusLabel', () => {
  it('counts from the connect time while connected and freezes when the call ended', () => {
    expect(callSeconds(call({ state: 'dialing' }), 20_000)).toBe(0);
    expect(callSeconds(call({ state: 'active', connectedAtMs: 10_000 }), 75_900)).toBe(65);
    expect(callSeconds(call({ state: 'disconnected', connectedAtMs: 10_000, endedAtMs: 40_000 }), 99_000)).toBe(30);
    expect(callSeconds(call({ state: 'disconnected', connectedAtMs: 0, endedAtMs: 40_000 }), 99_000)).toBe(0);
  });

  it('describes every state in plain words', () => {
    expect(statusLabel(call({ state: 'dialing' }))).toBe('Dialling…');
    expect(statusLabel(call({ state: 'ringing' }))).toBe('Incoming call');
    expect(statusLabel(call({ state: 'holding' }))).toBe('On hold');
    expect(statusLabel(call({ state: 'disconnected' }))).toBe('Call ended');
  });
});

describe('nextRoute', () => {
  it('toggles phone <-> speaker when nothing else is connected', () => {
    expect(nextRoute('earpiece', ['earpiece', 'speaker'])).toBe('speaker');
    expect(nextRoute('speaker', ['earpiece', 'speaker'])).toBe('earpiece');
  });

  it('cycles through bluetooth when it is available', () => {
    const routes = ['earpiece', 'speaker', 'bluetooth'] as const;
    expect(nextRoute('speaker', [...routes])).toBe('bluetooth');
    expect(nextRoute('bluetooth', [...routes])).toBe('earpiece');
  });
});

describe('live store', () => {
  it('ignores an older snapshot that arrives after a newer one', () => {
    const store = useLiveCalls.getState();
    store.apply(snapshot([call({ id: 'new' })], 'new', 50));
    store.apply(snapshot([], null, 40));
    expect(useLiveCalls.getState().snapshot.primaryId).toBe('new');
    store.apply(snapshot([], null, 60));
    expect(useLiveCalls.getState().snapshot.primaryId).toBeNull();
  });
});

describe('suggestDisposition', () => {
  it('suggests Connected for an answered call', () => {
    expect(suggestDisposition({ answered: true, causeCode: 3, causeReason: null })).toBe('CONNECTED');
  });

  it('maps the reason the phone gave to a sensible outcome', () => {
    expect(suggestDisposition({ answered: false, causeCode: 7, causeReason: null })).toBe('BUSY');
    expect(suggestDisposition({ answered: false, causeCode: 3, causeReason: 'BUSY' })).toBe('BUSY');
    expect(suggestDisposition({ answered: false, causeCode: 1, causeReason: 'UNOBTAINABLE_NUMBER' })).toBe('INVALID_NUMBER');
    expect(suggestDisposition({ answered: false, causeCode: 1, causeReason: 'POWER_OFF' })).toBe('SWITCHED_OFF');
    expect(suggestDisposition({ answered: false, causeCode: 1, causeReason: 'OUT_OF_SERVICE' })).toBe('SWITCHED_OFF');
  });

  it('defaults to No answer (rejected, missed, cancelled, unknown)', () => {
    expect(suggestDisposition({ answered: false, causeCode: 6, causeReason: null })).toBe('NO_ANSWER');
    expect(suggestDisposition({ answered: false, causeCode: 4, causeReason: 'OUTGOING_CANCELED' })).toBe('NO_ANSWER');
    expect(suggestDisposition({ answered: false, causeCode: -1, causeReason: null })).toBe('NO_ANSWER');
  });
});
