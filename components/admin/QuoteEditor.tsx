"use client";
import Link from "next/link";
import { ShareControls } from "./ShareControls";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DepositControls, TotalsSummary, VatControls } from "./DocumentControls";
import { CustomerFields, DateField, LinesField, SelectField, TextArea, TextField } from "./fields";
import { Icon } from "./Icon";
import { LineItemsEditor, UnitSuggestions } from "./LineItemsEditor";
import { Card, Loading, NotOnDevice, PageHead, SaveStatus, StateChip } from "./ui";
import { addDays, daysBetween, formatShortDate } from "@/lib/admin/dates";
import { depositPence, documentTotals, formatPence } from "@/lib/admin/money";
import { createInvoice, deleteQuote, duplicateQuote, updateQuote } from "@/lib/admin/operations";
import { quoteState } from "@/lib/admin/status";
import { clock, commit, useAdminState } from "@/lib/admin/store";
import type { Quote, QuoteStatus } from "@/lib/admin/types";

const statusOptions: [QuoteStatus, string][] = [
  ["draft", "Draft"],
  ["sent", "Sent to customer"],
  ["accepted", "Accepted"],
  ["declined", "Declined"],
];

export function QuoteEditor({ id }: { id: string }) {
  const router = useRouter();
  const state = useAdminState();
  const [leaving, setLeaving] = useState(false);
  if (!state || leaving) return <Loading />;
  const { data } = state;
  const quote = data.quotes.find(q => q.id === id);
  if (!quote) return <NotOnDevice kind="quote" href="/admin/quotes" />;

  const set = (change: Partial<Quote>) => commit(d => updateQuote(d, id, q => ({ ...q, ...change }), clock().now));
  const totals = documentTotals(quote);
  const deposit = depositPence(totals.totalPence, quote.deposit);
  const invoices = data.invoices.filter(inv => inv.quoteId === id);
  const bookings = data.bookings.filter(b => b.quoteId === id);
  const validDays = daysBetween(quote.issueDate, quote.validUntil);

  const toInvoice = () => {
    let invoiceId = "";
    commit(
      d => {
        const created = createInvoice(d, clock(), id);
        invoiceId = created.invoice.id;
        return created.data;
      },
      { immediate: true },
    );
    router.push(`/admin/invoices/${invoiceId}`);
  };
  const duplicate = () => {
    let copyId = "";
    commit(
      d => {
        const copy = duplicateQuote(d, id, clock());
        if (!copy) return d;
        copyId = copy.quote.id;
        return copy.data;
      },
      { immediate: true },
    );
    if (copyId) router.push(`/admin/quotes/${copyId}`);
  };
  const remove = () => {
    if (!window.confirm(`Delete quote ${quote.number}? This can't be undone.`)) return;
    setLeaving(true);
    commit(d => deleteQuote(d, id), { immediate: true });
    router.replace("/admin/quotes");
  };

  return (
    <div className="adm-editor">
      <UnitSuggestions />
      <PageHead
        back={{ href: "/admin/quotes", label: "Quotes" }}
        title={quote.title || "New quote"}
        subtitle={
          <>
            <span>{quote.number}</span>
            <StateChip state={quoteState(quote, clock().today)} />
            {quote.source === "chatgpt" && <span className="adm-chip adm-chip-muted">From ChatGPT</span>}
            <SaveStatus persistence={state.persistence} />
          </>
        }
      />

      <Card title="Customer">
        <CustomerFields value={quote.customer} onChange={customer => set({ customer })} />
      </Card>

      <Card title="Quote details">
        <div className="adm-grid">
          <TextField label="Job title" className="adm-span-2" value={quote.title} onChange={title => set({ title })} placeholder="e.g. Lounge and hallway redecoration" />
          <TextField label="Quote number" value={quote.number} onChange={number => set({ number })} />
          <SelectField label="Status" value={quote.status} options={statusOptions} onChange={status => set({ status })} />
          <DateField label="Date" value={quote.issueDate} onChange={issueDate => set({ issueDate, validUntil: addDays(issueDate, Math.max(validDays, 1)) })} />
          <DateField label="Valid until" value={quote.validUntil} onChange={validUntil => set({ validUntil })} />
        </div>
        <TextArea label="Introduction" value={quote.intro} onChange={intro => set({ intro })} placeholder="A short personal note to the customer" />
      </Card>

      <Card title="Scope of works">
        <LinesField
          label="One point per line"
          value={quote.scope}
          onChange={scope => set({ scope })}
          placeholder={"Protect floors and furniture throughout\nFill, sand and prime walls\nTwo finish coats to walls and ceilings"}
        />
      </Card>

      <Card title="Itemised works">
        <LineItemsEditor
          items={quote.works}
          onChange={works => set({ works })}
          addLabel="Add work item"
          placeholder="e.g. Lounge: walls and ceiling"
          subtotalLabel="Works"
        />
      </Card>

      <Card title="Materials">
        <LineItemsEditor
          items={quote.materials}
          onChange={materials => set({ materials })}
          addLabel="Add materials"
          placeholder="e.g. Trade emulsion, primers and fillers"
          subtotalLabel="Materials"
        />
        <TextArea
          label="Materials note"
          value={quote.materialsNote}
          onChange={materialsNote => set({ materialsNote })}
          rows={2}
          placeholder="Optional, e.g. paint colours to be confirmed before work begins"
        />
      </Card>

      <Card title="VAT and deposit">
        <VatControls vat={quote.vat} onChange={vat => set({ vat })} vatNumber={data.settings.vatNumber} />
        <hr className="adm-rule" />
        <DepositControls deposit={quote.deposit} onChange={deposit => set({ deposit })} depositPence={deposit} />
      </Card>

      <Card title="Totals">
        <TotalsSummary
          rows={[
            ["Works", totals.worksPence],
            ["Materials", totals.materialsPence],
            ...(quote.vat.enabled ? ([[`VAT at ${quote.vat.rate}%`, totals.vatPence]] as [string, number][]) : []),
            ["Total", totals.totalPence, "grand"],
            ...(deposit ? ([["Deposit requested", deposit, "muted"]] as [string, number, "muted"][]) : []),
          ]}
        />
      </Card>

      <Card title="Terms">
        <LinesField label="One term per line" value={quote.terms} onChange={terms => set({ terms })} hint="Defaults come from Settings." />
      </Card>

      <Card title="Private notes" tone="quiet">
        <TextArea label="Never shown to the customer" value={quote.internalNotes} onChange={internalNotes => set({ internalNotes })} rows={2} />
      </Card>

      <Card title="Next steps">
        <div className="adm-actions">
          <button type="button" className="adm-btn adm-btn-ghost" onClick={toInvoice}>
            <Icon name="invoice" size={18} /> {invoices.length ? "Create another invoice" : "Create invoice from quote"}
          </button>
          <Link className="adm-btn adm-btn-ghost" href={`/admin/diary?fromQuote=${id}`}>
            <Icon name="diary" size={18} /> Book into diary
          </Link>
          <button type="button" className="adm-btn adm-btn-ghost" onClick={duplicate}>
            <Icon name="copy" size={18} /> Duplicate
          </button>
        </div>
        {(invoices.length > 0 || bookings.length > 0) && (
          <ul className="adm-links">
            {invoices.map(inv => (
              <li key={inv.id}>
                <Link href={`/admin/invoices/${inv.id}`}>
                  <Icon name="invoice" size={16} /> Invoice {inv.number}
                </Link>
              </li>
            ))}
            {bookings.map(b => (
              <li key={b.id}>
                <Link href={`/admin/diary?date=${b.start}`}>
                  <Icon name="diary" size={16} /> Booked {formatShortDate(b.start)}
                  {b.end !== b.start && ` – ${formatShortDate(b.end)}`}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ShareControls id={id} />

      <div className="adm-danger-zone">
        <button type="button" className="adm-btn adm-btn-danger" onClick={remove}>
          <Icon name="trash" size={18} /> Delete quote
        </button>
      </div>

      <div className="adm-bottom-bar adm-chrome">
        <div>
          <small>{quote.vat.enabled ? "Total inc. VAT" : "Total"}</small>
          <strong>{formatPence(totals.totalPence)}</strong>
        </div>
        <Link className="adm-btn" href={`/admin/quotes/${id}/preview`}>
          <Icon name="eye" size={18} /> Preview
        </Link>
      </div>
    </div>
  );
}

