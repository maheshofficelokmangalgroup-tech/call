import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { MANAGER, backendLogin, login, panelGet, unique } from "./helpers";

async function openCreateDialog(page: Page) {
  await page.goto("/employees");
  await page.getByTestId("new-employee").click();
  const dialog = page.getByTestId("employee-dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Create an account through the dialog and return what the administrator is shown to hand over. */
async function createThroughDialog(page: Page, v: { name: string; email: string; phone?: string; role?: "Manager" | "Administrator"; team?: string; target?: string }) {
  const dialog = await openCreateDialog(page);
  await dialog.getByLabel("Full name").fill(v.name);
  await dialog.getByLabel("Email").fill(v.email);
  if (v.phone) await dialog.getByLabel("Mobile number").fill(v.phone);
  if (v.role) {
    await dialog.locator("#ef-role").click();
    await page.getByRole("option", { name: new RegExp(v.role) }).click();
  }
  if (v.team) {
    await dialog.locator("#ef-team").click();
    await page.getByRole("option", { name: v.team }).click();
  }
  if (v.target) await dialog.getByLabel("Daily call target").fill(v.target);
  await dialog.getByTestId("employee-submit").click();
  const card = dialog.getByTestId("credentials-card");
  await expect(card).toBeVisible();
  const code = (await card.getByTestId("cred-employee-id").textContent())!.trim();
  await card.getByRole("button", { name: "Show Password" }).click();
  const password = (await card.getByTestId("cred-password").textContent())!.trim();
  return { dialog, card, code, password };
}

test.describe("employees list", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/employees");
    await expect(page.getByTestId("employee-row").first()).toBeVisible();
  });

  test("lists everybody with their calls, talk time and status", async ({ page }) => {
    expect(await page.getByTestId("employee-row").count()).toBeGreaterThanOrEqual(10);
    const first = page.getByTestId("employee-row").first();
    await expect(first).toContainText(/\d+ picked up/);
    await expect(first).toContainText(/On a call|Online|Idle|Offline|Inactive/);
    // the busiest person comes first
    const calls = await page.getByTestId("employee-row").evaluateAll((rows) => rows.map((r) => Number((r.querySelectorAll("td")[2]?.querySelector("p")?.textContent ?? "0").replace(/[^\d]/g, ""))));
    expect(calls).toEqual([...calls].sort((a, b) => b - a));
  });

  test("search narrows the list", async ({ page }) => {
    await page.getByTestId("employee-search").fill("Sneha");
    await expect(page.getByTestId("employee-row")).toHaveCount(1);
    await expect(page.getByTestId("employee-row")).toContainText("Sneha Kulkarni");
    await page.getByTestId("employee-search").fill("zzz-nobody");
    await expect(page.getByText("Nobody matches these filters")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).first().click();
    await expect(page.getByTestId("employee-row").first()).toBeVisible();
  });

  test("the status chips filter by activity", async ({ page }) => {
    await page.getByTestId("chip-inactive").click();
    const rows = page.getByTestId("employee-row");
    await expect(rows).not.toHaveCount(0);
    for (const text of await rows.allTextContents()) expect(text).toContain("Inactive");
    await page.getByTestId("chip-all").click();
    expect(await rows.count()).toBeGreaterThanOrEqual(10);
  });

  test("opening the New employee form does not throw away the search", async ({ page }) => {
    await page.getByTestId("employee-search").fill("Sneha");
    await expect(page.getByTestId("employee-row")).toHaveCount(1);
    await page.getByTestId("new-employee").click();
    await expect(page.getByTestId("employee-dialog")).toBeVisible();
    await expect(page).toHaveURL(/[?&]new=1/);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("employee-dialog")).toHaveCount(0);
    await expect(page).not.toHaveURL(/new=1/);
    await expect(page.getByTestId("employee-search")).toHaveValue("Sneha");
    await expect(page.getByTestId("employee-row")).toHaveCount(1);
  });

  test("the palette's 'New employee' opens the form", async ({ page }) => {
    await page.keyboard.press("Control+k");
    await page.getByRole("option", { name: /New employee/ }).click();
    await expect(page.getByTestId("employee-dialog")).toBeVisible();
  });

  test("clicking a row opens the profile", async ({ page }) => {
    await page.getByTestId("employee-search").fill("Aarav");
    // the whole list is on screen until the answer for "Aarav" arrives: wait for it, or the first row of the old list is opened
    await expect(page.getByTestId("employee-row")).toHaveCount(1);
    await page.getByTestId("employee-row").first().click();
    await page.waitForURL(/\/employees\/\d+/);
    await expect(page.getByTestId("employee-name")).toHaveText("Aarav Patil");
  });

  test("the list can be exported as a spreadsheet", async ({ page }) => {
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-employees").click()]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const text = readFileSync(await download.path(), "utf8");
    expect(text.startsWith("﻿")).toBe(true);
    expect(text).toContain("Employee ID,Name,Email");
    expect(text).toContain("Aarav Patil");
  });
});

