import { invoiceTotals } from "./money.ts";
import type { Invoice, IsoDate, Quote } from "./types.ts";

export type QuoteState = Quote["status"] | "expired";
export type InvoiceState = "draft" | "sent" | "part-paid" | "paid" | "overdue";

export function quoteState(quote: Quote, today: IsoDate): QuoteState {
  if ((quote.status === "draft" || quote.status === "sent") && quote.validUntil < today) return "expired";
  return quote.status;
}

export function invoiceState(invoice: Invoice, today: IsoDate): InvoiceState {
  const totals = invoiceTotals(invoice);
  if (totals.totalPence > 0 && totals.balancePence <= 0) return "paid";
  if (invoice.status === "draft") return "draft";
  if (invoice.dueDate < today) return "overdue";
  if (totals.paidPence > 0) return "part-paid";
  return "sent";
}

export const stateLabels: Record<QuoteState | InvoiceState, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  "part-paid": "Part paid",
  paid: "Paid",
  overdue: "Overdue",
};
