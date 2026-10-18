import { expect, type Page } from "@playwright/test";
import { emptyCustomer, emptyData } from "../../../lib/admin/factories";
import { createQuote } from "../../../lib/admin/operations";
import { field, readCloud, waitCloud } from "./fixtures";
import { adminNavigate } from "./live-environment";

export type LegacyImportOptions = {
  page: Page;
  observerPage: Page;
  baseURL: string;
  owned: Set<string>;
  runId: string;
  existingQuoteId: string;
};

const LEGACY_KEY = "dm-admin:v1";

/** Exercise the reviewed legacy import against real storage using TEST data only. */
export async function verifyLegacyBrowserImport({ page, observerPage, baseURL, owned, runId, existingQuoteId }: LegacyImportOptions): Promise<void> {
  const request = page.context().request;
  const before = await readCloud(request, baseURL);
  const existing = before.data.quotes.find(quote => quote.id === existingQuoteId);
  expect(Boolean(existing && owned.has(existing.id) && existing.isTest === true && existing.number.startsWith("TEST-") && existing.title.startsWith(`TEST ${runId} `)), "Legacy import verification requires an existing TEST quote owned by this run").toBe(true);
  if (!existing) throw new Error("The existing TEST quote is unavailable for import verification.");
  expect(await page.evaluate(key => window.localStorage.getItem(key) === null, LEGACY_KEY), "The isolated test browser must not already contain original browser records").toBe(true);

  const now = new Date().toISOString();
  const seed = emptyData(now);
  // Deliberately different settings make the unchecked option meaningful. Copy
  // only numeric sequence values, so even a reviewed merge cannot consume or
  // advance issued document numbers. No real customer/bank data enters source.
  seed.settings = {
    ...seed.settings,
    businessName: `TEST ${runId} Browser settings must not replace cloud`,
    email: "",
    website: "",
    defaultQuoteIntro: "TEST legacy browser import",
    defaultTerms: ["TEST document only. Not issued. No payment required."],
    defaultPaymentNote: "",
    nextQuoteNumber: before.data.settings.nextQuoteNumber,
    nextInvoiceNumber: before.data.settings.nextInvoiceNumber,
  };
  const created = createQuote(seed, { now, today: now.slice(0, 10) }, {
    isTest: true,
    title: `TEST ${runId} Imported browser quotation`,
    customer: { ...emptyCustomer(), name: `TEST Browser Customer ${runId}` },
    works: [{ description: "TEST legacy preparation", quantity: 1, unit: "day", unitPrice: 75 }],
    internalNotes: "TEST legacy fixture only. Not issued to a customer.",
    source: "import",
  });
  const imported = created.quote;
  expect([before.data.quotes, before.data.invoices, before.data.bookings].every(records => records.every(record => record.id !== imported.id)), "The new TEST quote ID must not belong to an existing cloud record").toBe(true);
  // Register ownership before the source is placed in the browser or any UI
  // action can persist it; the worker's cleanup removes this ID safely.
  owned.add(imported.id);
  const stale = {
    ...imported,
    id: existing.id,
    number: existing.number,
    title: `TEST ${runId} Stale browser duplicate must not replace cloud`,
    intro: "TEST stale browser introduction must not replace cloud",
    updatedAt: "2000-01-01T00:00:00.000Z",
  };
  const source = JSON.stringify({ ...created.data, quotes: [stale, imported] });
  await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [LEGACY_KEY, source]);

  try {
    const sourceIsUnchanged = async () => {
      expect(await page.evaluate(([key, value]) => window.localStorage.getItem(key) === value, [LEGACY_KEY, source]), "Review and import must preserve the original browser source byte for byte").toBe(true);
    };
    const cloudIsUnchanged = async () => {
      const current = await readCloud(request, baseURL);
      expect(current.revision === before.revision && JSON.stringify(current.data) === JSON.stringify(before.data), "Original browser records must not enter or alter cloud storage before explicit approval").toBe(true);
    };

    await adminNavigate(page, "/admin/settings#storage");
    await expect(page.getByRole("link", { name: "Saved to cloud", exact: true })).toBeVisible();
    const review = page.getByRole("button", { name: "Review original browser records", exact: true });
    await expect(review).toBeVisible();
    await cloudIsUnchanged();
    await sourceIsUnchanged();
    await review.click();

    const dialog = page.getByRole("dialog", { name: "Review import", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Contains 2 quotes, 0 invoices and 0 bookings.");
    await expect(dialog).toContainText("Will add 1 quotes, 0 invoices and 0 bookings.");
    await expect(dialog).toContainText("Existing records with the same ID will be kept.");
    await expect(dialog.getByRole("checkbox", { name: "Also use business settings from this backup", exact: true })).not.toBeChecked();
    await cloudIsUnchanged();
    await sourceIsUnchanged();

    await dialog.getByRole("button", { name: "Import missing records", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: "Missing records imported and saved to cloud storage." })).toBeVisible();
    await waitCloud(request, baseURL, data => data.quotes.some(quote => quote.id === imported.id && quote.isTest === true && quote.number.startsWith("TEST-")));
    const after = await readCloud(request, baseURL);
    for (const group of ["quotes", "invoices", "bookings"] as const) {
      const retained = after.data[group].filter(record => record.id !== imported.id);
      expect(retained.length === before.data[group].length && before.data[group].every(record => {
        const current = retained.find(candidate => candidate.id === record.id);
        return current !== undefined && JSON.stringify(current) === JSON.stringify(record);
      }), "Import must preserve every pre-existing cloud record, including the newer duplicate").toBe(true);
    }
    expect(JSON.stringify(after.data.settings) === JSON.stringify(before.data.settings), "Leaving settings unchecked must preserve business settings and issued number sequences").toBe(true);
    expect(JSON.stringify(after.data.meta) === JSON.stringify(before.data.meta), "Import must preserve existing cloud backup metadata").toBe(true);
    expect(after.data.quotes.filter(quote => quote.id === imported.id).length === 1 && after.data.quotes.filter(quote => quote.id === existing.id).length === 1, "Import must add only the missing TEST quote and retain one existing quote").toBe(true);
    await sourceIsUnchanged();

    // This page belongs to the independently authenticated observer context. Its
    // full navigation loads Supabase records without sharing localStorage/state.
    expect(await observerPage.evaluate(key => window.localStorage.getItem(key) === null, LEGACY_KEY), "The independent browser must not contain the importing browser's legacy source").toBe(true);
    await adminNavigate(observerPage, `/admin/quotes/${imported.id}`);
    await expect(field(observerPage, "Job title")).toHaveValue(imported.title);
    await expect(field(observerPage, "Customer name")).toHaveValue(imported.customer.name);
    await adminNavigate(observerPage, `/admin/quotes/${existing.id}`);
    await expect(field(observerPage, "Job title"), "The second browser must retain the cloud quote rather than the stale browser duplicate").toHaveValue(existing.title);
    await expect(field(observerPage, "Introduction"), "Import must retain the existing cloud introduction across browsers").toHaveValue(existing.intro);
    await sourceIsUnchanged();
  } finally {
    // The synthetic source belongs to this test, not to Mike's real browser.
    await page.evaluate(key => window.localStorage.removeItem(key), LEGACY_KEY).catch(() => {});
  }
}
