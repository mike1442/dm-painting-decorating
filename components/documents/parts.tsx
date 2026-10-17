import "./documents.css";
import { BrandLogo } from "./BrandLogo";
import { formatPence, formatQuantity, lineTotalPence, toPence } from "@/lib/admin/money";
import type { Address, BusinessSettings, Customer, LineItem } from "@/lib/admin/types";

// Building blocks shared by the quotation and invoice templates. They are
// plain server-safe components so a future customer link page can render them.

export const addressLines = (a: Address) => [a.line1, a.line2, a.town, a.postcode].map(s => s.trim()).filter(Boolean);

export function Paper({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <article className="dmdoc" aria-label={label}>
      {/* The empty header and footer rows repeat on every printed page, giving each page a margin. */}
      <table className="dmdoc-frame" role="presentation">
        <thead>
          <tr>
            <td className="dmdoc-frame-space" />
          </tr>
        </thead>
        <tfoot>
          <tr>
            <td className="dmdoc-frame-space" />
          </tr>
        </tfoot>
        <tbody>
          <tr>
            <td>
              <div className="dmdoc-body">{children}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </article>
  );
}

export function DocHeader({ kind, number }: { kind: string; number: string }) {
  return (
    <header className="dmdoc-head">
      <BrandLogo tone="ink" className="dmdoc-logo" />
      <div className="dmdoc-kind">
        <h1>{kind}</h1>
        {number && <p>No. {number}</p>}
      </div>
    </header>
  );
}

export function TestDocumentNotice() {
  return <p className="dmdoc-test-notice">Test document · Not issued · No payment required</p>;
}

export function Party({ heading, customer }: { heading: string; customer: Customer }) {
  const contact = [customer.email ?? "", customer.phone ?? ""].map(s => s.trim()).filter(Boolean);
  return (
    <div className="dmdoc-party">
      <p className="dmdoc-label">{heading}</p>
      {customer.name && <strong>{customer.name}</strong>}
      {addressLines(customer.address).map(line => (
        <span key={line}>{line}</span>
      ))}
      {contact.length > 0 && <span className="dmdoc-party-contact">{contact.join("  ·  ")}</span>}
    </div>
  );
}

export function Meta({ items }: { items: [string, string][] }) {
  return (
    <dl className="dmdoc-meta">
      {items
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <div key={label}>
            <dt className="dmdoc-label">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
}

export function Intro({ title, text }: { title: string; text: string }) {
  if (!title && !text.trim()) return null;
  return (
    <div className="dmdoc-intro">
      {title && <h2>{title}</h2>}
      {text.trim() && <p>{text.trim()}</p>}
    </div>
  );
}

export function Section({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section className="dmdoc-section">
      <div className="dmdoc-section-head">
        <h3>{title}</h3>
        {aside && <span>{aside}</span>}
      </div>
      {children}
    </section>
  );
}

export function ScopeList({ title, points }: { title: string; points: string[] }) {
  if (!points.length) return null;
  return (
    <Section title={title}>
      <ol className="dmdoc-scope">
        {points.map((point, i) => (
          <li key={i}>{point}</li>
        ))}
      </ol>
    </Section>
  );
}

export function ItemsTable({ title, items, subtotalLabel, subtotalPence, note }: {
  title: string;
  items: LineItem[];
  subtotalLabel: string;
  subtotalPence: number;
  note?: string;
}) {
  const rows = items.filter(item => item.description.trim() || item.unitPrice);
  if (!rows.length) return null;
  return (
    <Section title={title}>
      <table className="dmdoc-items">
        <thead>
          <tr>
            <th scope="col">Description</th>
            <th scope="col" className="dmdoc-num">Qty</th>
            <th scope="col" className="dmdoc-num">Rate</th>
            <th scope="col" className="dmdoc-num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(item => (
            <tr key={item.id}>
              <td className="dmdoc-desc">{item.description}</td>
              <td className="dmdoc-num dmdoc-qty">
                {formatQuantity(item.quantity)}
                {item.unit && ` ${item.unit}`}
              </td>
              <td className="dmdoc-num dmdoc-rate">{formatPence(toPence(item.unitPrice))}</td>
              <td className="dmdoc-num dmdoc-amount">{formatPence(lineTotalPence(item))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>{subtotalLabel}</td>
            <td className="dmdoc-num">{formatPence(subtotalPence)}</td>
          </tr>
        </tfoot>
      </table>
      {note?.trim() && <p className="dmdoc-note">{note.trim()}</p>}
    </Section>
  );
}

export type TotalRow = { label: string; pence: number; tone?: "grand" | "minus" | "highlight" | "balance" };

export function Totals({ rows, stamp }: { rows: TotalRow[]; stamp?: string }) {
  return (
    <div className="dmdoc-totals-wrap">
      {stamp && <p className="dmdoc-stamp">{stamp}</p>}
      <div className="dmdoc-totals">
        {rows.map(row => (
          <div key={row.label} className={row.tone ? `dmdoc-total-${row.tone}` : undefined}>
            <span>{row.label}</span>
            <strong>{row.tone === "minus" ? `−${formatPence(row.pence)}` : formatPence(row.pence)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Terms({ title, terms }: { title: string; terms: string[] }) {
  if (!terms.length) return null;
  return (
    <Section title={title}>
      <ol className="dmdoc-terms">
        {terms.map((term, i) => (
          <li key={i}>{term}</li>
        ))}
      </ol>
    </Section>
  );
}

export function BusinessFooter({ business }: { business: BusinessSettings }) {
  const contact = [business.phone, business.email, business.website].map(s => s.trim()).filter(Boolean);
  const legal = [
    business.vatNumber.trim() && `VAT reg. no. ${business.vatNumber.trim()}`,
    business.companyNumber.trim() && `Company no. ${business.companyNumber.trim()}`,
  ].filter(Boolean);
  return (
    <footer className="dmdoc-foot">
      <div>
        <strong>{business.businessName}</strong>
        <span>{addressLines(business.address).join(", ")}</span>
      </div>
      <div>
        {contact.map(item => (
          <span key={item}>{item}</span>
        ))}
      </div>
      <div className="dmdoc-foot-end">
        {legal.map(item => (
          <span key={item as string}>{item}</span>
        ))}
        <em>The difference is in the preparation.</em>
      </div>
    </footer>
  );
}

