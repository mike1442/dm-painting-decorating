import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const base = site.url;
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: base + "/sitemap.xml",
    host: base,
  };
}
