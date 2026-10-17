import test from "node:test";
import assert from "node:assert/strict";
import {
  depositPence,
  documentTotals,
  formatPence,
  formatQuantity,
  invoiceTotals,
  lineTotalPence,
  parseAmount,
  toPence,
} from "../../lib/admin/money.ts";
import type { LineItem, Payment } from "../../lib/admin/types.ts";

const line = (quantity: number, unitPrice: number): LineItem => ({ id: "line-x", description: "", quantity, unit: "", unitPrice });
const payment = (amount: number): Payment => ({ id: "pay-xx", date: "2026-10-01", amount, method: "bank-transfer", label: "" });

test("converts pounds to whole pence without float drift", () => {
  assert.equal(toPence(1.005), 101);
  assert.equal(toPence(0.1 + 0.2), 30);
  assert.equal(toPence(19.99), 1999);
  assert.equal(toPence(Number.NaN), 0);
});

test("line totals handle decimal quantities and prices", () => {
  assert.equal(lineTotalPence(line(3, 0.1)), 30);
  assert.equal(lineTotalPence(line(2.5, 180)), 45000);
  assert.equal(lineTotalPence(line(12.5, 4.35)), 5438);
  assert.equal(lineTotalPence(line(1, -50)), -5000);
});

test("VAT is only charged when enabled", () => {
  const works = [line(1, 1000)];
  const materials = [line(2, 62.5)];
  const off = documentTotals({ works, materials, vat: { enabled: false, rate: 20 } });
  assert.deepEqual(off, { worksPence: 100000, materialsPence: 12500, subtotalPence: 112500, vatPence: 0, totalPence: 112500 });
  const on = documentTotals({ works, materials, vat: { enabled: true, rate: 20 } });
  assert.equal(on.vatPence, 22500);
  assert.equal(on.totalPence, 135000);
  const reduced = documentTotals({ works: [line(1, 99.99)], materials: [], vat: { enabled: true, rate: 5 } });
  assert.equal(reduced.vatPence, 500);
});

test("deposits by percentage and fixed amount", () => {
  assert.equal(depositPence(135000, { type: "percent", value: 25 }), 33750);
  assert.equal(depositPence(135000, { type: "fixed", value: 250 }), 25000);
  assert.equal(depositPence(10000, { type: "fixed", value: 500 }), 10000, "never more than the total");
  assert.equal(depositPence(135000, { type: "none", value: 0 }), 0);
});

test("invoice balance subtracts deposits and payments", () => {
  const totals = invoiceTotals({
    works: [line(1, 1200)],
    materials: [line(1, 150)],
    vat: { enabled: false, rate: 20 },
    payments: [payment(300), payment(549.5)],
  });
  assert.equal(totals.totalPence, 135000);
  assert.equal(totals.paidPence, 84950);
  assert.equal(totals.balancePence, 50050);
});

test("formats money and quantities for documents", () => {
  assert.equal(formatPence(135000), "£1,350.00");
  assert.equal(formatPence(-5000), "-£50.00");
  assert.equal(formatQuantity(2.5), "2.5");
  assert.equal(formatQuantity(3), "3");
});

test("parses typed and pasted amounts", () => {
  assert.equal(parseAmount("£1,250.50"), 1250.5);
  assert.equal(parseAmount(" 12 "), 12);
  assert.equal(parseAmount("12."), 12);
  assert.equal(parseAmount(".5"), 0.5);
  assert.equal(parseAmount("abc"), null);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount(Infinity), null);
});
