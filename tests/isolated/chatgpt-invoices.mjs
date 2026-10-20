import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { addDays } from "../../lib/admin/dates.ts";
import { emptyCustomer, emptyData, formatDocNumber, newBooking } from "../../lib/admin/factories.ts";
import { invoiceTotals } from "../../lib/admin/money.ts";
import { normaliseAdminData, normaliseInvoice } from "../../lib/admin/normalise.ts";
import { createInvoice, createQuote } from "../../lib/admin/operations.ts";
import { asAdmin, certificates, fail, MIGRATIONS, run } from "./harness.mjs";
import { SUPABASE_HOST, startEmulator } from "./supabase-emulator.mjs";

// Mike's ordinary ChatGPT creating invoices through its Supabase connection
// (docs/chatgpt-invoices.md), end to end, with no real credential and without
// reaching the hosted project:
//
// - a disposable loopback PostgreSQL database with the real migrations;
// - "ChatGPT" is a connection as the postgres role (what the Supabase
//   connection's execute_sql runs as) sending the exact SQL text the
//   documentation tells ChatGPT to send;
// - every customer link it returns is opened on a production build of the site,
//   rendered by the canonical invoice template through the emulated gateway;
// - TEST invoices are removed afterwards and the database is checked: every
//   pre-existing record is unchanged and no TEST record or link remains.
//
// Requires what run.mjs requires (README.md). ISOLATED_SKIP_BUILD=1 reuses a
// build made by either runner, which targets the same emulator address.

const root = fileURLToPath(new URL("../../", import.meta.url));
const port = Number(process.env.ISOLATED_SUPABASE_PORT || 54443);
const appPort = Number(process.env.ISOLATED_APP_PORT || 3100);
const app = `http://127.0.0.1:${appPort}`;
const adminId = "5eed0000-0000-4000-8000-00000000a11c";
const passed = [];

function ok(message) {
  passed.push(message);
  console.log(`ok ${passed.length} - ${message}`);
}

/** The statement ChatGPT runs with the Supabase connection's execute_sql (docs/chatgpt-invoices.md). */
const createSql = request => `select private.dm_chatgpt_create_invoice($dm$${JSON.stringify(request, null, 2)}$dm$::jsonb);`;
const removeSql = number => `select private.dm_chatgpt_remove_test_invoice('${number}');`;

/** Runs one SQL text as the connector does: a single statement, as postgres, nothing else in the transaction. */
async function chatgpt(databaseUrl, sql) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query(sql);
    return Object.values(rows[0])[0];
  } finally {
    await client.end();
  }
}

async function failure(promise) {
  try { await promise; } catch (error) { return error; }
  throw new Error("The request unexpectedly succeeded.");
}

