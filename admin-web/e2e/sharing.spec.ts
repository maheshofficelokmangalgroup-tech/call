import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { BACKEND, backendLogin, login, unique } from "./helpers";

/** Create an employee through the panel's own proxy (as the signed-in administrator) and return what the administrator is told to hand over. */
async function createEmployee(page: Page, name: string, email: string) {
  const response = await page.request.post("/api/backend/employees", {
    headers: { "x-requested-with": "admin-web" },
    data: { full_name: name, email, role: "employee", daily_target: 50, device_binding_enabled: false, must_change_password: true },
  });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { employee: { id: number; employee_code: string }; temporary_password: string };
  return { id: created.employee.id, code: created.employee.employee_code, password: created.temporary_password };
}

async function chooseOwnPassword(request: APIRequestContext, code: string, password: string, next: string) {
  const login = await backendLogin(request, code, password);
  expect(login.ok()).toBe(true);
  const { access_token } = (await login.json()) as { access_token: string };
  const changed = await request.post(`${BACKEND}/api/v1/auth/change-password`, {
    headers: { authorization: `Bearer ${access_token}` },
    data: { current_password: password, new_password: next },
  });
  expect(changed.ok()).toBe(true);
}

test.describe("the password an administrator handed out", () => {
  test("can be looked at again until the employee chooses their own - then it is gone for good", async ({ page, request }) => {
    await login(page);
    const id = unique();
    const made = await createEmployee(page, `Vault Person ${id}`, `vault.${id}@example.com`);

    await page.goto(`/employees/${made.id}`);
    await page.getByRole("button", { name: "Manage" }).click();
    await page.getByTestId("show-password").click();
    const dialog = page.getByTestId("credentials-dialog");
    await expect(dialog.getByTestId("cred-employee-id")).toHaveText(made.code);
    await dialog.getByRole("button", { name: "Show Password" }).click();
    await expect(dialog.getByTestId("cred-password")).toHaveText(made.password);
    await expect(dialog).toContainText("audit log");
    await dialog.getByRole("button", { name: "Close" }).click();

    // the employee signs in and chooses their own password: nobody can see it - the first one is wiped
    await chooseOwnPassword(request, made.code, made.password, `Chosen-by-me-${id}-9`);
    await page.reload();
    await page.getByRole("button", { name: "Manage" }).click();
    await page.getByTestId("show-password").click();
    await expect(page.getByTestId("credentials-unavailable")).toContainText("chosen their own password");
    await expect(page.getByTestId("cred-password")).toHaveCount(0);
  });

  test("the login sheet of a list of employees is an Excel file", async ({ page }) => {
    await login(page);
    await page.goto("/employees");
    await expect(page.getByTestId("employee-row").first()).toBeVisible();
    const href = await page.getByTestId("login-sheet").getAttribute("href");
    expect(href).toContain("/api/backend/employees/credentials.xlsx?ids=");
    const response = await page.request.get(href!);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("spreadsheetml");
    expect((await response.body()).subarray(0, 2).toString()).toBe("PK"); // an .xlsx is a zip
  });
});

test.describe("sharing a sheet", () => {
  test("the administrator picks the people and each gets the same number", async ({ page }) => {
    await login(page);
    const id = unique();
    const people = await Promise.all([1, 2, 3].map((n) => createEmployee(page, `Share ${id} ${n}`, `share.${id}.${n}@example.com`)));
    expect(people).toHaveLength(3);

    await page.goto("/contacts");
    await page.getByTestId("import-open").click();
    const dialog = page.getByTestId("import-dialog");
    const rows = Array.from({ length: 9 }, (_, i) => `Shared ${id} ${i},${String(9400000000 + (Date.now() % 100000) * 10 + i).slice(0, 10)}`);
    await dialog.getByTestId("import-file").setInputFiles({ name: "share.csv", mimeType: "text/csv", buffer: Buffer.from(["name,phone", ...rows].join("\r\n")) });
    await dialog.getByTestId("import-start").click();
    await expect(dialog.getByText("Check the sheet")).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByText("ready to add").locator("..")).toContainText("9");

    // choose exactly the three new employees
    await dialog.getByTestId("share-chosen").click();
    const table = dialog.getByTestId("import-share");
    await expect(table.getByTestId("share-row").first()).toBeVisible();
    for (const row of await table.getByTestId("share-row").all()) {
      const box = row.getByRole("checkbox");
      const ours = (await row.textContent())?.includes(`Share ${id}`) ?? false;
      if ((await box.getAttribute("data-state")) === "checked" !== ours) await box.click();
    }
    await expect(dialog.getByTestId("import-each")).toContainText("9 contacts ÷ 3 people = 3 each");

    await dialog.getByTestId("import-apply").click();
    await expect(dialog.getByTestId("import-result")).toContainText("9 contacts added", { timeout: 60_000 });
    const given = dialog.getByTestId("import-employees");
    for (let n = 1; n <= 3; n += 1) await expect(given).toContainText(`Share ${id} ${n}`);
    await expect(given.locator("tr")).toHaveCount(3);
    await expect(given.locator("tr").first().locator("td").last()).toHaveText("3");
    await dialog.getByRole("button", { name: "Done" }).click();
  });

  test("somebody who is not working is shown as such and gets nothing", async ({ page }) => {
    await login(page);
    const response = await page.request.get("/api/backend/distribution/overview");
    expect(response.ok()).toBe(true);
    const overview = (await response.json()) as { employees: { state: string }[]; inactive_after_days: number };
    expect(overview.inactive_after_days).toBeGreaterThanOrEqual(1);

    await page.goto("/distribution");
    await expect(page.getByRole("heading", { name: "Work sharing" })).toBeVisible();
    await expect(page.getByTestId("tile-working")).toBeVisible();
    expect(await page.getByTestId("work-row").count()).toBe(overview.employees.length);
  });
});
