"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TotalsSummary, VatControls } from "./DocumentControls";
import { CustomerFields, DateField, LinesField, NumberField, SelectField, TextArea, TextField } from "./fields";
import { Icon } from "./Icon";
import { LineItemsEditor, UnitSuggestions } from "./LineItemsEditor";
import { Card, CustomerLinkNotice, Loading, NotFound, PageHead, SaveStatus, StateChip } from "./ui";
import { paymentMethodLabels } from "@/components/documents/InvoiceDocument";
import { addDays, formatShortDate } from "@/lib/admin/dates";
import { newId } from "@/lib/admin/factories";
import { depositPence, documentTotals, formatPence, invoiceTotals } from "@/lib/admin/money";
import { deleteInvoice, updateInvoice } from "@/lib/admin/operations";
import { invoiceState } from "@/lib/admin/status";
import { clock, commit, useAdminState } from "@/lib/admin/store";
import type { Invoice, InvoiceStatus, Payment, PaymentMethod } from "@/lib/admin/types";

const statusOptions: [InvoiceStatus, string][] = [
  ["draft", "Draft"],
  ["sent", "Sent to customer"],
];
const methodOptions = Object.entries(paymentMethodLabels) as [PaymentMethod, string][];

export function InvoiceEditor({ id }: { id: string }) {
  const router = useRouter();
  const state = useAdminState();
  const [leaving, setLeaving] = useState(false);
  if (!state || leaving) return <Loading />;
  const { data } = state;
  const invoice = data.invoices.find(i => i.id === id);
  if (!invoice) return <NotFound kind="invoice" href="/admin/invoices" />;

  const today = clock().today;
  const set = (change: Partial<Invoice>) => commit(d => updateInvoice(d, id, i => ({ ...i, ...change }), clock().now));
  const totals = invoiceTotals(invoice);
  const quote = invoice.quoteId ? data.quotes.find(q => q.id === invoice.quoteId) : undefined;
  const requestedDeposit = quote ? depositPence(documentTotals(quote).totalPence, quote.deposit) : 0;
  const bookings = data.bookings.filter(b => b.invoiceId === id);

  const setPayment = (paymentId: string, change: Partial<Payment>) =>
    set({ payments: invoice.payments.map(p => (p.id === paymentId ? { ...p, ...change } : p)) });
  const addPayment = (fields: Partial<Payment> = {}) =>
    set({ payments: [...invoice.payments, { id: newId(), date: today, amount: 0, method: "bank-transfer", label: "", ...fields }] });
  const remove = () => {
    if (!window.confirm(`Delete invoice ${invoice.number}? This can't be undone.`)) return;
    setLeaving(true);
    commit(d => deleteInvoice(d, id), { immediate: true });
    router.replace("/admin/invoices");
  };

  return (
    <div className="adm-editor">
      <UnitSuggestions />
      <PageHead
        back={{ href: "/admin/invoices", label: "Invoices" }}
        title={invoice.title || "New invoice"}
        subtitle={
          <>
            <span>{invoice.number}</span>
            <StateChip state={invoiceState(invoice, today)} />
            <SaveStatus persistence={state.persistence} />
          </>
        }
      />

      {invoice.quoteId && (
        <p className="adm-from">
          <Icon name="link" size={16} /> Created from quote{" "}
          {quote ? <Link href={`/admin/quotes/${quote.id}`}>{invoice.quoteNumber}</Link> : invoice.quoteNumber}. Changes here don&apos;t
          alter the quote.
        </p>
      )}

      <Card title="Customer">
        <CustomerFields value={invoice.customer} onChange={customer => set({ customer })} />
      </Card>

      <Card title="Invoice details">
        <div className="adm-grid">
          <TextField label="Job title" className="adm-span-2" value={invoice.title} onChange={title => set({ title })} placeholder="e.g. Lounge and hallway redecoration" />
          <TextField label="Invoice number" value={invoice.number} onChange={number => set({ number })} />
          <SelectField label="Status" value={invoice.status} options={statusOptions} onChange={status => set({ status })} />
          <DateField label="Invoice date" value={invoice.issueDate} onChange={issueDate => set({ issueDate, dueDate: addDays(issueDate, data.settings.paymentTermsDays) })} />
          <DateField label="Payment due" value={invoice.dueDate} onChange={dueDate => set({ dueDate })} />
          <TextField label="Quotation reference" className="adm-span-2" value={invoice.quoteNumber} onChange={quoteNumber => set({ quoteNumber })} placeholder="Optional" />
        </div>
      </Card>

      <Card title="Work carried out">
        <LinesField label="One point per line (optional)" value={invoice.scope} onChange={scope => set({ scope })} />
      </Card>

      <Card title="Itemised works">
        <LineItemsEditor items={invoice.works} onChange={works => set({ works })} addLabel="Add work item" placeholder="e.g. Lounge: walls and ceiling" subtotalLabel="Works" />
      </Card>

      <Card title="Materials">
        <LineItemsEditor items={invoice.materials} onChange={materials => set({ materials })} addLabel="Add materials" placeholder="e.g. Trade emulsion, primers and fillers" subtotalLabel="Materials" />
        <TextArea label="Materials note" value={invoice.materialsNote} onChange={materialsNote => set({ materialsNote })} rows={2} placeholder="Optional" />
      </Card>

      <Card title="VAT">
        <VatControls vat={invoice.vat} onChange={vat => set({ vat })} vatNumber={data.settings.vatNumber} />
      </Card>

      <Card title="Deposits and payments received">
        {requestedDeposit > 0 && !invoice.payments.length && (
          <div className="adm-hint-box">
            <span>
              Quote {invoice.quoteNumber} asked for a deposit of <strong>{formatPence(requestedDeposit)}</strong>. Record it here once
              received.
            </span>
            <button type="button" className="adm-btn adm-btn-ghost adm-btn-small" onClick={() => addPayment({ amount: requestedDeposit / 100, label: "Deposit received" })}>
              Add deposit
            </button>
          </div>
        )}
        <div className="adm-payments">
          {invoice.payments.map((payment, index) => (
            <div className="adm-payment" key={payment.id}>
              <DateField label="Date" value={payment.date} onChange={date => setPayment(payment.id, { date })} />
              <NumberField label="Amount" prefix="£" decimals={2} placeholder="0.00" value={payment.amount} onChange={amount => setPayment(payment.id, { amount })} />
              <SelectField label="Method" value={payment.method} options={methodOptions} onChange={method => setPayment(payment.id, { method })} />
              <TextField label="Shown as" value={payment.label} onChange={label => setPayment(payment.id, { label })} placeholder="e.g. Deposit received" />
              <button
                type="button"
                className="adm-icon-btn adm-danger"
                onClick={() => set({ payments: invoice.payments.filter(p => p.id !== payment.id) })}
                aria-label={`Remove payment ${index + 1}`}
              >
                <Icon name="trash" size={18} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="adm-btn adm-btn-ghost" onClick={() => addPayment()}>
          <Icon name="plus" size={18} /> Record a payment or deposit
        </button>
      </Card>

      <Card title="Totals">
        <TotalsSummary
          rows={[
            ["Works", totals.worksPence],
            ["Materials", totals.materialsPence],
            ...(invoice.vat.enabled ? ([[`VAT at ${invoice.vat.rate}%`, totals.vatPence]] as [string, number][]) : []),
            ["Invoice total", totals.totalPence],
            ["Received", totals.paidPence, "muted"],
            ["Balance due", totals.balancePence, "grand"],
          ]}
        />
      </Card>

      <Card title="Payment details">
        <div className="adm-grid">
          <TextField label="Account name" className="adm-span-2" value={invoice.bank.accountName} onChange={accountName => set({ bank: { ...invoice.bank, accountName } })} autoComplete="off" />
          <TextField label="Sort code" inputMode="numeric" value={invoice.bank.sortCode} onChange={sortCode => set({ bank: { ...invoice.bank, sortCode } })} autoComplete="off" placeholder="00-00-00" />
          <TextField label="Account number" inputMode="numeric" value={invoice.bank.accountNumber} onChange={accountNumber => set({ bank: { ...invoice.bank, accountNumber } })} autoComplete="off" />
        </div>
        <TextArea label="Note on invoice" value={invoice.paymentNote} onChange={paymentNote => set({ paymentNote })} rows={2} />
        <p className="adm-muted adm-small">Bank details are copied from Settings when the invoice is created.</p>
      </Card>

      <Card title="Private notes" tone="quiet">
        <TextArea label="Never shown to the customer" value={invoice.internalNotes} onChange={internalNotes => set({ internalNotes })} rows={2} />
      </Card>

      <Card title="Diary">
        <div className="adm-actions">
          <Link className="adm-btn adm-btn-ghost" href={`/admin/diary?fromInvoice=${id}`}>
            <Icon name="diary" size={18} /> Book into diary
          </Link>
        </div>
        {bookings.length > 0 && (
          <ul className="adm-links">
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

      <CustomerLinkNotice kind="invoice" />

      <div className="adm-danger-zone">
        <button type="button" className="adm-btn adm-btn-danger" onClick={remove}>
          <Icon name="trash" size={18} /> Delete invoice
        </button>
      </div>

      <div className="adm-bottom-bar adm-chrome">
        <div>
          <small>Balance due</small>
          <strong>{formatPence(totals.balancePence)}</strong>
        </div>
        <Link className="adm-btn" href={`/admin/invoices/${id}/preview`}>
          <Icon name="eye" size={18} /> Preview
        </Link>
      </div>
    </div>
  );
}
