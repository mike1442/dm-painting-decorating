import Link from "next/link";
import { publicMetadata } from "@/lib/site";
import { coverageAreas } from "@/lib/coverage";
import { areas } from "@/lib/seo-content";
import { SeoLayout, PageIntro } from "@/components/SeoLayout";
export const metadata = publicMetadata("/areas", "Areas We Cover | D&M Painting & Decorating", "Decorating for homes, landlords and businesses across Cheshire, Manchester, Altrincham, Wilmslow, Wigan, Leigh, Culcheth, Golborne, Haydock and Lymm.");
export default function Page() {
  return <SeoLayout breadcrumbs={[{ name: "Areas we cover", path: "/areas" }]}>
    <PageIntro kicker="WHERE WE WORK" title="Areas we cover" description="Painting and decorating for homeowners, landlords, agents and businesses. Tell us the location and work involved; we discuss access, preparation and availability before agreeing a quote."/>
    <section className="seo-article"><div><h2>Our working area</h2>
      <p>We welcome enquiries across the areas below, from individual rooms to whole properties and commercial work. There is no minimum job value to enquire.</p>
      <ul className="coverage-list">{coverageAreas.map(name => { const area = areas.find(a => a.name === name); return <li key={name}>{area ? <Link href={`/areas/${area.slug}`}>{name} ↗</Link> : name}</li>; })}</ul>
      <p>Send your postcode, photographs and the surfaces you want decorated. Travel and access can be discussed as part of the quote, rather than imposing a minimum project size.</p>
      <Link className="seo-cta" href="/contact">Tell us about your project ↗</Link>
    </div><aside><h3>Plan the work</h3><Link href="/services">Decorating services ↗</Link><Link href="/services#commercial-decorating">Commercial decorating ↗</Link><Link href="/services#landlord-decorating">Landlord &amp; agent work ↗</Link></aside></section>
    <section className="seo-grid" aria-label="Explore our existing area guides">{areas.map(a => <Link className="seo-tile" href={`/areas/${a.slug}`} key={a.slug}><span>PAINTING &amp; DECORATING</span><h2>{a.name}</h2><p>{a.intro}</p><b>Explore area ↗</b></Link>)}</section>
  </SeoLayout>;
}