/** The visible text of a page, without scripts or markup. */
function visibleText(html) {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** Opens a customer link as the customer would, on the local production build. */
async function openLink(link) {
  const token = /^https:\/\/www\.dmpaintingdecorating\.co\.uk\/d\/([a-f0-9]{64})$/.exec(link)?.[1];
  assert.ok(token, `Not a D&M customer link: ${link}`);
  const response = await fetch(`${app}/d/${token}`, { redirect: "manual" });
  return { status: response.status, headers: response.headers, text: visibleText(await response.text()) };
}

async function admin(client, sql, values = []) {
  return asAdmin(client, adminId, async () => (await client.query(sql, values)).rows[0].result);
}

/** Records standing in for Mike's real business: a quote, its invoice with a deposit, and a diary booking. */
function seedData() {
  const now = new Date().toISOString();
  const clock = { now, today: now.slice(0, 10) };
  let data = emptyData(now);
  data.settings = { ...data.settings, phone: "01000 000000", bank: { accountName: "D&M ISOLATED TEST", sortCode: "00-00-00", accountNumber: "12345678" }, nextQuoteNumber: 41, nextInvoiceNumber: 11 };
  const quote = createQuote(data, clock, { title: "Hallway, stairs and landing", customer: { ...emptyCustomer(), name: "Isolated Customer One" }, works: [{ description: "Walls and woodwork", quantity: 3, unit: "day", unitPrice: 240 }] });
  data = quote.data;
  const invoice = createInvoice(data, clock, quote.quote.id);
  data = invoice.data;
  data.invoices[0].payments = [{ id: randomUUID(), date: clock.today, amount: 200, method: "bank-transfer", label: "Deposit received" }];
  data.bookings = [newBooking(clock.today, now, { job: "Hallway, stairs and landing", customerName: "Isolated Customer One", quoteId: quote.quote.id, invoiceId: invoice.invoice.id })];
  return normaliseAdminData(data, now);
}

async function prepareDatabase(adminUrl) {
  const url = new URL(adminUrl);
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) fail("ISOLATED_DATABASE_URL must point at a disposable loopback PostgreSQL server.");
  const name = "dm_isolated_chatgpt_invoices";
  const server = new pg.Client({ connectionString: adminUrl });
  await server.connect();
  await server.query(`drop database if exists ${name} with (force)`);
  await server.query(`create database ${name}`);
  await server.end();
  url.pathname = `/${name}`;
  const databaseUrl = url.href;
  for (const file of ["tests/isolated/auth-schema.sql", ...MIGRATIONS]) {
    const options = { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, PGOPTIONS: "-c client_min_messages=warning" } };
    if (await run("psql", ["-X", "-q", "--set=ON_ERROR_STOP=1", `--dbname=${databaseUrl}`, `--file=${join(root, file)}`], options) !== 0) fail(`${file} could not be applied.`);
  }
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query("insert into auth.users(id, email, email_confirmed_at) values ($1, 'mike@dmpaintingdecorating.co.uk', now())", [adminId]);
  const seeded = await admin(client, "select public.dm_save_data($1::jsonb, 0) as result", [JSON.stringify(seedData())]);
  await client.end();
  return { databaseUrl, seeded, dropDatabase: async () => {
    const cleanup = new pg.Client({ connectionString: adminUrl });
    await cleanup.connect();
    await cleanup.query(`drop database if exists ${name} with (force)`);
    await cleanup.end();
  } };
}

async function startApp(env) {
  const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(appPort)], { cwd: root, env, stdio: ["ignore", "ignore", "inherit"] });
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode !== null) fail("The production server stopped while starting.");
    if (await fetch(`${app}/login`).then(response => response.ok, () => false)) return child;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  child.kill();
  fail("The production server did not start.");
}

/** A request to the emulated Data API, trusting only its throwaway certificate. Returns the HTTP status. */
function apiStatus(path, body, { publishableKey, ca }) {
  return new Promise((resolve, reject) => {
    const outgoing = httpsRequest(`https://${SUPABASE_HOST}:${port}${path}`, { method: "POST", ca, headers: { apikey: publishableKey, "Content-Type": "application/json" } }, response => {
      response.resume();
      resolve(response.statusCode);
    });
    outgoing.once("error", reject);
    outgoing.end(JSON.stringify(body));
  });
}

