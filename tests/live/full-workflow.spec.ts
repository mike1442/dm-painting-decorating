import type { Page } from "@playwright/test";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../../lib/admin/auth";
import { invoiceTotals } from "../../lib/admin/money";
import type { AdminData } from "../../lib/admin/types";
import { documentTotal, editorTotal, expect, field, layoutFits, readCloud, region, revokeAndClose, signIn, test, waitCloud } from "./support/fixtures";
import { verifyLegacyBrowserImport } from "./support/legacy-import";
import { adminNavigate, liveApi, prepareLiveBrowser, privateNavigate } from "./support/live-environment";

// Outside the anonymous suite's testDir. The dedicated config validates real
// credentials and the preview allowlist before it launches any browser. Each
// project (desktop, mobile) signs in a primary and a second browser once; their
// worker fixtures remove this run's TEST records and revoke both sessions after
// the last step, whether it passed, failed or timed out.

const sessionCookies = [ACCESS_COOKIE, REFRESH_COOKIE];
const hasSessionCookie = async (page: Page, origin: string) => (await page.context().cookies(origin)).some(cookie => sessionCookies.includes(cookie.name));

async function createCustomerLink(page: Page) {
  const section = region(page, "Customer link");
  const request = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/share" && response.request().method() === "POST");
  await section.getByRole("button", { name: /^(Create customer link|Replace link)$/ }).click();
  expect((await request).status(), "A saved test document must receive a secure customer link").toBe(200);
  const value = await field(section, "Customer link").inputValue();
  expect(/^\/d\/[a-f0-9]{64}$/.test(new URL(value).pathname), "Customer token must contain 256 bits of randomness").toBe(true);
  return value;
}

async function unavailable(page: Page, url: string) {
  const response = await privateNavigate(page, url);
  expect(response?.status(), "Invalid or revoked customer tokens must fail closed").toBe(404);
  await expect(page.getByRole("heading", { name: "This document is unavailable" })).toBeVisible();
}

const invoiceIn = (data: AdminData, id: string) => data.invoices.find(record => record.id === id);

