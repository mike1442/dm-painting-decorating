import type { Metadata } from "next";
import { DocumentPreview } from "@/components/admin/DocumentPreview";

export const metadata: Metadata = { title: "Invoice preview" };

export default async function InvoicePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DocumentPreview kind="invoice" id={id} />;
}
