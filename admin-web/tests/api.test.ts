import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, buildQuery, downloadUrl, errorMessage, mediaUrl, parseError } from "@/lib/api";

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

describe("addresses", () => {
  it("builds a query string and leaves empty values out", () => {
    expect(buildQuery({ a: 1, b: "x y", c: undefined, d: null, e: "", f: false })).toBe("?a=1&b=x+y&f=false");
    expect(buildQuery({})).toBe("");
    expect(buildQuery(undefined)).toBe("");
    expect(buildQuery({ id: [1, 2] })).toBe("?id=1&id=2");
  });

  it("sends downloads through the panel's own proxy", () => {
    expect(downloadUrl("calls/export.csv", { status: "no_answer" })).toBe("/api/backend/calls/export.csv?status=no_answer");
    expect(downloadUrl("/employees")).toBe("/api/backend/employees");
  });

  it("rewrites the backend's recording links but leaves object-storage links alone", () => {
    expect(mediaUrl("/api/v1/recordings/9/stream?exp=1&sig=ab")).toBe("/api/backend/recordings/9/stream?exp=1&sig=ab");
    expect(mediaUrl("https://bucket.s3.amazonaws.com/x.m4a?X-Amz-Signature=1")).toBe("https://bucket.s3.amazonaws.com/x.m4a?X-Amz-Signature=1");
  });
});

describe("error answers", () => {
  it("reads the backend's error shape", async () => {
    const err = await parseError(jsonResponse({ error: { code: "email_taken", message: "An employee with this email already exists.", details: { field: "email" } } }, { status: 409 }));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "email_taken", message: "An employee with this email already exists.", details: { field: "email" } });
  });

  it("reads framework validation errors", async () => {
    const err = await parseError(jsonResponse({ detail: [{ msg: "Field required" }, { msg: "Too short" }] }, { status: 422 }));
    expect(err).toMatchObject({ code: "validation_error", message: "Field required Too short" });
  });

  it("knows how long to wait after being rate limited", async () => {
    const err = await parseError(jsonResponse({ error: { code: "rate_limited", message: "Slow down" } }, { status: 429, headers: { "retry-after": "42" } }));
    expect(err.retryAfter).toBe(42);
  });

  it("still gives a sensible message when the answer is not JSON", async () => {
    const err = await parseError(new Response("<html>Bad gateway</html>", { status: 502 }));
    expect(err).toMatchObject({ status: 502, code: "http_error", message: "The server answered 502." });
  });

  it("chooses what to show a person", () => {
    expect(errorMessage(new ApiError(400, "x", "Bad value"))).toBe("Bad value");
    expect(errorMessage(new Error("Boom"))).toBe("Boom");
    expect(errorMessage("weird")).toBe("Something went wrong. Please try again.");
    expect(errorMessage(undefined, "Custom")).toBe("Custom");
  });
});

describe("api()", () => {
  it("calls the proxy with the panel's header and the cookies, and decodes JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const data = await api<{ ok: boolean }>("teams", { params: { page: 2 } });
    expect(data).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/backend/teams?page=2");
    expect(init).toMatchObject({ method: "GET", credentials: "same-origin", cache: "no-store" });
    expect(init.headers["x-requested-with"]).toBe("admin-web");
  });

  it("sends a JSON body with its content type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await api("teams", { method: "POST", body: { name: "A" } });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.body).toBe('{"name":"A"}');
    expect(init.headers["content-type"]).toBe("application/json");
  });

  it("lets the browser set the type of a file upload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData();
    form.append("file", new Blob(["x"]), "a.csv");
    await api("contacts/import", { method: "POST", form });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.body).toBe(form);
    expect(init.headers["content-type"]).toBeUndefined();
  });

  it("returns nothing for 204", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    expect(await api("teams/1", { method: "DELETE" })).toBeUndefined();
  });

  it("throws the backend's own message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { code: "conflict", message: "Name taken." } }, { status: 409 })));
    await expect(api("teams", { method: "POST", body: {} })).rejects.toMatchObject({ status: 409, message: "Name taken." });
  });

  it("explains a network failure in plain words", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api("teams")).rejects.toMatchObject({ code: "network_error", message: expect.stringContaining("internet") });
  });

  it("lets a cancelled request stay cancelled", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    await expect(api("teams")).rejects.toMatchObject({ name: "AbortError" });
  });
});
