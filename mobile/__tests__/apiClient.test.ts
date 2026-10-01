/**
 * The HTTP client: error model, automatic token refresh (single flight), offline detection.
 */
import * as Keychain from 'react-native-keychain';

import { ApiError, NetworkError, http, isTransient, normalizeServerUrl, setBaseUrl, setSessionEndedHandler } from '../src/services/api/client';
import { loadTokens, saveTokens } from '../src/services/storage/secureTokens';

jest.mock('react-native-keychain', () => {
  let stored: { username: string; password: string } | false = false;
  return {
    getGenericPassword: jest.fn(async () => stored),
    setGenericPassword: jest.fn(async (username: string, password: string) => {
      stored = { username, password };
      return { service: 'x', storage: 'keychain' };
    }),
    resetGenericPassword: jest.fn(async () => {
      stored = false;
      return true;
    }),
  };
});

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };
const calls: { url: string; init: RequestInit }[] = [];
let queue: (Reply | Error)[] = [];

function reply(status: number, body?: unknown, headers: Record<string, string> = {}): Reply {
  return { status, body, headers };
}

beforeEach(async () => {
  calls.length = 0;
  queue = [];
  setBaseUrl('http://api.test');
  setSessionEndedHandler(() => undefined);
  await Keychain.resetGenericPassword();
  jest.resetModules();
  (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request ${url}`);
    if (next instanceof Error) throw next;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      headers: { get: (name: string) => next.headers?.[name] ?? null },
      json: async () => next.body,
    } as unknown as Response;
  });
});

async function signInWithExpiry(expiresInMs: number) {
  await saveTokens({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() + expiresInMs });
}

const pair = (n: number) => ({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, token_type: 'bearer', expires_in: 900, must_change_password: false, employee: {} });

describe('normalizeServerUrl', () => {
  it('adds a scheme and strips trailing slashes and /api/v1', () => {
    expect(normalizeServerUrl('192.168.1.5:8000')).toBe('http://192.168.1.5:8000');
    expect(normalizeServerUrl('https://api.company.com/')).toBe('https://api.company.com');
    expect(normalizeServerUrl('http://10.0.2.2:8000/api/v1')).toBe('http://10.0.2.2:8000');
  });
});

describe('requests', () => {
  it('sends the bearer token and parses JSON', async () => {
    await signInWithExpiry(600_000);
    queue.push(reply(200, { hello: 'world' }));
    const result = await http.get<{ hello: string }>('/me', { q: 'a b', skip: undefined });
    expect(result).toEqual({ hello: 'world' });
    expect(calls[0].url).toBe('http://api.test/api/v1/me?q=a%20b');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer access-1');
  });

  it('maps the uniform error body to ApiError', async () => {
    await signInWithExpiry(600_000);
    queue.push(reply(409, { error: { code: 'disposition_already_set', message: 'Already recorded', details: { x: 1 } } }));
    await expect(http.post('/calls/1/disposition', {})).rejects.toMatchObject({ name: 'ApiError', status: 409, code: 'disposition_already_set', message: 'Already recorded' });
  });

  it('exposes Retry-After for rate limiting', async () => {
    queue.push(reply(429, { error: { code: 'rate_limited', message: 'Slow down' } }, { 'Retry-After': '42' }));
    const error = (await http.post('/auth/login', {}, { auth: false }).catch((e) => e)) as ApiError;
    expect(error.retryAfter).toBe(42);
    expect(isTransient(error)).toBe(true);
  });

  it('reports connectivity problems as NetworkError', async () => {
    await signInWithExpiry(600_000);
    queue.push(new TypeError('Network request failed'));
    const error = await http.get('/queue').catch((e) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(isTransient(error)).toBe(true);
  });

  it('classifies which errors are worth retrying', () => {
    expect(isTransient(new ApiError(500, 'internal_error', 'x'))).toBe(true);
    expect(isTransient(new ApiError(503, 'x', 'x'))).toBe(true);
    expect(isTransient(new ApiError(404, 'not_found', 'x'))).toBe(false);
    expect(isTransient(new ApiError(422, 'validation_error', 'x'))).toBe(false);
    expect(isTransient(new Error('boom'))).toBe(false);
  });
});

describe('token refresh', () => {
  it('refreshes once on token_expired and replays the request with the new token', async () => {
    await signInWithExpiry(600_000);
    queue.push(reply(401, { error: { code: 'token_expired', message: 'expired' } }));
    queue.push(reply(200, pair(2))); // /auth/refresh
    queue.push(reply(200, { ok: true }));
    const result = await http.get<{ ok: boolean }>('/queue');
    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.url.replace('http://api.test/api/v1', ''))).toEqual(['/queue', '/auth/refresh', '/queue']);
    expect((calls[2].init.headers as Record<string, string>).Authorization).toBe('Bearer access-2');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ refresh_token: 'refresh-1' });
    expect((await loadTokens())?.refreshToken).toBe('refresh-2'); // rotated token persisted
  });

  it('refreshes proactively when the access token is about to expire', async () => {
    await signInWithExpiry(5_000);
    queue.push(reply(200, pair(2)));
    queue.push(reply(200, { ok: true }));
    await http.get('/me');
    expect(calls[0].url).toContain('/auth/refresh');
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer access-2');
  });

  it('shares one refresh between concurrent requests', async () => {
    await signInWithExpiry(5_000);
    queue.push(reply(200, pair(2))); // a single refresh
    queue.push(reply(200, { n: 1 }));
    queue.push(reply(200, { n: 2 }));
    queue.push(reply(200, { n: 3 }));
    await Promise.all([http.get('/a'), http.get('/b'), http.get('/c')]);
    expect(calls.filter((c) => c.url.includes('/auth/refresh'))).toHaveLength(1);
  });

  it('signs the user out when the refresh token is rejected', async () => {
    const ended = jest.fn();
    setSessionEndedHandler(ended);
    await signInWithExpiry(5_000);
    queue.push(reply(401, { error: { code: 'invalid_refresh_token', message: 'Your session has ended.' } }));
    await expect(http.get('/me')).rejects.toMatchObject({ status: 401 });
    expect(ended).toHaveBeenCalledWith('session_ended');
    expect(await loadTokens()).toBeNull();
  });

  it('keeps the session when the refresh attempt merely fails to connect', async () => {
    const ended = jest.fn();
    setSessionEndedHandler(ended);
    await signInWithExpiry(5_000);
    queue.push(new TypeError('Network request failed'));
    await expect(http.get('/me')).rejects.toBeInstanceOf(NetworkError);
    expect(ended).not.toHaveBeenCalled();
    expect((await loadTokens())?.refreshToken).toBe('refresh-1');
  });

  it('ends the session for a deactivated account', async () => {
    const ended = jest.fn();
    setSessionEndedHandler(ended);
    await signInWithExpiry(600_000);
    queue.push(reply(403, { error: { code: 'account_disabled', message: 'Deactivated' } }));
    await expect(http.get('/queue')).rejects.toMatchObject({ code: 'account_disabled' });
    expect(ended).toHaveBeenCalledWith('account_disabled');
  });

  it('rejects immediately when there is no session', async () => {
    await expect(http.get('/me')).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(0);
  });
});
