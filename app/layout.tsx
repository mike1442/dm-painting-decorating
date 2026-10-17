import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "D&M Painting & Decorating | The Difference Is in the Preparation", description: "Premium painting and decorating with a meticulous approach to preparation, detail and finish. Enquire about your next project.", metadataBase: new URL("https://www.dmpaintingdecorating.co.uk"), alternates: { canonical: "/" }, robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) { return <html lang="en"><body>{children}</body></html> }
