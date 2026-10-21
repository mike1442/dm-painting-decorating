"use client";
import Link from "./AdminLink";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CopyField } from "./CopyField";
import { TotalsSummary } from "./DocumentControls";
import { CustomerFields, Field, TextField } from "./fields";
import { Icon } from "./Icon";
import { Card, Loading, PageHead } from "./ui";
import { newId } from "@/lib/admin/factories";
import { documentTotals, formatPence } from "@/lib/admin/money";
import { createQuote } from "@/lib/admin/operations";
import { customerMatches, defaultTitle, parsePrice, quickQuoteInput, quickQuoteInstructions, withMatchedCustomer } from "@/lib/admin/quick-quote";
import type { QuickQuoteStart } from "@/lib/admin/quick-quote";
import { clock, commit, flush, getAdminState, useAdminState } from "@/lib/admin/store";
import type { Customer } from "@/lib/admin/types";

type Phase = "form" | "saving" | "failed";

const CONFLICT = "Another device changed D&M's records at the same moment, so nothing was overwritten. Your draft is kept on this page: use Backup to export it, then Reload cloud records and open the link again.";

/**
 * Admin → Quick quote. A link from ChatGPT (or Mike typing) fills in the form;
 * nothing is saved until Mike presses Save, and the editor opens only once the
 * draft has reached cloud storage. It never creates a customer link.
 */
