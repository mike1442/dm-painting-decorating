import type { Metadata } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import { SITE } from "@/lib/site";
import "./globals.css";

// Self-hosted at build time: no render-blocking request to Google Fonts and
// size-adjusted fallbacks, so text doesn't shift when the fonts arrive.
const body = DM_Sans({ subsets: ["latin"], display: "swap", variable: "--font-body" });
const display = Manrope({ subsets: ["latin"], display: "swap", variable: "--font-display" });

export const metadata: Metadata = {
  title: "D&M Painting & Decorating | The Difference Is in the Preparation",
  description: "Premium painting and decorating with a meticulous approach to preparation, detail and finish. Enquire about your next project.",
  metadataBase: new URL(SITE.url),
  robots: { index: true, follow: true },
  openGraph: { type: "website", locale: "en_GB", siteName: SITE.name, images: [SITE.ogImage] },
};
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="en-GB" className={`${body.variable} ${display.variable}`}><body>{children}</body></html>;
}
