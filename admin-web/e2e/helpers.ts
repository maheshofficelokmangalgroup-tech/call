import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** The demo accounts created by `python -m scripts.seed_demo` in the backend. */
export const ADMIN = { email: "admin@example.com", password: "Admin@12345" };
export const MANAGER = { email: "manager@example.com", password: "Manager@12345" };
export const EMPLOYEE = { email: "emp001@example.com", code: "EMP001", password: "Employee@123" };

export const BACKEND = (process.env.E2E_BACKEND_URL ?? "http://127.0.0.1:8002").replace(/\/+$/, "");

/** A short unique suffix, so the data a test creates never collides with an earlier run. */
export const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/** Sign in through the real form and wait for the dashboard. */
export async function login(page: Page, account: { email: string; password: string } = ADMIN, landing = /\/dashboard/) {
  await page.goto("/login");
  const form = page.getByTestId("login-form");
  // the form is switched on once the page's script has loaded; typing earlier would be lost
  await expect(form).toHaveAttribute("data-ready", "true");
  await page.locator("#identifier").fill(account.email);
  await page.locator("#password").fill(account.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(landing);
}

/** The panel is a single-page app: wait until the page's own data (not just the frame) has arrived. */
export async function settled(page: Page) {
  await page.waitForLoadState("networkidle");
}

/** Sign an account in against the backend directly (not through the panel) - proves a login really works for the mobile app. */
export async function backendLogin(request: APIRequestContext, identifier: string, password: string) {
  return request.post(`${BACKEND}/api/v1/auth/login`, {
    data: { identifier, password, device: { device_uid: `e2e-${unique()}-device`, name: "E2E phone", platform: "android" } },
  });
}

/** Ask the panel's proxy for something as the signed-in browser would. */
export async function panelGet(page: Page, path: string) {
  return page.request.get(`/api/backend/${path.replace(/^\//, "")}`);
}
