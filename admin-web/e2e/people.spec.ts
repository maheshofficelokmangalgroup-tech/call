import { expect, test } from "@playwright/test";

import { ADMIN, BACKEND, backendLogin, login, panelGet, searchFor, unique } from "./helpers";

/** Valid Indian mobile numbers nobody has used yet - all different. */
function numbers(count: number): string[] {
  const made = new Set<string>();
  while (made.size < count) made.add(`9${Math.floor(100000000 + Math.random() * 899999999)}`);
  return [...made];
}

/** How the panel writes a number: +91 98765 43210 */
const shown = (n: string) => `+91 ${n.slice(0, 5)} ${n.slice(5)}`;

test.describe("people with many numbers", () => {
  test("one person with three numbers is one contact, found by any of them, with all the numbers on it", async ({ page }) => {
    await login(page);
    await page.goto("/contacts");
    const id = unique();
    const name = `E2E Person ${id}`;
    const [first, second, third, other] = numbers(4);

    await page.getByTestId("new-contact").click();
    await page.getByTestId("contact-name").fill(name);
    await page.getByTestId("contact-phone").fill(first);
    await page.getByTestId("contact-more-phones").fill(`${second}\n${third}`);
    await page.getByLabel("City / location").fill("Kolhapur");
    await page.getByTestId("contact-submit").click();
    await expect(page.getByText("Contact added")).toBeVisible();

    // the list shows the person once, with the first number and how many more there are - and any number finds them
    await searchFor(page, page.getByTestId("contact-search"), third, "contacts");
    await expect(page.getByTestId("contact-row")).toHaveCount(1);
    await expect(page.getByTestId("contact-row")).toContainText(name);
    await expect(page.getByTestId("contact-numbers-cell")).toContainText(shown(first));
    await expect(page.getByTestId("contact-numbers-cell")).toContainText("+2 more");

    // the drawer has every number, the main one marked
    await page.getByTestId("contact-row").click();
    const drawer = page.getByTestId("contact-drawer");
    await expect(drawer.getByTestId("contact-number")).toHaveCount(3);
    for (const n of [first, second, third]) await expect(drawer.getByTestId("contact-numbers")).toContainText(shown(n));
    await expect(drawer.getByTestId("contact-number").first()).toContainText("Main");

    // a number belongs to one person only: giving the second number to somebody else is refused, naming who has it
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await page.getByTestId("new-contact").click();
    await page.getByTestId("contact-name").fill(`Somebody else ${id}`);
    await page.getByTestId("contact-phone").fill(other);
    await page.getByTestId("contact-more-phones").fill(second);
    await page.getByTestId("contact-submit").click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(/already belongs to/i);
    await page.getByRole("button", { name: "Cancel" }).click();

    // what the server says is the same: one contact, three numbers
    const found = await (await panelGet(page, `contacts?q=${second}`)).json();
    expect(found.items).toHaveLength(1);
    expect(found.items[0].phone_count).toBe(3);
    expect(found.items[0].phones.map((p: { phone: string }) => p.phone)).toEqual([first, second, third].map((n) => `+91${n}`));
    expect(found.items[0].call_phone).toBe(`+91${first}`);

    // the numbers can be changed: the person gets another one, loses one
    await page.getByTestId("contact-row").click();
    await page.getByTestId("contact-drawer").getByRole("button", { name: "Edit" }).click();
    await page.getByTestId("contact-more-phones").fill(`${second}\n${other}`);
    await page.getByTestId("contact-submit").click();
    await expect(page.getByText("Contact saved")).toBeVisible();
    await expect(page.getByTestId("contact-name")).toBeHidden();
    const changed = await (await panelGet(page, `contacts/${found.items[0].id}`)).json();
    expect(changed.phones.map((p: { phone: string }) => p.phone)).toEqual([first, second, other].map((n) => `+91${n}`));

    // clean up
    await page.getByTestId("contact-drawer").getByRole("button", { name: "Delete" }).click();
    await page.getByTestId("confirm-yes").click();
    await expect(page.getByTestId("contact-row")).toHaveCount(0);
  });

  test("a voter sheet with one row per number becomes one contact per person, with every number and the voter details", async ({ page, request }) => {
    await login(page);
    await page.goto("/contacts");
    await page.getByTestId("import-open").click();
    const dialog = page.getByTestId("import-dialog");
    const id = unique();
    const [a1, a2, a3, b1] = numbers(4);
    const asha = `Asha Voter ${id}`;
    const bhau = `Bhau Voter ${id}`;
    const csv = [
      "Mobile Number,Voter Name,Relative Name,Age,Gender,EPIC No,Voter Pincode,Voter Address",
      `${a1},${asha},Ganesh Voter,41,F,,416001,"12/A Peth Vadgaon, Kolhapur"`,
      `${a2},${asha},Ganesh Voter,41,F,,416001,"12/A Peth Vadgaon, Kolhapur"`,
      `${a1},${asha},Ganesh Voter,41,F,,416001,"12/A Peth Vadgaon, Kolhapur"`, // the same number typed twice
      `${a3},${asha.toUpperCase()},Ganesh Voter,41,F,,416001,"12/A  Peth Vadgaon, Kolhapur"`, // capitals and spaces do not make another person
      `${b1},${bhau},Dada Voter,55,M,ZZZ${id.toUpperCase().slice(0, 7)},416002,"Station Road, Kolhapur"`,
      "12,Bad Row,Nobody,30,M,,416003,Nowhere",
    ].join("\r\n");
    await dialog.getByTestId("import-file").setInputFiles({ name: "voters.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await dialog.getByTestId("import-start").click();

    // 6 lines: 1 bad, 1 number typed twice, 4 numbers of 2 people - 2 lines joined a person who is on an earlier line
    await expect(dialog.getByText("Check the sheet")).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByText("lines in the sheet").locator("..")).toContainText("6");
    await expect(dialog.getByText("have a problem").locator("..")).toContainText("1");
    await expect(dialog.getByText("ready to add").locator("..")).toContainText("2");
    await expect(dialog.getByTestId("import-people-note")).toContainText("2 people with 4 numbers");
    await expect(dialog.getByTestId("import-people-note")).toContainText("2 lines were another number");

    await dialog.getByTestId("import-apply").click();
    await expect(dialog.getByTestId("import-result")).toContainText("2 contacts added", { timeout: 60_000 });
    await dialog.getByRole("button", { name: "Done" }).click();

    // the last number of the first person finds the person, once, with all three numbers
    await searchFor(page, page.getByTestId("contact-search"), a3, "contacts");
    await expect(page.getByTestId("contact-row")).toHaveCount(1);
    await expect(page.getByTestId("contact-row")).toContainText(asha);
    await expect(page.getByTestId("contact-numbers-cell")).toContainText("+2 more");
    await page.getByTestId("contact-row").click();
    const drawer = page.getByTestId("contact-drawer");
    await expect(drawer.getByTestId("contact-number")).toHaveCount(3);
    await expect(drawer).toContainText("Relative: Ganesh Voter");
    await expect(drawer).toContainText("41 years");
    await expect(drawer).toContainText("Female");
    await expect(drawer).toContainText("12/A Peth Vadgaon, Kolhapur");
    await expect(drawer).toContainText("416001");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();

    // the second person has one number and their voter card
    await searchFor(page, page.getByTestId("contact-search"), bhau, "contacts");
    await expect(page.getByTestId("contact-row")).toHaveCount(1);
    await expect(page.getByTestId("contact-numbers-cell")).not.toContainText("more");
    await page.getByTestId("contact-row").click();
    await expect(page.getByTestId("contact-drawer")).toContainText("Voter card (EPIC) ZZZ");

    // searching by the voter details works too
    await page.keyboard.press("Escape");
    await searchFor(page, page.getByTestId("contact-search"), "Ganesh Voter", "contacts");
    await expect(page.getByTestId("contact-row").filter({ hasText: asha })).toHaveCount(1);

    // the same sheet again adds nobody: both people are there already
    await page.getByTestId("import-open").click();
    const again = page.getByTestId("import-dialog");
    await again.getByTestId("import-file").setInputFiles({ name: "voters.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await again.getByTestId("import-start").click();
    await expect(again.getByText("Check the sheet")).toBeVisible({ timeout: 60_000 });
    await expect(again.getByText("ready to add").locator("..")).toContainText("0");
    await again.getByRole("button", { name: "Cancel import" }).click();

    // clean up: what the test made is removed through the API (as an administrator)
    const { access_token: token } = await (await backendLogin(request, ADMIN.email, ADMIN.password)).json();
    for (const who of [asha, bhau]) {
      const list = await (await panelGet(page, `contacts?q=${encodeURIComponent(who)}`)).json();
      for (const item of list.items) {
        const res = await request.delete(`${BACKEND}/api/v1/contacts/${item.id}`, { headers: { authorization: `Bearer ${token}` } });
        expect(res.ok()).toBeTruthy();
      }
    }
  });
});
