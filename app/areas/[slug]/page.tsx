import Link from "next/link";import type{Metadata}from "next";import{notFound}from "next/navigation";import{areas,services,guides,childAreas,bySlug}from "@/lib/seo-content";import{pageMetadata}from "@/lib/seo";import{SeoLayout,PageIntro,FaqList,EnquiryPanel,areaCrumbs}from "@/components/SeoLayout";
type P={params:Promise<{slug:string}>};
export function generateStaticParams(){return areas.map(a=>({slug:a.slug}))}
export async function generateMetadata({params}:P):Promise<Metadata>{const a=bySlug(areas,(await params).slug);return a?pageMetadata({title:a.metaTitle,description:a.metaDescription,path:`/areas/${a.slug}`}):{};}
export default async function Page({params}:P){const a=bySlug(areas,(await params).slug);if(!a)notFound();
const parent=a.parent?bySlug(areas,a.parent):undefined;const children=childAreas(a.slug);const guide=bySlug(guides,a.guide)!;const nearby=a.nearby.map(s=>bySlug(areas,s)!);
return <SeoLayout><PageIntro crumbs={areaCrumbs(a.slug)} kicker={a.label} title={`Painters & decorators in ${a.name}`} description={a.intro}/><section className="seo-article"><div>
<h2>Decorating homes in {a.name}</h2>{a.homes.map(p=><p key={p}>{p}</p>)}<p>{a.detail}</p>
<h2>What to consider</h2><div className="seo-points">{a.considerations.map(c=><div key={c.title}><h3>{c.title}</h3><p>{c.text}</p></div>)}</div>
{children.length>0&&<><h2>Areas around {a.name}</h2><div className="seo-link-cards">{children.map(c=><Link href={`/areas/${c.slug}`} key={c.slug}><b>{c.name} ↗</b><span>{c.intro}</span></Link>)}</div></>}
<h2>Decorating services in {a.name}</h2><p>{a.focus}. Explore the services below and the preparation behind them.</p><div className="seo-link-cards">{services.map(s=><Link href={`/services/${s.slug}`} key={s.slug}><b>{s.h1} ↗</b><span>{s.short}</span></Link>)}</div>
<p className="seo-guide-note">Helpful reading for {a.name} homes: <Link href={`/guides/${guide.slug}`}>{guide.title}</Link></p>
<FaqList title={`Decorating in ${a.name}: common questions`} faqs={a.faqs}/>
<EnquiryPanel title={`Planning decorating in ${a.name}?`} text="Tell us the location, rooms involved and the condition of the existing surfaces. We'll confirm whether your project is within our current working area."/>
</div><aside>{parent&&<><h3>Part of our {parent.name} area</h3><Link href={`/areas/${parent.slug}`}>Painters & decorators in {parent.name} ↗</Link></>}<h3>Nearby areas</h3>{nearby.map(x=><Link href={`/areas/${x.slug}`} key={x.slug}>{x.name} ↗</Link>)}<Link href="/areas">All areas we cover →</Link></aside></section></SeoLayout>}