test.describe("creating an employee", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("the form explains what is missing", async ({ page }) => {
    const dialog = await openCreateDialog(page);
    await dialog.getByTestId("employee-submit").click();
    await expect(dialog.getByText("Enter the employee's full name.")).toBeVisible();
    await expect(dialog.getByText("Enter an email address.")).toBeVisible();
    await dialog.getByLabel("Email").fill("not-an-email");
    await dialog.getByTestId("employee-submit").click();
    await expect(dialog.getByText("Enter a valid email address.")).toBeVisible();
    // a typed password must be strong enough
    await dialog.getByRole("radio", { name: "I will type one" }).click();
    await dialog.getByLabel("Password", { exact: true }).fill("abc");
    await dialog.getByTestId("employee-submit").click();
    await expect(dialog.getByText("Use at least 8 characters.")).toBeVisible();
  });

  test("a new employee gets a login that works on the phone", async ({ page, request }) => {
    const id = unique();
    const name = `Test Employee ${id}`;
    const email = `e2e.${id}@example.com`;
    const { dialog, card, code, password } = await createThroughDialog(page, { name, email, phone: "9822012345", team: "Sales Team A", target: "35" });

    expect(code).toMatch(/^EMP\d{3,}$/);
    expect(password).toMatch(/^[A-Za-z0-9]{12}$/);
    await expect(card.getByTestId("cred-email")).toHaveText(email);

    // copy-all works (and says so)
    await card.getByTestId("copy-credentials").click();
    await expect(page.getByText("Login details copied")).toBeVisible();

    // the WhatsApp link opens that person's chat with the details filled in
    const link = card.getByRole("link", { name: /WhatsApp/ });
    const href = (await link.getAttribute("href"))!;
    expect(href).toContain("https://wa.me/919822012345?text=");
    expect(decodeURIComponent(href)).toContain(password);

    // the proof: the same details sign in on the backend, the way the mobile app does
    const signIn = await backendLogin(request, code, password);
    expect(signIn.ok(), await signIn.text()).toBe(true);
    const body = await signIn.json();
    expect(body.employee.full_name).toBe(name);
    expect(body.employee.role).toBe("employee");
    expect(body.must_change_password).toBe(true);
    expect((await backendLogin(request, email, password)).ok()).toBe(true);

    await dialog.getByTestId("employee-done").click();
    await page.getByTestId("employee-search").fill(id);
    const row = page.getByTestId("employee-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(name);
    await expect(row).toContainText("Sales Team A");
    // they have just signed in on the phone (above), so the panel shows them as online
    await expect(row).toContainText("Online");
  });

  test("an email that is already used is refused", async ({ page }) => {
    const dialog = await openCreateDialog(page);
    await dialog.getByLabel("Full name").fill("Someone Else");
    await dialog.getByLabel("Email").fill("emp001@example.com");
    await dialog.getByTestId("employee-submit").click();
    await expect(dialog.getByTestId("employee-error")).toContainText(/already exists/i);
    await expect(dialog.getByTestId("credentials-card")).toHaveCount(0);
  });

  test("a typed password is used as given and never shown again", async ({ page, request }) => {
    const id = unique();
    const dialog = await openCreateDialog(page);
    await dialog.getByLabel("Full name").fill(`Typed Password ${id}`);
    await dialog.getByLabel("Email").fill(`typed.${id}@example.com`);
    await dialog.getByRole("radio", { name: "I will type one" }).click();
    await dialog.getByLabel("Password", { exact: true }).fill("Spring2026Sale");
    await dialog.getByTestId("employee-submit").click();
    const card = dialog.getByTestId("credentials-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("The password is the one you typed");
    await expect(card.getByTestId("cred-password")).toHaveCount(0);
    expect((await backendLogin(request, `typed.${id}@example.com`, "Spring2026Sale")).ok()).toBe(true);
  });

  test("a new manager signs in to the panel and must choose their own password first", async ({ page, browser }) => {
    const id = unique();
    const email = `manager.${id}@example.com`;
    const { dialog, password } = await createThroughDialog(page, { name: `New Manager ${id}`, email, role: "Manager", team: "Sales Team B" });
    await dialog.getByTestId("employee-done").click();

    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    try {
      const managerPage = await other.newPage();
      await login(managerPage, { email, password });
      // the temporary password has to be replaced before anything else can be done
      const change = managerPage.getByRole("dialog");
      await expect(change).toContainText("Choose a new password");
      await expect(change.getByRole("button", { name: "Close" })).toHaveCount(0);
      await change.getByLabel("Current password").fill(password);
      await change.getByLabel("New password", { exact: true }).fill("Brand-new-pass-77");
      await change.getByLabel("Repeat new password").fill("Brand-new-pass-77");
      await change.getByTestId("password-submit").click();
      await expect(change).toHaveCount(0);
      // a manager sees the team page numbers but cannot create employees
      await managerPage.goto("/employees");
      await expect(managerPage.getByTestId("new-employee")).toHaveCount(0);
    } finally {
      await other.close();
    }
  });
});

test.describe("importing employees from a sheet", () => {
  test("every line is checked, the good ones are created and the logins can be downloaded", async ({ page, request }) => {
    await login(page);
    await page.goto("/employees");
    await page.getByTestId("bulk-open").click();
    const dialog = page.getByTestId("bulk-dialog");
    await expect(dialog).toBeVisible();

    const id = unique();
    const csv = [
      "name,email,phone,employee_id,team,role,daily_target",
      `Bulk One ${id},bulk.one.${id}@example.com,9822000001,,Sales Team A,employee,40`,
      `Bulk Two ${id},bulk.two.${id}@example.com,,,,employee,`,
      `Bad Email ${id},not-an-email,,,,employee,`,
      `Already There,admin@example.com,,,,employee,`,
    ].join("\r\n");
    await dialog.getByTestId("bulk-file").setInputFiles({ name: "people.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });

    await expect(dialog.getByTestId("bulk-ready")).toContainText("3 lines ready");
    await expect(dialog.getByText("1 line with a problem")).toBeVisible();
    await expect(dialog.getByText("Email is not valid.")).toBeVisible();

    await dialog.getByTestId("bulk-run").click();
    await expect(dialog.getByTestId("bulk-created")).toHaveText("2");
    await expect(dialog.getByText(/already exists/i)).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByTestId("bulk-download").click()]);
    const sheet = readFileSync(await download.path(), "utf8");
    expect(sheet.startsWith("﻿")).toBe(true);
    expect(sheet).toContain("Name,Employee ID,Email,Password");
    const line = sheet.split(/\r?\n/).find((l) => l.includes(`bulk.one.${id}@example.com`));
    expect(line).toBeTruthy();
    const [, code, email, password] = line!.split(",");
    expect(password).toMatch(/^[A-Za-z0-9]{12}$/);
    expect((await backendLogin(request, email!, password!)).ok()).toBe(true);
    expect((await backendLogin(request, code!, password!)).ok()).toBe(true);

    await dialog.getByRole("button", { name: "Done" }).click();
    await page.getByTestId("employee-search").fill(`Bulk One ${id}`);
    await expect(page.getByTestId("employee-row")).toHaveCount(1);
  });

  test("a sheet without an email column is explained", async ({ page }) => {
    await login(page);
    await page.goto("/employees");
    await page.getByTestId("bulk-open").click();
    const dialog = page.getByTestId("bulk-dialog");
    await dialog.getByTestId("bulk-file").setInputFiles({ name: "wrong.csv", mimeType: "text/csv", buffer: Buffer.from("name,city\r\nRahul,Pune") });
    await expect(dialog.getByRole("alert")).toContainText(/needs a "email" column/);
  });
});

test.describe("managing one employee", () => {
  test("edit, reset the password, sign out, deactivate and activate again", async ({ page, request }) => {
    await login(page);
    const id = unique();
    const email = `manage.${id}@example.com`;
    const { dialog, code, password } = await createThroughDialog(page, { name: `Manage Me ${id}`, email });
    await dialog.getByTestId("employee-done").click();
    await page.getByTestId("employee-search").fill(id);
    await expect(page.getByTestId("employee-row")).toHaveCount(1); // the narrowed list, not the old one
    await page.getByTestId("employee-row").click();
    await page.waitForURL(/\/employees\/\d+/);
    await expect(page.getByTestId("employee-name")).toHaveText(`Manage Me ${id}`);

    // edit
    await page.getByRole("button", { name: "Manage" }).click();
    await page.getByRole("menuitem", { name: "Edit details" }).click();
    const edit = page.getByTestId("employee-dialog");
    await edit.getByLabel("Daily call target").fill("77");
    await edit.getByLabel("Mobile number").fill("9811122233");
    await edit.getByTestId("employee-submit").click();
    await expect(page.getByText("Changes saved")).toBeVisible();
    await expect(edit).toHaveCount(0);
    await expect(page.getByText("+91 98111 22233")).toBeVisible();

    // reset the password: the old one stops working, the new one works
    await page.getByRole("button", { name: "Manage" }).click();
    await page.getByRole("menuitem", { name: "Reset password" }).click();
    await page.getByTestId("reset-confirm").click();
    const card = page.getByTestId("credentials-card");
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Show Password" }).click();
    const fresh = (await card.getByTestId("cred-password").textContent())!.trim();
    expect(fresh).not.toBe(password);
    expect((await backendLogin(request, code, password)).status()).toBe(401);
    expect((await backendLogin(request, code, fresh)).ok()).toBe(true);
    await page.getByRole("button", { name: "Done" }).click();

    // deactivate: the account cannot sign in any more
    await page.getByRole("button", { name: "Manage" }).click();
    await page.getByRole("menuitem", { name: "Deactivate" }).click();
    await page.getByTestId("confirm-yes").click();
    await expect(page.getByText("Deactivated", { exact: true }).first()).toBeVisible();
    expect((await backendLogin(request, code, fresh)).ok()).toBe(false);

    // ...and works again once activated
    await page.getByRole("button", { name: "Manage" }).click();
    await page.getByRole("menuitem", { name: "Activate again" }).click();
    await page.getByTestId("confirm-yes").click();
    await expect(page.getByText("Deactivated", { exact: true })).toHaveCount(0);
    expect((await backendLogin(request, code, fresh)).ok()).toBe(true);
  });
});

test.describe("an employee's profile", () => {
  test("shows the same numbers as the API, and every tab works", async ({ page }) => {
    await login(page);
    const found = await (await panelGet(page, "employees?q=EMP001")).json();
    const id = found.items[0].id as number;

    const detail = page.waitForResponse((r) => r.url().includes(`/api/backend/analytics/employees/${id}`) && r.status() === 200);
    await page.goto(`/employees/${id}`);
    const data = await (await detail).json();
    await expect(page.getByTestId("employee-name")).toHaveText("Aarav Patil");
    await expect.poll(async () => Number(((await page.getByTestId("ekpi-calls-value").textContent()) ?? "").replace(/[^\d]/g, ""))).toBe(data.employee.calls);

    // calls
    await expect(page.getByTestId("call-row").first()).toBeVisible();
    // people called
    await page.getByRole("tab", { name: /People called/ }).click();
    await expect(page.getByTestId("people-table").locator("tbody tr").first()).toBeVisible();
    // recordings: open one and see the player
    await page.getByRole("tab", { name: /Recordings/ }).click();
    const rows = page.getByTestId("recording-row");
    await expect(rows.first()).toBeVisible();
    await rows.first().getByTestId("recording-play").click();
    await expect(page.getByTestId("audio-player")).toBeVisible();
    // phones
    await page.getByRole("tab", { name: /Phones/ }).click();
    await expect(page.getByTestId("device-card").first()).toContainText("Samsung Galaxy M34");
  });

  test("an employee that does not exist is explained", async ({ page }) => {
    await login(page);
    await page.goto("/employees/99999999");
    await expect(page.getByText("This employee does not exist")).toBeVisible();
  });

  test("a manager can look at a profile but not change it", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    try {
      const page = await context.newPage();
      await login(page, MANAGER);
      const team = await (await panelGet(page, "employees?role=employee")).json();
      expect(team.items.length).toBeGreaterThan(0);
      await page.goto(`/employees/${team.items[0].id}`);
      await expect(page.getByTestId("employee-hero")).toBeVisible();
      await expect(page.getByRole("button", { name: "Manage" })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
