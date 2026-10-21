import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { emptyData, newBooking } from "../../lib/admin/factories.ts";
import { documentTotals } from "../../lib/admin/money.ts";
import { normaliseAdminData } from "../../lib/admin/normalise.ts";
import { createQuote } from "../../lib/admin/operations.ts";
import {
  cleanTotal,
  customerMatches,
  defaultTitle,
  parsePrice,
  quickQuoteFingerprint,
  quickQuoteId,
  quickQuoteInput,
  quickQuoteInstructions,
  quickQuoteLink,
  readQuickQuoteParams,
  withMatchedCustomer,
} from "../../lib/admin/quick-quote.ts";
import type { QuickQuoteParams } from "../../lib/admin/quick-quote.ts";
import { validFinancialRecords } from "../../lib/admin/validation.ts";

const clock = { today: "2026-10-21", now: "2026-10-21T09:00:00.000Z" };
const origin = "https://www.dmpaintingdecorating.co.uk";
const idFor = (params: QuickQuoteParams) => quickQuoteId(createHash("sha256").update(quickQuoteFingerprint(readQuickQuoteParams(params))).digest("hex"));
const paramsOf = (link: string): QuickQuoteParams => {
  const params: Record<string, string[]> = {};
  for (const [key, value] of new URL(link).searchParams) (params[key] ??= []).push(value);
  return params;
};

test("a ChatGPT link only fills in the form: names, prices and points are cleaned, nothing else is assumed", () => {
  const start = readQuickQuoteParams({
    for: "  John Smith ",
    title: "Lounge and hallway",
    total: "£1,250",
    add: ["Prepare and fill walls|Two coats to walls\n- Gloss the doors", "Clear up daily"],
    address: "12 Mill Lane, Lymm, WA13 9SD",
    phone: "07700 900000",
  });
  assert.deepEqual(start, {
    customer: { name: "John Smith", email: "", phone: "07700 900000", address: { line1: "12 Mill Lane", line2: "", town: "Lymm", postcode: "WA13 9SD" } },
    title: "Lounge and hallway",
    total: "1250",
    lines: ["Prepare and fill walls", "Two coats to walls", "Gloss the doors", "Clear up daily"],
    test: false,
    fromLink: true,
  });
  assert.equal(readQuickQuoteParams({ for: "A", total: "1,250.5" }).total, "1250.50");
  assert.equal(readQuickQuoteParams({ for: "A", total: "about twelve hundred" }).total, "about twelve hundred", "unreadable prices are shown for Mike to correct, never guessed");
  assert.equal(readQuickQuoteParams({ for: "A", total: "1250", test: "1" }).test, true);
  assert.equal(readQuickQuoteParams({}).fromLink, false, "Quick quote opened from the admin starts empty");
  assert.equal(readQuickQuoteParams({ for: "x".repeat(500) }).customer.name.length, 120);
  assert.equal(cleanTotal("-50"), "-50");
});

test("only positive prices in whole pence are accepted", () => {
  assert.equal(parsePrice("1250"), 1250);
  assert.equal(parsePrice("£1,250.50"), 1250.5);
  assert.equal(parsePrice("19.99"), 19.99);
  for (const bad of ["", "0", "-5", "abc", "1.005", "1000000.01", "12,50,0x"]) assert.equal(parsePrice(bad), null, bad);
});

test("a £500 quick quote is saved as a £500 draft with D&M's own numbering, terms and VAT setting", () => {
  let data = emptyData(clock.now);
  data.settings = { ...data.settings, nextQuoteNumber: 42 };
  const start = readQuickQuoteParams({ for: "John Smith", total: "500", add: "Painting work" });
  const input = quickQuoteInput({ customer: start.customer, title: defaultTitle(start), lines: start.lines, price: parsePrice(start.total)!, test: start.test, fromLink: start.fromLink });
  const created = createQuote(data, clock, input);
  data = created.data;
  const quote = created.quote;
  // The original PR stored pence in a field that holds pounds: £500 became £50,000.
  assert.equal(quote.works[0].unitPrice, 500);
  assert.equal(documentTotals(quote).totalPence, 50_000);
  assert.equal(quote.number, "Q-0042");
  assert.equal(data.settings.nextQuoteNumber, 43);
  assert.equal(quote.status, "draft");
  assert.equal(quote.source, "chatgpt");
  assert.equal(quote.title, "Painting work");
  assert.deepEqual(quote.scope, ["Painting work"]);
  assert.deepEqual(quote.terms, data.settings.defaultTerms);
  assert.equal(quote.intro, data.settings.defaultQuoteIntro);
  assert.equal(quote.validUntil, "2026-11-20");
  assert.deepEqual(quote.vat, { enabled: false, rate: 20 });
  assert.ok(validFinancialRecords(data));

  const registered = { ...emptyData(clock.now), settings: { ...data.settings, vatRegistered: true } };
  const withVat = createQuote(registered, clock, quickQuoteInput({ ...start, title: "Hall", lines: [], price: 1250.5 }));
  assert.deepEqual(withVat.quote.vat, { enabled: true, rate: 20 }, "VAT follows Settings exactly as a quote made in the admin");
  assert.equal(documentTotals(withVat.quote).totalPence, 150_060);

  const typed = quickQuoteInput({ ...start, title: "Hall", lines: ["", " Walls "], price: 10, fromLink: false });
  assert.equal(typed.source, "manual");
  assert.deepEqual(typed.scope, ["Walls"]);
});

