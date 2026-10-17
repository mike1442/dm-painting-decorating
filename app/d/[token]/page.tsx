import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvoiceDocument } from "@/components/documents/InvoiceDocument";
import { QuoteDocument } from "@/components/documents/QuoteDocument";
import { PrintButton } from "@/components/documents/PrintButton";
import { publicRpc } from "@/lib/server/supabase";
import type { BusinessSettings, Invoice, Quote } from "@/lib/admin/types";
import "./shared-document.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Your document · D&M Painting & Decorating",
  description: "Your private quotation or invoice from D&M Painting & Decorating.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false, noimageindex: true } },
  referrer: "no-referrer",
  alternates: { canonical: null },
};

export default async function SharedDocumentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();

  const shared = await publicRpc("dm_get_shared_document", { p_token: token }) as {
    document: Quote | Invoice;
    business: BusinessSettings;
  } | null;
  if (!shared || !shared.document || !["quote", "invoice"].includes(shared.document.kind)) notFound();

  // These templates render on the server. The browser receives only the
  // document HTML; the print control receives no customer or admin data.
  return (
    <main className="dm-shared-document">
      <div className="dm-shared-toolbar">
        <span>D&amp;M Painting &amp; Decorating</span>
        <PrintButton />
      </div>
      <div className="dm-shared-paper">
        {shared.document.kind === "quote"
          ? <QuoteDocument quote={shared.document} business={shared.business} />
          : <InvoiceDocument invoice={shared.document} business={shared.business} />}
      </div>
    </main>
  );
}
