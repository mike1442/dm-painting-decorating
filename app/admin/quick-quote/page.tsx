import { createHash } from "node:crypto";
import type { Metadata } from "next";
import { QuickQuote } from "@/components/admin/QuickQuote";
import { quickQuoteFingerprint, quickQuoteId, readQuickQuoteParams } from "@/lib/admin/quick-quote";
import type { QuickQuoteParams } from "@/lib/admin/quick-quote";

export const metadata: Metadata = { title: "Quick quote" };

export default async function QuickQuotePage({ searchParams }: { searchParams: Promise<QuickQuoteParams> }) {
  const start = readQuickQuoteParams(await searchParams);
  // The same link always means the same draft, so opening it twice cannot make a second quote.
  const id = start.fromLink ? quickQuoteId(createHash("sha256").update(quickQuoteFingerprint(start)).digest("hex")) : null;
  return <QuickQuote start={start} id={id} />;
}
