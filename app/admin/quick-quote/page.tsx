import type { Metadata } from "next";
import { QuickQuote } from "./QuickQuote";

export const metadata: Metadata = { title: "Quick quotation | D&M Admin" };

export default async function Page({ searchParams }: {
  searchParams: Promise<{ for?: string; total?: string; add?: string }>
}) {
  const params = await searchParams;
  return <QuickQuote initialName={(params.for ?? "").slice(0, 120)}
    initialAmount={(params.total ?? "").slice(0, 24)}
    initialDescription={(params.add ?? "").slice(0, 500)} />;
}
