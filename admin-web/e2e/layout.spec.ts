import { expect, test, type Locator } from "@playwright/test";

import { login } from "./helpers";

/** Where a panel really is on the screen once its opening animation is over (the animation moves it). */
async function whereIs(element: Locator) {
  await element.evaluate((node) => Promise.all(node.getAnimations().map((a) => a.finished)));
  return element.evaluate((node) => {
    const r = node.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: window.innerWidth, height: window.innerHeight };
  });
}

test.describe("overlays sit where they belong", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("a form dialog is in the middle of the screen, fully visible", async ({ page }) => {
    await page.goto("/teams");
    await page.getByTestId("new-team").click();
    const box = await whereIs(page.getByRole("dialog"));
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(box.width);
    expect(box.bottom).toBeLessThanOrEqual(box.height);
    expect(Math.abs((box.left + box.right) / 2 - box.width / 2)).toBeLessThan(2);
    expect(Math.abs((box.top + box.bottom) / 2 - box.height / 2)).toBeLessThan(2);
  });

  test("a big dialog still fits inside the screen", async ({ page }) => {
    await page.goto("/employees");
    await page.getByTestId("new-employee").click();
    const box = await whereIs(page.getByTestId("employee-dialog"));
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(box.height);
    expect(Math.abs((box.left + box.right) / 2 - box.width / 2)).toBeLessThan(2);
  });

  test("the search palette is centred across and near the top", async ({ page }) => {
    await page.goto("/dashboard");
    // the shortcut only works once the page has been hydrated: a key pressed before that is lost, so press it again until it opens
    await expect(async () => {
      await page.keyboard.press("Control+k");
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2500 });
    }).toPass({ timeout: 20_000 });
    const box = await whereIs(page.getByRole("dialog"));
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(box.width);
    expect(Math.abs((box.left + box.right) / 2 - box.width / 2)).toBeLessThan(2);
    // 18 % from the top of the screen
    expect(Math.abs(box.top - box.height * 0.18)).toBeLessThan(2);
  });

  test("the side panel is against the right edge and as tall as the screen", async ({ page }) => {
    await page.goto("/contacts");
    await page.getByTestId("contact-row").first().click();
    const box = await whereIs(page.getByTestId("contact-drawer"));
    expect(Math.abs(box.right - box.width)).toBeLessThan(2);
    expect(box.top).toBeLessThan(2);
    expect(Math.abs(box.bottom - box.height)).toBeLessThan(2);
  });
});
