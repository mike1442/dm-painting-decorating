import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import { documentTotals, formatPence } from "../../lib/admin/money";
import { quickQuoteFingerprint, quickQuoteId, quickQuoteLink, readQuickQuoteParams } from "../../lib/admin/quick-quote";
import type { QuickQuoteParams } from "../../lib/admin/quick-quote";
import type { AdminData } from "../../lib/admin/types";
import { documentTotal, editorTotal, expect, field, layoutFits, readCloud, region, revokeAndClose, submitSignIn, test, waitCloud } from "./support/fixtures";
import { adminNavigate, adminReady, customerNavigate, prepareLiveBrowser, privateNavigate } from "./support/live-environment";

// Admin → Quick quote, the phone handoff from ChatGPT: a link fills in the form,
// Mike checks and corrects it, and only his Save makes a draft. Everything is a
// TEST quotation titled "TEST <run id> …", removed by the worker fixtures.

/** The record ID the page derives from a link, so ownership is registered before the write. */
function linkId(link: string) {
  const params: QuickQuoteParams = {};
  for (const [key, value] of new URL(link).searchParams) params[key as keyof QuickQuoteParams] = value;
  return quickQuoteId(createHash("sha256").update(quickQuoteFingerprint(readQuickQuoteParams(params))).digest("hex"));
}

/** No customer link may be created or changed while a Quick quote is prepared. */
function watchShares(page: Page) {
  const calls: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/admin/share") calls.push(request.method()); });
  return calls;
}

const quotesTitled = (data: AdminData, title: string) => data.quotes.filter(quote => quote.title === title);

