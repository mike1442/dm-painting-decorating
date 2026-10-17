import type { Metadata } from "next";
import { QuoteEditor } from "@/components/admin/QuoteEditor";

export const metadata: Metadata = { title: "Edit quote" };

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuoteEditor id={id} />;
}
