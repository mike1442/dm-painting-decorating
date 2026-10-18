import type { MetadataRoute } from "next";
import { areas, services, guides } from "@/lib/seo-content";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://www.dmpaintingdecorating.co.uk";
  const paths = [
    "/",
    "/areas",
    "/services",
    "/guides",
    "/contact",
    ...areas.map((a) => `/areas/${a.slug}`),
    ...services.map((s) => `/services/${s.slug}`),
    ...guides.map((g) => `/guides/${g.slug}`),
  ];
  return paths.map((path) => ({ url: base + path }));
}
