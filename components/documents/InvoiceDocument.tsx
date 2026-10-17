import { BusinessFooter, DocHeader, Intro, ItemsTable, Meta, Paper, Party, ScopeList, Totals } from "./parts";
import type { TotalRow } from "./parts";
import { formatLongDate, formatShortDate } from "@/lib/admin/dates";
import { invoiceTotals, toPence } from "@/lib/admin/money";
import type { BusinessSettings, Invoice, PaymentMethod } from "@/lib/admin/types";

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  "bank-transfer": "Bank transfer",
  cash: "Cash",
  card: "Card",
  cheque: "Cheque",
  other: "Payment",
};

export function InvoiceDocument({ invoice, business }: { invoice: Invoice; business: BusinessSettings }) {
  const totals = invoiceTotals(invoice);
  const hasMaterials = totals.materialsPence !== 0 || invoice.materials.some(m => m.description.trim());
  const paidInFull = totals.totalPence > 0 && totals.balancePence <= 0;
  const rows: TotalRow[] = [];
  if (hasMaterials || invoice.vat.enabled) {
    rows.push({ label: "Works", pence: totals.worksPence });
    if (hasMaterials) rows.push({ label: "Materials", pence: totals.materialsPence });
  }
  if (invoice.vat.enabled) {
    rows.push({ label: "Subtotal", pence: totals.subtotalPence });
    rows.push({ label: `VAT at ${invoice.vat.rate}%`, pence: totals.vatPence });
  }
  rows.push({ label: invoice.vat.enabled ? "Total including VAT" : "Total", pence: totals.totalPence, tone: "grand" });
  invoice.payments
    .filter(p => toPence(p.amount) !== 0)
    .forEach(p => {
      const label = p.label.trim() || `${paymentMethodLabels[p.method]} received`;
      rows.push({ label: `${label}, ${formatShortDate(p.date)}`, pence: toPence(p.amount), tone: "minus" });
    });
  if (invoice.payments.length) rows.push({ label: "Balance due", pence: Math.max(totals.balancePence, 0), tone: "balance" });
  else rows[rows.length - 1] = { ...rows[rows.length - 1], label: invoice.vat.enabled ? "Amount due including VAT" : "Amount due" };

  const bank = invoice.bank;
  const bankRows: [string, string][] = [
    ["Account name", bank.accountName],
    ["Sort code", bank.sortCode],
    ["Account number", bank.accountNumber],
  ];
  const hasBank = bankRows.some(([, value]) => value.trim());

  return (
    <Paper label={`Invoice ${invoice.number}`}>
      <DocHeader kind="Invoice" number={invoice.number} />
      <div className="dmdoc-parties">
        <Party heading="Billed to" customer={invoice.customer} />
        <Meta
          items={[
            ["Invoice date", formatLongDate(invoice.issueDate)],
            ["Payment due", formatLongDate(invoice.dueDate)],
            ["Invoice no.", invoice.number],
            ["Quotation ref.", invoice.quoteNumber],
          ]}
        />
      </div>
      <Intro title={invoice.title} text="" />
      <ScopeList title="Work carried out" points={invoice.scope} />
      <ItemsTable title="Itemised works" items={invoice.works} subtotalLabel="Works subtotal" subtotalPence={totals.worksPence} />
      <ItemsTable
        title="Materials"
        items={invoice.materials}
        subtotalLabel="Materials subtotal"
        subtotalPence={totals.materialsPence}
        note={invoice.materialsNote}
      />
      <Totals rows={rows} stamp={paidInFull ? "Paid in full" : undefined} />
      {!paidInFull && (
        <div className="dmdoc-pay">
          <p className="dmdoc-label">Payment details</p>
          <dl>
            {hasBank &&
              bankRows
                .filter(([, value]) => value.trim())
                .map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
            <div>
              <dt>Reference</dt>
              <dd>{invoice.number}</dd>
            </div>
            <div>
              <dt>Due by</dt>
              <dd>{formatLongDate(invoice.dueDate)}</dd>
            </div>
          </dl>
          {invoice.paymentNote.trim() && <p>{invoice.paymentNote.trim()}</p>}
        </div>
      )}
      {paidInFull && <p className="dmdoc-thanks">Thank you. This invoice has been paid in full.</p>}
      <BusinessFooter business={business} />
    </Paper>
  );
}
