import type { Metadata } from "next";

export const site = {
  url: "https://www.dmpaintingdecorating.co.uk",
  name: "D&M Painting & Decorating",
  phone: "+447449255082",
  email: "info@dmpaintingdecorating.co.uk",
};

// Set canonicals on individual public routes, never on the root layout:
// an inherited homepage canonical would collapse distinct service/area pages.
export function publicMetadata(path: string, title: string, description: string): Metadata {
  return {
    title, description,
    alternates: { canonical: path },
    openGraph: { type: "website", locale: "en_GB", siteName: site.name, url: path, title, description },
    twitter: { card: "summary", title, description },
  };
}
