import { expect, test } from "@playwright/test";

import { ADMIN, EMPLOYEE, MANAGER, login } from "./helpers";

test.describe("signing in and out", () => {
  test("a wrong password is refused with a clear message", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-form")).toHaveAttribute("data-ready", "true");
    await page.locator("#identifier").fill(ADMIN.email);
    await page.locator("#password").fill("not-the-password");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-error")).toContainText(/incorrect|invalid|wrong/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test("the button stays off until both fields are filled", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-form")).toHaveAttribute("data-ready", "true");
    await expect(page.getByTestId("login-submit")).toBeDisabled();
    await page.locator("#identifier").fill(ADMIN.email);
    await expect(page.getByTestId("login-submit")).toBeDisabled();
    await page.locator("#password").fill("x");
    await expect(page.getByTestId("login-submit")).toBeEnabled();
  });

  test("an administrator signs in, sees the dashboard and signs out", async ({ page }) => {
    await login(page);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/good (morning|afternoon|evening)|working late/i);
    await page.getByTestId("user-menu").click();
    await page.getByRole("menuitem", { name: /sign out/i }).click();
    await page.waitForURL(/\/login/);
    // the session is really gone: a protected page sends the visitor back
    await page.goto("/employees");
    await expect(page).toHaveURL(/\/login\?next=%2Femployees/);
  });

  test("a manager can sign in too", async ({ page }) => {
    await login(page, MANAGER);
    await expect(page.getByTestId("kpis")).toBeVisible();
    // ...but the administrator-only pages are not in the menu
    await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Audit log" })).toHaveCount(0);
  });

  test("an employee account is not allowed into the panel", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-form")).toHaveAttribute("data-ready", "true");
    await page.locator("#identifier").fill(EMPLOYEE.email);
    await page.locator("#password").fill(EMPLOYEE.password);
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-error")).toContainText(/administrators and managers/i);
    await expect(page).toHaveURL(/\/login/);
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "ec_at" || c.name === "ec_rt")).toBeUndefined();
  });

  test("a page asked for while signed out comes back after signing in", async ({ page }) => {
    await page.goto("/calls");
    await expect(page).toHaveURL(/\/login\?next=%2Fcalls/);
    await expect(page.getByTestId("login-form")).toHaveAttribute("data-ready", "true");
    await page.locator("#identifier").fill(ADMIN.email);
    await page.locator("#password").fill(ADMIN.password);
    await page.getByTestId("login-submit").click();
    await page.waitForURL(/\/calls/);
    await expect(page.getByRole("heading", { level: 1, name: "Calls" })).toBeVisible();
  });

  test("the sign-in cannot be used to send a visitor to another website", async ({ page }) => {
    await page.goto("/login?next=https%3A%2F%2Fevil.example%2F");
    await expect(page.getByTestId("login-form")).toHaveAttribute("data-ready", "true");
    await page.locator("#identifier").fill(ADMIN.email);
    await page.locator("#password").fill(ADMIN.password);
    await page.getByTestId("login-submit").click();
    await page.waitForURL(/\/dashboard/);
    expect(new URL(page.url()).origin).toBe(new URL(test.info().project.use.baseURL ?? page.url()).origin);
  });
});
