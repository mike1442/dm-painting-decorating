import assert from "node:assert/strict";
import { test } from "node:test";
import { areaHubs, areas, childAreas, guides, services } from "../../lib/seo-content.ts";
import { breadcrumbJsonLd, businessJsonLd, pageMetadata, serviceJsonLd } from "../../lib/seo.ts";
import { SITE, telHref, whatsappHref } from "../../lib/site.ts";

const areaSlugs = new Set(areas.map(a => a.slug));
const guideSlugs = new Set(guides.map(g => g.slug));
const serviceSlugs = new Set(services.map(s => s.slug));

test("every location page sits in the hub-and-spoke structure with real neighbours", () => {
  assert.deepEqual(areaHubs.map(a => a.slug), ["warrington", "south-manchester"]);
  for (const hub of areaHubs) {
    assert.ok(hub.region, `${hub.slug} needs a region heading for /areas`);
    assert.ok(childAreas(hub.slug).length > 0, `${hub.slug} hub has no spokes`);
  }
  for (const area of areas) {
    if (area.parent) assert.ok(areaHubs.some(h => h.slug === area.parent), `${area.slug} parent must be a hub`);
    assert.ok(area.nearby.length >= 2, `${area.slug} needs nearby areas`);
    for (const slug of area.nearby) {
      assert.ok(areaSlugs.has(slug), `${area.slug} links to unknown area ${slug}`);
      assert.notEqual(slug, area.slug);
    }
    assert.ok(guideSlugs.has(area.guide), `${area.slug} links to unknown guide ${area.guide}`);
    assert.ok(area.considerations.length >= 3 && area.faqs.length >= 2, `${area.slug} is too thin`);
  }
});

test("services and guides cross-link to pages that exist", () => {
  for (const service of services) for (const slug of service.guides) assert.ok(guideSlugs.has(slug), `${service.slug} -> ${slug}`);
  for (const guide of guides) {
    assert.ok(guide.services.length > 0, `${guide.slug} has no related service`);
    for (const slug of guide.services) assert.ok(serviceSlugs.has(slug), `${guide.slug} -> ${slug}`);
  }
});

test("titles and descriptions are unique and fit in search results", () => {
  const pages = [...areas, ...services];
  for (const key of ["metaTitle", "metaDescription"] as const) {
    const values = pages.map(p => p[key]);
    assert.equal(new Set(values).size, values.length, `duplicate ${key}`);
  }
  for (const page of pages) {
    assert.ok(page.metaTitle.length <= 60, `${page.slug} title is ${page.metaTitle.length} characters`);
    assert.ok(page.metaDescription.length >= 90 && page.metaDescription.length <= 160, `${page.slug} description is ${page.metaDescription.length} characters`);
  }
});

test("public copy makes no unverified business claims", () => {
  const copy = JSON.stringify([areas, services, guides]);
  const claims = [/free (quote|estimate|survey)/i, /fully insured/i, /\bguaranteed\b|\bwe guarantee\b/i, /years'? (of )?experience/i, /award/i, /accredit/i, /\b(customer|client|google|five-star) reviews?\b/i, /\b5[- ]star/i, /checkatrade|trustatrader|which\? trusted/i, /\bcertified\b/i];
  for (const claim of claims) assert.ok(!claim.test(copy), `unverified claim matches ${claim}: "${copy.match(claim)?.[0]}"`);
});

test("public copy talks about decorating, not property types", () => {
  const copy = JSON.stringify([areas, services, guides]);
  const propertyTalk = /\b(victorian|edwardian|georgian|terraced?|terraces|semis?|semi-detached|villas?|cottages?|detached|bungalows?|new-builds?|interwar|post-war|1930s|period (homes?|propert(y|ies))|older (homes|houses|propert(y|ies)))\b/i;
  assert.ok(!propertyTalk.test(copy), `property-type copy found: "${copy.match(propertyTalk)?.[0]}"`);
});

test("page metadata gives each page its own canonical and social preview", () => {
  const meta = pageMetadata({ title: "T", description: "D", path: "/areas/lymm" });
  assert.equal(meta.alternates?.canonical, "/areas/lymm");
  assert.deepEqual(meta.title, { absolute: "T" });
  assert.equal((meta.openGraph as { url?: string }).url, "/areas/lymm");
  assert.deepEqual((meta.openGraph as { images?: unknown }).images, [SITE.ogImage]);
});

test("structured data describes the business without inventing contact details", () => {
  const business = businessJsonLd();
  assert.equal(business["@type"], "HousePainter");
  assert.equal(business.email, SITE.email);
  assert.equal("telephone" in business, Boolean(SITE.phone));
  assert.equal("address" in business, false);
  assert.equal(business.areaServed.length, areas.length);
  assert.equal(business.hasOfferCatalog.itemListElement.length, services.length);
  const service = serviceJsonLd(services[0]);
  assert.equal(service.provider["@id"], business["@id"]);
  const crumbs = breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Areas we cover", path: "/areas" }]);
  assert.deepEqual(crumbs.itemListElement.map(i => [i.position, i.item]), [[1, SITE.url + "/"], [2, SITE.url + "/areas"]]);
});

test("contact links use international formats", () => {
  assert.equal(telHref("01925 000 000"), "tel:+441925000000");
  assert.equal(telHref("+44 7449 255082"), "tel:+447449255082");
  assert.match(whatsappHref, /^https:\/\/wa\.me\/447449255082\?text=/);
});
