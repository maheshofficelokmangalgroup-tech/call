import { NextResponse, type NextRequest } from "next/server";

import { applyTokens, backendFetch, canUsePanel, clearTokens, readTokens, refreshTokens, type TokenPair } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const unauthorized = () => clearTokens(NextResponse.json({ error: { code: "unauthenticated", message: "Please sign in." } }, { status: 401 }));

/** Who is signed in (and the organisation settings the phones use), renewing the session when the access token has expired. */
export async function GET(request: NextRequest) {
  const tokens = readTokens(request);
  let access = tokens.access;
  let renewed: TokenPair | null = null;

  if (!access && tokens.refresh) {
    renewed = await refreshTokens(tokens.refresh);
    if (!renewed) return unauthorized();
    access = renewed.access_token;
  }
  if (!access) return unauthorized();

  let res = await backendFetch("/api/v1/me", { headers: { authorization: `Bearer ${access}` } }).catch(() => null);
  if (res?.status === 401 && tokens.refresh && !renewed) {
    renewed = await refreshTokens(tokens.refresh);
    if (!renewed) return unauthorized();
    res = await backendFetch("/api/v1/me", { headers: { authorization: `Bearer ${renewed.access_token}` } }).catch(() => null);
  }
  if (!res) return NextResponse.json({ error: { code: "backend_unreachable", message: "The server is not reachable." } }, { status: 502 });
  if (!res.ok) return res.status === 401 || res.status === 403 ? unauthorized() : NextResponse.json(await res.json().catch(() => ({})), { status: res.status });

  const me = (await res.json()) as { employee: { role: string } };
  if (!canUsePanel(me.employee.role)) return unauthorized();
  const response = NextResponse.json(me);
  return renewed ? applyTokens(response, renewed) : response;
}
