import { devices, expect, test as base, type APIRequestContext, type Browser, type BrowserContext, type BrowserContextOptions, type Locator, type Page } from "@playwright/test";
import { ACCESS_COOKIE, ADMIN_EMAIL, REFRESH_COOKIE } from "../../../lib/admin/auth";
import { emptyCustomer } from "../../../lib/admin/factories";
import { billGatesTestInvoice } from "../../../lib/admin/fixtures";
import { invoiceTotals } from "../../../lib/admin/money";
import { createQuote } from "../../../lib/admin/operations";
import type { AdminData } from "../../../lib/admin/types";
import { liveApi, liveEnvironment, prepareLiveBrowser, privateNavigate } from "./live-environment";

// Shared fixtures for the real-workflow suite. Sessions, records and cleanup are
// worker-scoped: Playwright tears them down with their own time budget after a
// test passes, fails or times out, so test records are removed and every Auth
// session is revoked even when a workflow step fails. Failure messages are fixed
// strings: they never contain passwords, cookies, tokens or customer links.

export type Snapshot = { data: AdminData; revision: number };
export type Session = { context: BrowserContext; page: Page };
export type Live = { baseURL: string; password: string; runId: string; isMobile: boolean; device: BrowserContextOptions; otherDevice: BrowserContextOptions };
export type Ledger = { runId: string; owned: Set<string> };
export type Records = { quoteId: string; quoteTitle: string; invoiceId: string; invoiceTitle: string; privateMarker: string; separateCustomer: string };

const groups = ["quotes", "invoices", "bookings"] as const;
/** Every record this suite creates is titled "TEST <12 hex run id> …". */
const automatedTitle = /^TEST [0-9a-f]{12} /;
/** Leftovers younger than this may belong to a run still in progress elsewhere. */
const STALE_AFTER_MS = 20 * 60_000;

const label = (record: AdminData[(typeof groups)[number]][number]) => record.kind === "booking" ? record.job : record.title;
const automated = (record: AdminData[(typeof groups)[number]][number]) =>
  automatedTitle.test(label(record)) && (record.kind === "booking" || (record.isTest === true && record.number.startsWith("TEST-")));

export async function readCloud(request: APIRequestContext, origin: string): Promise<Snapshot> {
  const response = await liveApi(request, origin, "/api/admin/data");
  expect(response.status(), "Authenticated cloud read must succeed; preview access or Supabase Auth may still be blocked").toBe(200);
  const result = await response.json() as Snapshot;
  expect(Boolean(result.data && groups.every(key => Array.isArray(result.data[key])) && Number.isSafeInteger(result.revision)), "Cloud response must have records and a revision").toBe(true);
  return result;
}

/** The API accepts a complete snapshot: never overwrite or delete records outside `owned`. */
export async function saveOwned(request: APIRequestContext, origin: string, before: Snapshot, next: AdminData, owned: Set<string>) {
  for (const group of groups) {
    const untouched = before.data[group].filter(record => !owned.has(record.id));
    const proposed = next[group].filter(record => !owned.has(record.id));
    expect(JSON.stringify(untouched) === JSON.stringify(proposed), "Refusing to change records not created by this run").toBe(true);
  }
  expect(JSON.stringify(before.data.settings) === JSON.stringify(next.settings), "Live fixtures must not change business settings or issued number sequences").toBe(true);
  expect(JSON.stringify(before.data.meta) === JSON.stringify(next.meta), "Live fixtures must not change backup metadata").toBe(true);
  return liveApi(request, origin, "/api/admin/data", "PUT", { revision: before.revision, data: next });
}

/** Remove records by ID, retrying when a page's own background save wins the revision race. */
async function removeRecords(request: APIRequestContext, origin: string, select: (record: AdminData[(typeof groups)[number]][number]) => boolean) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readCloud(request, origin);
    const doomed = new Set(groups.flatMap(group => current.data[group].filter(select).map(record => record.id)));
    if (!doomed.size) return 0;
    const response = await saveOwned(request, origin, current, {
      ...current.data,
      quotes: current.data.quotes.filter(record => !doomed.has(record.id)),
      invoices: current.data.invoices.filter(record => !doomed.has(record.id)),
      bookings: current.data.bookings.filter(record => !doomed.has(record.id)),
    }, doomed);
    if (response.status() === 200) return doomed.size;
    if (response.status() !== 409) break;
  }
  throw new Error("Temporary TEST records could not be removed. Review the TEST drafts for this run before repeating live verification.");
}

export async function waitCloud(request: APIRequestContext, origin: string, predicate: (data: AdminData) => boolean, message = "The expected test record must be present in permanent cloud storage") {
  await expect.poll(async () => predicate((await readCloud(request, origin)).data), { message, timeout: 20_000, intervals: [300, 600, 1200] }).toBe(true);
}

export async function layoutFits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "The selected viewport must not require horizontal scrolling").toBe(true);
}

