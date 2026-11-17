import type { Metadata } from "next";
import "./globals.css";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "D&M Painting & Decorating | The Difference Is in the Preparation",
  description: "Premium painting and decorating with a meticulous approach to preparation, detail and finish. Enquire about your next project.",
  metadataBase: new URL(site.url),
  robots: { index: true, follow: true },
};
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="en-GB"><body>{children}</body></html>;
}
