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
