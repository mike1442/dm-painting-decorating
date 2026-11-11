import type { MetadataRoute } from "next";
import { areas, services, guides } from "@/lib/seo-content";
import { SITE } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    "/",
    "/services",
    "/areas",
    "/guides",
    "/contact",
    "/room-designer",
    ...services.map((s) => `/services/${s.slug}`),
    ...areas.map((a) => `/areas/${a.slug}`),
    ...guides.map((g) => `/guides/${g.slug}`),
  ];
  return paths.map((path) => ({ url: SITE.url + path }));
}
