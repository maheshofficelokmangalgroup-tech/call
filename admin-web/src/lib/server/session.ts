import "server-only";

import type { NextRequest, NextResponse } from "next/server";

/**
 * Server-side session handling for the admin panel (a "backend for frontend").
 *
 * The browser never sees an access or refresh token: they live in httpOnly cookies that only these server routes read.
 * Pages talk to /api/backend/*, which attaches the access token, renews it with the refresh token when it has expired
 * and forwards the call to the FastAPI backend.
 */
export const ACCESS_COOKIE = "ec_at";
export const REFRESH_COOKIE = "ec_rt";

const REFRESH_DAYS = 30;

export interface SessionEmployee {
  id: number;
  employee_code: string;
  full_name: string;
  email: string;
  role: string;
  [key: string]: unknown;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  must_change_password: boolean;
  employee: SessionEmployee;
}

export const backendUrl = () => (process.env.BACKEND_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
const secure = () => process.env.COOKIE_SECURE === "true";

export const cookieOptions = (maxAgeSeconds: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: secure(),
  path: "/",
  maxAge: Math.max(1, Math.floor(maxAgeSeconds)),
});

/** fetch against the backend with a timeout; `path` starts with /api/v1/ ... */
export function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${backendUrl()}${path}`, {
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(init.signal ? 600_000 : 30_000),
    ...init,
  });
}

// One refresh at a time per refresh token: the dashboard fires several requests at once, and every one of them would
// otherwise rotate the token again (the backend revokes a session when an old refresh token is reused after its grace period).
const inFlight = new Map<string, Promise<TokenPair | null>>();

export function refreshTokens(refreshToken: string): Promise<TokenPair | null> {
  const running = inFlight.get(refreshToken);
  if (running) return running;
  const promise = (async () => {
    try {
      const res = await backendFetch("/api/v1/auth/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return null;
      return (await res.json()) as TokenPair;
    } catch {
      return null;
    } finally {
      setTimeout(() => inFlight.delete(refreshToken), 15_000); // late arrivals reuse the answer instead of rotating again
    }
  })();
  inFlight.set(refreshToken, promise);
  return promise;
}

export function applyTokens<T extends NextResponse>(response: T, pair: TokenPair): T {
  // the access cookie expires a little before the token does, so a request never carries a token that is about to die
  response.cookies.set(ACCESS_COOKIE, pair.access_token, cookieOptions(pair.expires_in - 30));
  response.cookies.set(REFRESH_COOKIE, pair.refresh_token, cookieOptions(REFRESH_DAYS * 86400));
  return response;
}

export function clearTokens<T extends NextResponse>(response: T): T {
  response.cookies.set(ACCESS_COOKIE, "", { ...cookieOptions(1), maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, "", { ...cookieOptions(1), maxAge: 0 });
  return response;
}

export function readTokens(request: NextRequest) {
  return {
    access: request.cookies.get(ACCESS_COOKIE)?.value,
    refresh: request.cookies.get(REFRESH_COOKIE)?.value,
  };
}

/** Panel sessions are for administrators and managers only; employees use the mobile app. */
export const canUsePanel = (role: string | undefined) => role === "admin" || role === "manager";

export function clientIp(request: NextRequest): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0]?.trim() : undefined;
}

/** Same-origin check for state-changing requests: browsers cannot add this header to a cross-site form post. */
export const hasCsrfHeader = (request: NextRequest) => request.headers.get("x-requested-with") === "admin-web";
