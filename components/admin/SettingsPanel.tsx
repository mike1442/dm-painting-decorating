"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BackupPanel } from "./BackupPanel";
import { AddressFields, LinesField, NumberField, TextArea, TextField, Toggle } from "./fields";
import { Card, Loading, PageHead, SaveStatus } from "./ui";
import { formatDocNumber } from "@/lib/admin/factories";
import { billGatesTestInvoice } from "@/lib/admin/fixtures";
import { clock, commit, flush, useAdminState } from "@/lib/admin/store";
import type { BusinessSettings } from "@/lib/admin/types";

export function SettingsPanel() {
  const router = useRouter();
  const [creatingTest, setCreatingTest] = useState(false);
  const state = useAdminState();
  if (!state) return <Loading />;
  const s = state.data.settings;
  const set = (change: Partial<BusinessSettings>) => commit(d => ({ ...d, settings: { ...d.settings, ...change } }));
  const whole = (n: number, min: number, max: number) => Math.min(Math.max(Math.round(n), min), max);

  return (
    <div className="adm-page adm-editor">
      <PageHead title="Settings" subtitle={<SaveStatus persistence={state.persistence} />} />

      <BackupPanel data={state.data} />

      <Card title="Test invoice">
        <p className="adm-muted adm-small">Bill Gates: two painters, three days each at £250 per day, plus £180 materials. £1,680 before optional VAT. Clearly marked as a test; no payment is due.</p>
        <button type="button" className="adm-btn adm-btn-ghost" disabled={creatingTest} onClick={async () => {
          setCreatingTest(true);
          const existing = state.data.invoices.find(invoice => invoice.isTest && invoice.customer.name === "Bill Gates" && invoice.title === "Painting a 20m² wall");
          const invoice = existing ?? billGatesTestInvoice(clock());
          if (!existing) commit(data => ({ ...data, invoices: [invoice, ...data.invoices] }), { immediate: true });
          if (await flush()) router.push(`/admin/invoices/${invoice.id}`);
          setCreatingTest(false);
        }}>{creatingTest ? "Saving test…" : "Open or create test invoice"}</button>
      </Card>

      <Card title="Business details">
        <p className="adm-muted adm-small">Printed on every quotation and invoice.</p>
        <div className="adm-grid">
          <TextField label="Business name" className="adm-span-2" value={s.businessName} onChange={businessName => set({ businessName })} />
          <TextField label="Phone" type="tel" value={s.phone} onChange={phone => set({ phone })} />
          <TextField label="Email" type="email" value={s.email} onChange={email => set({ email })} />
          <TextField label="Website" className="adm-span-2" value={s.website} onChange={website => set({ website })} />
        </div>
        <AddressFields value={s.address} onChange={address => set({ address })} />
        <div className="adm-grid">
          <TextField label="VAT registration number" value={s.vatNumber} onChange={vatNumber => set({ vatNumber })} placeholder="Only if registered" />
          <TextField label="Company number" value={s.companyNumber} onChange={companyNumber => set({ companyNumber })} placeholder="Only if a limited company" />
        </div>
      </Card>

      <Card title="VAT">
        <div className="adm-stack">
          <Toggle
            label="Turn VAT on for new documents"
            hint="Leave off unless D&M is VAT registered. Each quote and invoice can still be changed individually."
            checked={s.vatRegistered}
            onChange={vatRegistered => set({ vatRegistered })}
          />
          <NumberField
            label="VAT rate used when VAT is turned on"
            suffix="%"
            value={s.defaultVatRate}
            onChange={rate => set({ defaultVatRate: Math.min(Math.max(rate, 0), 100) })}
            className="adm-narrow"
          />
        </div>
      </Card>

      <Card title="Getting paid">
        <div className="adm-grid">
          <TextField label="Bank account name" className="adm-span-2" value={s.bank.accountName} onChange={accountName => set({ bank: { ...s.bank, accountName } })} autoComplete="off" />
          <TextField label="Sort code" inputMode="numeric" value={s.bank.sortCode} onChange={sortCode => set({ bank: { ...s.bank, sortCode } })} placeholder="00-00-00" autoComplete="off" />
          <TextField label="Account number" inputMode="numeric" value={s.bank.accountNumber} onChange={accountNumber => set({ bank: { ...s.bank, accountNumber } })} autoComplete="off" />
          <NumberField label="Payment terms" suffix="days" value={s.paymentTermsDays} onChange={n => set({ paymentTermsDays: whole(n, 0, 365) })} />
        </div>
        <TextArea label="Note on invoices" value={s.defaultPaymentNote} onChange={defaultPaymentNote => set({ defaultPaymentNote })} rows={2} />
        <p className="adm-muted adm-small">Used for new invoices. Existing invoices keep the details they were created with.</p>
      </Card>

      <Card title="Quotations">
        <NumberField label="Quotes are valid for" suffix="days" value={s.quoteValidityDays} onChange={n => set({ quoteValidityDays: whole(n, 1, 365) })} className="adm-narrow" />
        <TextArea label="Standard introduction" value={s.defaultQuoteIntro} onChange={defaultQuoteIntro => set({ defaultQuoteIntro })} />
        <LinesField label="Standard terms, one per line" value={s.defaultTerms} onChange={defaultTerms => set({ defaultTerms })} hint="Starting suggestions only. Review them before sending quotes." />
      </Card>

      <Card title="Numbering">
        <div className="adm-grid">
          <TextField label="Quote prefix" value={s.quotePrefix} onChange={quotePrefix => set({ quotePrefix })} />
          <NumberField label="Next quote number" value={s.nextQuoteNumber} onChange={n => set({ nextQuoteNumber: whole(n, 1, 999999) })} hint={`Next: ${formatDocNumber(s.quotePrefix, s.nextQuoteNumber)}`} />
          <TextField label="Invoice prefix" value={s.invoicePrefix} onChange={invoicePrefix => set({ invoicePrefix })} />
          <NumberField label="Next invoice number" value={s.nextInvoiceNumber} onChange={n => set({ nextInvoiceNumber: whole(n, 1, 999999) })} hint={`Next: ${formatDocNumber(s.invoicePrefix, s.nextInvoiceNumber)}`} />
        </div>
        <p className="adm-muted adm-small">Continue from your existing paperwork. Numbers are allocated securely when records are saved.</p>
      </Card>
    </div>
  );
}

