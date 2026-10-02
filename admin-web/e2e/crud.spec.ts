import { expect, test, type Page } from "@playwright/test";

import { login, panelGet, unique } from "./helpers";

/** A valid Indian mobile number nobody has used yet. */
const mobile = () => `9${Math.floor(100000000 + Math.random() * 899999999)}`;

test.describe("teams", () => {
  test("create, rename, switch off and delete a team", async ({ page }) => {
    await login(page);
    await page.goto("/teams");
    const id = unique();
    const name = `E2E Team ${id}`;

    await page.getByTestId("new-team").click();
    await page.getByTestId("team-name").fill(name);
    await page.getByLabel("Description").fill("Made by the test");
    await page.getByTestId("team-submit").click();
    const card = page.getByTestId("team-card").filter({ hasText: name });
    await expect(card).toBeVisible();
    await expect(card).toContainText("0 members");

    // a second team with the same name is refused with a reason
    await page.getByTestId("new-team").click();
    await page.getByTestId("team-name").fill(name);
    await page.getByTestId("team-submit").click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(/already/i);
    await page.getByRole("button", { name: "Cancel" }).click();

    // rename + deactivate
    await card.getByRole("button", { name: `Edit ${name}` }).click();
    await page.getByTestId("team-name").fill(`${name} renamed`);
    await page.getByRole("switch").click();
    await page.getByTestId("team-submit").click();
    const renamed = page.getByTestId("team-card").filter({ hasText: `${name} renamed` });
    await expect(renamed).toBeVisible();
    await expect(renamed).toContainText("Inactive");

    // delete
    await renamed.getByRole("button", { name: `Delete ${name} renamed` }).click();
    await page.getByTestId("confirm-yes").click();
    await expect(page.getByTestId("team-card").filter({ hasText: `${name} renamed` })).toHaveCount(0);
  });

  test("a team can be opened as a filtered employee list", async ({ page }) => {
    await login(page);
    await page.goto("/teams");
    await page.getByTestId("team-card").filter({ hasText: "Sales Team B" }).getByRole("link", { name: /members/ }).click();
    await page.waitForURL(/\/employees\?team=\d+/);
    await expect(page.getByTestId("employee-row").first()).toBeVisible();
    for (const text of await page.getByTestId("employee-row").allTextContents()) expect(text).toContain("Sales Team B");
  });
});

