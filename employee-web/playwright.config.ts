import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests against a RUNNING app and API with the demo data (see README.md):
 *
 *   BASE_URL=http://127.0.0.1:5173 npm run e2e
 *
 * PW_CHANNEL=msedge (or chrome) uses an installed browser instead of the one `npx playwright install` downloads.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://127.0.0.1:5173",
    channel: process.env.PW_CHANNEL || undefined,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"], channel: process.env.PW_CHANNEL || undefined } },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  ],
});
