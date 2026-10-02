import { expect, test, type Page } from "@playwright/test";

import { login, panelGet } from "./helpers";

/**
 * On a phone nothing may be wider than the screen: a sideways scroll is the clearest sign of a broken layout.
 * The comparison is with the real screen: when something sticks out, a phone's browser widens its layout, so window.innerWidth
 * grows with the page and would always agree with it.
 */
async function expectNoSidewaysScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.screen.width }));
  expect(overflow.scroll, `${label}: the page is ${overflow.scroll}px wide on a ${overflow.view}px screen`).toBeLessThanOrEqual(overflow.view + 1);
}

test.describe("on a phone", () => {
  test("sign in, open the menu and move around", async ({ page }) => {
    await login(page);
    await expect(page.getByTestId("kpis")).toBeVisible();
    // the side menu is hidden until the button is pressed
    await expect(page.getByRole("link", { name: "Employees" })).toHaveCount(0);
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("link", { name: "Employees" }).click();
    await page.waitForURL(/\/employees/);
    // the menu closed by itself on arrival
    await expect(page.getByRole("link", { name: "Teams" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Employees" })).toBeVisible();
  });

  test("employees are shown as cards, calls as cards, and nothing scrolls sideways", async ({ page }) => {
    await login(page);
    await page.goto("/employees");
    await expect(page.getByText("Aarav Patil").first()).toBeVisible();
    await expect(page.getByTestId("employee-table")).toBeHidden();
    await expectNoSidewaysScroll(page, "employees");

    await page.goto("/calls");
    await expect(page.getByTestId("call-card").first()).toBeVisible();
    await expect(page.getByTestId("calls-table")).toBeHidden();
    await expectNoSidewaysScroll(page, "calls");
  });

  test("every page fits the screen", async ({ page }) => {
    await login(page);
    const first = await (await panelGet(page, "employees?q=EMP001")).json();
    for (const path of ["/dashboard", "/recordings", "/teams", "/contacts", "/campaigns", "/audit", "/settings", `/employees/${first.items[0].id}`]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).or(page.getByTestId("employee-name"))).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectNoSidewaysScroll(page, path);
    }
  });

  test("a call opens as a full-screen panel with the player", async ({ page }) => {
    await login(page);
    await page.goto("/recordings");
    // the newest recordings may still be uploading (no player yet): take one that can be played
    const playable = page.getByTestId("recording-row").filter({ has: page.locator('[data-testid="recording-play"]:not([disabled])') }).first();
    await playable.getByRole("button", { name: "Details" }).click();
    const drawer = page.getByTestId("call-drawer");
    await expect(drawer).toBeVisible();
    const box = await drawer.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.width).toBeGreaterThanOrEqual(viewport.width - 2);
    await expect(drawer.getByTestId("audio-player")).toBeVisible();
    await expectNoSidewaysScroll(page, "call panel");
  });

  test("creating an employee works with the on-screen keyboard layout", async ({ page }) => {
    await login(page);
    await page.goto("/employees?new=1");
    const dialog = page.getByTestId("employee-dialog");
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await expect(dialog.getByTestId("employee-submit")).toBeVisible();
    await expectNoSidewaysScroll(page, "new employee");
  });
});