async function workflow(databaseUrl, seeded, api) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const revision = async () => Number((await db.query("select revision from public.admin_settings where owner_id = $1", [adminId])).rows[0].revision);
  const invoiceCount = async () => Number((await db.query("select count(*) from public.admin_documents where kind = 'invoice'")).rows[0].count);
  const records = async () => normaliseAdminData((await admin(db, "select public.dm_get_data() as result")).data, new Date().toISOString());
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const testNumbers = [];
  try {
    // 1. Mike: "Make a TEST invoice for TEST Customer O'Brien, 12 Mill Lane, Lymm, WA13 9SD: £850 decorating labour."
    const request = {
      customer: { name: "TEST Customer O'Brien", address: { line1: "12 Mill Lane", line2: "", town: "Lymm", postcode: "WA13 9SD" } },
      title: "TEST Decorating labour",
      works: [{ description: "Decorating labour", quantity: 1, unit: "", unitPrice: 850 }],
      expectedSubtotal: 850,
      testDocument: true,
    };
    const before = { revision: await revision(), count: await invoiceCount() };
    const created = await chatgpt(databaseUrl, createSql(request));
    assert.equal(created.status, "created");
    assert.equal(created.verified, true);
    assert.match(created.invoice.number, /^TEST-cgs[0-9a-f]{30}$/);
    assert.equal(created.invoice.total, "£850.00");
    assert.equal(created.invoice.dueDate, addDays(today, 14));
    assert.match(created.customerLink, /^https:\/\/www\.dmpaintingdecorating\.co\.uk\/d\/[a-f0-9]{64}$/);
    assert.ok(created.message.includes(created.customerLink) && created.message.includes("TEST invoice"));
    assert.equal(await invoiceCount(), before.count + 1);
    assert.equal(await revision(), before.revision + 1);
    testNumbers.push(created.invoice.number);
    ok(`ChatGPT's SQL creates TEST invoice ${created.invoice.number} (£850.00, due ${created.invoice.dueDate}) in one save and returns a customer link`);

    let page = await openLink(created.customerLink);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("cache-control") ?? "", /no-store/);
    for (const expected of ["Invoice", `No. ${created.invoice.number}`, "Test document · Not issued · No payment required", "Billed to", "TEST Customer O'Brien", "12 Mill Lane", "WA13 9SD", "TEST Decorating labour", "Decorating labour", "£850.00", "Test total"]) {
      assert.ok(page.text.includes(expected), `The customer page shows "${expected}"`);
    }
    for (const hidden of ["Test example only", "D&M ISOLATED TEST", "12345678", "Payment details", "admin"]) assert.ok(!page.text.includes(hidden), `The customer page hides "${hidden}"`);
    ok("The link opens on the production build as the canonical invoice template: number, customer, address, items, £850.00 and the TEST banner; no notes, bank details or admin links");

    // The stored record is the invoice the admin itself would have made.
    let data = await records();
    const stored = data.invoices.find(invoice => invoice.id === created.invoice.id);
    const raw = (await db.query("select payload from public.admin_documents where external_id = $1", [created.invoice.id])).rows[0].payload;
    assert.deepEqual(normaliseInvoice(raw, data.settings, new Date().toISOString()), raw, "Normalising the stored invoice changes nothing");
    const viaAdmin = createInvoice({ ...data, invoices: [] }, { today, now: raw.createdAt }, undefined, { id: raw.id, isTest: true }).invoice;
    assert.deepEqual(raw, {
      ...viaAdmin, title: request.title, customer: { ...request.customer, email: "", phone: "" },
      works: raw.works.map((line, index) => ({ ...request.works[index], id: line.id })), materials: [],
    });
    assert.equal(invoiceTotals(stored).totalPence, 85000);
    ok("The stored invoice equals what lib/admin/operations.ts createInvoice makes, and lib/admin/money.ts totals it at £850.00");

    // 2. Retries and duplicates.
    const repeat = await chatgpt(databaseUrl, createSql(request));
    assert.equal(repeat.status, "already_created");
    assert.equal(repeat.invoice.number, created.invoice.number);
    assert.equal(repeat.customerLink, null);
    assert.equal(repeat.customerLinkStatus, "already_issued");
    assert.equal(await invoiceCount(), before.count + 1);
    assert.equal((await openLink(created.customerLink)).status, 200);
    ok("Repeating the identical request (a retry after a lost answer) returns the same invoice, makes no duplicate and leaves the issued link working");

    const [first, second] = await Promise.all([1, 2].map(() => chatgpt(databaseUrl, createSql({ ...request, title: "TEST Concurrent request", expectedSubtotal: 860, works: [{ description: "Labour", quantity: 2, unitPrice: 430 }] }))));
    assert.deepEqual([first.status, second.status].sort(), ["already_created", "created"]);
    assert.equal(first.invoice.number, second.invoice.number);
    assert.equal(await invoiceCount(), before.count + 2);
    testNumbers.push(first.invoice.number);
    ok("Two identical requests sent at the same moment create exactly one invoice");

    const reworded = await chatgpt(databaseUrl, createSql({ ...request, title: "TEST Painting the hall", testDocument: true }));
    assert.equal(reworded.status, "possible_duplicate");
    assert.equal(reworded.existingInvoice.customer, "TEST Customer O'Brien");
    assert.equal(await invoiceCount(), before.count + 2);
    ok(`A reworded repeat (same customer and subtotal within 30 minutes) is held back with the existing number ${reworded.existingInvoice.number}`);

    // 3. Failures save nothing and say why.
    const unchanged = { revision: await revision(), count: await invoiceCount() };
    let error = await failure(chatgpt(databaseUrl, createSql({ ...request, expectedSubtotal: 800 })));
    assert.equal(error.code, "22023");
    assert.match(error.message, /The items add up to £850\.00 before VAT, but Mike's figures came to £800\.00\. Nothing was saved/);
    error = await failure(chatgpt(databaseUrl, createSql({ ...request, works: [{ description: "Labour", quantity: 1, unitPrice: "850" }] })));
    assert.match(error.message, /must be a number/);
    error = await failure(chatgpt(databaseUrl, createSql({ ...request, customer: { name: "" } })));
    assert.match(error.message, /Ask Mike who the invoice is for/);
    error = await failure(chatgpt(databaseUrl, `begin read only; ${createSql(request)}`));
    assert.equal(error.code, "25006");
    assert.match(error.message, /read-only/);
    assert.deepEqual({ revision: await revision(), count: await invoiceCount() }, unchanged);
    ok("A wrong total, a price given as text, a missing customer and a read-only connection are refused with plain reasons; nothing is saved");

    assert.equal(await apiStatus("/rest/v1/rpc/dm_chatgpt_create_invoice", { p_request: request }, api), 404);
    assert.equal(await invoiceCount(), unchanged.count);
    ok("The Data API (the website's public route to the database) cannot reach the entrypoint");

    // 4. VAT, materials and scope points.
    const vat = await chatgpt(databaseUrl, createSql({
      customer: { name: "TEST Sarah Jones", address: { line1: "4 Mill Lane", town: "Lymm", postcode: "WA13 9SD" } },
      title: "TEST Lounge and hallway", scope: ["Prepare walls and ceilings", "Two coats of emulsion"],
      works: [{ description: "Labour", quantity: 1, unitPrice: 1500 }], materials: [{ description: "Paint and sundries", quantity: 1, unitPrice: 200 }],
      expectedSubtotal: 1700, vat: { enabled: true, rate: 20 }, dueInDays: 7, testDocument: true,
    }));
    assert.equal(vat.status, "created");
    assert.equal(vat.invoice.total, "£2,040.00");
    testNumbers.push(vat.invoice.number);
    page = await openLink(vat.customerLink);
    for (const expected of ["Work carried out", "Prepare walls and ceilings", "Works £1,500.00", "Materials £200.00", "Subtotal £1,700.00", "VAT at 20% £340.00", "Test total £2,040.00", "TEST Sarah Jones"]) {
      assert.ok(page.text.includes(expected), `The VAT invoice page shows "${expected}"`);
    }
    data = await records();
    assert.equal(invoiceTotals(data.invoices.find(invoice => invoice.id === vat.invoice.id)).totalPence, 204000);
    ok(`TEST invoice ${vat.invoice.number}: £1,500 labour + £200 materials + VAT at 20% = £2,040.00, the same in SQL, lib/admin/money.ts and on the customer page`);

    // 5. A real invoice in this disposable database takes the next canonical number and shows bank details.
    const next = formatDocNumber(data.settings.invoicePrefix, data.settings.nextInvoiceNumber);
    const real = await chatgpt(databaseUrl, createSql({ ...request, customer: { name: "Isolated Customer Two", address: { line1: "1 Isolated Street", town: "Testtown", postcode: "TE1 1ST" } }, title: "Kitchen ceiling", testDocument: false }));
    assert.equal(real.status, "created");
    assert.equal(real.invoice.number, next);
    page = await openLink(real.customerLink);
    for (const expected of [`No. ${next}`, "Amount due £850.00", "Payment details", "Account name D&M ISOLATED TEST", "Account number 12345678", `Reference ${next}`, "Please use the invoice number as your payment reference."]) {
      assert.ok(page.text.includes(expected), `The real invoice page shows "${expected}"`);
    }
    assert.ok(!page.text.includes("Test document"));
    data = await records();
    assert.equal(data.settings.nextInvoiceNumber, Number(next.slice(-4)) + 1);
    ok(`A real invoice gets the next canonical number ${next}; its page shows the amount due, bank details and payment reference`);

    // Mike deletes it in the admin (the browser's own save path); its number stays used, as for any deleted invoice.
    const deleted = await asAdmin(db, adminId, async () => {
      const current = (await db.query("select public.dm_get_data() as result")).rows[0].result;
      const without = { ...current.data, invoices: current.data.invoices.filter(invoice => invoice.id !== real.invoice.id) };
      return (await db.query("select public.dm_save_data($1::jsonb, $2) as result", [JSON.stringify(without), current.revision])).rows[0].result;
    });
    assert.ok(!deleted.data.invoices.some(invoice => invoice.id === real.invoice.id));
    assert.equal((await openLink(real.customerLink)).status, 404);
    ok(`Deleting ${next} in the admin removes it and stops its link`);

    // 6. Removing the TEST invoices: their links stop working, nothing else changes.
    await assert.rejects(chatgpt(databaseUrl, removeSql("INV-0011")), /not a TEST invoice/);
    for (const number of testNumbers) {
      const removed = await chatgpt(databaseUrl, removeSql(number));
      assert.equal(removed.status, "removed");
    }
    for (const link of [created.customerLink, vat.customerLink]) assert.equal((await openLink(link)).status, 404);
    ok(`private.dm_chatgpt_remove_test_invoice refuses real invoice INV-0011, removed ${testNumbers.length} TEST invoices, and their links now answer 404`);
  } finally {
    await db.end();
  }

  // 7. The database afterwards.
  const check = new pg.Client({ connectionString: databaseUrl });
  await check.connect();
  try {
    const final = await admin(check, "select public.dm_get_data() as result");
    for (const group of ["quotes", "invoices", "bookings"]) {
      assert.deepEqual(final.data[group], seeded.data[group], `Every pre-existing ${group.slice(0, -1)} is unchanged and nothing else remains`);
    }
    const { nextInvoiceNumber, ...settings } = final.data.settings;
    const { nextInvoiceNumber: seededNext, ...seededSettings } = seeded.data.settings;
    assert.deepEqual(settings, seededSettings);
    assert.equal(nextInvoiceNumber, seededNext + 1, "Only the real invoice used a number");
    assert.deepEqual(final.data.meta, seeded.data.meta);
    const leftovers = (await check.query(`
      select (select count(*) from public.admin_documents where payload->>'isTest' = 'true' or document_number like 'TEST-%') as documents,
             (select count(*) from private.dm_number_reservations where number like 'TEST-%') as reservations,
             (select count(*) from private.dm_document_shares) as links`)).rows[0];
    assert.deepEqual(leftovers, { documents: "0", reservations: "0", links: "0" });
    ok("Afterwards every pre-existing quote, invoice, booking and setting is unchanged; no TEST record, TEST number or customer link remains");
  } finally {
    await check.end();
  }
}

