import type { Metadata } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import "./globals.css";
import { site } from "@/lib/site";
import VercelInsights from "@/components/VercelInsights";

// Self-hosted at build time: no render-blocking request to Google Fonts.
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: "D&M Painting & Decorating | The Difference Is in the Preparation",
  description: "Premium painting and decorating with a meticulous approach to preparation, detail and finish. Enquire about your next project.",
  metadataBase: new URL(site.url),
  robots: { index: true, follow: true },
};
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="en-GB" className={`${dmSans.variable} ${manrope.variable}`}><body>{children}<VercelInsights /></body></html>;
}