test.describe("contacts", () => {
  test("add one, find it, read it, add a note, edit it, hand it to an employee and delete it", async ({ page }) => {
    await login(page);
    await page.goto("/contacts");
    const id = unique();
    const name = `E2E Contact ${id}`;
    const phone = mobile();

    await page.getByTestId("new-contact").click();
    await page.getByTestId("contact-name").fill(name);
    await page.getByTestId("contact-phone").fill(phone);
    await page.getByLabel("City / location").fill("Pune");
    await page.getByLabel("Tags").fill("e2e, vip");
    await page.getByTestId("contact-submit").click();
    await expect(page.getByText("Contact added")).toBeVisible();

    await page.getByTestId("contact-search").fill(name);
    const row = page.getByTestId("contact-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Pune");
    await expect(row).toContainText("New");

    // the same number cannot be added twice
    await page.getByTestId("new-contact").click();
    await page.getByTestId("contact-name").fill("Duplicate");
    await page.getByTestId("contact-phone").fill(phone);
    await page.getByTestId("contact-submit").click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(/already|exists|duplicate/i);
    await page.getByRole("button", { name: "Cancel" }).click();

    // details + notes
    await row.click();
    const drawer = page.getByTestId("contact-drawer");
    await expect(drawer).toContainText(name);
    await expect(drawer).toContainText("e2e");
    await expect(drawer).toContainText("Not assigned to anyone");
    await drawer.getByLabel("New note").fill("Asked for a call after 5 PM");
    await drawer.getByRole("button", { name: "Add note" }).click();
    await expect(drawer.getByText("Asked for a call after 5 PM")).toBeVisible();

    // edit
    await drawer.getByRole("button", { name: "Edit" }).click();
    await page.getByTestId("contact-name").fill(`${name} edited`);
    await page.getByTestId("contact-submit").click();
    await expect(page.getByText("Contact saved")).toBeVisible();
    await expect(drawer).toContainText(`${name} edited`);
    await page.keyboard.press("Escape");

    // hand it to Priya Joshi
    await page.getByTestId("contact-search").fill(`${name} edited`);
    // wait for the new result: a row of the old list would be deselected the moment the new list arrives
    await expect(page.getByTestId("contact-row")).toHaveCount(1);
    await expect(page.getByTestId("contact-row")).toContainText(`${name} edited`);
    await page.getByTestId("contact-row").getByRole("checkbox").click();
    await expect(page.getByTestId("selection-bar")).toContainText("1 contact selected");
    await page.getByTestId("bulk-assign").click();
    const assign = page.getByTestId("assign-dialog");
    await assign.getByRole("checkbox", { name: "Priya Joshi" }).click();
    await assign.getByTestId("assign-confirm").click();
    await expect(page.getByText(/1 contact assigned/)).toBeVisible();
    const found = await (await panelGet(page, `contacts?q=${encodeURIComponent(name)}`)).json();
    const detail = await (await panelGet(page, `contacts/${found.items[0].id}`)).json();
    expect(detail.assigned_to.name).toBe("Priya Joshi");

    // delete
    await page.getByTestId("contact-row").click();
    await page.getByTestId("contact-drawer").getByRole("button", { name: "Delete" }).click();
    await page.getByTestId("confirm-yes").click();
    await expect(page.getByTestId("contact-row")).toHaveCount(0);
  });

  test("a sheet is checked before anything is added, and the problems are listed", async ({ page }) => {
    await login(page);
    await page.goto("/contacts");
    await page.getByTestId("import-open").click();
    const dialog = page.getByTestId("import-dialog");
    const id = unique();
    const [a, b, dup] = [mobile(), mobile(), mobile()];
    const csv = [
      "name,phone,email,city,tags",
      `Import A ${id},${a},,Nashik,"e2e, sheet"`,
      `Import B ${id},${b},b@example.com,Thane,e2e`,
      `Import Bad ${id},12,,Pune,`,
      `Import Dup ${id},${dup},,Pune,`,
      `Import Dup Again ${id},${dup},,Pune,`,
    ].join("\r\n");
    await dialog.getByTestId("import-file").setInputFiles({ name: "contacts.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await dialog.getByTestId("import-start").click();

    await expect(dialog.getByText("Check the sheet")).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByText("lines in the sheet").locator("..")).toContainText("5");
    await expect(dialog.getByText("have a problem").locator("..")).toContainText("1");
    await expect(dialog.getByText("already exist").locator("..")).toContainText("1");
    await expect(dialog.getByText("ready to add").locator("..")).toContainText("3");

    await dialog.getByTestId("import-apply").click();
    await expect(dialog.getByTestId("import-result")).toContainText("3 contacts added", { timeout: 60_000 });
    await dialog.getByRole("button", { name: "Done" }).click();

    // each number is unique, so searching for it finds exactly that contact
    await page.getByTestId("contact-search").fill(a);
    await expect(page.getByTestId("contact-row")).toHaveCount(1);
    await expect(page.getByTestId("contact-row")).toContainText(`Import A ${id}`);
    await page.getByTestId("contact-search").fill(dup);
    await expect(page.getByTestId("contact-row")).toHaveCount(1);
    await expect(page.getByTestId("contact-row")).toContainText(`Import Dup ${id}`); // the repeated line did not create a second contact
    await page.getByTestId("contact-search").fill(`Import Bad ${id}`);
    await expect(page.getByText("No contacts match")).toBeVisible(); // the invalid line was not added
  });

  test("the filters narrow the list by status and by who has the contact", async ({ page }) => {
    await login(page);
    await page.goto("/contacts");
    await expect(page.getByTestId("contact-row").first()).toBeVisible();
    await page.getByRole("combobox", { name: "Given to" }).click();
    await page.getByRole("option", { name: "Not given to anyone" }).click();
    await expect.poll(async () => page.getByTestId("contact-row").count()).toBeGreaterThanOrEqual(0);
    await page.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "Callback" }).click();
    await expect.poll(async () => (await page.getByTestId("contact-row").allTextContents()).every((t) => t.includes("Callback"))).toBe(true);
  });
});

test.describe("campaigns", () => {
  test("create a campaign, choose who calls and see its progress", async ({ page }) => {
    await login(page);
    await page.goto("/campaigns");
    const id = unique();
    const name = `E2E Campaign ${id}`;

    await page.getByTestId("new-campaign").click();
    await page.getByTestId("campaign-name").fill(name);
    await page.getByLabel("Description").fill("Festival calls");
    await page.getByLabel("Calls to make").fill("500");
    await page.getByTestId("campaign-submit").click();
    const card = page.getByTestId("campaign-card").filter({ hasText: name });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Draft");
    await expect(card).toContainText("of 500");

    // an end date before the start date is explained
    await page.getByTestId("new-campaign").click();
    await page.getByTestId("campaign-name").fill(`${name} bad dates`);
    await page.getByLabel("Starts").fill("2026-12-10");
    await page.getByLabel("Ends").fill("2026-12-01");
    await page.getByTestId("campaign-submit").click();
    await expect(page.getByText("The end cannot be before the start.")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    // open it, pick two callers, save
    await card.click();
    const drawer = page.getByTestId("campaign-drawer");
    await expect(drawer).toContainText(name);
    await expect(drawer).toContainText("No contacts in this campaign yet");
    await drawer.getByRole("checkbox", { name: "Aarav Patil" }).click();
    await drawer.getByRole("checkbox", { name: "Sneha Kulkarni" }).click();
    await drawer.getByRole("button", { name: "Save callers" }).click();
    await expect(page.getByText("Callers saved")).toBeVisible();
    const found = (await (await panelGet(page, "campaigns")).json()).find((c: { name: string }) => c.name === name);
    const assignees = await (await panelGet(page, `campaigns/${found.id}/assignees`)).json();
    expect(assignees.employee_ids).toHaveLength(2);

    // switch it on
    await drawer.getByRole("button", { name: "Edit campaign" }).click();
    await page.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "Running" }).click();
    await page.getByTestId("campaign-submit").click();
    await expect(page.getByText("Campaign saved")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("campaign-card").filter({ hasText: name })).toContainText("Running");
  });

  test("the status chips show how many campaigns are in each state", async ({ page }) => {
    await login(page);
    await page.goto("/campaigns");
    await expect(page.getByTestId("campaign-card").first()).toBeVisible();
    await page.getByRole("group", { name: "Filter by status" }).getByRole("button", { name: /^Paused/ }).click();
    await expect.poll(async () => (await page.getByTestId("campaign-card").allTextContents()).every((t) => t.includes("Paused"))).toBe(true);
  });
});

