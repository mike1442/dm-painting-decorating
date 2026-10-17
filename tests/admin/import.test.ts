import test from "node:test";
import assert from "node:assert/strict";
import { backupFileName, createBackup, mergeData, parseBackup } from "../../lib/admin/backup.ts";
import { chatGptInstructions, parseQuoteJson, quoteInputExample } from "../../lib/admin/chatgpt.ts";
import { emptyData } from "../../lib/admin/factories.ts";
import { normaliseAdminData } from "../../lib/admin/normalise.ts";
import { createQuote, updateQuote } from "../../lib/admin/operations.ts";

const now = "2026-10-17T10:00:00.000Z";
const clock = { today: "2026-10-17", now };

test("reads ChatGPT quote JSON from a fenced code block", () => {
  const pasted = "Here you go:\n```json\n" + JSON.stringify({
    customer: { name: "Mr A. Customer", address: "4 Lane, Appleton, WA4 5AB" },
    title: "Exterior refresh",
    scope: "- Wash down\n- Two coats masonry paint",
    works: [{ description: "Front elevation", quantity: "1", unit: "elevation", unitPrice: "£1,200" }],
    materials: [{ name: "Masonry paint", total: 180 }, { description: "Sundries", quantity: 1, unitPrice: 0 }],
    validForDays: 21,
  }) + "\n```";
  const result = parseQuoteJson(pasted, 20);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.input.source, "chatgpt");
  assert.deepEqual(result.input.customer?.address, { line1: "4 Lane", line2: "", town: "Appleton", postcode: "WA4 5AB" });
  assert.deepEqual(result.input.scope, ["Wash down", "Two coats masonry paint"]);
  assert.equal(result.input.works?.[0].unitPrice, 1200);
  assert.deepEqual(result.input.materials?.[0], { description: "Masonry paint", quantity: 1, unit: "", unitPrice: 180 });
  assert.equal(result.input.validForDays, 21);
  assert.equal(result.input.vat, undefined, "VAT is not assumed");
  assert.equal(result.input.terms, undefined, "standard terms are used");
  assert.deepEqual(result.warnings, ["1 line has no price yet. Add prices before sending."]);

  const { quote } = createQuote(emptyData(now), clock, result.input);
  assert.equal(quote.validUntil, "2026-11-07");
  assert.equal(quote.vat.enabled, false);
});

test("the documented example is accepted", () => {
  const result = parseQuoteJson(JSON.stringify(quoteInputExample), 20);
  assert.ok(result.ok);
  assert.ok(chatGptInstructions.includes('"unitPrice": 0'));
});

test("rejects JSON that is not a quote", () => {
  assert.equal(parseQuoteJson("no json here", 20).ok, false);
  assert.equal(parseQuoteJson("{ broken", 20).ok, false);
  assert.equal(parseQuoteJson('{"hello":"world"}', 20).ok, false);
});

test("stored data is repaired rather than trusted", () => {
  const data = normaliseAdminData({
    quotes: [{ id: "abc123", works: [{ description: "x", quantity: "2", unitPrice: "10" }], vat: { enabled: "yes", rate: 900 } }, { id: "abc123" }],
    bookings: [{ start: "2026-10-20", end: "2026-10-01" }, "nonsense"],
    settings: { nextQuoteNumber: -5, defaultVatRate: 20, phone: "01925 000000" },
  }, now);
  assert.equal(data.quotes.length, 1, "duplicate ids dropped");
  assert.deepEqual(data.quotes[0].works[0].quantity, 2);
  assert.deepEqual(data.quotes[0].vat, { enabled: false, rate: 20 });
  assert.equal(data.bookings[0].end, "2026-10-20");
  assert.equal(data.bookings.length, 1, "non-object entries dropped");
  assert.equal(data.settings.nextQuoteNumber, 1);
  assert.equal(data.settings.phone, "01925 000000");
  assert.equal(data.settings.email, "info@dmpaintingdecorating.co.uk");
});

test("backups round-trip and merge keeps the newest copy", () => {
  const first = createQuote(emptyData(now), clock, { title: "Original" });
  const backup = JSON.stringify(createBackup(first.data, now));
  assert.equal(backupFileName(now), "dm-admin-backup-2026-10-17.json");

  const parsed = parseBackup(backup, now);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.data, first.data);

  const later = "2026-10-18T09:00:00.000Z";
  const edited = updateQuote(first.data, first.quote.id, q => ({ ...q, title: "Edited on phone" }), later);
  const second = createQuote(edited, { today: "2026-10-18", now: later });
  const merged = mergeData(parsed.data, second.data);
  assert.equal(merged.quotes.length, 2);
  assert.equal(merged.quotes.find(q => q.id === first.quote.id)?.title, "Edited on phone");
  assert.equal(merged.settings.nextQuoteNumber, 3);

  assert.equal(parseBackup("{}", now).ok, false);
  assert.equal(parseBackup("not json", now).ok, false);
});
