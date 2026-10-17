import test from "node:test";
import assert from "node:assert/strict";
import { billGatesTestInvoice } from "../../lib/admin/fixtures.ts";
import { emptyData } from "../../lib/admin/factories.ts";
import { invoiceTotals, lineTotalPence } from "../../lib/admin/money.ts";
import { normaliseAdminData } from "../../lib/admin/normalise.ts";

const clock = { today: "2026-10-17", now: "2026-10-17T10:00:00.000Z" };

test("Bill Gates wall painting totals £1,680 before optional VAT", () => {
  const invoice = billGatesTestInvoice(clock);
  assert.equal(invoice.customer.name, "Bill Gates");
  assert.deepEqual(invoice.works.map(lineTotalPence), [75000, 75000]);
  assert.equal(invoiceTotals(invoice).materialsPence, 18000);
  assert.equal(invoiceTotals(invoice).totalPence, 168000);
  assert.equal(invoiceTotals(invoice).balancePence, 168000);
  assert.equal(invoiceTotals(invoice).vatPence, 0);
  assert.equal(invoiceTotals({ ...invoice, vat: { enabled: true, rate: 20 } }).totalPence, 201600);
});

test("example stays a clearly marked draft through backup/import normalization", () => {
  const invoice = billGatesTestInvoice(clock);
  const imported = normaliseAdminData({ ...emptyData(clock.now), invoices: [invoice] }, clock.now).invoices[0];
  assert.equal(imported.isTest, true);
  assert.equal(imported.status, "draft");
  assert.match(imported.number, /^TEST-/);
  assert.deepEqual(imported.bank, { accountName: "", sortCode: "", accountNumber: "" });
  assert.equal(imported.payments.length, 0);
  assert.equal(imported.share.token, null);
  assert.equal(invoiceTotals(imported).totalPence, 168000);
});
