import type { Metadata } from "next";
import { QuoteList } from "@/components/admin/QuoteList";

export const metadata: Metadata = { title: "Quotes" };

export default function QuotesPage() {
  return <QuoteList />;
}
