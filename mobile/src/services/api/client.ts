/**
 * HTTP client: JSON over fetch with timeouts, automatic access-token refresh (single flight) and a uniform
 * error model. The backend always answers errors as {"error": {"code", "message", "details"}}.
 */
import { API_PREFIX, DEFAULT_API_URL, REQUEST_TIMEOUT_MS } from '../../config/env';
import { clearTokens, loadTokens, saveTokens, type Tokens } from '../storage/secureTokens';
import { normalizeServerUrl } from './serverUrl';
import type { TokenPair } from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly retryAfter?: number;

  constructor(status: number, code: string, message: string, details?: unknown, retryAfter?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfter = retryAfter;
  }
}

/** The server could not be reached (offline, DNS, timeout, refused). The operation can be retried later. */
export class NetworkError extends Error {
  constructor(message = 'Cannot reach the server. Check your internet connection.') {
    super(message);
    this.name = 'NetworkError';
  }
}

let baseUrl = DEFAULT_API_URL;
let sessionEndedHandler: ((reason: string) => void) | null = null;

export { normalizeServerUrl };

export function setBaseUrl(url: string): void {
  baseUrl = normalizeServerUrl(url);
}

export function getBaseUrl(): string {
  return baseUrl;
}

/** Called when the refresh token is rejected or the account is disabled: the UI must return to the login screen. */
export function setSessionEndedHandler(handler: (reason: string) => void): void {
  sessionEndedHandler = handler;
}

function endSession(reason: string): void {
  void clearTokens();
  sessionEndedHandler?.(reason);
}

export function resolveUrl(pathOrUrl: string): string {
  return /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${baseUrl}${pathOrUrl}`;
}

interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  auth?: boolean;
  timeoutMs?: number;
  form?: FormData;
  /** path is relative to the server root instead of /api/v1 (used by /health) */
  root?: boolean;
  /** internal: set after one refresh attempt */
  retried?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query'], root = false): string {
  let url = `${baseUrl}${root ? '' : API_PREFIX}${path}`;
  if (query) {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
    if (parts.length) url += `?${parts.join('&')}`;
  }
  return url;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    const aborted = (error as { name?: string })?.name === 'AbortError';
    throw new NetworkError(aborted ? 'The server took too long to respond.' : undefined);
  } finally {
    clearTimeout(timer);
  }
}

async function readError(response: Response): Promise<ApiError> {
  let code = `http_${response.status}`;
  let message = `Request failed (${response.status})`;
  let details: unknown;
  try {
    const json = await response.json();
    if (json?.error) {
      code = json.error.code ?? code;
      message = json.error.message ?? message;
      details = json.error.details;
    }
  } catch {
    // non-JSON error body (proxy error page, ...)
  }
  const retryAfter = Number(response.headers.get('Retry-After')) || undefined;
  return new ApiError(response.status, code, message, details, retryAfter);
}

// ------------------------------------------------------------------ token refresh
let refreshInFlight: Promise<Tokens> | null = null;

async function refreshTokens(): Promise<Tokens> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefresh(): Promise<Tokens> {
  const current = await loadTokens();
  if (!current?.refreshToken) {
    endSession('signed_out');
    throw new ApiError(401, 'unauthorized', 'Please sign in again.');
  }
  const response = await fetchWithTimeout(
    buildUrl('/auth/refresh'),
    { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ refresh_token: current.refreshToken }) },
    REQUEST_TIMEOUT_MS,
  );
  if (!response.ok) {
    const error = await readError(response);
    if (response.status === 401 || response.status === 403) endSession(error.code === 'account_disabled' ? 'account_disabled' : 'session_ended');
    throw error;
  }
  const pair = (await response.json()) as TokenPair;
  const tokens = tokensFromPair(pair);
  await saveTokens(tokens);
  return tokens;
}

export function tokensFromPair(pair: TokenPair): Tokens {
  return { accessToken: pair.access_token, refreshToken: pair.refresh_token, expiresAt: Date.now() + pair.expires_in * 1000 };
}

async function accessToken(): Promise<string | null> {
  let tokens = await loadTokens();
  if (!tokens) return null;
  if (tokens.expiresAt - Date.now() < 30_000) tokens = await refreshTokens();
  return tokens.accessToken;
}

// ------------------------------------------------------------------ core request
export async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, auth = true, timeoutMs = REQUEST_TIMEOUT_MS, form } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (!form && body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = await accessToken();
    if (!token) throw new ApiError(401, 'unauthorized', 'Please sign in again.');
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetchWithTimeout(
    buildUrl(path, query, options.root),
    { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) },
    timeoutMs,
  );

  if (response.ok) {
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  const error = await readError(response);
  if (auth && !options.retried && response.status === 401 && (error.code === 'token_expired' || error.code === 'invalid_token')) {
    await refreshTokens();
    return request<T>(method, path, { ...options, retried: true });
  }
  if (auth && response.status === 401 && (error.code === 'session_revoked' || error.code === 'invalid_refresh_token')) {
    endSession('session_ended');
  }
  if (auth && response.status === 403 && error.code === 'account_disabled') {
    endSession('account_disabled');
  }
  throw error;
}

export const http = {
  get: <T>(path: string, query?: RequestOptions['query'], options: RequestOptions = {}) => request<T>('GET', path, { ...options, query }),
  post: <T>(path: string, body?: unknown, options: RequestOptions = {}) => request<T>('POST', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options: RequestOptions = {}) => request<T>('PATCH', path, { ...options, body }),
  upload: <T>(path: string, form: FormData, timeoutMs: number) => request<T>('POST', path, { form, timeoutMs }),
};

/** True for errors that are worth retrying later (connectivity, timeouts, server trouble, throttling). */
export function isTransient(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  if (error instanceof ApiError) return error.status === 408 || error.status === 429 || error.status >= 500;
  return false;
}
