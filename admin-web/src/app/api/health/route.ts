import { NextResponse } from "next/server";

import { backendFetch } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * Is the panel alive? `GET /api/health` answers at once and never depends on the backend, so a backend that is down does
 * not make the platform restart the (healthy) panel. `GET /api/health?deep=1` also asks the backend, for monitoring.
 */
export async function GET(request: Request) {
  const body: { status: "ok" | "degraded"; backend?: "ok" | "unreachable" } = { status: "ok" };
  if (new URL(request.url).searchParams.get("deep") === "1") {
    const ok = await backendFetch("/health", { signal: AbortSignal.timeout(5000) }).then((r) => r.ok, () => false);
    body.backend = ok ? "ok" : "unreachable";
    if (!ok) body.status = "degraded";
  }
  return NextResponse.json(body, { status: body.status === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } });
}
