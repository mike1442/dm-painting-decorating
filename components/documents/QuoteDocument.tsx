import { BusinessFooter, DocHeader, Intro, ItemsTable, Meta, Paper, Party, ScopeList, Terms, TestDocumentNotice, Totals } from "./parts";
import type { TotalRow } from "./parts";
import { formatLongDate } from "@/lib/admin/dates";
import { depositPence, documentTotals } from "@/lib/admin/money";
import type { BusinessSettings, Quote } from "@/lib/admin/types";

export function QuoteDocument({ quote, business }: { quote: Quote; business: BusinessSettings }) {
  const isTest = "isTest" in quote && quote.isTest === true;
  const totals = documentTotals(quote);
  const deposit = depositPence(totals.totalPence, quote.deposit);
  const hasMaterials = totals.materialsPence !== 0 || quote.materials.some(m => m.description.trim());
  const rows: TotalRow[] = [];
  if (hasMaterials || quote.vat.enabled) {
    rows.push({ label: "Works", pence: totals.worksPence });
    if (hasMaterials) rows.push({ label: "Materials", pence: totals.materialsPence });
  }
  if (quote.vat.enabled) {
    rows.push({ label: "Subtotal", pence: totals.subtotalPence });
    rows.push({ label: `VAT at ${quote.vat.rate}%`, pence: totals.vatPence });
  }
  rows.push({ label: quote.vat.enabled ? "Total including VAT" : "Total", pence: totals.totalPence, tone: "grand" });
  if (deposit > 0) {
    const percent = quote.deposit.type === "percent" ? ` (${quote.deposit.value}%)` : "";
    rows.push({ label: `Deposit to confirm your booking${percent}`, pence: deposit, tone: "highlight" });
  }

  return (
    <Paper label={`Quotation ${quote.number}`}>
      <DocHeader kind="Quotation" number={quote.number} />
      {isTest && <TestDocumentNotice />}
      <div className="dmdoc-parties">
        <Party heading="Prepared for" customer={quote.customer} />
        <Meta
          items={[
            ["Date", formatLongDate(quote.issueDate)],
            ["Valid until", formatLongDate(quote.validUntil)],
            ["Reference", quote.number],
          ]}
        />
      </div>
      <Intro title={quote.title} text={quote.intro} />
      <ScopeList title="Scope of works" points={quote.scope} />
      <ItemsTable title="Itemised works" items={quote.works} subtotalLabel="Works subtotal" subtotalPence={totals.worksPence} />
      <ItemsTable
        title="Materials"
        items={quote.materials}
        subtotalLabel="Materials subtotal"
        subtotalPence={totals.materialsPence}
        note={quote.materialsNote}
      />
      {!hasMaterials && quote.materialsNote.trim() && (
        <p className="dmdoc-note dmdoc-note-solo">{quote.materialsNote.trim()}</p>
      )}
      <Totals rows={rows} />
      {!isTest && <div className="dmdoc-accept">
        <p className="dmdoc-label">Accepting this quotation</p>
        <p>
          To go ahead, simply get in touch to confirm and we will arrange a start date that suits you.
          {deposit > 0 && " Your booking is secured once the deposit shown above has been received."}
        </p>
      </div>}
      <Terms title="Terms" terms={quote.terms} />
      <BusinessFooter business={business} />
    </Paper>
  );
}

