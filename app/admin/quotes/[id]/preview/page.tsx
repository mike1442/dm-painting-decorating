import type { Metadata } from "next";
import { DocumentPreview } from "@/components/admin/DocumentPreview";

export const metadata: Metadata = { title: "Quotation preview" };

export default async function QuotePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DocumentPreview kind="quote" id={id} />;
}
