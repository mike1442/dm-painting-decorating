import type { DepositSetting, Invoice, LineItem, Payment, Quote, VatSetting } from "./types.ts";

// All arithmetic happens in whole pence so totals never drift by a penny.

export function toPence(pounds: number): number {
  if (!Number.isFinite(pounds)) return 0;
  return Math.round(Number((pounds * 100).toPrecision(15)));
}

export function lineTotalPence(item: Pick<LineItem, "quantity" | "unitPrice">): number {
  const quantity = Number.isFinite(item.quantity) ? item.quantity : 0;
  return Math.round(Number((quantity * toPence(item.unitPrice)).toPrecision(15)));
}

export function sumLinesPence(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + lineTotalPence(item), 0);
}

export function vatPence(netPence: number, vat: VatSetting): number {
  if (!vat.enabled || !Number.isFinite(vat.rate) || vat.rate <= 0) return 0;
  return Math.round((netPence * vat.rate) / 100);
}

export type DocumentTotals = {
  worksPence: number;
  materialsPence: number;
  subtotalPence: number;
  vatPence: number;
  totalPence: number;
};

export function documentTotals(doc: Pick<Quote, "works" | "materials" | "vat">): DocumentTotals {
  const worksPence = sumLinesPence(doc.works);
  const materialsPence = sumLinesPence(doc.materials);
  const subtotalPence = worksPence + materialsPence;
  const vat = vatPence(subtotalPence, doc.vat);
  return { worksPence, materialsPence, subtotalPence, vatPence: vat, totalPence: subtotalPence + vat };
}

export function depositPence(totalPence: number, deposit: DepositSetting): number {
  if (deposit.type === "percent") {
    const percent = Math.min(Math.max(deposit.value, 0), 100);
    return Math.round((totalPence * percent) / 100);
  }
  if (deposit.type === "fixed") return Math.min(Math.max(toPence(deposit.value), 0), Math.max(totalPence, 0));
  return 0;
}

export type InvoiceTotals = DocumentTotals & {
  paidPence: number;
  balancePence: number;
};

export function paymentsPence(payments: Payment[]): number {
  return payments.reduce((sum, payment) => sum + toPence(payment.amount), 0);
}

export function invoiceTotals(invoice: Pick<Invoice, "works" | "materials" | "vat" | "payments">): InvoiceTotals {
  const totals = documentTotals(invoice);
  const paidPence = paymentsPence(invoice.payments);
  return { ...totals, paidPence, balancePence: totals.totalPence - paidPence };
}

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

export function formatPence(pence: number): string {
  return gbp.format(pence / 100);
}

/** Formats a quantity without trailing zeros, e.g. 2, 2.5, 12.25. */
export function formatQuantity(quantity: number): string {
  if (!Number.isFinite(quantity)) return "0";
  return Number(quantity.toFixed(3)).toString();
}

/** Lenient parser for typed or pasted amounts such as "£1,250.50" or " 12 ". */
export function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[£,\s]/g, "");
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}
