import { devices, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { ACCESS_COOKIE, ADMIN_EMAIL, REFRESH_COOKIE } from "../../lib/admin/auth";
import { emptyCustomer } from "../../lib/admin/factories";
import { billGatesTestInvoice } from "../../lib/admin/fixtures";
import { invoiceTotals } from "../../lib/admin/money";
import { createQuote } from "../../lib/admin/operations";
import type { AdminData } from "../../lib/admin/types";
import { liveApi, liveEnvironment, prepareLiveBrowser, privateNavigate } from "./support/live-environment";
import { verifyLegacyBrowserImport } from "./support/legacy-import";

// Outside the anonymous suite's testDir. The dedicated config validates real
// credentials and the preview allowlist before it launches any browser.

type Snapshot = { data: AdminData; revision: number };
const groups = ["quotes", "invoices", "bookings"] as const;

async function readCloud(context: BrowserContext, origin: string): Promise<Snapshot> {
  const response = await liveApi(context.request, origin, "/api/admin/data");
  expect(response.status(), "Authenticated cloud read must succeed; preview access or Supabase Auth may still be blocked").toBe(200);
  const result = await response.json() as Snapshot;
  expect(Boolean(result.data && groups.every(key => Array.isArray(result.data[key])) && Number.isSafeInteger(result.revision)), "Cloud response must have records and a revision").toBe(true);
  return result;
}

/** The API accepts a complete snapshot: never overwrite or delete unrelated IDs. */
async function saveOwned(context: BrowserContext, origin: string, before: Snapshot, next: AdminData, owned: Set<string>) {
  for (const group of groups) {
    const untouched = before.data[group].filter(record => !owned.has(record.id));
    const proposed = next[group].filter(record => !owned.has(record.id));
    expect(JSON.stringify(untouched) === JSON.stringify(proposed), "Refusing to change records not created by this run").toBe(true);
  }
  expect(JSON.stringify(before.data.settings) === JSON.stringify(next.settings), "Live fixtures must not change business settings or issued number sequences").toBe(true);
  expect(JSON.stringify(before.data.meta) === JSON.stringify(next.meta), "Live fixtures must not change backup metadata").toBe(true);
  const response = await liveApi(context.request, origin, "/api/admin/data", "PUT", { revision: before.revision, data: next });
  expect(response.status(), "A conflict must fail safely; stop other admin edits before repeating the live suite").toBe(200);
  return await response.json() as Snapshot;
}

async function waitCloud(context: BrowserContext, origin: string, predicate: (data: AdminData) => boolean) {
  await expect.poll(async () => predicate((await readCloud(context, origin)).data), {
    message: "The expected test record must be present in permanent cloud storage",
    timeout: 30_000,
    intervals: [400, 800, 1500],
  }).toBe(true);
}

async function layoutFits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "The selected viewport must not require horizontal scrolling").toBe(true);
}