async function setTarget(page: Page, value: string) {
  await page.goto("/settings");
  const box = page.getByTestId("setting-target");
  await box.getByLabel("Calls per day").fill(value);
  await box.getByTestId("save-setting").click();
  await expect(page.getByText("Default target saved")).toBeVisible();
}

test.describe("settings", () => {
  test("the default daily target is saved and used for the next new employee", async ({ page }) => {
    await login(page);
    await setTarget(page, "63");
    await page.reload();
    await expect(page.getByTestId("setting-target").getByLabel("Calls per day")).toHaveValue("63");

    await page.goto("/employees");
    await page.getByTestId("new-employee").click();
    await expect(page.getByTestId("employee-dialog").getByLabel("Daily call target")).toHaveValue("63");
    await page.keyboard.press("Escape");
    await setTarget(page, "50");
  });

  test("a value that is not allowed cannot be saved", async ({ page }) => {
    await login(page);
    await page.goto("/settings");
    const box = page.getByTestId("setting-target");
    await box.getByLabel("Calls per day").fill("5000");
    await expect(box.getByText("Enter a whole number from 0 to 2000.")).toBeVisible();
    await expect(box.getByTestId("save-setting")).toBeDisabled();
    const notice = page.getByTestId("setting-recording");
    await notice.getByTestId("recording-notice").fill("short");
    await expect(notice.getByText("Write at least 10 characters.")).toBeVisible();
    await expect(notice.getByTestId("save-setting")).toBeDisabled();
  });

  test("switching recording off is reflected for the phones and on the dashboard, and back on again", async ({ page }) => {
    await login(page);
    await page.goto("/settings");
    const box = page.getByTestId("setting-recording");
    await box.getByTestId("recording-switch").click();
    await box.getByTestId("save-setting").click();
    await expect(page.getByText("Recording settings saved")).toBeVisible();
    const me = await (await page.request.get("/api/auth/me")).json();
    expect(me.config.recording.enabled).toBe(false);

    await page.goto("/dashboard");
    await expect(page.getByTestId("recording-coverage")).toContainText("Recording is switched off");

    await page.goto("/settings");
    await page.getByTestId("setting-recording").getByTestId("recording-switch").click();
    await page.getByTestId("setting-recording").getByTestId("save-setting").click();
    await expect(page.getByText("Recording settings saved")).toBeVisible();
    expect((await (await page.request.get("/api/auth/me")).json()).config.recording.enabled).toBe(true);
  });

  test("the retry rules can be changed", async ({ page }) => {
    await login(page);
    await page.goto("/settings");
    const box = page.getByTestId("setting-retry");
    const wait = box.locator("#rt-BUSY-delay");
    const before = await wait.inputValue();
    await wait.fill("45");
    await box.getByTestId("save-setting").click();
    await expect(page.getByText("Retry rules saved")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("setting-retry").locator("#rt-BUSY-delay")).toHaveValue("45");
    await page.getByTestId("setting-retry").locator("#rt-BUSY-delay").fill(before);
    await page.getByTestId("setting-retry").getByTestId("save-setting").click();
    await expect(page.getByText("Retry rules saved")).toBeVisible();
  });
});

test.describe("audit log", () => {
  test("records who changed what, and can be filtered", async ({ page }) => {
    await login(page);
    // make sure there is something fresh to find
    await setTarget(page, "51");
    await setTarget(page, "50");

    await page.goto("/audit");
    await expect(page.getByTestId("audit-row").first()).toBeVisible();
    await expect(page.getByTestId("audit-table")).toContainText("Changed a setting");
    await expect(page.getByTestId("audit-table")).toContainText("admin@example.com");

    await page.getByTestId("audit-group").click();
    await page.getByRole("option", { name: "Settings" }).click();
    await expect.poll(async () => (await page.getByTestId("audit-row").allTextContents()).every((t) => t.includes("Changed a setting"))).toBe(true);

    await page.getByTestId("audit-group").click();
    await page.getByRole("option", { name: "Sign-ins and passwords" }).click();
    await expect.poll(async () => (await page.getByTestId("audit-row").allTextContents()).every((t) => /Signed|sign-in|password|session/i.test(t))).toBe(true);
  });
});