export function QuickQuote({ start, id }: { start: QuickQuoteStart; id: string | null }) {
  const router = useRouter();
  const state = useAdminState();
  // The link's own ID, so reopening the same link finds this draft; otherwise a fresh one.
  const [quoteId] = useState(() => id ?? newId());
  const [customer, setCustomer] = useState<Customer>(start.customer);
  const [matchedFrom, setMatchedFrom] = useState("");
  const [title, setTitle] = useState(() => defaultTitle(start));
  const [lines, setLines] = useState(start.lines.join("\n"));
  const [total, setTotal] = useState(start.total);
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState("");
  if (!state) return <Loading />;

  const existing = state.data.quotes.find(q => q.id === quoteId);
  if (phase === "form" && existing) {
    return (
      <div className="adm-editor">
        <PageHead back={{ href: "/admin/quotes", label: "Quotes" }} title="Quick quote" />
        <Card title="Already saved">
          <p>
            This link was saved as quotation <strong>{existing.number}</strong> for {existing.customer.name || "the customer"},{" "}
            {formatPence(documentTotals(existing).totalPence)}. Opening the link again doesn&apos;t make another copy.
          </p>
          <div className="adm-actions">
            <Link className="adm-btn" href={`/admin/quotes/${existing.id}`}>
              <Icon name="quote" size={18} /> Open quotation {existing.number}
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const price = parsePrice(total);
  const vat = { enabled: state.data.settings.vatRegistered, rate: state.data.settings.defaultVatRate };
  const totals = documentTotals({ works: [{ id: "preview", description: title, quantity: 1, unit: "job", unitPrice: price ?? 0 }], materials: [], vat });
  const matches = matchedFrom ? [] : customerMatches(state.data, customer.name, start.test);
  const missing = [
    !customer.name.trim() && "the customer's name",
    !title.trim() && "a job title",
    price === null && "the price before VAT",
  ].filter((item): item is string => Boolean(item));
  const blocked = state.persistence === "conflict";

  const finish = async () => {
    setPhase("saving");
    setError("");
    const saved = await flush();
    const current = getAdminState();
    if (saved && current?.data.quotes.some(q => q.id === quoteId)) {
      // Replace, so Back from the editor does not return to this form.
      router.replace(`/admin/quotes/${quoteId}`);
      return;
    }
    setPhase("failed");
    setError(current?.persistence === "conflict" ? CONFLICT : current?.message || "Cloud storage did not confirm the save. Check your signal and try again.");
  };
  const save = () => {
    if (missing.length || price === null || blocked || phase !== "form") return;
    const input = quickQuoteInput({ customer, title, lines: lines.split(/\r?\n/), price, test: start.test, fromLink: start.fromLink }, quoteId);
    commit(d => (d.quotes.some(q => q.id === quoteId) ? d : createQuote(d, clock(), input).data), { immediate: true });
    void finish();
  };

  if (phase !== "form") {
    return (
      <div className="adm-editor">
        <PageHead back={{ href: "/admin/quotes", label: "Quotes" }} title="Quick quote" />
        <Card title={phase === "saving" ? "Saving the draft" : "Not saved yet"}>
          <p>
            <strong>{title}</strong> for {customer.name}, {formatPence(totals.totalPence)}.
          </p>
          {phase === "saving" ? (
            <p className="adm-muted" role="status">Saving to D&amp;M&apos;s cloud records…</p>
          ) : (
            <>
              <p className="adm-inline-error" role="alert">The draft quotation has not been saved. {error}</p>
              <div className="adm-actions">
                <button type="button" className="adm-btn" onClick={() => void finish()}>
                  Try saving again
                </button>
              </div>
            </>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="adm-editor">
      <PageHead
        back={{ href: "/admin/quotes", label: "Quotes" }}
        title="Quick quote"
        subtitle={start.fromLink ? <span className="adm-chip adm-chip-muted">From ChatGPT</span> : undefined}
      />
      <p className="adm-muted">Check the details, then save a draft. Nothing is sent to the customer and no customer link is made.</p>
      {start.test && (
        <p className="adm-inline-warn">Test quotation: it gets a TEST number, is marked as a test document and must never be sent to a customer.</p>
      )}

      <Card title="Customer">
        {matches.length > 0 && (
          <div className="adm-stack">
            <p className="adm-small adm-muted">Already a customer? Use their saved details:</p>
            <div className="adm-choices">
              {matches.map(match => (
                <button
                  key={match.key}
                  type="button"
                  className="adm-choice"
                  onClick={() => {
                    setCustomer(withMatchedCustomer(customer, match.customer));
                    setMatchedFrom(match.from);
                  }}
                >
                  <Icon name="check" size={20} />
                  <span>
                    <strong>{match.customer.name}</strong>
                    <small>
                      {[[match.customer.address.line1, match.customer.address.town, match.customer.address.postcode].filter(Boolean).join(", "), match.customer.phone]
                        .filter(Boolean)
                        .join(" · ") || "No address saved"}{" "}
                      · from {match.from}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {matchedFrom && <p className="adm-inline-ok" role="status">Using the details saved with {matchedFrom}. Check them below.</p>}
        <CustomerFields
          value={customer}
          onChange={next => {
            if (next.name !== customer.name) setMatchedFrom("");
            setCustomer(next);
          }}
        />
      </Card>

      <Card title="Quotation">
        <TextField label="Job title" value={title} onChange={setTitle} placeholder="e.g. Lounge and hallway redecoration" />
        <Field label="Work to include" hint="One point per line. Shown to the customer as the scope of works.">
          {control => <textarea {...control} className="adm-input adm-textarea" rows={4} value={lines} onChange={e => setLines(e.target.value)} />}
        </Field>
        <Field label="Price before VAT">
          {control => (
            <span className="adm-affix">
              <span className="adm-affix-text" id={`${control.id}prefix`}>£</span>
              <input
                {...control}
                aria-describedby={`${control.id}prefix`}
                className="adm-input"
                inputMode="decimal"
                autoComplete="off"
                placeholder="e.g. 1250"
                value={total}
                onChange={e => setTotal(e.target.value)}
              />
            </span>
          )}
        </Field>
        {total.trim() !== "" && price === null && (
          <p className="adm-inline-warn" role="alert">Enter the price in pounds and pence, for example 1250 or 1250.50.</p>
        )}
      </Card>

      <Card title="Totals">
        <TotalsSummary
          rows={[
            ["Price before VAT", totals.subtotalPence],
            ...(vat.enabled ? ([[`VAT at ${vat.rate}%`, totals.vatPence]] as [string, number][]) : []),
            ["Total", totals.totalPence, "grand"],
          ]}
        />
        <p className="adm-muted adm-small">
          {vat.enabled ? `VAT at ${vat.rate}% is added, as set in Settings.` : "No VAT is charged, as set in Settings."} After saving you can change VAT,
          add materials, itemise prices and create the customer link when you are ready.
        </p>
      </Card>

      {blocked && <p className="adm-inline-warn" role="alert">{CONFLICT}</p>}
      <div className="adm-actions">
        <button type="button" className="adm-btn adm-btn-wide" disabled={missing.length > 0 || blocked} onClick={save}>
          <Icon name="check" size={18} /> Save draft quotation
        </button>
      </div>
      {missing.length > 0 && <p className="adm-muted adm-small">To save, add {missing.join(", ").replace(/, ([^,]*)$/, " and $1")}.</p>}

      <Card tone="quiet">
        <details className="adm-small">
          <summary>Set up ChatGPT to send Quick quote links</summary>
          <ol className="adm-steps">
            <li>Copy the instructions below.</li>
            <li>In the ChatGPT app, open Settings → Personalisation → Custom instructions and paste them into “Anything else ChatGPT should know”. Save.</li>
            <li>Ask ChatGPT, for example: “Quote John Smith, 12 Mill Lane, Lymm, WA13 9SD: £1,250 for the lounge and hallway, two coats.” Tap the link it gives you, check the details here and save.</li>
          </ol>
          <CopyField label="Instructions for ChatGPT" value={quickQuoteInstructions(typeof window === "undefined" ? "" : window.location.origin)} multiline />
        </details>
      </Card>
    </div>
  );
}
