import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a real panel talking to a real backend that holds demo data
 * (see e2e/README.md). The panel's address comes from E2E_BASE_URL, the backend's from E2E_BACKEND_URL.
 *
 * PW_CHANNEL=chrome uses the Chrome that is installed on the computer instead of downloading Playwright's own browser.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const channel = process.env.PW_CHANNEL || undefined;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL,
    channel,
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // the sign-in cookies are "Secure" only in production, so plain http works for the test run
    ignoreHTTPSErrors: true,
  },
  projects: [
    { name: "desktop", testIgnore: /mobile\.spec\.ts/, use: { ...devices["Desktop Chrome"], channel, viewport: { width: 1440, height: 900 } } },
    { name: "mobile", testMatch: /mobile\.spec\.ts/, use: { ...devices["Pixel 7"], channel } },
  ],
});
