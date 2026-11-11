import type { Metadata } from "next";
import { SITE } from "./site.ts";
import { areas, services } from "./seo-content.ts";

export type Crumb = { name: string; path: string };

// Every public page gets its own canonical, Open Graph and Twitter tags. Next
// replaces (not merges) openGraph per page, so the shared fields live here.
export function pageMetadata({ title, description, path }: { title: string; description: string; path: string }): Metadata {
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", locale: "en_GB", siteName: SITE.name, url: path, title, description, images: [SITE.ogImage] },
    twitter: { card: "summary_large_image", title, description, images: [SITE.ogImage.url] },
  };
}

const absolute = (path: string) => SITE.url + (path === "/" ? "/" : path);
const businessId = SITE.url + "/#business";

export function businessJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "HousePainter",
    "@id": businessId,
    name: SITE.name,
    url: SITE.url + "/",
    logo: SITE.url + "/dm-logo.svg",
    image: SITE.url + SITE.ogImage.url,
    email: SITE.email,
    ...(SITE.phone ? { telephone: SITE.phone } : {}),
    slogan: SITE.tagline,
    description: "Preparation-led painting and decorating for homes in Warrington, Cheshire and South Manchester.",
    areaServed: areas.map(a => ({ "@type": "Place", name: a.placeName, url: absolute(`/areas/${a.slug}`) })),
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Painting and decorating services",
      itemListElement: services.map(s => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: s.h1, url: absolute(`/services/${s.slug}`) } })),
    },
  };
}

export function websiteJsonLd() {
  return { "@context": "https://schema.org", "@type": "WebSite", "@id": SITE.url + "/#website", name: SITE.name, alternateName: "D&M Painting and Decorating", url: SITE.url + "/", publisher: { "@id": businessId } };
}

export function serviceJsonLd(service: { slug: string; h1: string; intro: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: service.h1,
    serviceType: service.h1,
    description: service.intro,
    url: absolute(`/services/${service.slug}`),
    provider: { "@type": "HousePainter", "@id": businessId, name: SITE.name, url: SITE.url + "/" },
    areaServed: areas.map(a => ({ "@type": "Place", name: a.placeName })),
  };
}

export function breadcrumbJsonLd(crumbs: Crumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: absolute(c.path) })),
  };
}
