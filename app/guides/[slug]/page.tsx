import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { guides, services, bySlug } from "@/lib/seo-content";
import { guideServices } from "@/lib/seo-details";
import { SeoLayout, PageIntro } from "@/components/SeoLayout";
import { publicMetadata } from "@/lib/site";
type P = { params: Promise<{ slug: string }> };
export function generateStaticParams() { return guides.map(g => ({ slug: g.slug })); }
export async function generateMetadata({ params }: P): Promise<Metadata> {
  const g = bySlug(guides, (await params).slug);
  return g ? publicMetadata(`/guides/${g.slug}`, `${g.title} | D&M Decorating Guides`, g.intro) : {};
}
export default async function Page({ params }: P) {
  const g = bySlug(guides, (await params).slug);
  if (!g) notFound();
  const related = services.filter(s => guideServices[g.slug].includes(s.slug));
  return <SeoLayout breadcrumbs={[{ name: "Guides", path: "/guides" }, { name: g.title, path: `/guides/${g.slug}` }]}>
    <PageIntro kicker="DECORATING ADVICE" title={g.title} description={g.intro}/>
    <section className="seo-article"><div>{g.sections.map(([h, p]) => <section key={h}><h2>{h}</h2><p>{p}</p></section>)}
      <h2>Putting this into practice</h2><p>For help with the work, explore {related.map((s, i) => <span key={s.slug}>{i > 0 ? " or " : ""}<Link className="under-link" href={`/services/${s.slug}`}>{s.name.toLowerCase()}</Link></span>)}. Send a photograph of the whole area and a close-up of any damaged surfaces when requesting a quote.</p>
      <h2>Need a hand with your project?</h2><p>D&amp;M works in Wigan, Leigh and Warrington, with selected projects across Cheshire and South Manchester. Every property is different, so preparation and the final scope need assessing for your home.</p>
      <Link className="seo-cta" href="/contact">Discuss your project ↗</Link>
    </div><aside><h3>Related services</h3>{related.map(s => <Link href={`/services/${s.slug}`} key={s.slug}>{s.name} ↗</Link>)}<Link href="/guides">All guides →</Link></aside></section>
  </SeoLayout>;
}
