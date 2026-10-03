import { expect, test, type Page } from "@playwright/test";

import { login, unique } from "./helpers";
import { FakePhone } from "./phone";

/** A valid mobile number nobody else uses (it is made from the clock). */
const mobile = () => `7${String(Date.now() % 1_000_000_000).padStart(9, "0")}`;

/** An administrator makes a contact and hands it to an employee, the way the Contacts page does. */
async function giveContact(page: Page, employeeId: number, name: string, phone: string) {
  const res = await page.request.post("/api/backend/contacts", { headers: { "x-requested-with": "admin-web" }, data: { name, phone, assign_to_employee_id: employeeId } });
  expect(res.ok(), await res.text()).toBe(true);
}

test.describe("follow-ups and responses", () => {
  const tag = unique();
  const late = { name: `Late Lead ${tag}`, phone: mobile() };
  const warm = { name: `Warm Lead ${tag}`, phone: String(Number(mobile()) + 1) };

  test.beforeAll(async ({ browser }) => {
    // an employee's phone talks to two people: one asks to be called back (and the time has already passed), one is interested
    const page = await browser.newPage();
    await login(page);
    const phone = await new FakePhone(page.request).signIn("emp009@example.com", "Employee@123");
    await giveContact(page, phone.employeeId, late.name, late.phone);
    await giveContact(page, phone.employeeId, warm.name, warm.phone);
    const started = new Date(Date.now() - 20 * 60_000);
    const first = await phone.dial(late.phone, started);
    await phone.answer(first, new Date(started.getTime() + 8_000));
    await phone.hangUp(first, { startedAt: started, talkSeconds: 90, outcome: "CALLBACK", note: "Call me after lunch with the price list", callbackAt: new Date(Date.now() - 60_000), callbackNote: "Send the price list" });
    const secondStart = new Date(Date.now() - 10 * 60_000);
    const second = await phone.dial(warm.phone, secondStart);
    await phone.hangUp(second, { startedAt: secondStart, talkSeconds: 45, outcome: "INTERESTED", note: "Wants a demo on Friday" });
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("the dashboard counts the people spoken to, by what they answered, and the follow-ups that are late", async ({ page }) => {
    await page.goto("/followups");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Follow-ups");
    await expect(page.getByTestId("fkpi-people-value")).not.toHaveText("0");
    await expect.poll(async () => Number((await page.getByTestId("fkpi-overdue-value").innerText()).replace(/[^\d]/g, ""))).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("response-followup-count")).not.toHaveText("0");
    await expect(page.getByTestId("response-interested-count")).not.toHaveText("0");
    // the employee is in the table, with the late follow-up
    const row = page.getByTestId("followup-employee-row").filter({ hasText: /EMP009/i });
    await expect(row).toHaveCount(1);
  });

  test("the people list shows the latest response, what the employee wrote and when the next call is due", async ({ page }) => {
    await page.goto("/followups");
    await page.getByTestId("followup-search").fill(`Lead ${tag}`);
    await expect(page.getByTestId("conversation-row")).toHaveCount(2);
    const lateRow = page.getByTestId("conversation-row").filter({ hasText: late.name });
    await expect(lateRow).toContainText("Callback");
    await expect(lateRow).toContainText("Call me after lunch with the price list");
    await expect(lateRow).toContainText(/Overdue/);
    const warmRow = page.getByTestId("conversation-row").filter({ hasText: warm.name });
    await expect(warmRow).toContainText("Interested");
    await expect(warmRow).toContainText("Wants a demo on Friday");
    await expect(warmRow).not.toContainText(/Overdue|Today|Tomorrow/);

    // the response filter keeps only the people who gave that answer
    await page.getByTestId("response-interested").click();
    await expect(page.getByTestId("conversation-row")).toHaveCount(1);
    await expect(page.getByTestId("conversation-row")).toContainText(warm.name);
    await page.getByTestId("response-interested").click(); // (pressed again: filter off)
    await expect(page.getByTestId("conversation-row")).toHaveCount(2);
  });

  test("the follow-ups to do come with the reason and what was said before, and open into the whole conversation", async ({ page }) => {
    await page.goto("/followups");
    await page.getByRole("tab", { name: /To call back/ }).click();
    await page.getByTestId("followup-search").fill(`Lead ${tag}`);
    const row = page.getByTestId("followup-row");
    await expect(row).toHaveCount(1); // (only the late one has a follow-up)
    await expect(row).toContainText(late.name);
    await expect(row).toContainText(/Overdue/);
    await expect(row).toContainText("Send the price list");
    await expect(row).toContainText("Callback");
    await row.click();

    const drawer = page.getByTestId("conversation-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(late.name);
    await expect(drawer).toContainText("Send the price list");
    await expect(drawer).toContainText("Call me after lunch with the price list");
    await expect(drawer.getByTestId("timeline-call")).toHaveCount(1);
    expect(page.url()).toContain("talk=");
    // a call opens the usual call panel on top
    await drawer.getByTestId("timeline-call").getByRole("button").first().click();
    await expect(page.getByTestId("call-drawer")).toBeVisible();
  });

  test("a refresh keeps the conversation open, and an address that is not a conversation is ignored", async ({ page }) => {
    await page.goto("/followups");
    await page.getByTestId("followup-search").fill(late.name);
    await expect(page.getByTestId("conversation-row")).toHaveCount(1); // (the search waits a moment before it asks: do not click the old list)
    await page.getByTestId("conversation-row").first().click();
    await expect(page.getByTestId("conversation-drawer")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("conversation-drawer")).toBeVisible();
    await expect(page.getByTestId("conversation-drawer")).toContainText(late.name);
    await page.goto("/followups?talk=../../etc/passwd");
    await expect(page.getByTestId("conversation-drawer")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Follow-ups");
  });

  test("an employee's own page lists the people they called with the response and the follow-up", async ({ page }) => {
    await page.goto("/employees");
    await page.getByTestId("employee-search").fill("emp009");
    await expect(page.getByTestId("employee-row")).toHaveCount(1);
    await page.getByTestId("employee-row").first().click();
    await page.waitForURL(/\/employees\/\d+/);
    await page.getByRole("tab", { name: /Responses/ }).click();
    const row = page.getByTestId("conversation-row").filter({ hasText: late.name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Callback");
    await expect(row).toContainText(/Overdue/);
    await row.click();
    await expect(page.getByTestId("conversation-drawer")).toContainText("Call me after lunch with the price list");
  });

  test("the page is in the navigation", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Follow-ups" }).first().click();
    await page.waitForURL(/\/followups/);
  });
});
