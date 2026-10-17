import type { Metadata } from "next";
import { InvoiceList } from "@/components/admin/InvoiceList";

export const metadata: Metadata = { title: "Invoices" };

export default function InvoicesPage() {
  return <InvoiceList />;
}
