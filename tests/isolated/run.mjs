import { spawn } from "node:child_process";
import { get } from "node:https";
import { randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { emptyCustomer, emptyData, newBooking } from "../../lib/admin/factories.ts";
import { billGatesTestInvoice } from "../../lib/admin/fixtures.ts";
import { normaliseAdminData } from "../../lib/admin/normalise.ts";
import { createInvoice, createQuote } from "../../lib/admin/operations.ts";
import { ISOLATED_MARKER, SUPABASE_HOST, startEmulator } from "./supabase-emulator.mjs";

// Runs the unmodified real-workflow Playwright suite (tests/live) against a
// disposable loopback PostgreSQL database that has the real migrations applied,
// served through the isolated Supabase emulator. Afterwards it inspects the
// database directly: every Auth session must be revoked, every record created
// by the suite (and stale records from interrupted runs) removed, and every
// pre-existing business record and number sequence left exactly as seeded.
//
// Requires: the pinned Supabase hostname mapped to 127.0.0.1 (e.g. in
// /etc/hosts), openssl, psql and a PostgreSQL server reachable through
// ISOLATED_DATABASE_URL on a loopback address. No real credential is used.

const root = fileURLToPath(new URL("../../", import.meta.url));
const port = Number(process.env.ISOLATED_SUPABASE_PORT || 54443);
const supabaseUrl = `https://${SUPABASE_HOST}:${port}`;
const adminEmail = "mike@dmpaintingdecorating.co.uk";
const adminId = "5eed0000-0000-4000-8000-00000000a11c";
const runPattern = /^TEST [0-9a-f]{12} /;

function fail(message) {
  console.error(`ISOLATED: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("close", code => resolve(code ?? 1));
  });
}

async function certificates(directory) {
  const file = name => join(directory, name);
  const quiet = { stdio: "ignore" };
  const steps = [
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=D&M isolated test CA", "-keyout", file("ca.key"), "-out", file("ca.pem")],
    ["req", "-newkey", "rsa:2048", "-nodes", "-subj", `/CN=${SUPABASE_HOST}`, "-keyout", file("server.key"), "-out", file("server.csr")],
    ["x509", "-req", "-in", file("server.csr"), "-CA", file("ca.pem"), "-CAkey", file("ca.key"), "-CAcreateserial", "-days", "2", "-extfile", file("san.cnf"), "-out", file("server.pem")],
  ];
  await writeFile(file("san.cnf"), `subjectAltName=DNS:${SUPABASE_HOST}\nextendedKeyUsage=serverAuth\n`);
  for (const args of steps) if (await run("openssl", args, quiet) !== 0) fail("openssl could not create the disposable TLS certificate.");
  // Keep any CA bundle the environment already relies on (for example a proxy CA).
  const existing = process.env.NODE_EXTRA_CA_CERTS ? await readFile(process.env.NODE_EXTRA_CA_CERTS, "utf8").catch(() => "") : "";
  await writeFile(file("bundle.pem"), `${existing}\n${await readFile(file("ca.pem"), "utf8")}`);
  return { key: await readFile(file("server.key")), cert: await readFile(file("server.pem")), ca: await readFile(file("ca.pem")), bundle: file("bundle.pem") };
}

/** Records that stand in for Mike's real business data plus leftovers of an interrupted earlier run. */
function seedData() {
  const now = new Date().toISOString();
  const clock = { now, today: now.slice(0, 10) };
  let data = emptyData(now);
  data.settings = { ...data.settings, phone: "01000 000000", bank: { accountName: "D&M ISOLATED TEST", sortCode: "00-00-00", accountNumber: "00000000" }, nextQuoteNumber: 41, nextInvoiceNumber: 11 };
  const person = name => ({ ...emptyCustomer(), name, address: { line1: "1 Isolated Street", line2: "", town: "Testtown", postcode: "TE1 1ST" } });
  const hallway = createQuote(data, clock, { title: "Hallway, stairs and landing", customer: person("Isolated Customer One"), works: [{ description: "Walls and woodwork", quantity: 3, unit: "day", unitPrice: 240 }], internalNotes: "SEED PRIVATE NOTE" });
  data = hallway.data;
  data = createQuote(data, clock, { title: "Kitchen ceiling", customer: person("Isolated Customer Two"), works: [{ description: "Ceiling", quantity: 1, unit: "room", unitPrice: 320 }] }).data;
  const invoice = createInvoice(data, clock, hallway.quote.id);
  data = invoice.data;
  data.invoices[0].payments = [{ id: randomUUID(), date: clock.today, amount: 200, method: "bank-transfer", label: "Deposit received" }];
  data.bookings = [newBooking(clock.today, now, { job: "Hallway, stairs and landing", customerName: "Isolated Customer One", quoteId: hallway.quote.id, invoiceId: invoice.invoice.id })];
  // Mike's own Settings "test invoice" is a test document without a run marker: it must survive.
  data.invoices.push(billGatesTestInvoice(clock));
  // An automated run interrupted two hours ago left these behind.
  const earlier = new Date(Date.now() - 2 * 3600_000).toISOString();
  const earlierClock = { now: earlier, today: earlier.slice(0, 10) };
  const stale = createQuote(data, earlierClock, { isTest: true, title: "TEST 0123456789ab Separate customer quotation", customer: person("TEST Separate Customer 0123456789ab") });
  data = stale.data;
  const staleInvoice = { ...billGatesTestInvoice(earlierClock), title: "TEST 0123456789ab Painting a 20m² wall" };
  data.invoices.push(staleInvoice);
  data.bookings.push(newBooking(earlierClock.today, earlier, { job: "TEST 0123456789ab Wall painting booking", customerName: "Bill Gates", invoiceId: staleInvoice.id, quoteId: stale.quote.id }));
  return normaliseAdminData(data, now);
}

async function asAdmin(client, work) {
  const session = randomUUID();
  await client.query("insert into auth.sessions(id, user_id) values ($1, $2)", [session, adminId]);
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: adminId, role: "authenticated", session_id: session })]);
    const result = await work();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.query("delete from auth.sessions where id = $1", [session]);
  }
}

async function prepareDatabase(adminUrl) {
  const url = new URL(adminUrl);
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) fail("ISOLATED_DATABASE_URL must point at a disposable loopback PostgreSQL server.");
  const name = "dm_isolated_workflow";
  const server = new pg.Client({ connectionString: adminUrl });
  await server.connect();
  await server.query(`drop database if exists ${name} with (force)`);
  await server.query(`create database ${name}`);
  await server.end();
  url.pathname = `/${name}`;
  const databaseUrl = url.href;
  for (const file of ["tests/isolated/auth-schema.sql", "supabase/base-schema.sql", "supabase/production-admin.sql"]) {
    const options = { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, PGOPTIONS: "-c client_min_messages=warning" } };
    if (await run("psql", ["-X", "-q", "--set=ON_ERROR_STOP=1", `--dbname=${databaseUrl}`, `--file=${join(root, file)}`], options) !== 0) fail(`${file} could not be applied.`);
  }
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  // The real enrolment trigger adds Mike's membership once his email is confirmed.
  await client.query("insert into auth.users(id, email, email_confirmed_at) values ($1, $2, now())", [adminId, adminEmail]);
  const seeded = await asAdmin(client, async () => (await client.query("select public.dm_save_data($1::jsonb, 0) as result", [JSON.stringify(seedData())])).rows[0].result);
  await client.end();
  return { databaseUrl, seeded };
}

async function verifyDatabase(databaseUrl, seeded) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const problems = [];
  try {
    const sessions = Number((await client.query("select count(*) from auth.sessions")).rows[0].count);
    if (sessions) problems.push(`${sessions} Auth session(s) were not revoked.`);
    const final = await asAdmin(client, async () => (await client.query("select public.dm_get_data() as result")).rows[0].result);
    const label = record => record.kind === "booking" ? record.job : record.title;
    const leftovers = ["quotes", "invoices", "bookings"].flatMap(group => final.data[group]).filter(record => runPattern.test(label(record)));
    if (leftovers.length) problems.push(`${leftovers.length} automated TEST record(s) remain.`);
    for (const group of ["quotes", "invoices", "bookings"]) {
      for (const record of seeded.data[group].filter(item => !runPattern.test(label(item)))) {
        const current = final.data[group].find(item => item.id === record.id);
        if (!current) problems.push(`Pre-existing ${record.kind} ${record.id} was deleted.`);
        else if (JSON.stringify(current) !== JSON.stringify(record)) problems.push(`Pre-existing ${record.kind} ${record.id} was changed.`);
      }
    }
    if (JSON.stringify(final.data.settings) !== JSON.stringify(seeded.data.settings)) problems.push("Business settings or issued number sequences changed.");
    if (JSON.stringify(final.data.meta) !== JSON.stringify(seeded.data.meta)) problems.push("Backup metadata changed.");
  } finally {
    await client.end();
  }
  return problems;
}

async function main() {
  const resolved = await lookup(SUPABASE_HOST).catch(() => null);
  if (!resolved || !["127.0.0.1", "::1"].includes(resolved.address)) fail(`${SUPABASE_HOST} must resolve to 127.0.0.1 for the isolated run (for example: echo "127.0.0.1 ${SUPABASE_HOST}" | sudo tee -a /etc/hosts).`);
  const adminUrl = process.env.ISOLATED_DATABASE_URL;
  if (!adminUrl) fail("Set ISOLATED_DATABASE_URL to a disposable loopback PostgreSQL server, e.g. postgres://postgres:postgres@127.0.0.1:5432/postgres.");

  const directory = await mkdtemp(join(tmpdir(), "dm-isolated-"));
  let emulator;
  try {
    const tls = await certificates(directory);
    const { databaseUrl, seeded } = await prepareDatabase(adminUrl);
    const publishableKey = `sb_publishable_isolated_${randomBytes(12).toString("hex")}`;
    const password = `isolated-${randomBytes(18).toString("base64url")}`;
    emulator = await startEmulator({ databaseUrl, port, tls: { key: tls.key, cert: tls.cert }, publishableKey, adminPassword: password });

    const env = {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      SUPABASE_PUBLISHABLE_KEY: publishableKey,
      NODE_EXTRA_CA_CERTS: tls.bundle,
      E2E_RUN_LIVE: "1",
      E2E_BASE_URL: "http://localhost:3000",
      E2E_ADMIN_PASSWORD: password,
    };
    for (const name of ["E2E_VERCEL_TRUSTED_OIDC_TOKEN", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) delete env[name];

    // Prove the application's pinned hostname reaches this emulator, not the hosted project.
    const marker = await new Promise(resolve => {
      get(`${supabaseUrl}/auth/v1/health`, { ca: tls.ca, headers: { apikey: publishableKey } }, response => {
        response.resume();
        resolve(response.headers[ISOLATED_MARKER]);
      }).once("error", () => resolve(undefined));
    });
    if (marker !== "1") fail("The pinned Supabase hostname did not reach the isolated emulator.");

    // NEXT_PUBLIC_* values are compiled into the build, so it must target the emulator.
    if (process.env.ISOLATED_SKIP_BUILD !== "1" && await run("npm", ["run", "build"], { cwd: root, env }) !== 0) fail("The production build failed.");
    const code = await run(process.execPath, [join(root, "node_modules/@playwright/test/cli.js"), "test", "--config", join(root, "playwright.live.config.ts"), ...process.argv.slice(2)], { cwd: root, env });
    console.log(`ISOLATED: Auth sign-ins ${emulator.stats.signIns}, refreshes ${emulator.stats.refreshes}, logouts ${emulator.stats.logouts}, database calls ${emulator.stats.rpcCalls}.`);
    const problems = await verifyDatabase(databaseUrl, seeded);
    for (const problem of problems) console.error(`ISOLATED: FAIL ${problem}`);
    if (!problems.length) console.log("ISOLATED: Database verified: every session revoked, every automated TEST record removed, pre-existing records, settings and sequences unchanged.");
    process.exitCode = code === 0 && !problems.length ? 0 : 1;
  } finally {
    await emulator?.close();
    await rm(directory, { recursive: true, force: true });
  }
}

await main();
