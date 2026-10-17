import type { Metadata, Viewport } from "next";
import "./admin.css";
import { AdminShell } from "@/components/admin/AdminShell";

export const metadata: Metadata = {
  title: { default: "D&M Admin", template: "%s · D&M Admin" },
  description: "Private administration for D&M Painting & Decorating.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false, noimageindex: true } },
  alternates: { canonical: null },
  referrer: "no-referrer",
};

export const viewport: Viewport = { themeColor: "#0c141a", viewportFit: "cover" };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
