import { NextResponse, type NextRequest } from "next/server";

import { backendFetch, clearTokens, hasCsrfHeader, readTokens } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!hasCsrfHeader(request)) return NextResponse.json({ error: { code: "csrf", message: "Request was blocked." } }, { status: 403 });
  const { access } = readTokens(request);
  if (access) {
    // end the session on the server too (best effort): the cookies are cleared either way
    await backendFetch("/api/v1/auth/logout", { method: "POST", headers: { authorization: `Bearer ${access}` } }).catch(() => undefined);
  }
  return clearTokens(NextResponse.json({ ok: true }));
}
