/**
 * HTTP client: JSON over fetch with timeouts, automatic access-token refresh (one refresh at a time, also across browser tabs)
 * and a uniform error model. The backend always answers errors as {"error": {"code", "message", "details"}}.
 *
 * Tokens: the short-lived access token and the refresh token are kept in localStorage so a reload (or a second tab) stays signed
 * in. The page loads no third-party scripts and the server sends a strict Content-Security-Policy, which is what protects them.
 */
import type { TokenPair } from "./types";

const API_PREFIX = "/api/v1";
const REQUEST_TIMEOUT_MS = 20_000;
/** Empty = the page's own origin (the dev server and the production reverse proxy both forward /api). */
const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? "").replace(/\/+$/, "");

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly retryAfter?: number;

  constructor(status: number, code: string, message: string, details?: unknown, retryAfter?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfter = retryAfter;
  }
}

/** The server could not be reached (offline, DNS, timeout, refused). The operation can be retried. */
export class NetworkError extends Error {
  constructor(message = "Cannot reach the server. Check your internet connection.") {
    super(message);
    this.name = "NetworkError";
  }
}

// ------------------------------------------------------------------ token storage
export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** epoch ms at which the access token stops being valid */
  expiresAt: number;
}

export const SESSION_KEY = "ec_web_session";

export function loadTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Tokens>;
    return parsed.accessToken && parsed.refreshToken && typeof parsed.expiresAt === "number" ? (parsed as Tokens) : null;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: Tokens): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(tokens));
  } catch {
    /* storage blocked (private mode): the session lasts until the tab closes only if the caller keeps it in memory */
  }
}

export function clearTokens(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function tokensFromPair(pair: TokenPair): Tokens {
  return { accessToken: pair.access_token, refreshToken: pair.refresh_token, expiresAt: Date.now() + pair.expires_in * 1000 };
}

// ------------------------------------------------------------------ session end
let sessionEndedHandler: ((reason: string) => void) | null = null;

/** Called when the refresh token is rejected or the account is disabled: the UI must return to the sign-in page. */
export function setSessionEndedHandler(handler: ((reason: string) => void) | null): void {
  sessionEndedHandler = handler;
}

function endSession(reason: string): void {
  clearTokens();
  sessionEndedHandler?.(reason);
}

// ------------------------------------------------------------------ plumbing
interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  auth?: boolean;
  timeoutMs?: number;
  /** path is relative to the server root instead of /api/v1 (used by /health) */
  root?: boolean;
  /** internal: set after one refresh attempt */
  retried?: boolean;
  signal?: AbortSignal;
}

export function buildUrl(path: string, query?: RequestOptions["query"], root = false): string {
  let url = `${API_BASE}${root ? "" : API_PREFIX}${path}`;
  if (query) {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
    if (parts.length) url += `?${parts.join("&")}`;
  }
  return url;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, outer?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  outer?.addEventListener("abort", onOuterAbort);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (outer?.aborted) throw error; // a cancelled query, not a network problem
    const aborted = (error as { name?: string })?.name === "AbortError";
    throw new NetworkError(aborted ? "The server took too long to respond." : undefined);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onOuterAbort);
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
    } else if (typeof json?.message === "string") {
      message = json.message;
    } else if (typeof json?.detail === "string") {
      message = json.detail;
    } else if (Array.isArray(json?.detail) && json.detail.length > 0) {
      message = json.detail.map((d: { msg?: string }) => d.msg || JSON.stringify(d)).join(", ");
    }
  } catch {
    // not JSON (a proxy's error page, ...)
  }
  const retryAfter = Number(response.headers.get("Retry-After")) || undefined;
  return new ApiError(response.status, code, message, details, retryAfter);
}

// ------------------------------------------------------------------ token refresh
let refreshInFlight: Promise<Tokens> | null = null;

/** Runs `job` while holding a lock shared by every tab of this browser, so two tabs never rotate the same refresh token. */
async function withTabLock<T>(job: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  return locks ? locks.request("ec-web-token-refresh", job) : job();
}

/** `stale` is the access token that just failed (or is about to expire); if another tab has already replaced it, use that one. */
function refreshTokens(stale: string | null): Promise<Tokens> {
  if (!refreshInFlight) {
    refreshInFlight = withTabLock(() => doRefresh(stale)).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefresh(stale: string | null): Promise<Tokens> {
  const current = loadTokens();
  if (!current) {
    endSession("signed_out");
    throw new ApiError(401, "unauthorized", "Please sign in again.");
  }
  if (stale !== null && current.accessToken !== stale && current.expiresAt - Date.now() > 30_000) return current;

  const response = await fetchWithTimeout(
    buildUrl("/auth/refresh"),
    { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ refresh_token: current.refreshToken }) },
    REQUEST_TIMEOUT_MS,
  );
  if (!response.ok) {
    const error = await readError(response);
    if (response.status === 401 || response.status === 403) endSession(error.code === "account_disabled" ? "account_disabled" : "session_ended");
    throw error;
  }
  const tokens = tokensFromPair((await response.json()) as TokenPair);
  saveTokens(tokens);
  return tokens;
}

async function accessToken(): Promise<string | null> {
  let tokens = loadTokens();
  if (!tokens) return null;
  if (tokens.expiresAt - Date.now() < 30_000) tokens = await refreshTokens(tokens.accessToken);
  return tokens.accessToken;
}

// ------------------------------------------------------------------ core request
export async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, auth = true, timeoutMs = REQUEST_TIMEOUT_MS } = options;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let used: string | null = null;
  if (auth) {
    used = await accessToken();
    if (!used) throw new ApiError(401, "unauthorized", "Please sign in again.");
    headers.Authorization = `Bearer ${used}`;
  }

  const response = await fetchWithTimeout(
    buildUrl(path, query, options.root),
    { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined },
    timeoutMs,
    options.signal,
  );

  if (response.ok) {
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  const error = await readError(response);
  if (auth && !options.retried && response.status === 401 && (error.code === "token_expired" || error.code === "invalid_token")) {
    await refreshTokens(used);
    return request<T>(method, path, { ...options, retried: true });
  }
  if (auth && response.status === 401 && (error.code === "session_revoked" || error.code === "invalid_refresh_token")) endSession("session_ended");
  if (auth && response.status === 403 && error.code === "account_disabled") endSession("account_disabled");
  throw error;
}

export const http = {
  get: <T>(path: string, query?: RequestOptions["query"], options: RequestOptions = {}) => request<T>("GET", path, { ...options, query }),
  post: <T>(path: string, body?: unknown, options: RequestOptions = {}) => request<T>("POST", path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options: RequestOptions = {}) => request<T>("PATCH", path, { ...options, body }),
};

/** True for errors that are worth retrying (connectivity, timeouts, server trouble, throttling). */
export function isTransient(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  if (error instanceof ApiError) return error.status === 408 || error.status === 429 || error.status >= 500;
  return false;
}

/** A readable sentence for any error. */
export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof ApiError || error instanceof NetworkError) return error.message;
  return fallback;
}

/**
 * A signed recording link as the browser can open it. The backend signs links against its own address; behind the proxy the page
 * reaches the API on its own origin, so an /api/v1 path is kept and only the host is dropped.
 */
export function resolveMediaUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.pathname.startsWith(`${API_PREFIX}/`) ? `${API_BASE}${parsed.pathname}${parsed.search}` : parsed.href;
  } catch {
    return url;
  }
}