async function main() {
  const resolved = await lookup(SUPABASE_HOST).catch(() => null);
  if (!resolved || !["127.0.0.1", "::1"].includes(resolved.address)) fail(`${SUPABASE_HOST} must resolve to 127.0.0.1 for the isolated run (for example: echo "127.0.0.1 ${SUPABASE_HOST}" | sudo tee -a /etc/hosts).`);
  const adminUrl = process.env.ISOLATED_DATABASE_URL;
  if (!adminUrl) fail("Set ISOLATED_DATABASE_URL to a disposable loopback PostgreSQL server, e.g. postgres://postgres:postgres@127.0.0.1:5432/postgres.");

  const directory = await mkdtemp(join(tmpdir(), "dm-isolated-"));
  let emulator;
  let server;
  let database;
  try {
    const tls = await certificates(directory);
    database = await prepareDatabase(adminUrl);
    const publishableKey = `sb_publishable_isolated_${randomBytes(12).toString("hex")}`;
    emulator = await startEmulator({ databaseUrl: database.databaseUrl, port, tls: { key: tls.key, cert: tls.cert }, publishableKey, adminPassword: `isolated-${randomBytes(18).toString("base64url")}` });
    const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_SUPABASE_URL: `https://${SUPABASE_HOST}:${port}`, DM_SUPABASE_PUBLISHABLE_KEY: publishableKey, NODE_EXTRA_CA_CERTS: tls.bundle };
    for (const name of ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) delete env[name];
    if (process.env.ISOLATED_SKIP_BUILD !== "1" && await run("npm", ["run", "build"], { cwd: root, env }) !== 0) fail("The production build failed.");
    server = await startApp(env);
    await workflow(database.databaseUrl, database.seeded, { publishableKey, ca: tls.ca });
    console.log(`ISOLATED: ChatGPT invoice workflow verified (${passed.length} checks).`);
  } catch (error) {
    console.error(`ISOLATED: FAIL ${error.message}`);
    process.exitCode = 1;
  } finally {
    server?.kill();
    await emulator?.close();
    await database?.dropDatabase();
    await rm(directory, { recursive: true, force: true });
  }
}

await main();
