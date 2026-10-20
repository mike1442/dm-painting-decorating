import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { emptyCustomer, emptyData, newBooking } from "../../lib/admin/factories.ts";
import { documentTotals, invoiceTotals } from "../../lib/admin/money.ts";
import { normaliseAdminData } from "../../lib/admin/normalise.ts";
import { createInvoice, createQuote } from "../../lib/admin/operations.ts";
import type { AdminData } from "../../lib/admin/types.ts";
import { ALL_SCOPES } from "../../lib/chatgpt/config.ts";
import { runTool } from "../../lib/chatgpt/mcp.ts";
import { londonToday, tools, type ToolContext } from "../../lib/chatgpt/tools.ts";
import { configure, fakeSupabase, ORIGIN } from "./fake-supabase.ts";

const NOW = new Date("2026-10-16T09:30:00.000Z"); // a Friday
const tool = (name: string) => tools.find(candidate => candidate.name === name)!;
const paulFinn = {
  customer: { name: "Paul Finn", address: "6 Falkstone Close, Gorse Covert, WA3 6SU" },
  title: "Living room redecoration",
  works: [{ description: "Living room walls (25 m²): preparation and two coats", quantity: 2, unit: "day", unitPrice: 200 }],
  materials: [{ description: "Paint and materials", quantity: 1, unitPrice: 118 }],
  expectedSubtotal: 518,
};

/** Existing business records that every ChatGPT action must leave exactly as they were. */
function existingRecords(): AdminData {
  const now = "2026-10-01T08:00:00.000Z";
  const clock = { now, today: "2026-10-01" };
  let data = emptyData(now);
  data.settings = { ...data.settings, nextQuoteNumber: 40, nextInvoiceNumber: 10 };
  const hallway = createQuote(data, clock, { title: "Hallway", customer: { ...emptyCustomer(), name: "Existing Customer" }, works: [{ description: "Walls", quantity: 3, unit: "day", unitPrice: 240 }], internalNotes: "private" });
  data = createInvoice(hallway.data, clock, hallway.quote.id).data;
  data.bookings = [newBooking("2026-10-21", now, { job: "Hallway", customerName: "Existing Customer", quoteId: hallway.quote.id })];
  return normaliseAdminData(data, now);
}

function setup(context: TestContext, data = existingRecords()) {
  configure(context);
  const supabase = fakeSupabase(context, data);
  const ctx = (grant = "grant-1"): ToolContext => ({ token: supabase.signIn(), origin: ORIGIN, grant, now: NOW });
  const context1 = ctx();
  const call = (name: string, args: Record<string, unknown>, on = context1) => tool(name).run(args, on);
  return { supabase, call, ctx };
}

const untouched = (before: AdminData, after: AdminData) => {
  for (const group of ["quotes", "invoices", "bookings"] as const) {
    for (const record of before[group]) assert.deepEqual(after[group].find(item => item.id === record.id), record, `${record.kind} ${record.id} must be preserved`);
  }
};

test("Mike's example creates a real £518 quote with the next number and a working customer link", async context => {
  const { supabase, call } = setup(context);
  const before = structuredClone(supabase.state.data);
  const result = await call("create_quote", paulFinn);
  const quote = supabase.state.data.quotes.find(record => record.customer.name === "Paul Finn")!;

  assert.equal(result.data.status, "created");
  assert.equal(quote.number, "Q-0041");
  assert.equal(quote.source, "chatgpt");
  assert.equal(quote.status, "draft");
  assert.deepEqual(quote.customer.address, { line1: "6 Falkstone Close", line2: "", town: "Gorse Covert", postcode: "WA3 6SU" });
  assert.equal(documentTotals(quote).totalPence, 51800);
  assert.deepEqual(quote.terms, before.settings.defaultTerms, "D&M's standard terms are used");
  assert.equal(quote.intro, before.settings.defaultQuoteIntro);
  assert.equal(supabase.state.data.settings.nextQuoteNumber, 42);
  const link = result.data.customerLink as string;
  assert.match(link, /^https:\/\/www\.dmpaintingdecorating\.co\.uk\/d\/[a-f0-9]{64}$/);
  assert.equal(supabase.state.shares.get(quote.id), link.slice(-64), "The link is the document's current share");
  assert.match(result.message, /Created quote Q-0041 for Paul Finn: Living room redecoration\. Total £518\.00 \(no VAT\)\./);
  assert.ok(result.message.includes(link));
  untouched(before, supabase.state.data);
});

