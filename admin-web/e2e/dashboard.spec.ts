import { expect, test } from "@playwright/test";

import { ADMIN, MANAGER, login, panelGet } from "./helpers";
import { FakePhone } from "./phone";

const digits = (text: string | null) => Number((text ?? "").replace(/[^\d]/g, ""));

/** A fictional number (the 555-01xx block is reserved for stories and tests) in the way the panel writes it. */
function fictionalNumber() {
  const tail = String(100 + Math.floor(Math.random() * 100)).padStart(4, "0");
  return { dialled: `+1415555${tail}`, shown: `+1 (415) 555-${tail}` };
}

test.describe("dashboard", () => {
  test("shows the numbers of the API, not made-up ones", async ({ page }) => {
    const overview = page.waitForResponse((r) => r.url().includes("/api/backend/analytics/overview") && r.status() === 200);
    await login(page);
    const data = await (await overview).json();
    expect(data.totals.calls).toBeGreaterThan(0);

    // the numbers count up for a moment; wait until they have arrived
    await expect.poll(async () => digits(await page.getByTestId("kpi-calls-value").textContent())).toBe(data.totals.calls);
    await expect.poll(async () => digits(await page.getByTestId("kpi-answered-value").textContent())).toBe(data.totals.connected);
    await expect.poll(async () => digits(await page.getByTestId("kpi-recordings-value").textContent())).toBe(data.totals.recordings);
  });

  test("every section of the page is there", async ({ page }) => {
    await login(page);
    for (const id of ["kpis", "live-panel", "recent-calls", "chart-activity", "leaderboard", "recording-coverage", "heatmap"]) {
      await expect(page.getByTestId(id), id).toBeVisible();
    }
    await expect(page.getByTestId("leaderboard").locator("li")).not.toHaveCount(0);
  });

  test("choosing another period changes what is shown and is remembered", async ({ page }) => {
    await login(page);
    await expect(page.getByTestId("range-picker")).toContainText("Last 7 days");
    await page.getByTestId("range-picker").click();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.getByTestId("range-picker")).toContainText("Today");
    await page.reload();
    await expect(page.getByTestId("range-picker")).toContainText("Today");
    // put it back for the other tests
    await page.getByTestId("range-picker").click();
    await page.getByRole("button", { name: "Last 7 days", exact: true }).click();
    await expect(page.getByTestId("range-picker")).toContainText("Last 7 days");
  });

  test("a call placed on a phone appears live, then moves to the latest calls with its recording", async ({ page, request }) => {
    const phone = await new FakePhone(request).signIn("emp004@example.com", "Employee@123");
    const { dialled, shown } = fictionalNumber();
    await login(page);

    const startedAt = new Date();
    const call = await phone.dial(dialled, startedAt);
    await phone.answer(call, new Date(startedAt.getTime() + 6000));

    // the live panel asks again every few seconds by itself
    const live = page.getByTestId("live-call").filter({ hasText: shown });
    await expect(live).toBeVisible({ timeout: 30_000 });
    await expect(live).toContainText("Talking");
    await expect(live).toContainText(/Priya Joshi/);

    await phone.hangUp(call, { startedAt, ringSeconds: 6, talkSeconds: 6, outcome: "INTERESTED", recording: "saved" });
    await phone.uploadRecording(call);

    // it leaves the live panel and shows up among the latest calls, marked as recorded
    await expect(live).toHaveCount(0, { timeout: 30_000 });
    const latest = page.getByTestId("recent-call").filter({ hasText: shown.replace("+1 ", "") }).first();
    await expect(latest).toBeVisible({ timeout: 30_000 });
    await expect(latest.locator('[title="Has a recording"]')).toBeVisible();
    await latest.click();
    await expect(page.getByTestId("call-drawer")).toBeVisible();
    await expect(page.getByTestId("audio-player")).toBeVisible();
  });

  test("the search box finds an employee and opens their profile", async ({ page }) => {
    await login(page);
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder(/search pages, employees/i).fill("Aarav");
    await page.getByRole("option", { name: /Aarav Patil/ }).click();
    await page.waitForURL(/\/employees\/\d+/);
    await expect(page.getByTestId("employee-name")).toHaveText("Aarav Patil");
  });

  test("dark mode can be switched on and stays on after a reload", async ({ page }) => {
    await login(page);
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  });

  test("a manager sees only the numbers of their own team", async ({ page, browser }) => {
    await login(page, ADMIN);
    const all = await (await panelGet(page, "analytics/overview")).json();

    // a second, separate browser profile: the manager's session must not mix with the administrator's
    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    try {
      const managerPage = await other.newPage();
      await login(managerPage, MANAGER);
      const mine = await (await panelGet(managerPage, "analytics/overview")).json();
      expect(mine.scope).toBe("team");
      expect(mine.totals.calls).toBeLessThan(all.totals.calls);
      expect(mine.totals.calls).toBeGreaterThan(0);
    } finally {
      await other.close();
    }
  });
});
