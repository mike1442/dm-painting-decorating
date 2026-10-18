import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyData } from "../../lib/admin/factories.ts";
import { createInvoice } from "../../lib/admin/operations.ts";
import { validFinancialRecords } from "../../lib/admin/validation.ts";
test("financial validation rejects overflow and negative payments without changing records", () => {
  const { data, invoice } = createInvoice(emptyData("2026-10-17"), { today: "2026-10-17", now: "2026-10-17T00:00:00Z" });
  assert.equal(validFinancialRecords(data), true);
  invoice.works[0].quantity = 1e300;
  assert.equal(validFinancialRecords(data), false);
  invoice.works[0].quantity = 1;
  invoice.payments = [{ id: "test", date: "2026-10-17", amount: -1, method: "cash", label: "" }];
  assert.equal(validFinancialRecords(data), false);
});
