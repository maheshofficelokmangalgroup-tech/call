import { expect, test } from "@playwright/test";

// EMP001 of `python -m scripts.seed_demo`.
const IDENTIFIER = process.env.E2E_IDENTIFIER ?? "EMP001";
const PASSWORD = process.env.E2E_PASSWORD ?? "Employee@123";

// the smallest phones in use: a folded Galaxy Fold, an old iPhone SE, and the common small Android size
const SIZES = [
  { width: 280, height: 653 },
  { width: 320, height: 568 },
  { width: 360, height: 640 },
];
const PAGES = ["/", "/queue", "/history", "/callbacks", "/notifications", "/profile", "/dial"];

test("no page needs sideways scrolling on a small phone", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the sizes are set inside the test; one project is enough");
  await page.addInitScript(() => localStorage.setItem("ec_web_no_dialer", "1"));

  await page.setViewportSize(SIZES[0]);
  await page.goto("/login");
  await page.getByTestId("login-identifier").fill(IDENTIFIER);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("start-calling")).toBeVisible();

  const tooWide: string[] = [];
  for (const size of SIZES) {
    await page.setViewportSize(size);
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      if (scrollWidth > clientWidth + 1) tooWide.push(`${size.width}x${size.height} ${path}: page is ${scrollWidth}px wide, screen is ${clientWidth}px`);
    }
  }
  expect(tooWide, tooWide.join("\n")).toEqual([]);
});
