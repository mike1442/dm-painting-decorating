import test from "node:test";
import assert from "node:assert/strict";
import { emptyData } from "../../lib/admin/factories.ts";
import { documentTotals, invoiceTotals } from "../../lib/admin/money.ts";
import {
  bookingFieldsFromQuote,
  bookingsOn,
  createInvoice,
  createQuote,
  deleteQuote,
  duplicateQuote,
  saveBooking,
  updateQuote,
} from "../../lib/admin/operations.ts";
import { newBooking } from "../../lib/admin/factories.ts";
import { invoiceState, quoteState } from "../../lib/admin/status.ts";

const clock = { today: "2026-10-17", now: "2026-10-17T10:00:00.000Z" };

function sampleQuote() {
  const created = createQuote(emptyData(clock.now), clock, {
    title: "Lounge redecoration",
    customer: { name: "J. Example", email: "j@example.com", phone: "07000 000000", address: { line1: "1 Road", line2: "", town: "Warrington", postcode: "WA1 1AA" } },
    scope: ["Protect floors", "Two coats"],
    works: [{ description: "Walls", quantity: 1, unit: "room", unitPrice: 450 }],
    materials: [{ description: "Paint", quantity: 2, unit: "tin", unitPrice: 48.5 }],
    vat: { enabled: true, rate: 20 },
    deposit: { type: "percent", value: 25 },
  });
  return created;
}

test("new quotes are numbered in sequence and never assume VAT", () => {
  const first = createQuote(emptyData(clock.now), clock);
  assert.equal(first.quote.number, "Q-0001");
  assert.equal(first.quote.vat.enabled, false);
  assert.equal(first.quote.validUntil, "2026-11-16");
  assert.equal(first.quote.terms.length > 0, true);
  const second = createQuote(first.data, clock);
  assert.equal(second.quote.number, "Q-0002");
  assert.equal(second.data.quotes.length, 2);
});

test("converting a quote copies everything into an independent invoice", () => {
  const { data, quote } = sampleQuote();
  const { data: next, invoice } = createInvoice(data, clock, quote.id);
  assert.equal(invoice.number, "INV-0001");
  assert.equal("isTest" in invoice, false);
  assert.equal(invoice.quoteId, quote.id);
  assert.equal(invoice.quoteNumber, quote.number);
  assert.deepEqual(invoice.customer, quote.customer);
  assert.deepEqual(invoice.scope, quote.scope);
  assert.deepEqual(invoice.vat, quote.vat);
  assert.equal(invoice.dueDate, "2026-10-31");
  assert.deepEqual(documentTotals(invoice), documentTotals(quote));
  assert.notEqual(invoice.works[0].id, quote.works[0].id);
  assert.notEqual(invoice.customer, quote.customer, "customer must not be shared by reference");
  assert.equal(next.quotes[0].status, "accepted");

  const edited = updateQuote(next, quote.id, q => ({ ...q, title: "Changed" }), clock.now);
  assert.equal(edited.invoices[0].title, "Lounge redecoration", "editing the quote leaves the invoice alone");
});

test("test quotation copies and conversions remain tests without consuming issued numbers", () => {
  const initial = emptyData(clock.now);
  initial.settings.bank = { accountName: "Business account", sortCode: "11-22-33", accountNumber: "12345678" };
  const created = createQuote(initial, clock, { isTest: true, title: "TEST painting example" });
  const duplicate = duplicateQuote(created.data, created.quote.id, clock)!;
  const converted = createInvoice(duplicate.data, clock, created.quote.id);

  const testRecords = [created.quote, duplicate.quote, converted.invoice];
  for (const record of testRecords) {
    assert.equal(record.isTest, true);
    assert.equal(record.status, "draft");
    assert.match(record.number, /^TEST-[a-f0-9]{32}$/);
    assert.ok(record.number.length <= 40);
  }
  assert.equal(new Set(testRecords.map(record => record.number)).size, 3);
  assert.equal(converted.data.settings.nextQuoteNumber, initial.settings.nextQuoteNumber);
  assert.equal(converted.data.settings.nextInvoiceNumber, initial.settings.nextInvoiceNumber);
  assert.deepEqual(converted.invoice.bank, { accountName: "", sortCode: "", accountNumber: "" });
  assert.equal(converted.invoice.paymentNote, "");
  assert.match(converted.invoice.internalNotes, /No payment is due/);
  assert.equal(converted.invoice.quoteId, created.quote.id);

  const real = createQuote(converted.data, clock);
  assert.equal(real.quote.number, "Q-0001");
  assert.equal("isTest" in real.quote, false);
  assert.equal(createInvoice(real.data, clock).invoice.number, "INV-0001");
});

