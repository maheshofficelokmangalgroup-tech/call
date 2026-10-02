import { NextResponse, type NextRequest } from "next/server";

/**
 * Keeps signed-out visitors out of the panel's pages. It only looks for the session cookies - the backend decides whether a
 * session is really valid - so a stale cookie ends up on the sign-in page one request later.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = request.cookies.has("ec_at") || request.cookies.has("ec_rt");

  if (pathname === "/login") {
    return hasSession ? NextResponse.redirect(new URL("/dashboard", request.url)) : NextResponse.next();
  }
  if (!hasSession) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  if (pathname === "/") return NextResponse.redirect(new URL("/dashboard", request.url));
  return NextResponse.next();
}

export const config = {
  // pages only: API routes answer 401 themselves, and static assets must never be redirected
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|logo.svg|robots.txt).*)"],
};