async function signIn(page: Page, password: string) {
  const response = await privateNavigate(page, "/login");
  expect(response?.status(), "The login page must be reachable before real workflow verification").toBe(200);
  await expect(page.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(ADMIN_EMAIL);
  // Do not use locator.fill(password): its failure call log can print the value.
  // Recordings are also disabled by the dedicated live config.
  await page.evaluate(value => {
    const field = document.querySelector<HTMLInputElement>('input[name="password"]');
    if (!field) throw new Error("The password field is unavailable.");
    field.value = value;
  }, password);
  const signedIn = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/login" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await signedIn).status(), "Mike's confirmed Supabase Auth account and privately supplied password must authenticate successfully").toBe(200);
  await expect(page).toHaveURL(/\/admin\/quotes$/);
  await expect(page.getByRole("link", { name: "Saved to cloud", exact: true })).toBeVisible();
  await layoutFits(page);
}

async function createCustomerLink(page: Page) {
  const section = page.getByRole("region", { name: "Customer link", exact: true });
  const request = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/share" && response.request().method() === "POST");
  await section.getByRole("button", { name: /^(Create customer link|Replace link)$/ }).click();
  expect((await request).status(), "A saved test document must receive a secure customer link").toBe(200);
  const value = await section.getByLabel("Customer link", { exact: true }).inputValue();
  expect(/^\/d\/[a-f0-9]{64}$/.test(new URL(value).pathname), "Customer token must contain 256 bits of randomness").toBe(true);
  return value;
}

async function unavailable(page: Page, url: string) {
  const response = await privateNavigate(page, url);
  expect(response?.status(), "Invalid or revoked customer tokens must fail closed").toBe(404);
  await expect(page.getByRole("heading", { name: "This document is unavailable" })).toBeVisible();
}

test("real admin workflow persists across browsers and exposes only an explicitly shared test document", async ({ page, context, browser, isMobile }, testInfo) => {
  const { baseURL, password } = liveEnvironment();
  const owned = new Set<string>();
  const contexts: BrowserContext[] = [];
  const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const privateMarker = `PRIVATE-NOTES-${runId}`;
  const quoteTitle = `TEST ${runId} Separate customer quotation`;
  const invoiceTitle = `TEST ${runId} Painting a 20m² wall`;
  let cleanupDone = false;
  let quoteId = "";
  let invoiceId = "";
  let bookingId = "";

  try {
    await prepareLiveBrowser(context, baseURL);
    await test.step("Sign in through the real UI and verify private session cookies", async () => {
      await signIn(page, password);
      const cookies = await context.cookies(baseURL);
      for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
        const cookie = cookies.find(value => value.name === name);
        expect(Boolean(cookie?.value && cookie.httpOnly && cookie.sameSite === "Lax" && cookie.secure), "Session cookies must be HttpOnly, Secure and SameSite=Lax").toBe(true);
      }
      expect(await page.evaluate(names => names.every(name => !document.cookie.split(";").some(cookie => cookie.trim().startsWith(`${name}=`))), [ACCESS_COOKIE, REFRESH_COOKIE]), "Browser scripts must not read session cookies").toBe(true);
      await page.reload();
      await expect(page.getByRole("heading", { name: "Quotes", exact: true })).toBeVisible();
      await context.clearCookies({ name: ACCESS_COOKIE });
      await privateNavigate(page, "/admin/invoices");
      await expect(page.getByRole("heading", { name: "Invoices", exact: true })).toBeVisible();
      expect((await liveApi(context.request, baseURL, "/api/admin/data")).status(), "Removing the expired access cookie must recover the real session using Supabase refresh").toBe(200);
      expect(Boolean((await context.cookies(baseURL)).find(cookie => cookie.name === ACCESS_COOKIE)?.value), "Session refresh must restore the HttpOnly access cookie").toBe(true);
    });

    await test.step("Create clearly labelled test drafts without changing existing records or issued sequences", async () => {
      const before = await readCloud(context, baseURL);
      const now = new Date().toISOString();
      const clock = { now, today: now.slice(0, 10) };
      const created = createQuote(before.data, clock, {
        isTest: true,
        title: quoteTitle,
        customer: { ...emptyCustomer(), name: `TEST Separate Customer ${runId}` },
        works: [{ description: "Test preparation", quantity: 1, unit: "day", unitPrice: 100 }],
        internalNotes: privateMarker,
      });
      quoteId = created.quote.id;
      owned.add(quoteId);
      const invoice = billGatesTestInvoice(clock);
      invoiceId = invoice.id;
      owned.add(invoiceId);
      invoice.number = `TEST-${invoice.id.replace(/-/g, "")}`;
      invoice.title = invoiceTitle;
      invoice.internalNotes += ` ${privateMarker}`;
      const saved = await saveOwned(context, baseURL, before, { ...created.data, invoices: [...created.data.invoices, invoice] }, owned);
      expect(saved.data.invoices.find(record => record.id === invoiceId)?.isTest).toBe(true);
      expect(invoiceTotals(saved.data.invoices.find(record => record.id === invoiceId)!).totalPence).toBe(168000);
      expect(saved.data.quotes.find(record => record.id === quoteId)?.number.startsWith("TEST-")).toBe(true);
      expect(saved.data.settings.nextInvoiceNumber).toBe(before.data.settings.nextInvoiceNumber);
      expect(saved.data.settings.nextQuoteNumber).toBe(before.data.settings.nextQuoteNumber);

      // A stale revision carries the current, unchanged snapshot: if conflict
      // protection ever regresses, this probe still cannot erase recent data.
      const current = await readCloud(context, baseURL);
      const stale = await liveApi(context.request, baseURL, "/api/admin/data", "PUT", { data: current.data, revision: current.revision - 1 });
      expect(stale.status(), "Outdated browser revisions must be rejected without overwriting cloud data").toBe(409);
    });

    const observer = await browser.newContext({ ...devices[isMobile ? "Desktop Chrome" : "Pixel 7"], baseURL });
    contexts.push(observer);
    await prepareLiveBrowser(observer, baseURL);
    const observerPage = await observer.newPage();

    await test.step("Verify a second independently authenticated browser sees quotes and invoices", async () => {
      await signIn(observerPage, password);
      await privateNavigate(observerPage, `/admin/quotes/${quoteId}`);
      await expect(observerPage.getByLabel("Job title", { exact: true })).toHaveValue(quoteTitle);
      // Fail promptly with the visible page state instead of exhausting the
      // entire test budget and starving the mandatory cleanup of test records.
      const introduction = observerPage.locator("label.adm-field").filter({ hasText: "Introduction" }).locator("textarea");
      try {
        await expect(introduction, "The second browser must show an editable quote; check cloud load and session state").toBeVisible({ timeout: 15_000 });
      } catch (error) {
        // Diagnostics contain only the synthetic test record and UI state, never credentials.
        const diagnostic = await observerPage.evaluate(() => ({
          path: location.pathname,
          headings: [...document.querySelectorAll("h1,h2")].map(node => node.textContent?.trim()).slice(0, 15),
          fields: [...document.querySelectorAll("input,textarea")].map(node => ({ label: node.closest("label")?.querySelector(".adm-field-label")?.textContent?.trim(), tag: node.tagName })).slice(0, 30),
          loading: !!document.querySelector(".adm-loading"),
          missing: document.body.textContent?.includes("could not be found") ?? false,
        }));
        throw new Error(`Quote editor failed to render: ${JSON.stringify(diagnostic)}; ${String(error)}`);
      }
      await introduction.fill(`TEST saved from another browser ${runId}`, { timeout: 15_000 });
      await waitCloud(observer, baseURL, data => data.quotes.find(record => record.id === quoteId)?.intro === `TEST saved from another browser ${runId}`);
      await privateNavigate(page, `/admin/quotes/${quoteId}`);
      await expect(page.locator("label.adm-field").filter({ hasText: "Introduction" }).locator("textarea")).toHaveValue(`TEST saved from another browser ${runId}`);
      await layoutFits(page);
      await privateNavigate(observerPage, `/admin/invoices/${invoiceId}`);
      await expect(observerPage.getByLabel("Customer name", { exact: true })).toHaveValue("Bill Gates");
      await expect(observerPage.getByLabel("Job title", { exact: true })).toHaveValue(invoiceTitle);
      await layoutFits(observerPage);
    });

    await test.step("Review and import legacy browser records without replacing current cloud records", async () => {
      await verifyLegacyBrowserImport({ page, observerPage, context, baseURL, readCloud, waitCloud, owned, runId, existingQuoteId: quoteId });
      await privateNavigate(page, `/admin/invoices/${invoiceId}`);
      await privateNavigate(observerPage, `/admin/invoices/${invoiceId}`);
    });

    await test.step("Edit invoice calculations through the UI and persist optional VAT and payments", async () => {
      await privateNavigate(page, `/admin/invoices/${invoiceId}`);
      const works = page.locator("section.adm-card").filter({ has: page.getByRole("heading", { name: "Itemised works", exact: true }) });
      await expect(works.getByLabel("Qty", { exact: true }).first()).toHaveValue("3");
      await expect(works.locator("label.adm-field").filter({ hasText: "Price each" }).locator("input").first()).toHaveValue("250.00");
      const materials = page.locator("section.adm-card").filter({ has: page.getByRole("heading", { name: "Materials", exact: true }) });
      await materials.locator("label.adm-field").filter({ hasText: "Price each" }).locator("input").fill("181");
      await waitCloud(context, baseURL, data => invoiceTotals(data.invoices.find(record => record.id === invoiceId)!).totalPence === 168100);
      await materials.locator("label.adm-field").filter({ hasText: "Price each" }).locator("input").fill("180");
      await page.getByRole("switch", { name: /Charge VAT/ }).check();
      await waitCloud(context, baseURL, data => invoiceTotals(data.invoices.find(record => record.id === invoiceId)!).totalPence === 201600);
      await page.getByRole("switch", { name: /Charge VAT/ }).uncheck();
      await waitCloud(context, baseURL, data => invoiceTotals(data.invoices.find(record => record.id === invoiceId)!).totalPence === 168000);
      await observerPage.reload();
      await expect(observerPage.getByText("£1,680.00", { exact: true }).first()).toBeVisible();
      await layoutFits(page);
    });

    await test.step("Create a linked diary booking in the UI and verify it in the second browser", async () => {
      await page.getByRole("link", { name: "Book into diary", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: "New booking", exact: true })).toBeVisible();
      await expect(dialog.getByLabel("Customer", { exact: true })).toHaveValue("Bill Gates");
      await dialog.getByLabel("Job description", { exact: true }).fill(`TEST ${runId} Wall painting booking`);
      await dialog.getByLabel("Linked quote", { exact: true }).selectOption(quoteId);
      const date = await dialog.getByLabel("First day", { exact: true }).inputValue();
      await layoutFits(page);
      await dialog.getByRole("button", { name: "Add to diary", exact: true }).click();
      await waitCloud(context, baseURL, data => data.bookings.some(record => record.job === `TEST ${runId} Wall painting booking` && record.invoiceId === invoiceId && record.quoteId === quoteId));
      const booking = (await readCloud(context, baseURL)).data.bookings.find(record => record.job === `TEST ${runId} Wall painting booking`)!;
      bookingId = booking.id;
      owned.add(bookingId);
      await privateNavigate(observerPage, `/admin/diary?date=${date}`);
      await observerPage.locator(".adm-day-panel").getByRole("button").filter({ hasText: `TEST ${runId} Wall painting booking` }).click();
      await expect(observerPage.getByRole("dialog").getByLabel("Linked invoice", { exact: true })).toHaveValue(invoiceId);
      await expect(observerPage.getByRole("dialog").getByLabel("Linked quote", { exact: true })).toHaveValue(quoteId);
      await observerPage.getByRole("dialog").getByLabel("Notes", { exact: true }).fill(`TEST updated on another device ${runId}`);
      await observerPage.getByRole("button", { name: "Save changes", exact: true }).click();
      await waitCloud(observer, baseURL, data => data.bookings.find(record => record.id === bookingId)?.notes === `TEST updated on another device ${runId}`);
      await page.reload();
      await layoutFits(observerPage);
    });

    await test.step("Convert the accepted test quote through the UI without creating an issued invoice", async () => {
      await privateNavigate(page, `/admin/quotes/${quoteId}`);
      await page.getByLabel("Status", { exact: true }).selectOption("accepted");
      await waitCloud(context, baseURL, data => data.quotes.find(record => record.id === quoteId)?.status === "accepted");
      const before = await readCloud(context, baseURL);
      await page.getByRole("button", { name: "Create invoice from quote", exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/invoices\/[a-zA-Z0-9_-]+$/);
      const convertedId = new URL(page.url()).pathname.split("/").pop()!;
      owned.add(convertedId);
      await waitCloud(context, baseURL, data => data.invoices.some(record => record.id === convertedId));
      const converted = await readCloud(context, baseURL);
      const invoice = converted.data.invoices.find(record => record.id === convertedId)!;
      expect(invoice.quoteId === quoteId && invoice.quoteNumber.startsWith("TEST-") && invoice.isTest === true && invoice.status === "draft" && invoice.number.startsWith("TEST-"), "Converting a test quote must preserve its test marker and draft state").toBe(true);
      expect(converted.data.settings.nextInvoiceNumber).toBe(before.data.settings.nextInvoiceNumber);
      expect(Object.values(invoice.bank).every(value => value === ""), "Test conversions must omit payment bank details").toBe(true);
    });

    const customer = await browser.newContext({ ...devices[isMobile ? "Pixel 7" : "Desktop Chrome"], baseURL });
    contexts.push(customer);
    await prepareLiveBrowser(customer, baseURL);
    const customerPage = await customer.newPage();
    let invoiceLink = "";

    await test.step("Verify Bill Gates's £1,680 test invoice in an unauthenticated browser", async () => {
      await privateNavigate(page, `/admin/invoices/${invoiceId}`);
      invoiceLink = await createCustomerLink(page);
      expect(new URL(invoiceLink).origin === baseURL, "Customer links must remain on the selected application").toBe(true);
      const response = await privateNavigate(customerPage, invoiceLink);
      expect(response?.status()).toBe(200);
      await expect(customerPage.getByRole("heading", { name: "Invoice", exact: true })).toBeVisible();
      await expect(customerPage.getByText("Bill Gates", { exact: true })).toBeVisible();
      await expect(customerPage.getByText("£1,680.00", { exact: true })).toBeVisible();
      await expect(customerPage.getByText("Test document · Not issued · No payment required", { exact: true })).toBeVisible();
      await expect(customerPage.locator(".adm-top, .adm-tabs, input[type=password], .dmdoc-pay")).toHaveCount(0);
      const html = await response!.text();
      expect([privateMarker, quoteTitle, `TEST Separate Customer ${runId}`].every(value => !html.includes(value)), "Customer HTML and serialized data must omit other documents and private notes").toBe(true);
      expect(response?.headers()["cache-control"].includes("no-store")).toBe(true);
      expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
      expect((await customer.cookies(baseURL)).some(cookie => [ACCESS_COOKIE, REFRESH_COOKIE].includes(cookie.name)), "A customer document must not grant an admin session").toBe(false);
      await layoutFits(customerPage);
      expect((await liveApi(customer.request, baseURL, "/api/admin/data")).status()).toBe(401);
      expect((await liveApi(customer.request, baseURL, "/api/admin/share", "POST", { id: quoteId, action: "create" })).status()).toBe(401);
      await unavailable(customerPage, `/d/${quoteId}`);
      const token = new URL(invoiceLink).pathname.split("/").pop()!;
      await unavailable(customerPage, `/d/${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`);
      await privateNavigate(customerPage, `/admin/invoices/${invoiceId}`);
      await expect(customerPage).toHaveURL(/\/login$/);
      await expect(customerPage.locator(".adm-top, .adm-tabs")).toHaveCount(0);
    });

    await test.step("Record a partial payment and verify the £1,180 remainder across browsers and the same customer link", async () => {
      await page.getByRole("button", { name: "Record a payment or deposit", exact: true }).click();
      const payment = page.locator(".adm-payment");
      await expect(payment).toHaveCount(1);
      await payment.getByLabel("Amount", { exact: true }).fill("500");
      await payment.getByLabel("Method", { exact: true }).selectOption("cash");
      await payment.getByLabel("Shown as", { exact: true }).fill("TEST deposit received");
      await waitCloud(context, baseURL, data => {
        const invoice = data.invoices.find(record => record.id === invoiceId)!;
        const totals = invoiceTotals(invoice);
        return invoice.isTest === true && invoice.status === "draft" && invoice.payments.length === 1 &&
          invoice.payments[0].amount === 500 && invoice.payments[0].method === "cash" &&
          invoice.payments[0].label === "TEST deposit received" && totals.totalPence === 168000 &&
          totals.paidPence === 50000 && totals.balancePence === 118000;
      });
      await expect(page.locator(".adm-bottom-bar strong")).toHaveText("£1,180.00");
      await privateNavigate(observerPage, `/admin/invoices/${invoiceId}`);
      await expect(observerPage.locator(".adm-payment").getByLabel("Amount", { exact: true })).toHaveValue("500.00");
      await expect(observerPage.locator(".adm-payment").getByLabel("Method", { exact: true })).toHaveValue("cash");
      await expect(observerPage.locator(".adm-bottom-bar strong")).toHaveText("£1,180.00");

      expect((await privateNavigate(customerPage, invoiceLink))?.status()).toBe(200);
      await expect(customerPage.locator(".dmdoc-total-grand strong")).toHaveText("£1,680.00");
      await expect(customerPage.locator(".dmdoc-total-minus")).toContainText("TEST deposit received");
      await expect(customerPage.locator(".dmdoc-total-minus strong")).toHaveText("−£500.00");
      await expect(customerPage.locator(".dmdoc-total-balance strong")).toHaveText("£1,180.00");
      await expect(customerPage.getByText("Test document · Not issued · No payment required", { exact: true })).toBeVisible();
      await layoutFits(observerPage);
      await layoutFits(customerPage);
      expect((await liveApi(customer.request, baseURL, "/api/admin/data")).status()).toBe(401);
    });

    await test.step("Print the customer's test invoice and generate a real PDF entirely in memory", async () => {
      // Exercise the actual customer button without opening a native OS print
      // dialog. Restore window.print before testing Chromium's real PDF renderer.
      const printControl = await customerPage.evaluateHandle(() => {
        const original = window.print;
        let calls = 0;
        window.print = () => { calls += 1; };
        return { calls: () => calls, restore: () => { window.print = original; } };
      });
      try {
        await customerPage.getByRole("button", { name: "Print / Save PDF", exact: true }).click();
        expect(await printControl.evaluate(control => control.calls()), "The customer print button must invoke browser printing").toBe(1);
      } finally {
        await printControl.evaluate(control => control.restore());
        await printControl.dispose();
      }

      await customerPage.emulateMedia({ media: "print" });
      try {
        await expect(customerPage.locator(".dm-shared-toolbar")).toBeHidden();
        await expect(customerPage.getByRole("heading", { name: "Invoice", exact: true })).toBeVisible();
        await expect(customerPage.getByText("Bill Gates", { exact: true })).toBeVisible();
        await expect(customerPage.getByText("Test document · Not issued · No payment required", { exact: true })).toBeVisible();
        await expect(customerPage.locator(".dmdoc-total-balance strong")).toHaveText("£1,180.00");
        await expect(customerPage.locator(".adm-top, .adm-tabs, .dmdoc-pay")).toHaveCount(0);
        await customerPage.evaluate(() => document.fonts.ready.then(() => undefined));
        // Deliberately omit path and testInfo.attach: customer PDFs and bearer
        // links must never enter CI files, reports or uploaded artifacts.
        const pdf = await customerPage.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
        expect(pdf.byteLength > 1000 && pdf.subarray(0, 5).toString("ascii") === "%PDF-" && pdf.subarray(-32).toString("ascii").includes("%%EOF"), "Chromium must render a complete, nonempty customer PDF").toBe(true);
      } finally {
        await customerPage.emulateMedia({ media: "screen" });
      }
      await expect(customerPage.getByRole("button", { name: "Print / Save PDF", exact: true })).toBeVisible();
      expect((await customer.cookies(baseURL)).some(cookie => [ACCESS_COOKIE, REFRESH_COOKIE].includes(cookie.name)), "Printing a document must not create an admin session").toBe(false);
    });

    await test.step("Verify the separate quote link, token replacement and revocation", async () => {
      await privateNavigate(page, `/admin/quotes/${quoteId}`);
      const quoteLink = await createCustomerLink(page);
      const quoteCustomer = await browser.newContext({ ...devices[isMobile ? "Desktop Chrome" : "Pixel 7"], baseURL });
      contexts.push(quoteCustomer);
      await prepareLiveBrowser(quoteCustomer, baseURL);
      const quotePage = await quoteCustomer.newPage();
      const quoteResponse = await privateNavigate(quotePage, quoteLink);
      expect(quoteResponse?.status()).toBe(200);
      await expect(quotePage.getByRole("heading", { name: "Quotation", exact: true })).toBeVisible();
      expect((await quoteResponse!.text()).includes("Bill Gates"), "A quotation link must not disclose a different customer's invoice").toBe(false);
      await expect(quotePage.getByText(`TEST Separate Customer ${runId}`, { exact: true })).toBeVisible();
      await layoutFits(quotePage);

      await privateNavigate(page, `/admin/invoices/${invoiceId}`);
      const replacement = await createCustomerLink(page);
      expect(replacement !== invoiceLink, "Replacing a link must issue a new token").toBe(true);
      await unavailable(customerPage, invoiceLink);
      expect((await privateNavigate(customerPage, replacement))?.status()).toBe(200);
      const revoked = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/share" && response.request().method() === "POST");
      await page.getByRole("button", { name: "Revoke customer access", exact: true }).click();
      expect((await revoked).status()).toBe(200);
      await unavailable(customerPage, replacement);
    });

    await test.step("Mark the test invoice paid and verify the balance on the other device", async () => {
      page.once("dialog", dialog => dialog.accept());
      await page.getByRole("button", { name: "Mark paid", exact: true }).click();
      await waitCloud(context, baseURL, data => {
        const invoice = data.invoices.find(record => record.id === invoiceId)!;
        const totals = invoiceTotals(invoice);
        return invoice.status === "draft" && invoice.isTest === true && invoice.payments.length === 2 &&
          invoice.payments.some(payment => payment.amount === 500 && payment.label === "TEST deposit received") &&
          invoice.payments.some(payment => payment.amount === 1180 && payment.label === "Balance received") &&
          totals.totalPence === 168000 && totals.paidPence === 168000 && totals.balancePence === 0;
      });
      await privateNavigate(observerPage, `/admin/invoices/${invoiceId}`);
      await expect(observerPage.locator(".adm-page-sub .adm-chip")).toHaveText("Paid");
      await expect(observerPage.locator(".adm-bottom-bar strong")).toHaveText("£0.00");
    });

    await test.step("Delete only this run's invoice, booking and quote using their UI controls", async () => {
      page.once("dialog", dialog => dialog.accept());
      await page.getByRole("button", { name: "Delete invoice", exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/invoices$/);
      await waitCloud(context, baseURL, data => !data.invoices.some(record => record.id === invoiceId));

      const booking = (await readCloud(context, baseURL)).data.bookings.find(record => record.id === bookingId)!;
      await privateNavigate(page, `/admin/diary?date=${booking.start}`);
      await page.locator(".adm-day-panel").getByRole("button").filter({ hasText: `TEST ${runId} Wall painting booking` }).click();
      page.once("dialog", dialog => dialog.accept());
      await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
      await waitCloud(context, baseURL, data => !data.bookings.some(record => record.id === bookingId));

      await privateNavigate(page, `/admin/quotes/${quoteId}`);
      page.once("dialog", dialog => dialog.accept());
      await page.getByRole("button", { name: "Delete quote", exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/quotes$/);
      await waitCloud(context, baseURL, data => !data.quotes.some(record => record.id === quoteId));
    });

    await test.step("Remove remaining test conversions and sign out with server session revocation", async () => {
      const current = await readCloud(context, baseURL);
      await saveOwned(context, baseURL, current, {
        ...current.data,
        quotes: current.data.quotes.filter(record => !owned.has(record.id)),
        invoices: current.data.invoices.filter(record => !owned.has(record.id)),
        bookings: current.data.bookings.filter(record => !owned.has(record.id)),
      }, owned);
      cleanupDone = true;
      await privateNavigate(page, "/admin/quotes");
      const replay = await browser.newContext({ baseURL });
      contexts.push(replay);
      await prepareLiveBrowser(replay, baseURL);
      await replay.addCookies((await context.cookies(baseURL)).filter(cookie => [ACCESS_COOKIE, REFRESH_COOKIE].includes(cookie.name)));
      const signedOut = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/logout" && response.request().method() === "POST");
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      const response = await signedOut;
      expect(response.status()).toBe(200);
      expect((await response.json()).revoked, "Logout must revoke the actual Supabase session").toBe(true);
      await expect(page).toHaveURL(/\/login$/);
      expect((await context.cookies(baseURL)).some(cookie => [ACCESS_COOKIE, REFRESH_COOKIE].includes(cookie.name))).toBe(false);
      expect((await liveApi(context.request, baseURL, "/api/admin/data")).status()).toBe(401);
      expect((await liveApi(replay.request, baseURL, "/api/admin/data")).status(), "Replaying the logged-out access and refresh cookies must not regain admin access").toBe(401);
      // Revocation is now established. Remove the deliberately stale credentials
      // so teardown does not try to revoke an already invalid refresh token.
      await replay.clearCookies({ name: ACCESS_COOKIE });
      await replay.clearCookies({ name: REFRESH_COOKIE });
      await privateNavigate(page, "/admin/diary");
      await expect(page).toHaveURL(/\/login$/);
    });

    testInfo.annotations.push({ type: "verification", description: "Verified real Supabase Auth, cross-browser storage, test-only documents, partial payments and remaining-balance settlement, customer print/PDF rendering and isolation/revocation, session refresh/logout, and both viewport layouts. No invoice was issued or emailed; PDF bytes remained in memory." });
  } finally {
    // On a partial failure, discover only descendants identifiable by this run's
    // unique quote ID and title. Never restore an old complete-data snapshot.
    const cleanupFailures: string[] = [];
    try {
      if (!cleanupDone && owned.size) {
        const current = await readCloud(context, baseURL);
        for (const invoice of current.data.invoices) {
          if (quoteId && invoice.quoteId === quoteId && invoice.isTest === true && invoice.title === quoteTitle) owned.add(invoice.id);
        }
        for (const booking of current.data.bookings) {
          if (booking.job === `TEST ${runId} Wall painting booking` && booking.invoiceId === invoiceId) owned.add(booking.id);
        }
        await saveOwned(context, baseURL, current, {
          ...current.data,
          quotes: current.data.quotes.filter(record => !owned.has(record.id)),
          invoices: current.data.invoices.filter(record => !owned.has(record.id)),
          bookings: current.data.bookings.filter(record => !owned.has(record.id)),
        }, owned);
      }
    } catch {
      cleanupFailures.push("Temporary TEST records could not be removed. Review this run's test drafts before repeating live verification.");
    }

    // Every created context is attempted even if an earlier request or close
    // fails. Include the primary context when sign-in only partially completed:
    // it may already hold a live session before a loading/layout assertion fails.
    // Transport errors can contain headers, so retain only these fixed messages.
    for (const [index, other] of [...contexts, context].entries()) {
      try {
        const response = await liveApi(other.request, baseURL, "/api/auth/logout", "POST");
        const result: unknown = response.status() === 200 ? await response.json() : null;
        if (!result || typeof result !== "object" || !("revoked" in result) || result.revoked !== true) {
          cleanupFailures.push(`Browser ${index + 1}: server session revocation was not confirmed.`);
        }
      } catch {
        cleanupFailures.push(`Browser ${index + 1}: the session revocation request failed.`);
      }
      try {
        await other.close();
      } catch {
        cleanupFailures.push(`Browser ${index + 1}: the browser context could not be closed.`);
      }
    }
    // Preserve an original workflow failure while reporting every cleanup issue.
    expect.soft(cleanupFailures, "All test records must be removed and every browser session revoked and closed").toEqual([]);
  }
});