test("retries never create duplicates, and only an explicit request makes a second copy", async context => {
  const { supabase, call } = setup(context);
  const first = await call("create_quote", paulFinn);
  const again = await call("create_quote", paulFinn);
  assert.equal(again.data.status, "already_created");
  assert.equal((again.data.quote as { number: string }).number, (first.data.quote as { number: string }).number);
  assert.equal(supabase.state.data.quotes.filter(record => record.customer.name === "Paul Finn").length, 1);
  assert.equal(again.data.customerLink, undefined, "A repeat never replaces a link Mike may already have sent");
  assert.equal(supabase.state.shares.get((first.data.quote as { id: string }).id), (first.data.customerLink as string).slice(-64));

  // The model may reword a retry; the same customer and subtotal minutes later is held back.
  const reworded = await call("create_quote", { ...paulFinn, title: "Lounge redecoration" });
  assert.equal(reworded.data.status, "possible_duplicate");
  assert.equal(supabase.state.data.quotes.filter(record => record.customer.name === "Paul Finn").length, 1);

  const second = await call("create_quote", { ...paulFinn, allowDuplicate: true });
  assert.equal(second.data.status, "created");
  assert.equal((second.data.quote as { number: string }).number, "Q-0042");
});

test("a total that does not match Mike's figures saves nothing", async context => {
  const { supabase, call } = setup(context);
  await assert.rejects(call("create_quote", { ...paulFinn, expectedSubtotal: 520 }), /add up to £518\.00 before VAT, but Mike's figures came to £520\.00\. Nothing was saved/);
  await assert.rejects(call("create_quote", { ...paulFinn, works: [{ description: "Walls", quantity: 1, unitPrice: -5 }] }), /cannot be negative/);
  assert.equal(supabase.state.revision, 0, "Nothing was saved");
});

test("a save racing another device, or losing its answer, is completed exactly once", async context => {
  const { supabase, call } = setup(context);
  // Another device saves a new booking first: the stale write is refused, re-read and reapplied.
  supabase.state.beforeSave = () => {
    supabase.state.data.bookings.push(newBooking("2026-11-02", NOW.toISOString(), { job: "Phone booking" }));
    supabase.state.revision += 1;
  };
  await call("create_quote", paulFinn);
  assert.equal(supabase.state.data.bookings.filter(booking => booking.job === "Phone booking").length, 1, "The other device's change survives");
  assert.equal(supabase.state.data.quotes.filter(record => record.customer.name === "Paul Finn").length, 1);

  // The write is applied but its answer is lost: the retry recognises its own quote.
  supabase.state.loseNextSaveAnswer = true;
  const result = await call("create_quote", { ...paulFinn, customer: { name: "Jo Bloggs", address: "1 High Street, Warrington, WA1 1AA" } });
  assert.equal(result.data.status, "created");
  assert.equal(supabase.state.data.quotes.filter(record => record.customer.name === "Jo Bloggs").length, 1);
});

test("deleting needs a confirmation code bound to this connection, this action and the unchanged record", async context => {
  const { supabase, call, ctx } = setup(context);
  await call("create_quote", paulFinn);
  const preview = await call("delete_quote", { quote: "Q-0041" });
  assert.equal(preview.data.status, "confirmation_required");
  assert.match(preview.message, /Nothing has been changed yet\. Deleting quote Q-0041 for Paul Finn \(£518\.00\) cannot be undone/);
  assert.ok(supabase.state.data.quotes.some(record => record.number === "Q-0041"));
  const code = preview.data.confirmationCode as string;

  assert.equal((await call("delete_quote", { quote: "Q-0041", confirmationCode: "x" })).data.status, "confirmation_required");
  assert.equal((await call("delete_quote", { quote: "Q-0041", confirmationCode: code }, ctx("another-connection"))).data.status, "confirmation_required");
  assert.equal((await call("delete_invoice", { invoice: "INV-0010", confirmationCode: code })).data.status, "confirmation_required", "A code confirms one action only");

  // Editing the quote after the preview voids the code.
  await call("update_quote", { quote: "Q-0041", internalNotes: "Customer wants a call first" }, { ...ctx(), now: new Date(NOW.getTime() + 60_000) });
  assert.match((await call("delete_quote", { quote: "Q-0041", confirmationCode: code })).message, /not valid for this record any more/);
  const fresh = (await call("delete_quote", { quote: "Q-0041" })).data.confirmationCode;
  const deleted = await call("delete_quote", { quote: "Q-0041", confirmationCode: fresh });
  assert.equal(deleted.data.status, "deleted");
  assert.ok(!supabase.state.data.quotes.some(record => record.number === "Q-0041"));
  assert.ok(!supabase.state.shares.size, "Its customer link no longer resolves");
  assert.equal(supabase.state.data.settings.nextQuoteNumber, 42, "The number stays used");
});

test("customer links: revocation is confirmed; replacing a sent document's link is confirmed; drafts are not", async context => {
  const { supabase, call } = setup(context);
  const created = await call("create_quote", paulFinn);
  const id = (created.data.quote as { id: string }).id;

  const draftLink = await call("create_customer_link", { document: "Q-0041" });
  assert.equal(draftLink.data.status, "created");
  assert.equal(supabase.state.shares.get(id), (draftLink.data.customerLink as string).slice(-64));

  await call("update_quote", { quote: "Q-0041", status: "sent" });
  const held = supabase.state.shares.get(id);
  const ask = await call("create_customer_link", { document: "Q-0041" });
  assert.equal(ask.data.status, "confirmation_required");
  assert.equal(supabase.state.shares.get(id), held, "The customer's link keeps working until Mike confirms");
  const replaced = await call("create_customer_link", { document: "Q-0041", confirmationCode: ask.data.confirmationCode });
  assert.notEqual(supabase.state.shares.get(id), held);
  assert.equal(replaced.data.status, "created");

  const revoke = await call("revoke_customer_link", { document: "Q-0041" });
  assert.equal(revoke.data.status, "confirmation_required");
  assert.ok(supabase.state.shares.has(id));
  await call("revoke_customer_link", { document: "Q-0041", confirmationCode: revoke.data.confirmationCode });
  assert.ok(!supabase.state.shares.has(id));
});

test("invoices: converting a quote once, recording payments without double counting", async context => {
  const { supabase, call } = setup(context);
  await call("create_quote", paulFinn);
  const invoice = await call("create_invoice", { fromQuote: "Q-0041", dueInDays: 7 });
  assert.equal(invoice.data.status, "created");
  const saved = supabase.state.data.invoices.find(record => record.customer.name === "Paul Finn")!;
  assert.equal(saved.number, "INV-0011");
  assert.equal(saved.quoteNumber, "Q-0041");
  assert.equal(saved.dueDate, "2026-10-23");
  assert.equal(invoiceTotals(saved).totalPence, 51800);
  assert.equal(supabase.state.data.quotes.find(record => record.number === "Q-0041")!.status, "accepted");
  assert.equal((await call("create_invoice", { fromQuote: "Q-0041" })).data.status, "already_created");
  assert.equal(supabase.state.data.invoices.filter(record => record.quoteNumber === "Q-0041").length, 1);

  const deposit = await call("record_payment", { invoice: "INV-0011", amount: 200, label: "Deposit" });
  assert.equal(deposit.data.status, "recorded");
  assert.equal((await call("record_payment", { invoice: "INV-0011", amount: 200, label: "Deposit" })).data.status, "duplicate");
  await assert.rejects(call("record_payment", { invoice: "INV-0011", amount: 400 }), /more than the £318\.00 still owed/);
  const rest = await call("record_payment", { invoice: "INV-0011", payRemainingBalance: true, method: "cash" });
  assert.match(rest.message, /balance £0\.00 \(paid\)/);
  assert.equal(invoiceTotals(supabase.state.data.invoices.find(record => record.number === "INV-0011")!).balancePence, 0);

  const scratch = await call("create_invoice", { customer: { name: "Ann Other", address: "2 Low Road, Lymm, WA13 0AA" }, title: "Front door", works: [{ description: "Paint front door", quantity: 1, unitPrice: 150 }], expectedSubtotal: 150, createCustomerLink: false });
  const made = supabase.state.data.invoices.find(record => record.customer.name === "Ann Other")!;
  assert.equal(scratch.data.status, "created");
  assert.equal(made.works.length, 1, "No blank starter line is left behind");
  assert.equal(made.number, "INV-0012");
});

test("the diary refuses clashes unless Mike agrees, finds openings and records job updates", async context => {
  const { supabase, call } = setup(context);
  assert.equal(londonToday(NOW), "2026-10-16");
  const clash = await call("create_booking", { start: "2026-10-20", days: 2, job: "Living room", customerName: "Paul Finn" });
  assert.equal(clash.data.status, "clash", "The existing Wednesday booking blocks Tuesday–Wednesday");
  assert.equal(supabase.state.data.bookings.length, 1);

  const openings = await call("check_availability", { daysNeeded: 2 });
  assert.deepEqual((openings.data.openings as { start: string; end: string }[])[0], { start: "2026-10-16", end: "2026-10-19" }, "Friday and Monday, skipping the weekend");

  const booked = await call("create_booking", { start: "2026-10-16", days: 2, quote: "Q-0040", job: "Hallway, second visit" });
  assert.equal(booked.data.status, "booked");
  const booking = supabase.state.data.bookings.find(record => record.job === "Hallway, second visit")!;
  assert.equal(booking.end, "2026-10-19");
  assert.equal(booking.customerName, "Existing Customer", "Filled in from the quote");
  assert.equal((await call("create_booking", { start: "2026-10-16", days: 2, quote: "Q-0040", job: "Hallway, second visit" })).data.status, "already_booked");

  await call("update_booking", { booking: booking.id, addNote: "First coat done" });
  await call("update_booking", { booking: booking.id, addNote: "First coat done" });
  assert.equal(supabase.state.data.bookings.find(record => record.id === booking.id)!.notes, "16 Oct 2026: First coat done");

  const moved = await call("update_booking", { booking: booking.id, start: "2026-10-26" });
  assert.equal((moved.data.booking as { end: string }).end, "2026-10-29", "Moving keeps the booking's length");
});

test("a connection without a permission is told so and changes nothing", async context => {
  const { supabase, ctx } = setup(context);
  const context1 = ctx();
  const result = await runTool(tool("create_quote"), paulFinn, { client: "c", scopes: ["dm:read"], grant: "g", supabase: context1.token, audience: `${ORIGIN}/api/mcp`, origin: ORIGIN });
  assert.equal(result.isError, true);
  assert.equal(result.output.data.status, "not_permitted");
  assert.equal(supabase.state.revision, 0);
  assert.deepEqual(ALL_SCOPES, ["dm:read", "dm:write", "dm:delete"]);
});

/* Mike's own requests, read back from Supabase -------------------------------- */

type Saved = { kind: string; id: string; number: string; customer: string; amount: string; status: string; customerLink: string | null; customerLinkStatus: string; verified: boolean; balance?: string };
const savedDocument = (result: { data: Record<string, unknown> }) => result.data.document as Saved;
/** What an anonymous customer's page receives for a link, through the stand-in's dm_get_shared_document. */
async function openLink(link: string) {
  const response = await fetch("https://fdctgtncawolrapwwevm.supabase.co/rest/v1/rpc/dm_get_shared_document", { method: "POST", body: JSON.stringify({ p_token: link.slice(-64) }) });
  return await response.json() as { document: { kind: string; number: string; customer: { name: string; email: string }; works: { unitPrice: number; quantity: number }[]; payments?: { amount: number }[]; internalNotes?: string } } | null;
}

test("\"Create an invoice for John Smith for £850 decorating labour\" saves INV-0011 and returns its checked customer link", async context => {
  const { supabase, call } = setup(context);
  const before = structuredClone(supabase.state.data);
  const result = await call("create_invoice", {
    customer: { name: "John Smith" }, title: "Decorating labour",
    works: [{ description: "Decorating labour", quantity: 1, unitPrice: 850 }], expectedSubtotal: 850,
  });
  const saved = savedDocument(result);
  const stored = supabase.state.data.invoices.find(record => record.id === saved.id)!;
  assert.equal(result.data.status, "created");
  assert.deepEqual({ ...saved, id: undefined, customerLink: undefined }, {
    kind: "invoice", id: undefined, number: "INV-0011", customer: "John Smith", amount: "£850.00", vat: "no VAT", paid: "£0.00", balance: "£850.00",
    dueDate: "2026-10-30", status: "draft", customerLink: undefined, customerLinkStatus: "new", adminUrl: `${ORIGIN}/admin/invoices/${saved.id}`, verified: true,
  });
  assert.equal(stored.number, saved.number, "The number is the one Supabase stored");
  assert.equal(invoiceTotals(stored).totalPence, 85000);
  assert.deepEqual(stored.bank, before.settings.bank, "D&M's bank details and terms are used");
  assert.equal(stored.paymentNote, before.settings.defaultPaymentNote);
  assert.equal(saved.customerLink, result.data.customerLink);
  assert.equal(supabase.state.opened.at(-1), saved.customerLink!.slice(-64), "The link was opened before it was given");
  const shown = await openLink(saved.customerLink!);
  assert.equal(shown?.document.number, "INV-0011");
  assert.equal(shown?.document.customer.name, "John Smith");
  assert.equal(shown?.document.customer.email, "", "The customer page shows no contact details");
  assert.equal(shown?.document.internalNotes, undefined, "Private notes never reach the customer");
  untouched(before, supabase.state.data);
});

test("a three-day painting quote (£1,500 labour, £200 materials) is created, revised and keeps its number and link", async context => {
  const { supabase, call, ctx } = setup(context);
  const job = {
    customer: { name: "Sarah Jones", address: "4 Mill Lane, Lymm, WA13 9SD" }, title: "Three-day painting job",
    works: [{ description: "Painting labour", quantity: 3, unit: "day", unitPrice: 500 }], materials: [{ description: "Paint and materials", quantity: 1, unitPrice: 200 }],
    expectedSubtotal: 1700,
  };
  const created = savedDocument(await call("create_quote", job));
  assert.equal(created.number, "Q-0041");
  assert.equal(created.amount, "£1,700.00");
  assert.equal(created.verified, true);

  const revised = await call("update_quote", { quote: "Q-0041", materials: [{ description: "Paint and materials", quantity: 1, unitPrice: 260 }], expectedSubtotal: 1760 }, { ...ctx(), now: new Date(NOW.getTime() + 60_000) });
  const after = savedDocument(revised);
  assert.equal(revised.data.status, "updated");
  assert.equal(after.number, "Q-0041", "A revision keeps the quote's number");
  assert.equal(after.amount, "£1,760.00");
  assert.equal(after.customerLinkStatus, "unchanged");
  assert.equal(after.customerLink, null, "No new link is made; the customer's link shows the revision");
  assert.equal(supabase.state.data.settings.nextQuoteNumber, 42, "A revision uses no new number");
  const shown = await openLink(created.customerLink!);
  assert.equal(shown?.document.number, "Q-0041");
  assert.equal(normaliseAdminData({ quotes: [shown!.document] }, NOW.toISOString()).quotes.map(documentTotals)[0].totalPence, 176000, "The customer sees the revised total");
});

test("document numbers are always the ones Supabase issues, never the number ChatGPT's request expected", async context => {
  const { supabase, call } = setup(context);
  // Q-0041 was issued once and deleted: the database keeps it reserved and issues the next free number.
  supabase.state.reserved.add("quote:Q-0041");
  const quote = savedDocument(await call("create_quote", paulFinn));
  assert.equal(quote.number, "Q-0042");
  assert.equal(supabase.state.data.quotes.find(record => record.id === quote.id)!.number, "Q-0042");
  const settings = await call("get_business_settings", {});
  assert.equal(settings.data.nextQuoteNumber, "Q-0043");
  const test = savedDocument(await call("create_invoice", { customer: { name: "Test Customer" }, title: "Test", works: [{ description: "Test", quantity: 1, unitPrice: 1 }], expectedSubtotal: 1, testDocument: true }));
  assert.match(test.number, /^TEST-/, "A test invoice uses no invoice number");
  assert.equal(supabase.state.data.settings.nextInvoiceNumber, 11);
});

test("a save that does not read back as requested is reported as unverified, with no customer link", async context => {
  const { supabase, ctx } = setup(context);
  // Straight after the save, another device changes the price before ChatGPT reads it back.
  supabase.state.afterSave = () => { supabase.state.data.quotes[0].works[0].unitPrice = 999; };
  const result = await runTool(tool("create_quote"), paulFinn, { client: "c", scopes: ALL_SCOPES, grant: "g", supabase: ctx().token, audience: `${ORIGIN}/api/mcp`, origin: ORIGIN });
  assert.equal(result.isError, true);
  assert.equal(result.output.data.status, "unverified");
  assert.match(result.output.message, /^The quote Q-0041 was saved, but when D&M read it back it did not match what was asked/);
  const document = result.output.data.document as Saved;
  assert.equal(document.verified, false);
  assert.equal(document.customerLink, null);
  assert.equal(supabase.state.shares.size, 0, "No link is made for a document that did not verify");
});

test("a customer link is only given once it opens the document; otherwise the saved document is reported without one", async context => {
  const { supabase, call } = setup(context);
  supabase.state.breakNextShareOpen = true;
  const result = await call("create_quote", paulFinn);
  const saved = savedDocument(result);
  assert.equal(result.data.status, "created");
  assert.equal(saved.number, "Q-0041");
  assert.equal(saved.customerLink, null);
  assert.equal(saved.customerLinkStatus, "failed");
  assert.equal(result.data.customerLink, undefined);
  assert.match(result.data.linkError as string, /Quote Q-0041 is saved; call create_customer_link to try again/);
  const again = await call("create_customer_link", { document: "Q-0041" });
  assert.equal(savedDocument(again).customerLinkStatus, "new");
  assert.equal((await openLink(again.data.customerLink as string))?.document.number, "Q-0041");
});

test("\"Find John's invoice and give me the customer link\" finds it and replaces the link only after Mike confirms", async context => {
  const { supabase, call } = setup(context);
  await call("create_invoice", { customer: { name: "John Smith" }, title: "Decorating labour", works: [{ description: "Decorating labour", quantity: 1, unitPrice: 850 }], expectedSubtotal: 850 });
  const found = await call("list_invoices", { search: "John" });
  assert.equal(found.data.total, 1);
  const number = (found.data.invoices as { number: string }[])[0].number;
  const link = await call("create_customer_link", { document: number });
  const saved = savedDocument(link);
  assert.deepEqual([saved.number, saved.customer, saved.amount, saved.customerLinkStatus, saved.verified], ["INV-0011", "John Smith", "£850.00", "new", true]);
  assert.equal((await openLink(saved.customerLink!))?.document.number, "INV-0011");

  await call("update_invoice", { invoice: number, status: "sent" });
  const held = supabase.state.shares.get(saved.id);
  const ask = await call("create_customer_link", { document: number });
  assert.equal(ask.data.status, "confirmation_required");
  assert.equal(supabase.state.shares.get(saved.id), held, "The customer's link keeps working until Mike says yes");
  const replaced = savedDocument(await call("create_customer_link", { document: number, confirmationCode: ask.data.confirmationCode }));
  assert.notEqual(replaced.customerLink, saved.customerLink);
  assert.equal(await openLink(saved.customerLink!), null, "The earlier link stopped working");
});

test("\"Mark invoice INV-0012 as paid\" records the balance once and the customer's link shows it", async context => {
  const { supabase, call } = setup(context);
  const made = savedDocument(await call("create_invoice", { customer: { name: "Ann Other" }, title: "Front door", works: [{ description: "Paint front door", quantity: 1, unitPrice: 150 }], expectedSubtotal: 150 }));
  await call("create_invoice", { customer: { name: "John Smith" }, title: "Decorating labour", works: [{ description: "Decorating labour", quantity: 1, unitPrice: 850 }], expectedSubtotal: 850 });
  const paid = await call("record_payment", { invoice: "INV-0012", payRemainingBalance: true });
  const saved = savedDocument(paid);
  assert.equal(paid.data.status, "recorded");
  assert.deepEqual([saved.number, saved.status, saved.balance, saved.verified], ["INV-0012", "paid", "£0.00", true]);
  assert.equal((await call("record_payment", { invoice: "INV-0012", payRemainingBalance: true })).data.status, "already_paid");
  assert.equal(supabase.state.data.invoices.find(record => record.number === "INV-0012")!.payments.length, 1);
  assert.equal(invoiceTotals(supabase.state.data.invoices.find(record => record.number === "INV-0011")!).paidPence, 0, "Only the named invoice is marked paid");
  assert.equal(made.number, "INV-0011");
  // A paid invoice's customer may hold its link, so a new one needs Mike's yes.
  const ask = await call("create_customer_link", { document: "INV-0012" });
  assert.equal(ask.data.status, "confirmation_required");
  const link = await call("create_customer_link", { document: "INV-0012", confirmationCode: ask.data.confirmationCode });
  const shown = await openLink(link.data.customerLink as string);
  assert.equal(shown?.document.payments?.[0].amount, 850, "The customer sees the payment");
});

test("\"Show my diary for next week\" lists Monday to Sunday in UK time, and bookings are read back after saving", async context => {
  const { supabase, call } = setup(context);
  const week = await call("list_bookings", { period: "next-week" });
  assert.deepEqual([week.data.today, week.data.from, week.data.to], ["2026-10-16", "2026-10-19", "2026-10-25"]);
  assert.equal((week.data.bookings as { customer: string }[])[0].customer, "Existing Customer");
  assert.match(week.message, /^1 booking next week \(Mon 19 Oct – Sun 25 Oct\)\.$/);
  assert.deepEqual([(await call("list_bookings", { period: "this-month" })).data.from, (await call("list_bookings", { period: "next-month" })).data.to], ["2026-10-01", "2026-11-30"]);
  const free = await call("check_availability", { period: "next-week" });
  assert.deepEqual((free.data.days as { date: string; status: string }[]).map(entry => entry.status), ["free", "free", "booked", "free", "free", "weekend", "weekend"]);

  const booked = await call("create_booking", { start: "2026-10-22", days: 2, job: "Kitchen", customerName: "Sarah Jones" });
  assert.equal(booked.data.status, "booked");
  assert.equal((booked.data.booking as { end: string }).end, "2026-10-23");
  assert.ok(supabase.state.data.bookings.some(record => record.job === "Kitchen"));
  supabase.state.afterSave = () => { supabase.state.data.bookings.find(record => record.job === "Kitchen")!.start = "2026-10-29"; };
  await assert.rejects(call("update_booking", { booking: (booked.data.booking as { id: string }).id, addNote: "Colours agreed" }), /did not match what was asked/);
});

test("conflicting edits: another device's change survives, and repeated conflicts save nothing", async context => {
  const { supabase, call } = setup(context);
  await call("create_quote", paulFinn);
  const id = supabase.state.data.quotes.find(record => record.number === "Q-0041")!.id;
  // Mike edits the quote's notes in the admin while ChatGPT changes its price.
  supabase.state.beforeSave = () => {
    supabase.state.data.quotes.find(record => record.id === id)!.internalNotes = "Edited on the phone";
    supabase.state.revision += 1;
  };
  const updated = await call("update_quote", { quote: "Q-0041", works: [{ description: "Living room walls", quantity: 2, unit: "day", unitPrice: 220 }], expectedSubtotal: 558 });
  const quote = supabase.state.data.quotes.find(record => record.id === id)!;
  assert.equal(savedDocument(updated).amount, "£558.00");
  assert.equal(quote.internalNotes, "Edited on the phone", "The other device's edit is kept");
  assert.equal(documentTotals(quote).subtotalPence, 55800);

  // Another device saves first, three times running: ChatGPT gives up and changes nothing.
  let competing = 0;
  const race = () => { competing += 1; supabase.state.revision += 1; if (competing < 3) supabase.state.beforeSave = race; };
  supabase.state.beforeSave = race;
  const revision = supabase.state.revision;
  await assert.rejects(call("update_quote", { quote: "Q-0041", status: "sent" }), /changed on another device at the same moment\. Nothing was saved/);
  assert.equal(supabase.state.data.quotes.find(record => record.id === id)!.status, "draft");
  assert.equal(supabase.state.revision, revision + 3, "Only the other device's saves happened");
});

test("a lost answer followed by conflicts is never reported as \"nothing was saved\"", async context => {
  const { supabase, call } = setup(context);
  await call("create_quote", paulFinn);
  supabase.state.loseNextSaveAnswer = true;
  let competing = 0;
  supabase.state.beforeSave = () => {
    // The first save lands but its answer is lost; then another device keeps saving first.
    const race = () => { competing += 1; supabase.state.revision += 1; if (competing < 2) supabase.state.beforeSave = race; };
    supabase.state.beforeSave = race;
  };
  await assert.rejects(call("update_quote", { quote: "Q-0041", status: "sent" }), /may or may not have been saved\. Check with the matching get_ or list_ tool/);
  assert.equal(supabase.state.data.quotes.find(record => record.number === "Q-0041")!.status, "sent", "The first attempt did land");
});

test("incorrect totals are refused for invoices, revisions and payments, and nothing is saved", async context => {
  const { supabase, call } = setup(context);
  await call("create_quote", paulFinn);
  const revision = supabase.state.revision;
  await assert.rejects(call("create_invoice", { customer: { name: "John Smith" }, title: "Labour", works: [{ description: "Labour", quantity: 1, unitPrice: 850 }], expectedSubtotal: 800 }), /add up to £850\.00 before VAT, but Mike's figures came to £800\.00\. Nothing was saved/);
  await assert.rejects(call("update_quote", { quote: "Q-0041", works: [{ description: "Walls", quantity: 3, unit: "day", unitPrice: 200 }], expectedSubtotal: 600 }), /add up to £718\.00 before VAT, but Mike's figures came to £600\.00/);
  await assert.rejects(call("create_invoice", { fromQuote: "Q-0041", works: [{ description: "Deposit", quantity: 1, unitPrice: 200 }], expectedSubtotal: 250 }), /add up to £318\.00 before VAT/);
  await assert.rejects(call("create_invoice", { customer: { name: "X" }, title: "X", works: [{ description: "X", quantity: 0, unitPrice: 5 }] }), /needs a quantity greater than 0/);
  assert.equal(supabase.state.revision, revision, "Nothing was saved");

  const vat = savedDocument(await call("create_invoice", { customer: { name: "VAT Customer" }, title: "Labour", works: [{ description: "Labour", quantity: 1, unitPrice: 850 }], vat: { enabled: true, rate: 20 }, expectedSubtotal: 850 }));
  assert.equal(vat.amount, "£1,020.00", "expectedSubtotal is before VAT; the amount includes it");
  await assert.rejects(call("record_payment", { invoice: vat.number, amount: 1020.01 }), /£1,020\.01 is more than the £1,020\.00 still owed/);
});

test("retries, lost answers and racing devices never overwrite or delete existing records", async context => {
  const { supabase, call } = setup(context);
  const before = structuredClone(supabase.state.data);
  supabase.state.loseNextSaveAnswer = true;
  await call("create_invoice", { customer: { name: "John Smith" }, title: "Decorating labour", works: [{ description: "Decorating labour", quantity: 1, unitPrice: 850 }], expectedSubtotal: 850 });
  supabase.state.beforeSave = () => { supabase.state.revision += 1; };
  await call("record_payment", { invoice: "INV-0011", amount: 100 });
  supabase.state.loseNextSaveAnswer = true;
  await call("record_payment", { invoice: "INV-0011", amount: 100, label: "Second instalment" });
  for (let repeat = 0; repeat < 3; repeat += 1) {
    await call("create_invoice", { customer: { name: "John Smith" }, title: "Decorating labour", works: [{ description: "Decorating labour", quantity: 1, unitPrice: 850 }], expectedSubtotal: 850 });
  }
  const invoices = supabase.state.data.invoices.filter(record => record.customer.name === "John Smith");
  assert.equal(invoices.length, 1);
  assert.equal(invoices[0].payments.length, 2, "Each payment is recorded exactly once");
  assert.equal(supabase.state.data.settings.nextInvoiceNumber, 12, "Retries use no extra invoice numbers");
  untouched(before, supabase.state.data);
});
