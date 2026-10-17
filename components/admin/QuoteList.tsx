"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "./Icon";
import { Empty, Loading, PageHead, Sheet, StateChip } from "./ui";
import { chatGptInstructions, parseQuoteJson } from "@/lib/admin/chatgpt";
import { formatShortDate } from "@/lib/admin/dates";
import { documentTotals, formatPence } from "@/lib/admin/money";
import { createQuote } from "@/lib/admin/operations";
import type { QuoteInput } from "@/lib/admin/operations";
import { quoteState } from "@/lib/admin/status";
import { errorMessage } from "@/lib/admin/repository";
import { allocateNumber, clock, commit, useAdminState } from "@/lib/admin/store";

export function matchesSearch(query: string, ...fields: string[]) {
  const q = query.trim().toLowerCase();
  return !q || fields.some(field => field.toLowerCase().includes(q));
}

export function QuoteList() {
  const router = useRouter();
  const state = useAdminState();
  const [query, setQuery] = useState("");
  const [sheet, setSheet] = useState<"closed" | "choose" | "chatgpt">("closed");
  const [pasted, setPasted] = useState("");
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  if (!state) return <Loading />;

  const today = clock().today;
  const quotes = state.data.quotes
    .filter(q => matchesSearch(query, q.number, q.title, q.customer.name, q.customer.address.town, q.customer.address.postcode))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const parsed = pasted.trim() ? parseQuoteJson(pasted, state.data.settings.defaultVatRate) : null;

  const create = async (input?: QuoteInput) => {
    setCreating(true);
    setCreateError("");
    try {
      const number = await allocateNumber("quote");
      let quoteId = "";
      commit(
        d => {
          const created = createQuote(d, clock(), input, number);
          quoteId = created.quote.id;
          return created.data;
        },
        { immediate: true },
      );
      router.push(`/admin/quotes/${quoteId}`);
    } catch (error) {
      setCreateError(`Couldn't create the quote. ${errorMessage(error)}`);
    } finally {
      setCreating(false);
    }
  };
  const createErrorNote = createError && <p className="adm-inline-error">{createError}</p>;
  const copyInstructions = async () => {
    try {
      await navigator.clipboard.writeText(chatGptInstructions);
      setCopied(true);
    } catch {
      window.prompt("Copy these instructions into ChatGPT:", chatGptInstructions);
    }
  };

  return (
    <div className="adm-page">
      <PageHead
        title="Quotes"
        subtitle={`${state.data.quotes.length} saved`}
        action={
          <button type="button" className="adm-btn" onClick={() => setSheet("choose")}>
            <Icon name="plus" size={18} /> New quote
          </button>
        }
      />
      {state.data.quotes.length > 0 && (
        <label className="adm-search">
          <Icon name="search" size={18} />
          <input type="search" placeholder="Search name, job, postcode or number" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search quotes" />
        </label>
      )}
      {state.data.quotes.length === 0 ? (
        <Empty icon="quote" title="No quotes yet">
          <p>Create a quotation from scratch, or paste one prepared in ChatGPT.</p>
          <button type="button" className="adm-btn" onClick={() => setSheet("choose")}>
            <Icon name="plus" size={18} /> New quote
          </button>
        </Empty>
      ) : (
        <ul className="adm-list">
          {quotes.map(quote => (
            <li key={quote.id}>
              <Link href={`/admin/quotes/${quote.id}`} className="adm-item">
                <div className="adm-item-top">
                  <span className="adm-item-ref">{quote.number}</span>
                  <StateChip state={quoteState(quote, today)} />
                </div>
                <strong className="adm-item-title">{quote.title || "Untitled quote"}</strong>
                <div className="adm-item-meta">
                  <span>{[quote.customer.name, quote.customer.address.town].filter(Boolean).join(" · ") || "No customer yet"}</span>
                  <span>{formatShortDate(quote.issueDate)}</span>
                </div>
                <span className="adm-item-amount">{formatPence(documentTotals(quote).totalPence)}</span>
              </Link>
            </li>
          ))}
          {quotes.length === 0 && <li className="adm-muted adm-pad">No quotes match “{query}”.</li>}
        </ul>
      )}

      <Sheet open={sheet === "choose"} onClose={() => setSheet("closed")} title="New quote">
        <div className="adm-choices">
          <button type="button" className="adm-choice" onClick={() => create()} disabled={creating}>
            <Icon name="quote" size={24} />
            <span>
              <strong>Blank quotation</strong>
              <small>Start with your standard intro and terms.</small>
            </span>
          </button>
          <button type="button" className="adm-choice" onClick={() => setSheet("chatgpt")}>
            <Icon name="spark" size={24} />
            <span>
              <strong>Paste from ChatGPT</strong>
              <small>Turn a ChatGPT conversation into a D&amp;M quotation.</small>
            </span>
          </button>
        </div>
        {createErrorNote}
      </Sheet>

      <Sheet
        open={sheet === "chatgpt"}
        onClose={() => setSheet("closed")}
        title="Paste from ChatGPT"
        actions={
          <button type="button" className="adm-btn adm-btn-wide" disabled={!parsed?.ok || creating} onClick={() => parsed?.ok && create(parsed.input)}>
            {creating ? "Creating…" : "Create draft quote"}
          </button>
        }
      >
        <ol className="adm-steps">
          <li>
            <span>Copy the D&amp;M instructions and paste them into your ChatGPT conversation about the job.</span>
            <button type="button" className="adm-btn adm-btn-ghost adm-btn-small" onClick={copyInstructions}>
              <Icon name={copied ? "check" : "copy"} size={16} /> {copied ? "Copied" : "Copy instructions"}
            </button>
          </li>
          <li>Ask ChatGPT for the quote JSON and copy its reply.</li>
          <li>Paste the reply below. It becomes a draft quote that you can check before sending.</li>
        </ol>
        <label className="adm-field">
          <span className="adm-field-label">ChatGPT reply</span>
          <textarea className="adm-input adm-textarea adm-code" rows={8} value={pasted} onChange={e => setPasted(e.target.value)} placeholder='{ "customer": { … }, "title": "…", "works": [ … ] }' />
        </label>
        {parsed && !parsed.ok && <p className="adm-inline-error">{parsed.error}</p>}
        {createErrorNote}
        {parsed?.ok && (
          <div className="adm-parse-ok">
            <p>
              <Icon name="check" size={16} /> Ready: <strong>{parsed.input.title || "Untitled"}</strong>
              {parsed.input.customer?.name && ` for ${parsed.input.customer.name}`} · {parsed.input.works?.length ?? 0} work items,{" "}
              {parsed.input.materials?.length ?? 0} materials
            </p>
            {parsed.warnings.map(w => (
              <p key={w} className="adm-inline-warn">
                {w}
              </p>
            ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}
