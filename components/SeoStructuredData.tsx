import Link from "next/link";
import { areas } from "@/lib/seo-content";
import { site } from "@/lib/site";

export type Crumb = { name: string; path: string };
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
export function BusinessStructuredData() {
  return <JsonLd data={{ "@context": "https://schema.org", "@graph": [
    { "@type": "HousePainter", "@id": `${site.url}/#business`, name: site.name, url: site.url,
      telephone: site.phone, email: site.email, logo: `${site.url}/dm-logo.svg`,
      areaServed: areas.map(a => ({ "@type": "Place", name: a.name })) },
    { "@type": "WebSite", "@id": `${site.url}/#website`, url: site.url, name: site.name,
      publisher: { "@id": `${site.url}/#business` }, inLanguage: "en-GB" },
  ] }} />;
}
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const crumbs = [{ name: "Home", path: "/" }, ...items];
  return <>
    <nav className="seo-breadcrumbs" aria-label="Breadcrumb"><ol>{crumbs.map((c, i) => <li key={c.path}>
      {i === crumbs.length - 1 ? <span aria-current="page">{c.name}</span> : <Link href={c.path}>{c.name}</Link>}
    </li>)}</ol></nav>
    <JsonLd data={{ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem", position: i + 1, name: c.name, item: site.url + c.path,
    })) }} />
  </>;
}
