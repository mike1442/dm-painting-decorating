import type { Metadata } from "next";
import { InvoiceEditor } from "@/components/admin/InvoiceEditor";

export const metadata: Metadata = { title: "Edit invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvoiceEditor id={id} />;
}
