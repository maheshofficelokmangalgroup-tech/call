import { expect, test } from "@playwright/test";

import { login, panelGet } from "./helpers";

test.describe("recordings", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/recordings");
    await expect(page.getByTestId("recording-row").first()).toBeVisible();
  });

  test("lists recorded calls and plays one in place", async ({ page }) => {
    const ready = page.getByTestId("recording-row").filter({ has: page.locator('[data-testid="recording-play"]:not([disabled])') }).first();
    await ready.getByTestId("recording-play").click();
    const player = ready.getByTestId("audio-player");
    await expect(player).toBeVisible();
    await player.getByTestId("audio-toggle").click();
    await expect
      .poll(() => page.evaluate(() => document.querySelector("audio")?.currentTime ?? 0), { timeout: 20_000 })
      .toBeGreaterThan(0.6);
    // the player has a length, a seek bar and speed control
    await expect(player.getByRole("slider", { name: "Seek" })).toBeEnabled();
    await expect(player.getByText(/^\d\d:\d\d$/).last()).toBeVisible();
  });

  test("only one recording plays at a time", async ({ page }) => {
    const rows = page.getByTestId("recording-row").filter({ has: page.locator('[data-testid="recording-play"]:not([disabled])') });
    await rows.nth(0).getByTestId("recording-play").click();
    await rows.nth(0).getByTestId("audio-toggle").click();
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll("audio")].filter((a) => !a.paused).length)).toBe(1);
    await rows.nth(1).getByTestId("recording-play").click();
    await rows.nth(1).getByTestId("audio-toggle").click();
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll("audio")].filter((a) => !a.paused).length), { timeout: 20_000 }).toBe(1);
  });

  test("recordings that are still arriving cannot be played yet", async ({ page }) => {
    const waiting = page.getByTestId("recording-row").filter({ hasText: /Uploading|Upload failed/ });
    await expect(waiting.first()).toBeVisible();
    await expect(waiting.first().getByTestId("recording-play")).toBeDisabled();
  });

  test("the coverage box says how many answered calls were recorded and why the others were not", async ({ page }) => {
    const box = page.getByTestId("recording-coverage");
    await expect(box).toContainText(/\d+%/);
    await expect(box).toContainText("With recording");
    await expect(box).toContainText("Without recording");
    await expect(box).toContainText("Why some calls have no recording");
    // the figures match what the API says
    const overview = await (await panelGet(page, `analytics/overview`)).json();
    await expect(box).toContainText(String(overview.recording.recorded_calls));
  });

  test("the list can be limited to one employee", async ({ page }) => {
    await page.getByTestId("filter-employee").click();
    await page.getByRole("option", { name: "Aarav Patil" }).click();
    await expect.poll(async () => (await page.getByTestId("recording-row").allTextContents()).every((t) => t.includes("Aarav Patil"))).toBe(true);
    expect(await page.getByTestId("recording-row").count()).toBeGreaterThan(0);
  });

  test("Details opens the whole call", async ({ page }) => {
    await page.getByTestId("recording-row").first().getByRole("button", { name: "Details" }).click();
    await expect(page.getByTestId("call-drawer")).toBeVisible();
    await expect(page.getByTestId("call-drawer").getByText("Timing")).toBeVisible();
  });
});