test.describe("Quick quote from a ChatGPT link", () => {
  test.describe.configure({ mode: "serial" });

  const customerName = (runId: string) => `TEST Quick Customer ${runId}`;
  const lounge = (runId: string) => `TEST ${runId} Quick quote lounge`;
  const loungeLink = (baseURL: string, runId: string) => quickQuoteLink(baseURL, {
    for: customerName(runId),
    title: lounge(runId),
    total: "£1,250",
    add: ["Prepare and fill walls", "Two coats to walls and ceilings"],
    address: "1 Test Street, Testtown, TE1 1ST",
    test: true,
  });

  test("a link opened with an expired session comes back, filled in, after signing in", async ({ browser, live }) => {
    const link = loungeLink(live.baseURL, live.runId);
    const context = await browser.newContext(live.device);
    let failures: string[] = [];
    try {
      await prepareLiveBrowser(context);
      const page = await context.newPage();
      await privateNavigate(page, link);
      await expect(page, "An admin page without a session is sent to sign in, remembering the page").toHaveURL(/\/login\?next=%2Fadmin%2Fquick-quote%3F/);
      await submitSignIn(page, live.password);
      const target = new URL(link);
      await expect(page).toHaveURL(url => url.pathname === target.pathname && url.search === target.search);
      await adminReady(page);
      await expect(field(page, "Customer name")).toHaveValue(customerName(live.runId));
      await expect(field(page, "Price before VAT")).toHaveValue("1250");
    } finally {
      failures = await revokeAndClose(context, live.baseURL, "Sign-in return browser");
    }
    expect(failures).toEqual([]);
  });

  test("Mike checks and corrects ChatGPT's details, then saves a draft; no customer link is made", async ({ admin, ledger, live }) => {
    const { page } = admin;
    const shares = watchShares(page);
    const link = loungeLink(live.baseURL, live.runId);
    const id = linkId(link);
    ledger.owned.add(id);
    const before = await readCloud(page.request, live.baseURL);

    await adminNavigate(page, link);
    await expect(page.getByRole("heading", { name: "Quick quote", exact: true })).toBeVisible();
    await expect(page.getByText("From ChatGPT", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Test quotation:/)).toBeVisible();
    await expect(field(page, "Customer name")).toHaveValue(customerName(live.runId));
    await expect(field(page, "Address")).toHaveValue("1 Test Street");
    await expect(field(page, "Town")).toHaveValue("Testtown");
    await expect(field(page, "Postcode")).toHaveValue("TE1 1ST");
    await expect(field(page, "Job title")).toHaveValue(lounge(live.runId));
    await expect(field(page, "Work to include")).toHaveValue("Prepare and fill walls\nTwo coats to walls and ceilings");
    await expect(field(page, "Price before VAT")).toHaveValue("1250");
    await layoutFits(page);
    expect((await readCloud(page.request, live.baseURL)).revision, "Opening the link saves nothing").toBe(before.revision);

    await field(page, "Price before VAT").fill("1300");
    await field(page, "Work to include").fill("Prepare and fill walls\nTwo coats to walls and ceilings\nGloss the skirting");
    await field(page, "Phone").fill("01000 000001");
    const subtotal = editorTotal(page, "Price before VAT");
    await expect(subtotal).toHaveText("£1,300.00");
    await page.getByRole("button", { name: "Save draft quotation" }).click();

    // The editor opens only once the draft is in permanent cloud storage.
    await expect(page).toHaveURL(new RegExp(`/admin/quotes/${id}$`));
    await adminReady(page);
    await expect(field(page, "Job title")).toHaveValue(lounge(live.runId));
    await expect(field(page, "Status")).toHaveValue("draft");
    await expect(page.getByText("From ChatGPT", { exact: true })).toBeVisible();
    await expect(region(page, "Customer link").getByRole("button", { name: "Create customer link" })).toBeVisible();

    const after = await readCloud(page.request, live.baseURL);
    const saved = quotesTitled(after.data, lounge(live.runId));
    expect(saved.length, "Exactly one draft is saved").toBe(1);
    const [quote] = saved;
    expect(quote.id).toBe(id);
    expect(quote.status).toBe("draft");
    expect(quote.isTest).toBe(true);
    expect(quote.number.startsWith("TEST-"), "A test quotation never takes an issued number").toBe(true);
    expect(quote.source).toBe("chatgpt");
    expect(quote.customer).toEqual({ name: customerName(live.runId), email: "", phone: "01000 000001", address: { line1: "1 Test Street", line2: "", town: "Testtown", postcode: "TE1 1ST" } });
    expect(quote.scope).toEqual(["Prepare and fill walls", "Two coats to walls and ceilings", "Gloss the skirting"]);
    expect(quote.works.map(({ description, quantity, unit, unitPrice }) => ({ description, quantity, unit, unitPrice }))).toEqual([{ description: lounge(live.runId), quantity: 1, unit: "job", unitPrice: 1300 }]);
    expect(documentTotals(quote).subtotalPence, "£1,300 is stored as £1,300, not in pence").toBe(130_000);
    expect(quote.vat).toEqual({ enabled: before.data.settings.vatRegistered, rate: before.data.settings.defaultVatRate });
    expect(quote.terms).toEqual(before.data.settings.defaultTerms);
    expect(after.data.settings.nextQuoteNumber).toBe(before.data.settings.nextQuoteNumber);
    expect(shares, "Preparing a quotation never creates or changes a customer link").toEqual([]);
  });

  test("the draft reopens intact after a reload and on another device, and edits there are saved", async ({ admin, observer, live }) => {
    const id = linkId(loungeLink(live.baseURL, live.runId));
    await admin.page.reload();
    await adminReady(admin.page);
    await expect(field(admin.page, "Customer name")).toHaveValue(customerName(live.runId));
    await expect(editorTotal(admin.page, "Works")).toHaveText("£1,300.00");

    const other = observer.page;
    await adminNavigate(other, `/admin/quotes/${id}`);
    await expect(field(other, "Job title")).toHaveValue(lounge(live.runId));
    await expect(field(other, "Postcode")).toHaveValue("TE1 1ST");
    await expect(field(other, "Phone")).toHaveValue("01000 000001");
    await expect(field(other, "One point per line")).toHaveValue("Prepare and fill walls\nTwo coats to walls and ceilings\nGloss the skirting");
    await expect(field(other, "Price each")).toHaveValue("1300.00");
    await field(other, "Never shown to the customer").fill(`Quick quote checked on site ${live.runId}`);
    await expect(other.getByRole("link", { name: "Saved to cloud", exact: true })).toBeVisible();
    await waitCloud(other.request, live.baseURL, data => data.quotes.some(quote => quote.id === id && quote.internalNotes === `Quick quote checked on site ${live.runId}`));

    await admin.page.reload();
    await adminReady(admin.page);
    await expect(field(admin.page, "Never shown to the customer")).toHaveValue(`Quick quote checked on site ${live.runId}`);
    await expect(field(admin.page, "Status")).toHaveValue("draft");
  });

  test("opening the same ChatGPT link again finds the saved draft instead of making another", async ({ admin, live }) => {
    const { page } = admin;
    const link = loungeLink(live.baseURL, live.runId);
    await adminNavigate(page, link);
    await expect(region(page, "Already saved")).toBeVisible();
    await page.getByRole("link", { name: /^Open quotation TEST-/ }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/quotes/${linkId(link)}$`));
    await adminReady(page);
    expect(quotesTitled((await readCloud(page.request, live.baseURL)).data, lounge(live.runId)).length).toBe(1);
  });

  test("an earlier customer's saved details are offered and used for the next quick quote", async ({ admin, ledger, live }) => {
    const { page } = admin;
    const title = `TEST ${live.runId} Quick quote kitchen`;
    const link = quickQuoteLink(live.baseURL, { for: customerName(live.runId), title, total: "480", add: ["Kitchen ceiling"], test: true });
    const id = linkId(link);
    ledger.owned.add(id);
    await adminNavigate(page, link);
    await expect(field(page, "Postcode")).toHaveValue("");
    await page.getByRole("button", { name: new RegExp(`^${customerName(live.runId)} 1 Test Street, Testtown, TE1 1ST · 01000 000001 · from quote TEST-`) }).click();
    await expect(page.getByText(/^Using the details saved with quote TEST-/)).toBeVisible();
    await expect(field(page, "Postcode")).toHaveValue("TE1 1ST");
    await expect(field(page, "Phone")).toHaveValue("01000 000001");
    await page.getByRole("button", { name: "Save draft quotation" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/quotes/${id}$`));
    await adminReady(page);
    const [quote] = quotesTitled((await readCloud(page.request, live.baseURL)).data, title);
    expect(quote?.customer.address).toEqual({ line1: "1 Test Street", line2: "", town: "Testtown", postcode: "TE1 1ST" });
    expect(documentTotals(quote!).subtotalPence).toBe(48_000);
  });

  test("an unreadable price is held back, and a failed save is reported plainly and can be retried", async ({ admin, ledger, live }) => {
    const { page } = admin;
    const title = `TEST ${live.runId} Quick quote landing`;
    const link = quickQuoteLink(live.baseURL, { for: customerName(live.runId), title, total: "about 900", test: true });
    const id = linkId(link);
    ledger.owned.add(id);
    await adminNavigate(page, link);
    await expect(field(page, "Price before VAT")).toHaveValue("about 900");
    await expect(page.getByText("Enter the price in pounds and pence, for example 1250 or 1250.50.")).toBeVisible();
    await expect(page.getByText("To save, add the price before VAT.")).toBeVisible();
    const save = page.getByRole("button", { name: "Save draft quotation" });
    await expect(save).toBeDisabled();
    await field(page, "Price before VAT").fill("900");
    await expect(save).toBeEnabled();

    // Cloud storage refuses the first save; nothing reaches the database.
    const refuse = async (route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
      if (route.request().method() === "PUT") await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Storage is unavailable." }) });
      else await route.continue();
    };
    await page.route("**/api/admin/data", refuse);
    await save.click();
    await expect(region(page, "Not saved yet")).toBeVisible();
    await expect(region(page, "Not saved yet").getByRole("alert")).toContainText("The draft quotation has not been saved.");
    expect(quotesTitled((await readCloud(page.request, live.baseURL)).data, title)).toEqual([]);
    await expect(page).toHaveURL(/\/admin\/quick-quote\?/);

    await page.unroute("**/api/admin/data", refuse);
    await page.getByRole("button", { name: "Try saving again" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/quotes/${id}$`));
    await adminReady(page);
    const saved = quotesTitled((await readCloud(page.request, live.baseURL)).data, title);
    expect(saved.length).toBe(1);
    expect(documentTotals(saved[0]).subtotalPence).toBe(90_000);
  });

  test("only when Mike chooses does the draft get a customer link, which he can share from the phone", async ({ admin, customer, live }) => {
    const id = linkId(loungeLink(live.baseURL, live.runId));
    // A tab of its own with a stand-in share sheet that records what the phone would share.
    const page = await admin.context.newPage();
    try {
      await page.addInitScript(() => {
        const shared: unknown[] = [];
        Object.defineProperty(window, "sharedForTest", { value: shared });
        Object.defineProperty(navigator, "share", { configurable: true, value: async (data: unknown) => { shared.push(data); } });
      });
      await adminNavigate(page, `/admin/quotes/${id}`);
      const section = region(page, "Customer link");
      await expect(section.getByRole("button", { name: "Share…" }), "Nothing to share before Mike creates a link").toHaveCount(0);
      const created = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/share" && response.request().method() === "POST");
      await section.getByRole("button", { name: "Create customer link" }).click();
      expect((await created).status()).toBe(200);
      const url = await field(section, "Customer link").inputValue();
      await section.getByRole("button", { name: "Share…" }).click();
      await expect(section.getByText("Customer link shared.", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { sharedForTest: unknown[] }).sharedForTest)).toEqual([{ url }]);

      const [quote] = quotesTitled((await readCloud(page.request, live.baseURL)).data, lounge(live.runId));
      const response = await customerNavigate(customer.page, url);
      expect(response?.status()).toBe(200);
      await expect(customer.page.getByRole("heading", { name: "Quotation", exact: true })).toBeVisible();
      await expect(customer.page.getByText(customerName(live.runId), { exact: true })).toBeVisible();
      await expect(customer.page.getByText("Gloss the skirting", { exact: true })).toBeVisible();
      await expect(documentTotal(customer.page, /^Total( including VAT)?$/)).toHaveText(formatPence(documentTotals(quote).totalPence));
      await expect(customer.page.getByText("Test document · Not issued · No payment required", { exact: true })).toBeVisible();
      expect((await response!.text()).includes(`Quick quote checked on site ${live.runId}`), "Private notes never reach the customer").toBe(false);

      const revoked = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/share" && response.request().method() === "POST");
      await section.getByRole("button", { name: "Revoke customer access" }).click();
      expect((await revoked).status()).toBe(200);
      expect((await customerNavigate(customer.page, url))?.status()).toBe(404);
    } finally {
      await page.close();
    }
  });
});