test("invoice totals and payment state", () => {
  const { data, quote } = sampleQuote();
  const { invoice } = createInvoice(data, clock, quote.id);
  const totals = invoiceTotals(invoice);
  assert.equal(totals.totalPence, 65640);
  assert.equal(invoiceState(invoice, clock.today), "draft");
  const sent = { ...invoice, status: "sent" as const };
  assert.equal(invoiceState(sent, clock.today), "sent");
  const part = { ...sent, payments: [{ id: "pay-001", date: clock.today, amount: 164.1, method: "bank-transfer" as const, label: "Deposit" }] };
  assert.equal(invoiceState(part, clock.today), "part-paid");
  assert.equal(invoiceState(part, "2026-11-01"), "overdue");
  const paid = { ...part, payments: [...part.payments, { id: "pay-002", date: clock.today, amount: 492.3, method: "cash" as const, label: "" }] };
  assert.equal(invoiceTotals(paid).balancePence, 0);
  assert.equal(invoiceState(paid, "2026-11-01"), "paid");
});

test("quotes past their validity show as expired", () => {
  const { quote } = sampleQuote();
  assert.equal(quoteState(quote, "2026-11-16"), "draft");
  assert.equal(quoteState(quote, "2026-11-17"), "expired");
  assert.equal(quoteState({ ...quote, status: "accepted" }, "2027-01-01"), "accepted");
});

test("duplicating gets a new number; deleting unlinks invoices and bookings", () => {
  const { data, quote } = sampleQuote();
  const copy = duplicateQuote(data, quote.id, clock)!;
  assert.equal(copy.quote.number, "Q-0002");
  assert.equal(copy.quote.works[0].unitPrice, 450);

  const withInvoice = createInvoice(copy.data, clock, quote.id);
  const booking = newBooking("2026-10-20", clock.now, { ...bookingFieldsFromQuote(quote), end: "2026-10-22" });
  const withBooking = saveBooking(withInvoice.data, booking, clock.now);
  const removed = deleteQuote(withBooking, quote.id);
  assert.equal(removed.quotes.some(q => q.id === quote.id), false);
  assert.equal(removed.invoices[0].quoteId, null);
  assert.equal(removed.invoices[0].quoteNumber, quote.number, "invoice keeps its printed quote reference");
  assert.equal(removed.bookings[0].quoteId, null);
});

test("bookings cover every day from start to end", () => {
  const data = emptyData(clock.now);
  const a = newBooking("2026-10-19", clock.now, { job: "Hallway", end: "2026-10-21" });
  const b = newBooking("2026-10-21", clock.now, { job: "Bedroom" });
  const reversed = newBooking("2026-10-25", clock.now, { job: "Kitchen", end: "2026-10-23" });
  let next = saveBooking(data, a, clock.now);
  next = saveBooking(next, b, clock.now);
  next = saveBooking(next, reversed, clock.now);
  assert.deepEqual(bookingsOn(next.bookings, "2026-10-18").map(x => x.job), []);
  assert.deepEqual(bookingsOn(next.bookings, "2026-10-20").map(x => x.job), ["Hallway"]);
  assert.deepEqual(bookingsOn(next.bookings, "2026-10-21").map(x => x.job), ["Hallway", "Bedroom"]);
  assert.equal(next.bookings.find(x => x.job === "Kitchen")!.end, "2026-10-25", "end is never before start");
});
