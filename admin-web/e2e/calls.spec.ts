import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { login, panelGet } from "./helpers";
import { FakePhone } from "./phone";

/** A fictional number (the 555-01xx block is reserved for stories and tests) in the way the panel writes it. */
function fictionalNumber() {
  const tail = String(100 + Math.floor(Math.random() * 100)).padStart(4, "0");
  return { dialled: `+1415555${tail}`, shown: `+1 (415) 555-${tail}` };
}

async function audioState(page: Page) {
  return page.evaluate(() => {
    const a = document.querySelector("audio");
    return a ? { time: a.currentTime, paused: a.paused, rate: a.playbackRate, duration: a.duration, ready: a.readyState, src: a.currentSrc } : null;
  });
}

test.describe("calls", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/calls");
    await expect(page.getByTestId("call-row").first()).toBeVisible();
  });

  test("lists calls with their time, who was called, the result and the talk time", async ({ page }) => {
    expect(await page.getByTestId("call-row").count()).toBeGreaterThanOrEqual(20);
    await expect(page.getByTestId("call-row").first()).toContainText(/\d{1,2}:\d{2}\s?(am|pm)/i);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Calls");
    await expect(page.getByText(/[\d,]+ found/)).toBeVisible();
  });

  test("the result filter keeps only answered calls", async ({ page }) => {
    await page.getByTestId("filter-status").click();
    await page.getByRole("option", { name: "Answered", exact: true }).click();
    await expect.poll(async () => (await page.getByTestId("call-row").allTextContents()).every((t) => /Answered/.test(t) && !/Not answered/.test(t))).toBe(true);
    expect(await page.getByTestId("call-row").count()).toBeGreaterThan(0);
  });

  test("'Recorded' keeps only calls that have a recording", async ({ page }) => {
    await page.getByRole("radio", { name: "Recorded", exact: true }).click();
    await expect.poll(async () => page.getByTestId("call-row").count()).toBeGreaterThan(0);
    await expect.poll(async () => {
      const flags = await page.getByTestId("call-row").locator('[data-testid="recording-flag"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-recording")));
      return flags.length > 0 && flags.every((f) => f === "available" || f === "uploading" || f === "failed");
    }).toBe(true);
    await page.getByRole("radio", { name: "Not recorded", exact: true }).click();
    await expect.poll(async () => {
      const flags = await page.getByTestId("call-row").locator('[data-testid="recording-flag"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-recording")));
      return flags.every((f) => f === "missing");
    }).toBe(true);
  });

  test("searching by a number finds the calls made to it", async ({ page, request }) => {
    const phone = await new FakePhone(request).signIn("emp005@example.com", "Employee@123");
    const n = fictionalNumber();
    const startedAt = new Date(Date.now() - 20_000);
    const call = await phone.dial(n.dialled, startedAt);
    await phone.hangUp(call, { startedAt, talkSeconds: 0, ringSeconds: 18, outcome: "NO_ANSWER" });

    await page.getByTestId("call-search").fill(n.dialled);
    await expect(page.getByTestId("call-row").first()).toContainText(n.shown);
    for (const text of await page.getByTestId("call-row").allTextContents()) expect(text).toContain(n.shown);
    await page.getByTestId("call-search").fill("zzz-no-such-number");
    await expect(page.getByText("No calls match these filters")).toBeVisible();
  });

  test("the longest calls can be listed first", async ({ page }) => {
    const response = page.waitForResponse((r) => /\/api\/backend\/calls\?/.test(r.url()) && r.url().includes("sort=longest"));
    await page.getByTestId("filter-sort").click();
    await page.getByRole("option", { name: "Longest talk first" }).click();
    const body = await (await response).json();
    const seconds: number[] = body.items.map((c: { duration_seconds: number }) => c.duration_seconds);
    expect(seconds.length).toBeGreaterThan(5);
    expect(seconds).toEqual([...seconds].sort((a, b) => b - a));
  });

  test("a call opens with its timing, its timeline and a recording that can be played", async ({ page }) => {
    await page.getByRole("radio", { name: "Recorded", exact: true }).click();
    const withRecording = page.getByTestId("call-row").filter({ has: page.locator('[data-recording="available"]') }).first();
    await expect(withRecording).toBeVisible();
    await withRecording.click();

    const drawer = page.getByTestId("call-drawer");
    await expect(drawer).toBeVisible();
    for (const label of ["Called by", "Timing", "Recording", "What happened"]) await expect(drawer.getByText(label, { exact: true })).toBeVisible();
    for (const tile of ["Started", "Talk time", "Rang for", "Ended"]) await expect(drawer.getByText(tile, { exact: true })).toBeVisible();
    await expect(drawer.getByText("Call started")).toBeVisible();
    await expect(drawer.getByText("Answered", { exact: true }).first()).toBeVisible();
    await expect(drawer.getByText("Call ended")).toBeVisible();
    // the address now says which call is open
    await expect(page).toHaveURL(/[?&]call=\d+/);

    // play: the clock moves
    const toggle = drawer.getByTestId("audio-toggle");
    await toggle.click();
    await expect.poll(async () => (await audioState(page))?.time ?? 0, { timeout: 20_000 }).toBeGreaterThan(0.6);
    expect((await audioState(page))?.paused).toBe(false);
    expect((await audioState(page))?.src).toContain("/api/backend/recordings/");

    // seek, change speed, pause
    await drawer.getByRole("slider", { name: "Seek" }).fill("3");
    await expect.poll(async () => (await audioState(page))?.time ?? 0).toBeGreaterThan(2.5);
    await drawer.getByRole("button", { name: /Playback speed/ }).click();
    expect((await audioState(page))?.rate).toBe(1.25);
    await toggle.click();
    await expect.poll(async () => (await audioState(page))?.paused).toBe(true);

    // administrators can download the file
    const [download] = await Promise.all([page.waitForEvent("download"), drawer.getByRole("button", { name: "Download recording" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^recording-\d+\.(wav|mp3|m4a)$/);
    expect(readFileSync(await download.path()).subarray(0, 4).toString()).toBe("RIFF");

    // every listen is written to the audit log
    const log = await (await panelGet(page, "audit-logs?action=recording.access&page_size=5")).json();
    expect(log.total).toBeGreaterThan(0);

    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(page).not.toHaveURL(/call=/);
  });

  test("opening and closing a call keeps the search and the filters", async ({ page }) => {
    await page.getByTestId("call-search").fill("+1");
    await page.getByRole("radio", { name: "Recorded", exact: true }).click();
    await expect.poll(async () => page.getByTestId("call-row").count()).toBeGreaterThan(0);
    await page.getByTestId("call-row").first().click();
    await expect(page.getByTestId("call-drawer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("call-drawer")).toHaveCount(0);
    // nothing typed or chosen was thrown away by the address changing
    await expect(page.getByTestId("call-search")).toHaveValue("+1");
    await expect(page.getByRole("radio", { name: "Recorded", exact: true })).toHaveAttribute("aria-checked", "true");
  });

  test("a call link opens straight into the call", async ({ page }) => {
    const first = await (await panelGet(page, "calls?page_size=1")).json();
    await page.goto(`/calls?call=${first.items[0].id}`);
    await expect(page.getByTestId("call-drawer")).toBeVisible();
    await expect(page.getByTestId("call-drawer").getByText("Called by")).toBeVisible();
  });

  test("the panel says why an answered call has no recording", async ({ page, request }) => {
    const phone = await new FakePhone(request).signIn("emp006@example.com", "Employee@123");
    const cases = [
      { recording: "silent", headline: "Recorded, but silent" },
      { recording: "no_permission", headline: "Microphone not allowed" },
      { recording: "failed", headline: "The phone could not record" },
    ] as const;
    for (const c of cases) {
      const n = fictionalNumber();
      const startedAt = new Date(Date.now() - 60_000);
      const call = await phone.dial(n.dialled, startedAt);
      await phone.hangUp(call, { startedAt, ringSeconds: 7, talkSeconds: 25, outcome: "CONNECTED", recording: c.recording });
      await page.goto(`/calls?call=${call.id}`);
      await expect(page.getByTestId("call-drawer").getByText(c.headline)).toBeVisible();
      await expect(page.getByTestId("audio-player")).toHaveCount(0);
    }
    // a call nobody answered has nothing to record
    const n = fictionalNumber();
    const startedAt = new Date(Date.now() - 30_000);
    const call = await phone.dial(n.dialled, startedAt);
    await phone.hangUp(call, { startedAt, ringSeconds: 25, talkSeconds: 0, outcome: "NO_ANSWER" });
    await page.goto(`/calls?call=${call.id}`);
    await expect(page.getByTestId("call-drawer").getByText("The call was not answered")).toBeVisible();
  });

  test("the list of calls can be exported with the filters applied", async ({ page }) => {
    await page.getByTestId("filter-status").click();
    await page.getByRole("option", { name: "Not answered" }).click();
    await expect.poll(async () => (await page.getByTestId("call-row").allTextContents()).every((t) => /Not answered/.test(t))).toBe(true);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-calls").click()]);
    expect(download.suggestedFilename()).toMatch(/^calls-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = readFileSync(await download.path(), "utf8");
    expect(text.startsWith("﻿")).toBe(true);
    const lines = text.trim().split(/\r?\n/);
    expect(lines[0]).toContain("Call ID,Employee ID,Employee,Contact,Phone");
    expect(lines.length).toBeGreaterThan(50);
    // only the filtered calls are in the file
    expect(lines.slice(1).every((l) => l.includes("no_answer"))).toBe(true);
  });
});
