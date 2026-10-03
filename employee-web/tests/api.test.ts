import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, NetworkError, SESSION_KEY, buildUrl, clearTokens, errorMessage, http, isTransient, loadTokens, request, resolveMediaUrl, saveTokens, setSessionEndedHandler } from "@/lib/api";

const NOW = Date.now();
const fresh = () => ({ accessToken: "access-1", refreshToken: "refresh-1", expiresAt: NOW + 10 * 60_000 });

function reply(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const calls: { url: string; init: RequestInit }[] = [];
let queue: (Response | Error)[] = [];

beforeEach(() => {
  calls.length = 0;
  queue = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = queue.shift();
      if (!next) throw new Error(`unexpected request to ${url}`);
      if (next instanceof Error) throw next;
      return next;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  setSessionEndedHandler(null);
});

const auth = (index: number) => (calls[index].init.headers as Record<string, string>).Authorization;

describe("urls", () => {
  it("builds query strings and skips empty values", () => {
    expect(buildUrl("/queue", { limit: 100, offset: 0, q: "", day: undefined, ok: true })).toBe("/api/v1/queue?limit=100&offset=0&ok=true");
    expect(buildUrl("/health", undefined, true)).toBe("/health");
    expect(buildUrl("/contacts", { q: "a b&c" })).toBe("/api/v1/contacts?q=a%20b%26c");
  });
  it("keeps a signed link on the app's own address", () => {
    expect(resolveMediaUrl("http://backend:8000/api/v1/recordings/5/stream?sig=abc")).toBe("/api/v1/recordings/5/stream?sig=abc");
    expect(resolveMediaUrl("https://bucket.s3.amazonaws.com/x.m4a?sig=1")).toBe("https://bucket.s3.amazonaws.com/x.m4a?sig=1");
  });
});

describe("requests", () => {
  it("sends the access token and returns the JSON", async () => {
    saveTokens(fresh());
    queue.push(reply(200, { hello: "world" }));
    await expect(http.get("/me")).resolves.toEqual({ hello: "world" });
    expect(auth(0)).toBe("Bearer access-1");
  });

  it("sends no token for the sign-in call and posts JSON", async () => {
    queue.push(reply(200, { ok: true }));
    await request("POST", "/auth/login", { auth: false, body: { identifier: "EMP001", password: "x" } });
    expect(calls[0].init.headers).not.toHaveProperty("Authorization");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ identifier: "EMP001", password: "x" });
    expect((calls[0].init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("returns undefined for 204", async () => {
    saveTokens(fresh());
    queue.push(reply(204));
    await expect(http.post("/auth/logout")).resolves.toBeUndefined();
  });

  it("refuses to call without a session", async () => {
    await expect(http.get("/me")).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(0);
  });

  it("turns the server's error shape into an ApiError", async () => {
    saveTokens(fresh());
    queue.push(reply(409, { error: { code: "contact_do_not_contact", message: "This contact is marked Do Not Contact." } }, { "Retry-After": "7" }));
    const error = (await http.post("/calls", {}).catch((e) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "contact_do_not_contact", message: "This contact is marked Do Not Contact.", retryAfter: 7 });
  });

  it("copes with an error page that is not JSON", async () => {
    saveTokens(fresh());
    queue.push(new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(http.get("/me")).rejects.toMatchObject({ status: 502, code: "http_502" });
  });

  it("reports an unreachable server as a NetworkError", async () => {
    saveTokens(fresh());
    queue.push(new TypeError("Failed to fetch"));
    const error = await http.get("/me").catch((e) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(isTransient(error)).toBe(true);
    expect(errorMessage(error)).toMatch(/Cannot reach the server/);
  });
});

describe("token refresh", () => {
  it("renews a token that is about to expire before calling", async () => {
    saveTokens({ accessToken: "old", refreshToken: "refresh-1", expiresAt: NOW + 5_000 });
    queue.push(reply(200, { access_token: "new", refresh_token: "refresh-2", expires_in: 900, token_type: "bearer", must_change_password: false, employee: {} }));
    queue.push(reply(200, { fine: true }));
    await http.get("/me");
    expect(calls[0].url).toBe("/api/v1/auth/refresh");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ refresh_token: "refresh-1" });
    expect(auth(1)).toBe("Bearer new");
    expect(loadTokens()?.refreshToken).toBe("refresh-2");
  });

  it("renews once and repeats the call when the server says the token expired", async () => {
    saveTokens(fresh());
    queue.push(reply(401, { error: { code: "token_expired", message: "expired" } }));
    queue.push(reply(200, { access_token: "new", refresh_token: "refresh-2", expires_in: 900, token_type: "bearer", must_change_password: false, employee: {} }));
    queue.push(reply(200, { fine: true }));
    await expect(http.get("/me")).resolves.toEqual({ fine: true });
    expect(calls.map((c) => c.url)).toEqual(["/api/v1/me", "/api/v1/auth/refresh", "/api/v1/me"]);
    expect(auth(2)).toBe("Bearer new");
  });

  it("shares one refresh between calls made at the same time", async () => {
    saveTokens({ accessToken: "old", refreshToken: "refresh-1", expiresAt: NOW + 1_000 });
    queue.push(reply(200, { access_token: "new", refresh_token: "refresh-2", expires_in: 900, token_type: "bearer", must_change_password: false, employee: {} }));
    queue.push(reply(200, { n: 1 }));
    queue.push(reply(200, { n: 2 }));
    await Promise.all([http.get("/a"), http.get("/b")]);
    expect(calls.filter((c) => c.url.endsWith("/auth/refresh"))).toHaveLength(1);
  });

  it("ends the session when the refresh token is refused", async () => {
    const ended = vi.fn();
    setSessionEndedHandler(ended);
    saveTokens({ accessToken: "old", refreshToken: "refresh-1", expiresAt: NOW + 1_000 });
    queue.push(reply(401, { error: { code: "invalid_refresh_token", message: "Your session has ended." } }));
    await expect(http.get("/me")).rejects.toMatchObject({ code: "invalid_refresh_token" });
    expect(ended).toHaveBeenCalledWith("session_ended");
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("ends the session when the account was disabled", async () => {
    const ended = vi.fn();
    setSessionEndedHandler(ended);
    saveTokens(fresh());
    queue.push(reply(403, { error: { code: "account_disabled", message: "Your account has been deactivated." } }));
    await expect(http.get("/me")).rejects.toMatchObject({ status: 403 });
    expect(ended).toHaveBeenCalledWith("account_disabled");
  });
});

describe("saved session", () => {
  it("ignores a broken record", () => {
    localStorage.setItem(SESSION_KEY, "{not json");
    expect(loadTokens()).toBeNull();
    localStorage.setItem(SESSION_KEY, JSON.stringify({ accessToken: "a" }));
    expect(loadTokens()).toBeNull();
    clearTokens();
    expect(loadTokens()).toBeNull();
  });
  it("classifies errors worth retrying", () => {
    expect(isTransient(new ApiError(503, "x", "x"))).toBe(true);
    expect(isTransient(new ApiError(429, "x", "x"))).toBe(true);
    expect(isTransient(new ApiError(404, "x", "x"))).toBe(false);
    expect(isTransient(new Error("x"))).toBe(false);
  });
});
