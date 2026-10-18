"use client";
import Link from "./AdminLink";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "./Icon";
import { matchesSearch } from "./QuoteList";
import { Empty, Loading, PageHead, Sheet, StateChip } from "./ui";
import { formatShortDate } from "@/lib/admin/dates";
import { documentTotals, formatPence, invoiceTotals } from "@/lib/admin/money";
import { createInvoice } from "@/lib/admin/operations";
import { invoiceState } from "@/lib/admin/status";
import { clock, commit, useAdminState } from "@/lib/admin/store";

export function InvoiceList() {
  const router = useRouter();
  const state = useAdminState();
  const [query, setQuery] = useState("");
  const [choosing, setChoosing] = useState(false);
  if (!state) return <Loading />;

  const today = clock().today;
  const { quotes, invoices } = state.data;
  const shown = invoices
    .filter(i => matchesSearch(query, i.number, i.title, i.customer.name, i.customer.address.town, i.quoteNumber))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const outstanding = invoices
    .filter(i => i.status === "sent")
    .reduce((sum, i) => sum + Math.max(invoiceTotals(i).balancePence, 0), 0);
  const convertible = quotes
    .filter(q => q.status !== "declined")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 12);

  const create = (fromQuoteId?: string) => {
    let invoiceId = "";
    commit(
      d => {
        const created = createInvoice(d, clock(), fromQuoteId);
        invoiceId = created.invoice.id;
        return created.data;
      },
      { immediate: true },
    );
    router.push(`/admin/invoices/${invoiceId}`);
  };

  return (
    <div className="adm-page">
      <PageHead
        title="Invoices"
        subtitle={outstanding > 0 ? `${formatPence(outstanding)} outstanding on sent invoices` : invoices.length === 1 ? "1 invoice" : `${invoices.length} invoices`}
        action={
          <button type="button" className="adm-btn" onClick={() => setChoosing(true)}>
            <Icon name="plus" size={18} /> New invoice
          </button>
        }
      />
      {invoices.length > 0 && (
        <label className="adm-search">
          <Icon name="search" size={18} />
          <input type="search" placeholder="Search name, job or number" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search invoices" />
        </label>
      )}
      {invoices.length === 0 ? (
        <Empty icon="invoice" title="No invoices yet">
          <p>Turn an accepted quote into an invoice without re-typing anything, or start a blank one.</p>
          <button type="button" className="adm-btn" onClick={() => setChoosing(true)}>
            <Icon name="plus" size={18} /> New invoice
          </button>
        </Empty>
      ) : (
        <ul className="adm-list">
          {shown.map(invoice => {
            const totals = invoiceTotals(invoice);
            const invState = invoiceState(invoice, today);
            return (
              <li key={invoice.id}>
                <Link href={`/admin/invoices/${invoice.id}`} className="adm-item">
                  <div className="adm-item-top">
                    <span className="adm-item-ref">{invoice.number}</span>
                    <StateChip state={invState} />
                  </div>
                  <strong className="adm-item-title">{invoice.title || "Untitled invoice"}</strong>
                  <div className="adm-item-meta">
                    <span>{invoice.customer.name || "No customer yet"}</span>
                    <span>Due {formatShortDate(invoice.dueDate)}</span>
                  </div>
                  <span className="adm-item-amount">
                    {formatPence(invState === "paid" ? totals.totalPence : totals.balancePence)}
                    {invState !== "paid" && totals.paidPence > 0 && <small>due</small>}
                  </span>
                </Link>
              </li>
            );
          })}
          {shown.length === 0 && <li className="adm-muted adm-pad">No invoices match “{query}”.</li>}
        </ul>
      )}

      <Sheet open={choosing} onClose={() => setChoosing(false)} title="New invoice">
        {convertible.length > 0 && (
          <>
            <p className="adm-sheet-label">From a quote: everything is copied across</p>
            <div className="adm-choices">
              {convertible.map(q => (
                <button type="button" key={q.id} className="adm-choice" onClick={() => create(q.id)}>
                  <Icon name="quote" size={22} />
                  <span>
                    <strong>{q.title || "Untitled quote"}</strong>
                    <small>
                      {q.number} · {q.customer.name || "No customer"} · {formatPence(documentTotals(q).totalPence)}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
        <p className="adm-sheet-label">Or start empty</p>
        <div className="adm-choices">
          <button type="button" className="adm-choice" onClick={() => create()}>
            <Icon name="invoice" size={22} />
            <span>
              <strong>Blank invoice</strong>
              <small>Uses your bank details and payment terms from Settings.</small>
            </span>
          </button>
        </div>
      </Sheet>
    </div>
  );
}
