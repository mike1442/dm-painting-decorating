import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { services, areas, guides, bySlug } from "@/lib/seo-content";
import { serviceDetails } from "@/lib/seo-details";
import { SeoLayout, PageIntro } from "@/components/SeoLayout";
import { JsonLd } from "@/components/SeoStructuredData";
import { publicMetadata, site } from "@/lib/site";
type P = { params: Promise<{ slug: string }> };
export function generateStaticParams() { return services.map(s => ({ slug: s.slug })); }
export async function generateMetadata({ params }: P): Promise<Metadata> {
  const s = bySlug(services, (await params).slug);
  return s ? publicMetadata(`/services/${s.slug}`, `${s.name} in Wigan, Leigh & Warrington | D&M`, serviceDetails[s.slug].description) : {};
}
export default async function Page({ params }: P) {
  const s = bySlug(services, (await params).slug);
  if (!s) notFound();
  const detail = serviceDetails[s.slug];
  const relatedGuides = guides.filter(g => detail.guides.includes(g.slug));
  return <SeoLayout breadcrumbs={[{ name: "Services", path: "/services" }, { name: s.name, path: `/services/${s.slug}` }]}>
    <JsonLd data={{ "@context": "https://schema.org", "@type": "Service", "@id": `${site.url}/services/${s.slug}#service`, name: s.name,
      description: detail.description, url: `${site.url}/services/${s.slug}`, provider: { "@id": `${site.url}/#business` },
      areaServed: areas.map(a => ({ "@type": "Place", name: a.name })) }}/>
    <PageIntro kicker="WHAT WE DO" title={s.name} description={s.intro}/>
    <section className="seo-article"><div>
      <p>Available in <Link className="under-link" href="/areas/wigan">Wigan</Link>, <Link className="under-link" href="/areas/leigh">Leigh</Link> and <Link className="under-link" href="/areas/warrington">Warrington</Link>, with selected projects in our wider working area.</p>
      <h2>Our approach</h2><div className="seo-steps">{s.points.map(p => <p key={p}>✓ {p}</p>)}</div>
      {detail.sections.map(([h, p]) => <section key={h}><h2>{h}</h2><p>{p}</p></section>)}
      <h2>Before you book</h2>{detail.questions.map(([q, a]) => <section key={q}><h3>{q}</h3><p>{a}</p></section>)}
      <Link className="seo-cta" href="/contact">Discuss your project ↗</Link>
      <h2>Advice for this project</h2><div className="seo-link-list">{relatedGuides.map(g => <Link href={`/guides/${g.slug}`} key={g.slug}>{g.title} ↗</Link>)}</div>
      <h2>Other decorating services</h2><div className="seo-link-list">{services.filter(x => x.slug !== s.slug).map(x => <Link key={x.slug} href={`/services/${x.slug}`}>{x.name} ↗</Link>)}</div>
    </div><aside><h3>Where we work</h3>{areas.map(a => <Link href={`/areas/${a.slug}`} key={a.slug}>{a.name} ↗</Link>)}<Link href="/areas">View all areas →</Link></aside></section>
  </SeoLayout>;
}