test.describe("authenticated admin workflow", () => {
  // Later steps build on records and links verified by earlier ones. After the
  // first failure the remaining steps are skipped and cleanup runs immediately.
  test.describe.configure({ mode: "serial" });

  let bookingDate = "";
  let invoiceLink = "";
  const bookingJob = (runId: string) => `TEST ${runId} Wall painting booking`;
  const bookingCard = (page: Page, runId: string) => page.getByRole("button", { name: new RegExp(`^${bookingJob(runId)}`) });

  test("sign-in issues private session cookies that survive reload and refresh", async ({ admin, live }) => {
    const { context, page } = admin;
    for (const name of sessionCookies) {
      const cookie = (await context.cookies(live.baseURL)).find(value => value.name === name);
      expect(Boolean(cookie?.value && cookie.httpOnly && cookie.sameSite === "Lax" && cookie.secure), "Session cookies must be HttpOnly, Secure and SameSite=Lax").toBe(true);
    }
    expect(await page.evaluate(names => names.every(name => !document.cookie.split(";").some(cookie => cookie.trim().startsWith(`${name}=`))), sessionCookies), "Browser scripts must not read session cookies").toBe(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Quotes", exact: true })).toBeVisible();

    // The browser drops the access cookie when it expires; the refresh token restores it.
    await context.clearCookies({ name: ACCESS_COOKIE });
    await adminNavigate(page, "/admin/invoices");
    await expect(page.getByRole("heading", { name: "Invoices", exact: true })).toBeVisible();
    expect((await liveApi(context.request, live.baseURL, "/api/admin/data")).status(), "Removing the expired access cookie must recover the real session using Supabase refresh").toBe(200);
    const access = (await context.cookies(live.baseURL)).find(cookie => cookie.name === ACCESS_COOKIE);
    expect(Boolean(access?.value), "Session refresh must restore the HttpOnly access cookie").toBe(true);

    // Supabase Auth rejects an expired or invalid access JWT with 403 bad_jwt. A
    // stale access cookie must also be refreshed instead of signing Mike out.
    await context.addCookies([{ ...access!, value: "stale.access.token" }]);
    await adminNavigate(page, "/admin/diary");
    await expect(page.getByRole("heading", { name: "Diary", exact: true })).toBeVisible();
    expect((await context.cookies(live.baseURL)).find(cookie => cookie.name === ACCESS_COOKIE)?.value !== "stale.access.token", "A rejected access JWT must be replaced using the refresh token").toBe(true);
    await layoutFits(page);
  });

  test("test drafts leave existing records and issued numbers unchanged, and stale saves are rejected", async ({ admin, live, records }) => {
    const request = admin.context.request;
    const current = await readCloud(request, live.baseURL);
    expect(current.data.quotes.some(record => record.id === records.quoteId) && current.data.invoices.some(record => record.id === records.invoiceId), "The TEST quote and invoice must be stored").toBe(true);
    // A stale revision carries the current, unchanged snapshot: if conflict
    // protection ever regresses, this probe still cannot erase recent data.
    const stale = await liveApi(request, live.baseURL, "/api/admin/data", "PUT", { data: current.data, revision: current.revision - 1 });
    expect(stale.status(), "Outdated browser revisions must be rejected without overwriting cloud data").toBe(409);
    expect((await readCloud(request, live.baseURL)).revision, "A rejected save must not create a revision").toBe(current.revision);
  });

  test("a second, independently signed-in browser sees and edits the same quote and invoice", async ({ admin, observer, live, records }) => {
    const intro = `TEST saved from another browser ${live.runId}`;
    await adminNavigate(observer.page, `/admin/quotes/${records.quoteId}`);
    await expect(field(observer.page, "Job title")).toHaveValue(records.quoteTitle);
    await field(observer.page, "Introduction").fill(intro);
    await waitCloud(observer.context.request, live.baseURL, data => data.quotes.find(record => record.id === records.quoteId)?.intro === intro);
    await adminNavigate(admin.page, `/admin/quotes/${records.quoteId}`);
    await expect(field(admin.page, "Introduction")).toHaveValue(intro);
    await layoutFits(admin.page);
    await adminNavigate(observer.page, `/admin/invoices/${records.invoiceId}`);
    await expect(field(observer.page, "Customer name")).toHaveValue("Bill Gates");
    await expect(field(observer.page, "Job title")).toHaveValue(records.invoiceTitle);
    await layoutFits(observer.page);
  });

  test("reviewed legacy browser records are imported without replacing current cloud records", async ({ admin, observer, ledger, live, records }) => {
    await verifyLegacyBrowserImport({ page: admin.page, observerPage: observer.page, baseURL: live.baseURL, owned: ledger.owned, runId: live.runId, existingQuoteId: records.quoteId });
  });

  test("invoice line edits and optional VAT recalculate and persist across browsers", async ({ admin, observer, live, records }) => {
    const { page } = admin;
    const stored = (data: AdminData) => invoiceIn(data, records.invoiceId)!;
    await adminNavigate(page, `/admin/invoices/${records.invoiceId}`);
    const works = region(page, "Itemised works");
    for (const line of ["Line 1", "Line 2"]) {
      await expect(field(works.getByRole("group", { name: line, exact: true }), "Qty")).toHaveValue("3");
      await expect(field(works.getByRole("group", { name: line, exact: true }), "Price each")).toHaveValue("250.00");
    }
    const materialPrice = field(region(page, "Materials").getByRole("group", { name: "Line 1", exact: true }), "Price each");
    await expect(materialPrice).toHaveValue("180.00");
    await materialPrice.fill("181");
    await waitCloud(admin.context.request, live.baseURL, data => invoiceTotals(stored(data)).totalPence === 168100);
    await expect(editorTotal(page, "Invoice total")).toHaveText("£1,681.00");

    await materialPrice.fill("180");
    const vat = page.getByRole("switch", { name: "Charge VAT", exact: true });
    await vat.check();
    await waitCloud(admin.context.request, live.baseURL, data => stored(data).vat.enabled && invoiceTotals(stored(data)).totalPence === 201600);
    await expect(editorTotal(page, "VAT at 20%")).toHaveText("£336.00");
    await expect(editorTotal(page, "Invoice total")).toHaveText("£2,016.00");
    await vat.uncheck();
    await waitCloud(admin.context.request, live.baseURL, data => !stored(data).vat.enabled && invoiceTotals(stored(data)).totalPence === 168000);
    await expect(editorTotal(page, "Invoice total")).toHaveText("£1,680.00");

    await adminNavigate(observer.page, `/admin/invoices/${records.invoiceId}`);
    await expect(observer.page.getByRole("switch", { name: "Charge VAT", exact: true })).not.toBeChecked();
    await expect(editorTotal(observer.page, "Invoice total")).toHaveText("£1,680.00");
    await expect(editorTotal(observer.page, "Balance due")).toHaveText("£1,680.00");
    await layoutFits(page);
  });

  test("a diary booking made from the invoice links both documents and is edited on the other device", async ({ admin, observer, ledger, live, records }) => {
    const { page } = admin;
    const job = bookingJob(live.runId);
    await adminNavigate(page, `/admin/invoices/${records.invoiceId}`);
    await region(page, "Diary").getByRole("link", { name: "Book into diary", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New booking", exact: true });
    await expect(dialog).toBeVisible();
    // Prefilled from the invoice it was booked from.
    await expect(field(dialog, "Customer")).toHaveValue("Bill Gates");
    await expect(field(dialog, "Job description")).toHaveValue(records.invoiceTitle);
    await expect(field(dialog, "Linked invoice")).toHaveValue(records.invoiceId);
    await field(dialog, "Job description").fill(job);
    await field(dialog, "Linked quote").selectOption(records.quoteId);
    bookingDate = await field(dialog, "First day").inputValue();
    await layoutFits(page);
    await dialog.getByRole("button", { name: "Add to diary", exact: true }).click();
    await expect(dialog).toBeHidden();
    await waitCloud(admin.context.request, live.baseURL, data => data.bookings.some(record => record.job === job && record.invoiceId === records.invoiceId && record.quoteId === records.quoteId));
    ledger.owned.add((await readCloud(admin.context.request, live.baseURL)).data.bookings.find(record => record.job === job)!.id);
    await expect(bookingCard(page, live.runId)).toBeVisible();

    const notes = `TEST updated on another device ${live.runId}`;
    await adminNavigate(observer.page, `/admin/diary?date=${bookingDate}`);
    await bookingCard(observer.page, live.runId).click();
    const edit = observer.page.getByRole("dialog", { name: "Edit booking", exact: true });
    await expect(field(edit, "Linked invoice")).toHaveValue(records.invoiceId);
    await expect(field(edit, "Linked quote")).toHaveValue(records.quoteId);
    await field(edit, "Notes").fill(notes);
    await edit.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(edit).toBeHidden();
    await waitCloud(observer.context.request, live.baseURL, data => data.bookings.find(record => record.job === job)?.notes === notes);
    await layoutFits(observer.page);

    // The ?date link selects a day once. Moving through the calendar must survive
    // the background refresh that runs whenever the admin window regains focus.
    const month = observer.page.getByRole("heading", { level: 2, name: /^[A-Z][a-z]+ \d{4}$/ });
    const linkedMonth = await month.textContent();
    await observer.page.getByRole("button", { name: "Next month", exact: true }).click();
    await expect(month).not.toHaveText(linkedMonth!);
    const nextMonth = await month.textContent();
    const refreshed = observer.page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/data" && response.request().method() === "GET");
    await observer.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await (await refreshed).finished();
    // Let React apply the refreshed records and run its effects before checking.
    await observer.page.evaluate(() => new Promise(resolve => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 50)));
    await expect(month, "A cloud refresh must not reset the calendar to the linked date").toHaveText(nextMonth!);

    // Both linked documents list the booking on the first device.
    await adminNavigate(page, `/admin/invoices/${records.invoiceId}`);
    await expect(region(page, "Diary").getByRole("link", { name: /^Booked / })).toBeVisible();
    await adminNavigate(page, `/admin/quotes/${records.quoteId}`);
    await expect(region(page, "Next steps").getByRole("link", { name: /^Booked / })).toBeVisible();
  });

  test("converting the accepted test quote creates a draft test invoice without an issued number", async ({ admin, ledger, live, records }) => {
    const { page } = admin;
    await adminNavigate(page, `/admin/quotes/${records.quoteId}`);
    await field(page, "Status").selectOption("accepted");
    await waitCloud(admin.context.request, live.baseURL, data => data.quotes.find(record => record.id === records.quoteId)?.status === "accepted");
    const before = await readCloud(admin.context.request, live.baseURL);
    await page.getByRole("button", { name: "Create invoice from quote", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/invoices\/[a-zA-Z0-9_-]+$/);
    const convertedId = new URL(page.url()).pathname.split("/").pop()!;
    ledger.owned.add(convertedId);
    await expect(page.getByRole("heading", { level: 1, name: records.quoteTitle, exact: true })).toBeVisible();
    await waitCloud(admin.context.request, live.baseURL, data => data.invoices.some(record => record.id === convertedId));
    const converted = await readCloud(admin.context.request, live.baseURL);
    const invoice = invoiceIn(converted.data, convertedId)!;
    expect(invoice.quoteId === records.quoteId && invoice.quoteNumber.startsWith("TEST-") && invoice.isTest === true && invoice.status === "draft" && invoice.number.startsWith("TEST-"), "Converting a test quote must preserve its test marker and draft state").toBe(true);
    expect(converted.data.settings.nextInvoiceNumber, "Test conversions must not consume issued invoice numbers").toBe(before.data.settings.nextInvoiceNumber);
    expect(Object.values(invoice.bank).every(value => value === ""), "Test conversions must omit payment bank details").toBe(true);
    await expect(editorTotal(page, "Invoice total")).toHaveText("£100.00");

    await adminNavigate(page, `/admin/quotes/${records.quoteId}`);
    await expect(region(page, "Next steps").getByRole("link", { name: `Invoice ${invoice.number}`, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create another invoice", exact: true })).toBeVisible();
  });

  test("Bill Gates's £1,680 test invoice opens through its customer link without admin access or other documents", async ({ admin, customer, live, records }) => {
    await adminNavigate(admin.page, `/admin/invoices/${records.invoiceId}`);
    invoiceLink = await createCustomerLink(admin.page);
    expect(new URL(invoiceLink).origin === live.baseURL, "Customer links must remain on the selected application").toBe(true);
    const { page, context } = customer;
    const response = await privateNavigate(page, invoiceLink);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Invoice", exact: true })).toBeVisible();
    await expect(page.getByText("Bill Gates", { exact: true })).toBeVisible();
    await expect(documentTotal(page, "Test total")).toHaveText("£1,680.00");
    await expect(page.getByText("Test document · Not issued · No payment required", { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Admin sections" })).toHaveCount(0);
    await expect(page.getByText("Payment details", { exact: true })).toHaveCount(0);
    await expect(page.locator("input[type=password]")).toHaveCount(0);
    const html = await response!.text();
    expect([records.privateMarker, records.quoteTitle, records.separateCustomer].every(value => !html.includes(value)), "Customer HTML and serialized data must omit other documents and private notes").toBe(true);
    expect(response?.headers()["cache-control"].includes("no-store")).toBe(true);
    expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
    expect(await hasSessionCookie(page, live.baseURL), "A customer document must not grant an admin session").toBe(false);
    await layoutFits(page);
    expect((await liveApi(context.request, live.baseURL, "/api/admin/data")).status()).toBe(401);
    expect((await liveApi(context.request, live.baseURL, "/api/admin/share", "POST", { id: records.quoteId, action: "create" })).status()).toBe(401);
    await unavailable(page, `/d/${records.quoteId}`);
    const token = new URL(invoiceLink).pathname.split("/").pop()!;
    await unavailable(page, `/d/${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`);
    await privateNavigate(page, `/admin/invoices/${records.invoiceId}`);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("navigation", { name: "Admin sections" })).toHaveCount(0);
  });

  test("a £500 deposit leaves £1,180 due in storage, both browsers and the same customer link", async ({ admin, observer, customer, live, records }) => {
    const { page } = admin;
    await adminNavigate(page, `/admin/invoices/${records.invoiceId}`);
    await page.getByRole("button", { name: "Record a payment or deposit", exact: true }).click();
    const payment = page.getByRole("group", { name: "Payment 1", exact: true });
    await field(payment, "Amount").fill("500");
    await field(payment, "Method").selectOption("cash");
    await field(payment, "Shown as").fill("TEST deposit received");
    await waitCloud(admin.context.request, live.baseURL, data => {
      const invoice = invoiceIn(data, records.invoiceId)!;
      const totals = invoiceTotals(invoice);
      return invoice.isTest === true && invoice.status === "draft" && invoice.payments.length === 1 &&
        invoice.payments[0].amount === 500 && invoice.payments[0].method === "cash" &&
        invoice.payments[0].label === "TEST deposit received" && totals.totalPence === 168000 &&
        totals.paidPence === 50000 && totals.balancePence === 118000;
    });
    await expect(editorTotal(page, "Received")).toHaveText("£500.00");
    await expect(editorTotal(page, "Balance due")).toHaveText("£1,180.00");

    await adminNavigate(observer.page, `/admin/invoices/${records.invoiceId}`);
    const observed = observer.page.getByRole("group", { name: "Payment 1", exact: true });
    await expect(field(observed, "Amount")).toHaveValue("500.00");
    await expect(field(observed, "Method")).toHaveValue("cash");
    await expect(field(observed, "Shown as")).toHaveValue("TEST deposit received");
    await expect(editorTotal(observer.page, "Balance due")).toHaveText("£1,180.00");
    await layoutFits(observer.page);

    expect((await privateNavigate(customer.page, invoiceLink))?.status()).toBe(200);
    await expect(documentTotal(customer.page, "Total")).toHaveText("£1,680.00");
    // dm_get_shared_document treats payment labels as private bookkeeping: the
    // customer sees the payment method and date, never the admin's own wording.
    await expect(documentTotal(customer.page, /^Cash received, /)).toHaveText("−£500.00");
    await expect(customer.page.getByText("TEST deposit received")).toHaveCount(0);
    await expect(documentTotal(customer.page, "Balance due")).toHaveText("£1,180.00");
    await expect(customer.page.getByText("Test document · Not issued · No payment required", { exact: true })).toBeVisible();
    await layoutFits(customer.page);
    expect((await liveApi(customer.context.request, live.baseURL, "/api/admin/data")).status()).toBe(401);
  });

  test("the customer's test invoice prints and renders a complete PDF entirely in memory", async ({ customer, live }) => {
    const { page } = customer;
    await expect(documentTotal(page, "Balance due")).toHaveText("£1,180.00");
    // Exercise the actual customer button without opening a native OS print
    // dialog. Restore window.print before testing Chromium's real PDF renderer.
    const printControl = await page.evaluateHandle(() => {
      const original = window.print;
      let calls = 0;
      window.print = () => { calls += 1; };
      return { calls: () => calls, restore: () => { window.print = original; } };
    });
    try {
      await page.getByRole("button", { name: "Print / Save PDF", exact: true }).click();
      expect(await printControl.evaluate(control => control.calls()), "The customer print button must invoke browser printing").toBe(1);
    } finally {
      await printControl.evaluate(control => control.restore());
      await printControl.dispose();
    }

    await page.emulateMedia({ media: "print" });
    try {
      await expect(page.getByRole("button", { name: "Print / Save PDF", exact: true })).toBeHidden();
      await expect(page.getByRole("heading", { name: "Invoice", exact: true })).toBeVisible();
      await expect(page.getByText("Bill Gates", { exact: true })).toBeVisible();
      await expect(page.getByText("Test document · Not issued · No payment required", { exact: true })).toBeVisible();
      await expect(documentTotal(page, "Balance due")).toHaveText("£1,180.00");
      await expect(page.getByText("Payment details", { exact: true })).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      // Deliberately omit path and testInfo.attach: customer PDFs and bearer
      // links must never enter CI files, reports or uploaded artifacts.
      const pdf = await page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
      expect(pdf.byteLength > 1000 && pdf.subarray(0, 5).toString("ascii") === "%PDF-" && pdf.subarray(-32).toString("ascii").includes("%%EOF"), "Chromium must render a complete, nonempty customer PDF").toBe(true);
    } finally {
      await page.emulateMedia({ media: "screen" });
    }
    await expect(page.getByRole("button", { name: "Print / Save PDF", exact: true })).toBeVisible();
    expect(await hasSessionCookie(page, live.baseURL), "Printing a document must not create an admin session").toBe(false);
  });

  test("the separate quote link is isolated, and replacing or revoking a link disables the old one", async ({ admin, browser, customer, live, records }) => {
    await adminNavigate(admin.page, `/admin/quotes/${records.quoteId}`);
    const quoteLink = await createCustomerLink(admin.page);
    const quoteCustomer = await browser.newContext(live.otherDevice);
    try {
      await prepareLiveBrowser(quoteCustomer, live.baseURL);
      const quotePage = await quoteCustomer.newPage();
      const response = await privateNavigate(quotePage, quoteLink);
      expect(response?.status()).toBe(200);
      await expect(quotePage.getByRole("heading", { name: "Quotation", exact: true })).toBeVisible();
      expect((await response!.text()).includes("Bill Gates"), "A quotation link must not disclose a different customer's invoice").toBe(false);
      await expect(quotePage.getByText(records.separateCustomer, { exact: true })).toBeVisible();
      await layoutFits(quotePage);
    } finally {
      await quoteCustomer.close();
    }

    await adminNavigate(admin.page, `/admin/invoices/${records.invoiceId}`);
    const replacement = await createCustomerLink(admin.page);
    expect(replacement !== invoiceLink, "Replacing a link must issue a new token").toBe(true);
    await unavailable(customer.page, invoiceLink);
    expect((await privateNavigate(customer.page, replacement))?.status()).toBe(200);
    const revoked = admin.page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/share" && response.request().method() === "POST");
    await region(admin.page, "Customer link").getByRole("button", { name: "Revoke customer access", exact: true }).click();
    expect((await revoked).status()).toBe(200);
    await expect(region(admin.page, "Customer link").getByRole("status")).toHaveText("Customer access revoked. Previous links no longer work.");
    await unavailable(customer.page, replacement);
  });

  test("marking the invoice paid records the £1,180 remainder and shows it paid on the other device", async ({ admin, observer, live, records }) => {
    const { page } = admin;
    await adminNavigate(page, `/admin/invoices/${records.invoiceId}`);
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Mark paid", exact: true }).click();
    await waitCloud(admin.context.request, live.baseURL, data => {
      const invoice = invoiceIn(data, records.invoiceId)!;
      const totals = invoiceTotals(invoice);
      return invoice.status === "draft" && invoice.isTest === true && invoice.payments.length === 2 &&
        invoice.payments.some(payment => payment.amount === 500 && payment.label === "TEST deposit received") &&
        invoice.payments.some(payment => payment.amount === 1180 && payment.label === "Balance received") &&
        totals.totalPence === 168000 && totals.paidPence === 168000 && totals.balancePence === 0;
    });
    await expect(page.getByRole("button", { name: "Mark paid", exact: true })).toHaveCount(0);
    await adminNavigate(observer.page, `/admin/invoices/${records.invoiceId}`);
    await expect(observer.page.getByRole("main").getByText("Paid", { exact: true })).toBeVisible();
    await expect(editorTotal(observer.page, "Balance due")).toHaveText("£0.00");
  });

  test("this run's invoice, booking and quote are deleted through their own controls", async ({ admin, live, records }) => {
    const { page } = admin;
    const request = admin.context.request;
    await adminNavigate(page, `/admin/invoices/${records.invoiceId}`);
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Delete invoice", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/invoices$/);
    await waitCloud(request, live.baseURL, data => !invoiceIn(data, records.invoiceId), "The deleted invoice must be removed from cloud storage");

    await adminNavigate(page, `/admin/diary?date=${bookingDate}`);
    await bookingCard(page, live.runId).click();
    const edit = page.getByRole("dialog", { name: "Edit booking", exact: true });
    page.once("dialog", dialog => dialog.accept());
    await edit.getByRole("button", { name: "Remove", exact: true }).click();
    await waitCloud(request, live.baseURL, data => !data.bookings.some(record => record.job === bookingJob(live.runId)), "The removed booking must be removed from cloud storage");

    await adminNavigate(page, `/admin/quotes/${records.quoteId}`);
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Delete quote", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/quotes$/);
    await waitCloud(request, live.baseURL, data => !data.quotes.some(record => record.id === records.quoteId), "The deleted quote must be removed from cloud storage");
    test.info().annotations.push({ type: "verification", description: "Verified real Supabase Auth, cross-browser storage, test-only documents, partial payments and remaining-balance settlement, customer print/PDF rendering and isolation/revocation, session refresh, and the selected viewport's layouts. No invoice was issued or emailed; PDF bytes remained in memory." });
  });
});

test.describe("session revocation", () => {
  test("signing out revokes the Supabase session and replayed cookies cannot regain access", async ({ browser, live }) => {
    const context = await browser.newContext(live.device);
    const replay = await browser.newContext({ baseURL: live.baseURL });
    let failure: unknown;
    try {
      await prepareLiveBrowser(context, live.baseURL);
      await prepareLiveBrowser(replay, live.baseURL);
      const page = await context.newPage();
      await signIn(page, live.password);
      await replay.addCookies((await context.cookies(live.baseURL)).filter(cookie => sessionCookies.includes(cookie.name)));
      const signedOut = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/logout" && response.request().method() === "POST");
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      expect((await signedOut).status()).toBe(200);
      // The page navigates immediately, so the response body is gone. The admin
      // goes to /login?signout=local, with a warning, unless Supabase confirmed revocation.
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByText("The server could not confirm session revocation", { exact: false })).toHaveCount(0);
      expect(await hasSessionCookie(page, live.baseURL), "Logout must clear both session cookies").toBe(false);
      expect((await liveApi(context.request, live.baseURL, "/api/admin/data")).status()).toBe(401);
      expect((await liveApi(replay.request, live.baseURL, "/api/admin/data")).status(), "Replaying the logged-out access and refresh cookies must not regain admin access").toBe(401);
      await privateNavigate(page, "/admin/diary");
      await expect(page).toHaveURL(/\/login$/);
    } catch (error) {
      failure = error;
    }
    // Revoke whatever is still live (a partial sign-in, or the replayed copy if
    // revocation regressed), then report the original failure first.
    const cleanup = [...await revokeAndClose(context, live.baseURL, "Signed-out browser"), ...await revokeAndClose(replay, live.baseURL, "Replay browser")];
    if (failure) throw failure;
    expect(cleanup, "Every browser session must be revoked and closed").toEqual([]);
  });
});
