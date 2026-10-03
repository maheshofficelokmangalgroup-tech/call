import { expect, test, type Page } from "@playwright/test";

// EMP001 of `python -m scripts.seed_demo`. These tests place calls, so run them against demo data only.
const IDENTIFIER = process.env.E2E_IDENTIFIER ?? "EMP001";
const PASSWORD = process.env.E2E_PASSWORD ?? "Employee@123";

test.beforeEach(async ({ page }) => {
  // a tel: link raises a browser prompt that a test cannot answer, and the prompt blocks the page: switch the dialer off
  await page.addInitScript(() => localStorage.setItem("ec_web_no_dialer", "1"));
});

async function signIn(page: Page) {
  await page.goto("/");
  await page.waitForURL(/\/login/);
  await page.getByTestId("login-identifier").fill(IDENTIFIER);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("start-calling")).toBeVisible();
}

test("a wrong password stays on the sign-in page with a message", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-identifier").fill(IDENTIFIER);
  await page.getByTestId("login-password").fill("not-the-password-1");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-error")).toContainText("Incorrect");
  await expect(page).toHaveURL(/\/login/);
});

test("signed-out visitors are sent to sign in and come back to the page they asked for", async ({ page }) => {
  await page.goto("/history?filter=connected");
  await page.waitForURL(/\/login\?next=/);
  await page.getByTestId("login-identifier").fill(IDENTIFIER);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/history\?filter=connected/);
  await expect(page.getByTestId("history-filter-connected")).toHaveAttribute("aria-pressed", "true");
});

test("the dashboard cards open the lists they count", async ({ page }) => {
  await signIn(page);
  await page.getByTestId("stat-connected").click();
  await expect(page).toHaveURL(/\/history\?filter=connected/);
  await expect(page.getByTestId("history-filter-connected")).toHaveAttribute("aria-pressed", "true");
});

test("call a contact, end the call and record a connected outcome with feedback", async ({ page }) => {
  await signIn(page);
  await page.goto("/queue");
  await expect(page.getByTestId("next-bar")).toBeVisible();

  // the contact page: three details, three actions
  const first = page.locator(".row-open").first();
  await first.click();
  await expect(page.getByTestId("contact-call")).toBeVisible();
  await expect(page.getByText("Calls so far")).toBeVisible();
  await expect(page.getByText("Reschedule", { exact: true }).first()).toBeVisible();

  // the call
  await page.getByTestId("contact-call").click();
  await expect(page.getByTestId("incall")).toBeVisible();
  await page.getByTestId("call-ended").click();
  await expect(page.getByTestId("outcome")).toBeVisible();

  // four outcomes only, and the feedback appears only for a connected call
  await expect(page.getByTestId("disposition-CONNECTED")).toBeVisible();
  await expect(page.getByTestId("disposition-NO_ANSWER")).toBeVisible();
  await expect(page.getByTestId("disposition-BUSY")).toContainText("Call Back");
  await expect(page.getByTestId("disposition-SWITCHED_OFF")).toBeVisible();
  await expect(page.getByTestId("disposition-INTERESTED")).toHaveCount(0);
  await expect(page.getByTestId("feedback-supportive")).toHaveCount(0);
  await page.getByTestId("disposition-CONNECTED").click();
  await expect(page.getByTestId("feedback-supportive")).toBeVisible();
  await page.getByTestId("disposition-NO_ANSWER").click();
  await expect(page.getByTestId("feedback-supportive")).toHaveCount(0);

  await page.getByTestId("disposition-CONNECTED").click();
  await page.getByTestId("feedback-supportive").click();
  await page.getByTestId("outcome-notes").fill("Asked for the festival offer details.");
  await page.getByTestId("outcome-save").click();
  await expect(page.getByTestId("saved")).toBeVisible();
  await page.waitForURL((url) => url.pathname === "/");
});

test("an outcome can be recorded later for a call that was left waiting", async ({ page }) => {
  await signIn(page);
  await page.goto("/queue");
  await page.locator('[data-testid^="call-"]').first().click();
  await expect(page.getByTestId("incall")).toBeVisible();
  await page.goto("/"); // leave the call page without saying the call ended...
  await page.evaluate(() => localStorage.removeItem("ec_web_active_call")); // ...and lose the browser's note of it
  await page.reload();
  await page.getByTestId("pending-wrapup").click();
  await expect(page.getByTestId("outcome")).toContainText("waiting for an outcome");
  await page.getByTestId("disposition-NO_ANSWER").click();
  await page.getByTestId("outcome-save").click();
  await expect(page.getByTestId("saved")).toBeVisible();
});

test("a callback can be rescheduled from the contact page", async ({ page }) => {
  await signIn(page);
  await page.goto("/queue");
  await page.locator(".row-open").nth(2).click();
  await expect(page.getByTestId("contact-call")).toBeVisible();
  await page.getByText("Reschedule", { exact: true }).first().click();
  await page.getByRole("button", { name: "In 1 hour" }).click();
  await page.getByTestId("callback-save").click();
  await expect(page.getByTestId("callback-card")).toBeVisible();
});