test("a test quick quote uses a TEST number and leaves the issued quote numbers alone", () => {
  const data = { ...emptyData(clock.now), settings: { ...emptyData(clock.now).settings, nextQuoteNumber: 7 } };
  const start = readQuickQuoteParams({ for: "TEST Customer", total: "10", title: "TEST job", test: "1" });
  const created = createQuote(data, clock, quickQuoteInput({ ...start, price: 10 }, "11111111-2222-8333-8444-555555555555"));
  assert.equal(created.quote.isTest, true);
  assert.equal(created.quote.number, "TEST-11111111222283338444555555555555");
  assert.equal(created.data.settings.nextQuoteNumber, 7);
});

test("the same link always gives the same record ID, so reopening it cannot make a second quote", () => {
  const link = { for: "John Smith", total: "1250", add: "Walls|Ceilings" };
  const id = idFor(link);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(idFor({ ...link }), id);
  assert.equal(idFor({ ...link, for: " john smith " }), id, "case and stray spaces do not make a different quote");
  assert.equal(idFor({ ...link, total: "£1,250" }), id);
  assert.notEqual(idFor({ ...link, total: "1300" }), id);
  assert.notEqual(idFor({ ...link, add: "Walls" }), id);
  assert.notEqual(idFor({ ...link, test: "1" }), id);

  // The ID survives the server's normalisation and the database's external_id unchanged.
  const created = createQuote(emptyData(clock.now), clock, quickQuoteInput({ ...readQuickQuoteParams(link), title: "Walls", price: 1250 }, id));
  const stored = normaliseAdminData(JSON.parse(JSON.stringify(created.data)), clock.now);
  assert.equal(stored.quotes[0].id, id);
});

test("earlier customers are offered newest first, once each, and test customers only for a test quote", () => {
  let data = emptyData(clock.now);
  const at = (now: string) => ({ today: now.slice(0, 10), now });
  const smith = { name: "John Smith", email: "john@example.com", phone: "", address: { line1: "12 Mill Lane", line2: "", town: "Lymm", postcode: "WA13 9SD" } };
  data = createQuote(data, at("2026-10-01T09:00:00.000Z"), { title: "Old", customer: smith }).data;
  data = createQuote(data, at("2026-10-10T09:00:00.000Z"), { title: "Newer", customer: { ...smith, phone: "01925 000000" } }).data;
  data = createQuote(data, at("2026-10-05T09:00:00.000Z"), { title: "Other", customer: { ...smith, name: "Joan Smithson", address: { ...smith.address, postcode: "WA1 1AA" } } }).data;
  data = createQuote(data, at("2026-10-12T09:00:00.000Z"), { title: "Test", isTest: true, customer: { ...smith, name: "John Smith TEST" } }).data;
  data.bookings.push(newBooking("2026-10-20", "2026-10-15T09:00:00.000Z", { customerName: "Mrs Smithers", phone: "07000 111111" }));

  const matches = customerMatches(data, "smith", false);
  assert.deepEqual(matches.map(m => [m.customer.name, m.from.split(" ")[0]]), [["Mrs Smithers", "the"], ["John Smith", "quote"], ["Joan Smithson", "quote"]]);
  assert.equal(matches[1].customer.phone, "01925 000000", "the most recent details for a customer are offered");
  assert.ok(customerMatches(data, "John Smith", true).some(m => m.customer.name === "John Smith TEST"));
  assert.ok(!customerMatches(data, "John Smith", false).some(m => m.customer.name === "John Smith TEST"));
  assert.deepEqual(customerMatches(data, "j", false), []);

  const fromChatGpt = { name: "J Smith", email: "", phone: "07700 900000", address: { line1: "", line2: "", town: "", postcode: "" } };
  assert.deepEqual(withMatchedCustomer(fromChatGpt, smith), { ...smith, phone: "07700 900000" });
});

test("ChatGPT's instructions fit its custom instructions box, and their example link reads back exactly", () => {
  const text = quickQuoteInstructions(origin);
  assert.ok(text.length < 1500, `custom instructions are limited to 1,500 characters (${text.length})`);
  assert.match(text, /https:\/\/www\.dmpaintingdecorating\.co\.uk\/admin\/quick-quote\?for=NAME/);
  assert.match(text, /never estimate/i);
  assert.match(text, /Never say the quote is saved, created or sent/);
  const example = text.match(/Example: (\S+)$/)?.[1];
  assert.ok(example && !example.includes("+"), "the example encodes spaces as %20, as the instructions say");
  const start = readQuickQuoteParams(paramsOf(example));
  assert.equal(start.customer.name, "John Smith");
  assert.equal(start.customer.address.postcode, "WA13 9SD");
  assert.equal(start.title, "Lounge and hallway redecoration");
  assert.equal(start.total, "1250");
  assert.deepEqual(start.lines, ["Prepare and fill walls", "Two coats to walls and ceilings"]);

  const link = quickQuoteLink(origin, { for: "O'Brien & Sons", total: "99.50", add: ["Walls | ceilings? 100%"], test: true });
  const back = readQuickQuoteParams(paramsOf(link));
  assert.equal(back.customer.name, "O'Brien & Sons");
  assert.equal(back.total, "99.50");
  assert.deepEqual(back.lines, ["Walls", "ceilings? 100%"]);
  assert.equal(back.test, true);
});
