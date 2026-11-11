import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

// Only the private admin area is disallowed. Customer document links and the
// login page stay crawlable so their noindex headers are seen, and the
// ChatGPT OAuth/MCP endpoints are left untouched.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/admin"] },
    sitemap: SITE.url + "/sitemap.xml",
  };
}