/** Form controls are named by their visible label only (see components/admin/fields.tsx). */
export const field = (scope: Page | Locator, name: string) => scope.getByLabel(name, { exact: true });
export const region = (scope: Page | Locator, name: string) => scope.getByRole("region", { name, exact: true });
const exactly = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
/** The amount beside a label in an editor's Totals card. */
export const editorTotal = (page: Page, name: string) =>
  region(page, "Totals").locator("div").filter({ has: page.getByRole("term").filter({ hasText: exactly(name) }) }).getByRole("definition");
/** The amount beside a label in a rendered quotation or invoice. */
export const documentTotal = (page: Page, name: string | RegExp) =>
  page.getByRole("article").locator(".dmdoc-totals > div").filter({ has: page.locator("span").filter({ hasText: typeof name === "string" ? exactly(name) : name }) }).locator("strong");

export async function signIn(page: Page, password: string) {
  const response = await privateNavigate(page, "/login");
  expect(response?.status(), "The login page must be reachable before real workflow verification").toBe(200);
  await expect(page.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
  await field(page, "Email").fill(ADMIN_EMAIL);
  // Do not use locator.fill(password): its failure call log can print the value.
  // Recordings are also disabled by the dedicated live config.
  await page.evaluate(value => {
    const input = document.querySelector<HTMLInputElement>('input[name="password"]');
    if (!input) throw new Error("The password field is unavailable.");
    input.value = value;
  }, password);
  const signedIn = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/login" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await signedIn).status(), "Mike's confirmed Supabase Auth account and privately supplied password must authenticate successfully").toBe(200);
  await expect(page).toHaveURL(/\/admin\/quotes$/);
  await expect(page.getByRole("link", { name: "Saved to cloud", exact: true })).toBeVisible();
  await layoutFits(page);
}

/** Revoke a context's Auth session on the server, then close it; returns fixed failure messages. */
export async function revokeAndClose(context: BrowserContext, origin: string, name: string): Promise<string[]> {
  const failures: string[] = [];
  try {
    const response = await liveApi(context.request, origin, "/api/auth/logout", "POST");
    const result: unknown = response.status() === 200 ? await response.json() : null;
    if (!result || typeof result !== "object" || !("revoked" in result) || result.revoked !== true) failures.push(`${name}: server session revocation was not confirmed.`);
    if ((await context.cookies(origin)).some(cookie => [ACCESS_COOKIE, REFRESH_COOKIE].includes(cookie.name))) failures.push(`${name}: session cookies remained after logout.`);
  } catch {
    failures.push(`${name}: the session revocation request failed.`);
  }
  try { await context.close(); }
  catch { failures.push(`${name}: the browser context could not be closed.`); }
  return failures;
}

function deviceOptions(use: Record<string, unknown>, baseURL: string): BrowserContextOptions {
  const pick = ["viewport", "userAgent", "deviceScaleFactor", "isMobile", "hasTouch", "serviceWorkers"] as const;
  return { ...Object.fromEntries(pick.filter(key => use[key] !== undefined).map(key => [key, use[key]])), baseURL };
}

async function session(live: Live, device: BrowserContextOptions, browser: Browser, name: string, provide: (session: Session) => Promise<void>) {
  const context = await browser.newContext(device);
  let failure: unknown;
  try {
    await prepareLiveBrowser(context, live.baseURL);
    const page = await context.newPage();
    await signIn(page, live.password);
    await provide({ context, page });
  } catch (error) {
    failure = error;
  }
  // Also covers a partially completed sign-in that already holds a live session.
  const cleanup = await revokeAndClose(context, live.baseURL, name);
  if (failure) {
    // Report the original failure; cleanup problems must not hide it.
    if (cleanup.length) console.error(cleanup.join(" "));
    throw failure;
  }
  if (cleanup.length) throw new Error(cleanup.join(" "));
}

type WorkerFixtures = { live: Live; admin: Session; observer: Session; customer: Session; ledger: Ledger; records: Records };

export const test = base.extend<{ deadline: void }, WorkerFixtures>({
  live: [async ({}, use, workerInfo) => {
    const { baseURL, password } = liveEnvironment();
    const isMobile = workerInfo.project.use.isMobile === true;
    await use({
      baseURL, password, isMobile,
      runId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
      device: deviceOptions(workerInfo.project.use as Record<string, unknown>, baseURL),
      // Cross-device checks use the other viewport in an independent browser.
      otherDevice: deviceOptions(devices[isMobile ? "Desktop Chrome" : "Pixel 7"] as unknown as Record<string, unknown>, baseURL),
    });
  }, { scope: "worker" }],

  admin: [async ({ browser, live }, use) => session(live, live.device, browser, "Primary browser", use), { scope: "worker", timeout: 60_000 }],
  observer: [async ({ browser, live }, use) => session(live, live.otherDevice, browser, "Second browser", use), { scope: "worker", timeout: 60_000 }],

  customer: [async ({ browser, live }, use) => {
    const context = await browser.newContext(live.device);
    try {
      await prepareLiveBrowser(context, live.baseURL);
      await use({ context, page: await context.newPage() });
    } finally {
      const admin = (await context.cookies(live.baseURL).catch(() => [])).some(cookie => [ACCESS_COOKIE, REFRESH_COOKIE].includes(cookie.name));
      await context.close().catch(() => {});
      if (admin) throw new Error("Customer browser: an admin session cookie was issued to the customer.");
    }
  }, { scope: "worker", timeout: 30_000 }],

  ledger: [async ({ admin, live }, use) => {
    const ledger: Ledger = { runId: live.runId, owned: new Set() };
    // Interrupted earlier runs could not finish their own cleanup. Only records
    // carrying this suite's unique automated markers, and old enough not to
    // belong to a run in progress, are removed. The count alone is reported.
    const swept = await removeRecords(admin.context.request, live.baseURL, record =>
      automated(record) && Date.now() - Date.parse(record.createdAt) > STALE_AFTER_MS);
    if (swept) console.log(`Removed ${swept} TEST record(s) left by earlier interrupted runs.`);
    try {
      await use(ledger);
    } finally {
      const prefix = `TEST ${live.runId} `;
      await removeRecords(admin.context.request, live.baseURL, record => ledger.owned.has(record.id) || label(record).startsWith(prefix));
      const remaining = await readCloud(admin.context.request, live.baseURL);
      if (groups.some(group => remaining.data[group].some(record => ledger.owned.has(record.id) || label(record).startsWith(prefix)))) {
        throw new Error("Temporary TEST records remain after cleanup. Review the TEST drafts for this run before repeating live verification.");
      }
    }
  }, { scope: "worker", timeout: 60_000 }],

  records: [async ({ admin, ledger, live }, use) => {
    const request = admin.context.request;
    const before = await readCloud(request, live.baseURL);
    const now = new Date().toISOString();
    const clock = { now, today: now.slice(0, 10) };
    const records: Records = {
      quoteId: "", invoiceId: "",
      quoteTitle: `TEST ${live.runId} Separate customer quotation`,
      invoiceTitle: `TEST ${live.runId} Painting a 20m² wall`,
      privateMarker: `PRIVATE-NOTES-${live.runId}`,
      separateCustomer: `TEST Separate Customer ${live.runId}`,
    };
    const created = createQuote(before.data, clock, {
      isTest: true,
      title: records.quoteTitle,
      customer: { ...emptyCustomer(), name: records.separateCustomer },
      works: [{ description: "Test preparation", quantity: 1, unit: "day", unitPrice: 100 }],
      // Explicit, so expected totals never depend on the business's VAT setting.
      vat: { enabled: false, rate: 20 },
      internalNotes: records.privateMarker,
    });
    const invoice = billGatesTestInvoice(clock);
    invoice.number = `TEST-${invoice.id.replace(/-/g, "")}`;
    invoice.title = records.invoiceTitle;
    invoice.internalNotes += ` ${records.privateMarker}`;
    records.quoteId = created.quote.id;
    records.invoiceId = invoice.id;
    // Register ownership before the write, so a partial failure is still cleaned up.
    ledger.owned.add(records.quoteId);
    ledger.owned.add(records.invoiceId);
    const response = await saveOwned(request, live.baseURL, before, { ...created.data, invoices: [...created.data.invoices, invoice] }, ledger.owned);
    expect(response.status(), "A conflict must fail safely; stop other admin edits before repeating the live suite").toBe(200);
    const saved = await response.json() as Snapshot;
    const savedInvoice = saved.data.invoices.find(record => record.id === records.invoiceId);
    expect(savedInvoice?.isTest === true && invoiceTotals(savedInvoice).totalPence === 168000, "Bill Gates's test invoice must be stored as a £1,680 test document").toBe(true);
    expect(saved.data.quotes.find(record => record.id === records.quoteId)?.number.startsWith("TEST-"), "Test quotes must not consume issued quote numbers").toBe(true);
    expect(saved.data.settings.nextInvoiceNumber).toBe(before.data.settings.nextInvoiceNumber);
    expect(saved.data.settings.nextQuoteNumber).toBe(before.data.settings.nextQuoteNumber);
    await use(records);
  }, { scope: "worker", timeout: 30_000 }],

  // A protected preview's access credential has a short fixed lifetime. Fail a
  // step before it starts if it could outlive that credential, so the worker's
  // cleanup still runs while the preview remains reachable.
  deadline: [async ({}, use, testInfo) => {
    const deadline = Number(process.env.E2E_LIVE_DEADLINE || 0);
    if (deadline && Date.now() + testInfo.timeout > deadline) {
      throw new Error("BLOCKED: The preview access credential would expire before this step and its cleanup could finish. Remaining steps were not started.");
    }
    await use();
  }, { auto: true }],
});

export { expect };
