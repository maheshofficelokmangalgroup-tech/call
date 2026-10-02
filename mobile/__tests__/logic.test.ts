import type { LocalCall } from '../src/database/calls';
import type { ServerCall } from '../src/services/api/types';
import { mergeCalls } from '../src/services/data/callModels';
import { hasExhaustedAttempts, nextBackoffMs } from '../src/services/sync/backoff';
import { passwordStrength } from '../src/utils/password';
import { contactStatusLook, dispositionLook, DISPOSITION_LOOK } from '../src/utils/status';
import type { DispositionCode } from '../src/services/api/types';
import { newCallId, newId } from '../src/utils/ids';

// status.ts only imports the Icon *type*, so nothing native is loaded here.
jest.mock('../src/components/Icon', () => ({}));

function local(partial: Partial<LocalCall>): LocalCall {
  return {
    uuid: 'call-1', serverId: null, employeeId: 1, contactId: 10, contactName: 'Asha', phone: '+919876543210', campaignId: null,
    startedAt: 1000, answeredAt: null, endedAt: null, durationSec: 0, status: 'initiated', disposition: null, notes: null,
    callbackAt: null, callbackNote: null, wrapupDone: false, reconciled: false, recordingState: null, recordingUri: null,
    recordingMime: null, recordingSize: null, recordingServerId: null, recordingError: null, createdAt: 1000, updatedAt: 1000,
    ...partial,
  };
}

function server(partial: Partial<ServerCall>): ServerCall {
  return {
    id: 1, client_call_id: 'other', employee_id: 1, contact_id: 10, contact_name: 'Asha', phone_number: '+919876543210', campaign_id: null,
    attempt_number: 1, started_at: new Date(2000).toISOString(), answered_at: null, ended_at: null, duration_seconds: 0, status: 'no_answer',
    disposition: null, disposition_at: null, recording: null, callback_at: null, notes: [], events: [],
    ...partial,
  } as ServerCall;
}

describe('mergeCalls', () => {
  it('recognises the phone-local copy of a server call and prefers it', () => {
    const rows = mergeCalls(
      [local({ uuid: 'abc', serverId: 7, startedAt: 5000, status: 'completed', durationSec: 60, disposition: 'CONNECTED', wrapupDone: true })],
      [server({ id: 7, client_call_id: 'abc', started_at: new Date(5000).toISOString() }), server({ id: 8, client_call_id: 'from-other-phone', started_at: new Date(9000).toISOString() })],
      new Set(),
    );
    expect(rows.map((r) => r.key)).toEqual(['s8', 'abc']); // newest first, no duplicate of call 7
    expect(rows[1].durationSec).toBe(60);
    expect(rows[1].synced).toBe(true);
  });

  it('flags calls that still have work in the sync queue and calls missing an outcome', () => {
    const [row] = mergeCalls([local({ uuid: 'x', serverId: 3, status: 'no_answer' })], [], new Set(['x']));
    expect(row.synced).toBe(false);
    expect(row.needsOutcome).toBe(true);
    const [failed] = mergeCalls([local({ uuid: 'y', status: 'failed', wrapupDone: true })], [], new Set());
    expect(failed.needsOutcome).toBe(false);
    expect(failed.synced).toBe(false); // never reached the server
  });
});

describe('sync backoff', () => {
  it('grows exponentially with jitter and caps at 15 minutes', () => {
    const fixed = () => 0.5; // jitter factor 1.0
    expect(nextBackoffMs(0, fixed)).toBe(5_000);
    expect(nextBackoffMs(1, fixed)).toBe(10_000);
    expect(nextBackoffMs(3, fixed)).toBe(40_000);
    expect(nextBackoffMs(20, fixed)).toBe(15 * 60_000);
    expect(nextBackoffMs(2, () => 0)).toBe(Math.round(20_000 * 0.75));
    expect(nextBackoffMs(2, () => 1)).toBe(Math.round(20_000 * 1.25));
  });
  it('gives up after a fixed number of attempts', () => {
    expect(hasExhaustedAttempts(3)).toBe(false);
    expect(hasExhaustedAttempts(12)).toBe(true);
  });
});

describe('passwordStrength', () => {
  it('rates typical passwords', () => {
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('abc')).toBe(1);
    expect(passwordStrength('abcdefgh')).toBe(1);
    expect(passwordStrength('abcdefg1')).toBe(2);
    expect(passwordStrength('Abcdefg1')).toBe(3);
    expect(passwordStrength('Abcdefg1!')).toBe(4);
  });
});

// The outcomes the server's reference data defines (the app itself keeps no list: it downloads it).
const SERVER_OUTCOMES: DispositionCode[] = [
  'CONNECTED', 'NO_ANSWER', 'BUSY', 'SWITCHED_OFF', 'INVALID_NUMBER', 'INTERESTED', 'NOT_INTERESTED', 'CALLBACK', 'FOLLOW_UP', 'COMPLETED', 'DO_NOT_CONTACT',
];

describe('outcome presentation', () => {
  it('has a look for every disposition the server can return', () => {
    for (const code of SERVER_OUTCOMES) {
      expect(DISPOSITION_LOOK[code]).toBeDefined();
      expect(dispositionLook(code)?.icon).toBeTruthy();
    }
    expect(dispositionLook(null)).toBeNull();
    expect(dispositionLook('SOMETHING_NEW')).toBeNull();
  });
  it('labels contact statuses', () => {
    expect(contactStatusLook('do_not_contact').label).toBe('Do not contact');
    expect(contactStatusLook('weird').label).toBe('weird');
  });
});

describe('client generated ids', () => {
  it('are unique and usable as idempotency keys', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newCallId()));
    expect(ids.size).toBe(500);
    expect(newId('x')).toMatch(/^x-[a-z0-9]+-[a-z0-9]{10}$/);
    expect(newCallId()).toMatch(/^[A-Za-z0-9_.:-]{8,64}$/); // accepted by the server's client_call_id rule
  });
});
