import { NextResponse, type NextRequest } from "next/server";

import { applyTokens, backendFetch, canUsePanel, clientIp, hasCsrfHeader, type TokenPair } from "@/lib/server/session";

export const dynamic = "force-dynamic";

function describeBrowser(userAgent: string): string {
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Chrome\//.test(userAgent) ? "Chrome" : /Firefox\//.test(userAgent) ? "Firefox" : /Safari\//.test(userAgent) ? "Safari" : "Browser";
  const os = /Windows/.test(userAgent) ? "Windows" : /Android/.test(userAgent) ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Mac OS/.test(userAgent) ? "macOS" : /Linux/.test(userAgent) ? "Linux" : "";
  return `Admin panel (${browser}${os ? ` on ${os}` : ""})`;
}

export async function POST(request: NextRequest) {
  if (!hasCsrfHeader(request)) return NextResponse.json({ error: { code: "csrf", message: "Request was blocked." } }, { status: 403 });

  let body: { identifier?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "bad_request", message: "Invalid request." } }, { status: 400 });
  }
  const identifier = String(body.identifier ?? "").trim();
  const password = String(body.password ?? "");
  if (!identifier || !password) {
    return NextResponse.json({ error: { code: "missing_credentials", message: "Enter your email or employee ID and your password." } }, { status: 422 });
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  const ip = clientIp(request);
  if (ip) headers["x-forwarded-for"] = ip;

  let res: Response;
  try {
    res = await backendFetch("/api/v1/auth/login", {
      method: "POST",
      headers,
      body: JSON.stringify({
        identifier,
        password,
        // platform "web" tells the backend this is a browser: no device is registered for it, and only staff may sign in
        device: { device_uid: "admin-panel", name: describeBrowser(request.headers.get("user-agent") ?? ""), platform: "web" },
      }),
    });
  } catch {
    return NextResponse.json({ error: { code: "backend_unreachable", message: "The server is not reachable. Please try again in a moment." } }, { status: 502 });
  }

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const response = NextResponse.json(payload ?? { error: { code: "login_failed", message: "Sign-in failed." } }, { status: res.status });
    const retry = res.headers.get("retry-after");
    if (retry) response.headers.set("retry-after", retry);
    return response;
  }

  const pair = payload as TokenPair;
  if (!canUsePanel(pair.employee.role)) {
    // the backend already refuses employees on the web channel; this is the second lock, for a backend that does not
    await backendFetch("/api/v1/auth/logout", { method: "POST", headers: { authorization: `Bearer ${pair.access_token}` } }).catch(() => undefined);
    return NextResponse.json(
      { error: { code: "panel_not_allowed", message: "This panel is for administrators and managers. Employees use the mobile app." } },
      { status: 403 },
    );
  }

  return applyTokens(NextResponse.json({ employee: pair.employee, must_change_password: pair.must_change_password }), pair);
}
