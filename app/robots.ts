import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = "https://www.dmpaintingdecorating.co.uk";
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: base + "/sitemap.xml",
    host: base,
  };
}
