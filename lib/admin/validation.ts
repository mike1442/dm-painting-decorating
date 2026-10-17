import type { AdminData } from "./types.ts";
import { documentTotals, invoiceTotals } from "./money.ts";

/** Reject impossible amounts before persistence; do not silently rewrite prices. */
export function validFinancialRecords(data: AdminData): boolean {
  const money = (value: number) => Number.isFinite(value) && value >= 0 && value <= 100_000_000;
  for (const doc of [...data.quotes, ...data.invoices]) {
    if (![...doc.works, ...doc.materials].every(line => money(line.quantity) && money(line.unitPrice))) return false;
    if (!Object.values(documentTotals(doc)).every(Number.isSafeInteger)) return false;
    if (doc.kind === "invoice" && (!doc.payments.every(payment => money(payment.amount)) || !Object.values(invoiceTotals(doc)).every(Number.isSafeInteger))) return false;
  }
  return true;
}
