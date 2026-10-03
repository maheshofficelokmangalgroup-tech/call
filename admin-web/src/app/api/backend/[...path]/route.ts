import { NextResponse, type NextRequest } from "next/server";

import { applyTokens, backendFetch, clearTokens, clientIp, hasCsrfHeader, readTokens, refreshTokens, type TokenPair } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Response headers worth passing on to the browser (everything else stays on the server). */
const PASS_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "content-disposition", "retry-after", "x-request-id"];

const json = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });

type Ctx = { params: Promise<{ path: string[] }> };

async function forward(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { path } = await ctx.params;
  const method = request.method;

  // sign-in, refresh and sign-out are handled by /api/auth/*; the browser never talks to those backend routes directly
  // (changing one's own password is the one exception: it needs the signed-in session and nothing else)
  if (path[0] === "auth" && !(path.length === 2 && path[1] === "change-password")) return json(404, "not_found", "Not found.");
  if (method !== "GET" && method !== "HEAD" && !hasCsrfHeader(request)) return json(403, "csrf", "Request was blocked.");

  const target = `/api/v1/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
  // a recording stream link is signed by the backend: the signature is its credential, so it needs no token
  const signedLink = path[0] === "recordings" && path[2] === "stream";

  const tokens = readTokens(request);
  let access = tokens.access;
  let renewed: TokenPair | null = null;
  if (!access && tokens.refresh && !signedLink) {
    renewed = await refreshTokens(tokens.refresh);
    if (!renewed) return clearTokens(json(401, "unauthenticated", "Please sign in."));
    access = renewed.access_token;
  }
  if (!access && !signedLink) return json(401, "unauthenticated", "Please sign in.");

  // A sheet of contacts can be a hundred megabytes: it is passed on while it arrives and never held in memory (the container that
  // runs the panel has far less than that). Everything else is small and is read once, so the call can be repeated after a token
  // refresh - the sheet cannot be repeated, which is why the session is renewed above, before it is sent.
  const streaming = method === "POST" && path.length === 2 && path[0] === "contacts" && path[1] === "import";
  const body = method === "GET" || method === "HEAD" || streaming ? undefined : await request.arrayBuffer();

  const attempt = (token: string | undefined) => {
    const headers = new Headers();
    for (const name of streaming ? ["accept", "content-type", "content-length"] : ["accept", "content-type", "range", "if-range"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (token) headers.set("authorization", `Bearer ${token}`);
    const ip = clientIp(request);
    if (ip) headers.set("x-forwarded-for", ip);
    if (streaming) return backendFetch(target, { method, headers, body: request.body, duplex: "half", signal: request.signal } as RequestInit & { duplex: "half" });
    return backendFetch(target, { method, headers, body: body && body.byteLength ? body : undefined, signal: request.signal });
  };

  let upstream: Response;
  try {
    upstream = await attempt(access);
    if (upstream.status === 401 && tokens.refresh && !renewed && !signedLink && !streaming) {
      renewed = await refreshTokens(tokens.refresh);
      if (!renewed) return clearTokens(json(401, "unauthenticated", "Please sign in."));
      upstream = await attempt(renewed.access_token);
    }
  } catch {
    return json(502, "backend_unreachable", "The server is not reachable. Please try again in a moment.");
  }

  const headers = new Headers();
  for (const name of PASS_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("cache-control", "private, no-store");
  const response = new NextResponse(method === "HEAD" || upstream.status === 204 ? null : upstream.body, { status: upstream.status, headers });
  return renewed ? applyTokens(response, renewed) : response;
}

export const GET = forward;
export const HEAD = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
