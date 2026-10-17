"use client";
import Link from "next/link";
import { useEffect } from "react";
import { Icon } from "./Icon";
import { Loading, NotFound } from "./ui";
import { InvoiceDocument } from "@/components/documents/InvoiceDocument";
import { QuoteDocument } from "@/components/documents/QuoteDocument";
import { updateInvoice, updateQuote } from "@/lib/admin/operations";
import { clock, commit, useAdminState } from "@/lib/admin/store";

export function DocumentPreview({ kind, id }: { kind: "quote" | "invoice"; id: string }) {
  const state = useAdminState();
  const doc = kind === "quote" ? state?.data.quotes.find(q => q.id === id) : state?.data.invoices.find(i => i.id === id);
  const name = kind === "quote" ? "Quotation" : "Invoice";
  // The browser uses the page title as the suggested PDF file name.
  const fileTitle = doc ? [`D&M ${name} ${doc.number}`, doc.customer.name].filter(Boolean).join(" – ") : "";

  useEffect(() => {
    if (!fileTitle) return;
    const previous = document.title;
    document.title = fileTitle;
    return () => {
      document.title = previous;
    };
  }, [fileTitle]);

  if (!state) return <Loading />;
  if (!doc) return <NotFound kind={kind} href={`/admin/${kind}s`} />;

  const markSent = () =>
    commit(d =>
      doc.kind === "quote"
        ? updateQuote(d, id, q => ({ ...q, status: "sent" }), clock().now)
        : updateInvoice(d, id, i => ({ ...i, status: "sent" }), clock().now),
    );

  return (
    <div className="adm-preview">
      <div className="adm-preview-bar adm-chrome">
        <Link className="adm-btn adm-btn-ghost" href={`/admin/${kind}s/${id}`}>
          <Icon name="back" size={18} /> Edit
        </Link>
        <button type="button" className="adm-btn" onClick={() => window.print()}>
          <Icon name="print" size={18} /> Print / Save PDF
        </button>
      </div>
      <p className="adm-preview-note adm-chrome">
        <Icon name="device" size={16} />
        <span>
          Private preview. Only signed-in D&amp;M admins can open this page, so don&apos;t send its address to a customer. Choose{" "}
          <strong>Print / Save PDF</strong> and send the PDF instead.
        </span>
      </p>
      {doc.status === "draft" && (
        <div className="adm-preview-status adm-chrome">
          <span>Still a draft. Mark it as sent once the PDF is with the customer.</span>
          <button type="button" className="adm-btn adm-btn-ghost adm-btn-small" onClick={markSent}>
            <Icon name="check" size={16} /> Mark as sent
          </button>
        </div>
      )}
      <div className="adm-paper">
        {doc.kind === "quote" ? (
          <QuoteDocument quote={doc} business={state.data.settings} />
        ) : (
          <InvoiceDocument invoice={doc} business={state.data.settings} />
        )}
      </div>
    </div>
  );
}
