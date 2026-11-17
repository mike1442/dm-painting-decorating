import type { MetadataRoute } from "next";
import { site } from "@/lib/site";
import { areas, services, guides } from "@/lib/seo-content";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = site.url;
  const paths = [
    "/",
    "/areas",
    "/services",
    "/guides",
    "/contact",
    "/room-designer",
    ...areas.map((a) => `/areas/${a.slug}`),
    ...services.map((s) => `/services/${s.slug}`),
    ...guides.map((g) => `/guides/${g.slug}`),
  ];
  return paths.map((path) => ({ url: base + path }));
}
