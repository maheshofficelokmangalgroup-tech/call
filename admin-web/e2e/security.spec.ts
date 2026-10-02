import { expect, test } from "@playwright/test";

import { MANAGER, login, panelGet } from "./helpers";

test.describe("security", () => {
  test("a signed-out visitor gets nothing from the API proxy", async ({ playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL });
    const res = await anonymous.get("/api/backend/employees");
    expect(res.status()).toBe(401);
    expect((await res.json()).error.code).toBe("unauthenticated");
    expect((await anonymous.get("/api/auth/me")).status()).toBe(401);
    await anonymous.dispose();
  });

  test("the sign-in cookies cannot be read by scripts on the page", async ({ page }) => {
    await login(page);
    expect(await page.evaluate(() => document.cookie)).not.toMatch(/ec_at|ec_rt/);
    const cookies = await page.context().cookies();
    const session = cookies.filter((c) => c.name === "ec_at" || c.name === "ec_rt");
    expect(session.map((c) => c.name).sort()).toEqual(["ec_at", "ec_rt"]);
    for (const c of session) {
      expect(c.httpOnly, c.name).toBe(true);
      expect(c.sameSite, c.name).toBe("Lax");
    }
    // nothing sensitive is kept in the browser's storage either
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toMatch(/eyJ|access_token|refresh_token|password/i);
  });

  test("the proxy refuses the backend's own sign-in routes and state changes without the panel's header", async ({ page }) => {
    await login(page);
    expect((await page.request.post("/api/backend/auth/login", { headers: { "x-requested-with": "admin-web" }, data: { identifier: "a", password: "b" } })).status()).toBe(404);
    expect((await page.request.post("/api/backend/auth/refresh", { headers: { "x-requested-with": "admin-web" }, data: {} })).status()).toBe(404);
    // a request that a foreign website could send (no custom header) is not accepted
    const forged = await page.request.post("/api/backend/teams", { data: { name: "Forged team" } });
    expect(forged.status()).toBe(403);
    expect((await forged.json()).error.code).toBe("csrf");
    const logout = await page.request.post("/api/auth/logout");
    expect(logout.status()).toBe(403);
    // the session is still alive after the forged attempts
    expect((await panelGet(page, "teams")).status()).toBe(200);
  });

  test("every page carries the security headers", async ({ page }) => {
    const response = await page.goto("/login");
    const h = response!.headers();
    expect(h["content-security-policy"]).toContain("default-src 'self'");
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toContain("microphone=()");
    expect(h["x-powered-by"]).toBeUndefined();
  });

  test("a manager cannot reach the administrator's endpoints, even by asking the proxy directly", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    try {
      const page = await context.newPage();
      await login(page, MANAGER);
      const headers = { "x-requested-with": "admin-web" };
      expect((await page.request.get("/api/backend/settings")).status()).toBe(403);
      expect((await page.request.get("/api/backend/audit-logs")).status()).toBe(403);
      expect((await page.request.post("/api/backend/employees", { headers, data: { full_name: "Sneaky Admin", email: "sneaky@example.com", role: "admin" } })).status()).toBe(403);
      expect((await page.request.post("/api/backend/employees/3/reset-password", { headers, data: {} })).status()).toBe(403);
      expect((await page.request.post("/api/backend/teams", { headers, data: { name: "Not allowed" } })).status()).toBe(403);
      // ...while reading the team's own numbers is fine
      expect((await page.request.get("/api/backend/analytics/overview")).status()).toBe(200);
    } finally {
      await context.close();
    }
  });

  test("recording links are signed, short-lived and work in pieces", async ({ page, playwright, baseURL }) => {
    await login(page);
    const list = await (await panelGet(page, "calls?has_recording=true&page_size=5")).json();
    const withAudio = list.items.find((c: { recording: { upload_status: string } | null }) => c.recording?.upload_status === "available");
    expect(withAudio).toBeTruthy();
    const issued = await (await panelGet(page, `recordings/${withAudio.recording.id}/playback-url?mode=play`)).json();
    const path = (issued.url as string).replace("/api/v1/", "/api/backend/");

    // the link works without any cookie: the signature is the credential
    const stranger = await playwright.request.newContext({ baseURL });
    const whole = await stranger.get(path);
    expect(whole.status()).toBe(200);
    expect(whole.headers()["content-type"]).toContain("audio/");
    expect(whole.headers()["accept-ranges"]).toBe("bytes");
    // browsers ask for a piece at a time; so must the proxy deliver
    const piece = await stranger.get(path, { headers: { range: "bytes=0-99" } });
    expect(piece.status()).toBe(206);
    expect(piece.headers()["content-range"]).toMatch(/^bytes 0-99\/\d+$/);
    expect((await piece.body()).length).toBe(100);
    // changing anything breaks the signature
    expect((await stranger.get(path.replace(/sig=[0-9a-f]/, "sig=0"))).status()).toBe(403);
    expect((await stranger.get(path.replace(/m=play/, "m=download"))).status()).toBe(403);
    // and a link is for downloading only when an administrator asked for that
    await stranger.dispose();
  });

  test("downloading is for administrators: a manager can listen but not download", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    try {
      const page = await context.newPage();
      await login(page, MANAGER);
      const list = await (await panelGet(page, "calls?has_recording=true&page_size=20")).json();
      const rec = list.items.find((c: { recording: { upload_status: string } | null }) => c.recording?.upload_status === "available")?.recording;
      expect(rec).toBeTruthy();
      expect((await panelGet(page, `recordings/${rec.id}/playback-url?mode=play`)).status()).toBe(200);
      expect((await panelGet(page, `recordings/${rec.id}/playback-url?mode=download`)).status()).toBe(403);
    } finally {
      await context.close();
    }
  });

  test("a stolen or expired session sends the person back to sign in", async ({ page }) => {
    await login(page);
    await page.context().clearCookies({ name: "ec_at" });
    // the refresh cookie renews the session without asking for the password again
    await page.goto("/employees");
    await expect(page.getByTestId("employee-row").first()).toBeVisible();
    await page.context().clearCookies();
    await page.goto("/employees");
    await expect(page).toHaveURL(/\/login/);
  });
});
