import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { areas, services, bySlug } from "@/lib/seo-content";
import { areaPlanning, relatedAreaSlugs } from "@/lib/seo-details";
import { SeoLayout, PageIntro } from "@/components/SeoLayout";
import { publicMetadata } from "@/lib/site";
type P = { params: Promise<{ slug: string }> };
export function generateStaticParams() { return areas.map(a => ({ slug: a.slug })); }
export async function generateMetadata({ params }: P): Promise<Metadata> {
  const a = bySlug(areas, (await params).slug);
  return a ? publicMetadata(`/areas/${a.slug}`, `Painters & Decorators in ${a.name} | D&M`, a.intro) : {};
}
export default async function Page({ params }: P) {
  const a = bySlug(areas, (await params).slug);
  if (!a) notFound();
  const nearby = relatedAreaSlugs(a.slug).map(slug => bySlug(areas, slug)).filter(x => x !== undefined);
  const planning = areaPlanning[a.slug];
  return <SeoLayout breadcrumbs={[{ name: "Areas we cover", path: "/areas" }, { name: a.name, path: `/areas/${a.slug}` }]}>
    <PageIntro kicker="AREAS WE COVER" title={`Painting & decorating in ${a.name}`} description={a.intro}/>
    <section className="seo-article"><div>
      <h2>Prepared properly. Finished with care.</h2><p>{a.detail}</p>
      <p>Our approach starts with understanding the surfaces, the finish you want and how the work fits around your home. We discuss protection, preparation, suitable coatings and any access requirements before agreeing the scope.</p>
      <h2>What we can help with</h2><p>{a.focus}. Explore the services below for what to include in your enquiry and what can affect the quote.</p>
      <div className="seo-link-list">{services.map(s => <Link href={`/services/${s.slug}`} key={s.slug}>{s.name} ↗</Link>)}</div>
      {planning && <section><h2>{planning[0]}</h2><p>{planning[1]}</p></section>}
      <h2>Before arranging your decorating</h2>
      <p>Send your postcode, the rooms or exterior surfaces involved, and photographs of both the overall space and any damage. Mention old wallpaper, flaking paint or ceiling stains, as these can change the preparation needed. Let us know about parking, access and your preferred dates.</p>
      <p>We confirm availability and whether a visit is needed before agreeing the work. The quote should identify the surfaces and preparation included; repairs or extra rooms can be discussed separately. Start with our <Link className="under-link" href="/guides/why-preparation-matters">guide to preparation</Link> if you are unsure why surface condition matters.</p>
      <h2>Discuss your project in {a.name}</h2><p>Tell us what you would like to change and we will discuss the next step.</p>
      <Link className="seo-cta" href="/contact">Request a decorating quote ↗</Link>
    </div><aside><h3>Other areas we cover</h3>{nearby.map(x => <Link href={`/areas/${x.slug}`} key={x.slug}>{x.name} ↗</Link>)}<Link href="/areas">All locations →</Link></aside></section>
  </SeoLayout>;
}
