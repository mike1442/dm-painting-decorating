import Link from "next/link";import type{Metadata}from "next";import{notFound}from "next/navigation";import{services,guides,areaHubs,childAreas,bySlug}from "@/lib/seo-content";import{pageMetadata,serviceJsonLd}from "@/lib/seo";import{SeoLayout,PageIntro,FaqList,EnquiryPanel,JsonLd,homeCrumb}from "@/components/SeoLayout";
type P={params:Promise<{slug:string}>};
export function generateStaticParams(){return services.map(s=>({slug:s.slug}))}
export async function generateMetadata({params}:P):Promise<Metadata>{const s=bySlug(services,(await params).slug);return s?pageMetadata({title:s.metaTitle,description:s.metaDescription,path:`/services/${s.slug}`}):{};}
export default async function Page({params}:P){const s=bySlug(services,(await params).slug);if(!s)notFound();
const related=s.guides.map(g=>bySlug(guides,g)!);const others=services.filter(x=>x.slug!==s.slug);
return <SeoLayout><JsonLd data={serviceJsonLd(s)}/><PageIntro crumbs={[homeCrumb,{name:"Services",path:"/services"},{name:s.name,path:`/services/${s.slug}`}]} kicker="WARRINGTON · CHESHIRE · SOUTH MANCHESTER" title={s.h1} description={s.intro}/><section className="seo-article"><div>
<h2>What&apos;s included</h2><div className="seo-points">{s.included.map(c=><div key={c.title}><h3>{c.title}</h3><p>{c.text}</p></div>)}</div>
<h2>Our approach</h2>{s.approach.map(p=><p key={p}>{p}</p>)}
{s.projects&&<><h2>Typical projects</h2><div className="seo-steps">{s.projects.map(p=><p key={p}>✓ {p}</p>)}</div></>}
<h2>Preparation advice</h2><div className="seo-link-list">{related.map(g=><Link href={`/guides/${g.slug}`} key={g.slug}>{g.title} ↗</Link>)}</div>
<h2>Where we offer {s.name.toLowerCase()}</h2><div className="seo-area-groups">{areaHubs.map(h=><div key={h.slug}><h3><Link href={`/areas/${h.slug}`}>{h.region?.title}</Link></h3><div className="seo-link-list">{childAreas(h.slug).map(a=><Link href={`/areas/${a.slug}`} key={a.slug}>{a.name} ↗</Link>)}</div></div>)}</div>
<FaqList title={`${s.name}: common questions`} faqs={s.faqs}/>
<EnquiryPanel title="Planning a project?" text="Tell us what needs decorating, the approximate scope and where the property is. We can then discuss the next steps without making assumptions about the condition of the surfaces."/>
</div><aside><h3>Other services</h3>{others.map(x=><Link href={`/services/${x.slug}`} key={x.slug}>{x.h1} ↗</Link>)}<Link href="/services">All services →</Link><h3>Where we work</h3><Link href="/areas">Areas we cover →</Link></aside></section></SeoLayout>}
