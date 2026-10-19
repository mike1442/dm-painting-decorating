# SEO audit: D&M Painting & Decorating

Audited 18–19 October 2026 against the live site (https://www.dmpaintingdecorating.co.uk) and the `main` branch at `b69ada6`. Fixes are in the `claude/dm-painting-seo-audit-qko54i` branch and have not been deployed.

**Method:** source review of every public route; a crawl of all 22 live URLs (status codes, redirects, titles, descriptions, canonicals, headings, links, schema and Open Graph data); mobile Lighthouse runs; 5-word-shingle duplicate-content analysis of the location pages; desktop (1440 px) and mobile (390 px) screenshots. The same crawl, Lighthouse and screenshot scripts were then run against a local production build of the fixed branch.

## Before and after

| Measure | Live site | This branch |
|---|---|---|
| Pages with a canonical tag | 1 of 22 | 24 of 24 |
| Pages with Open Graph / Twitter tags | 0 | 24 (with a branded 1200×630 share image) |
| Pages with structured data | 0 | 23 (HousePainter, WebSite, Service, BreadcrumbList) |
| Pages with visible breadcrumbs | 0 | 21 (all hubs, spokes and guides) |
| Pages in the sitemap / in the crawl | 21 / 22 (`/room-designer` missing) | 24 / 24 |
| Hubs more than one click from the homepage | `/services`, `/guides` (depth 2) | none |
| `/room-designer` internal links | 1 | 23 |
| Unique copy per location page | 39–48 words | 430–600 words in `<main>` |
| Unique copy per service page | 29–35 words | 420–470 words in `<main>` |
| Location page body overlap (mean 5-word shingles) | 42% | 14% |
| Homepage title mentions a location | No | Yes |
| Render-blocking third-party font request | Yes (Google Fonts `@import`) | No (self-hosted via `next/font`) |
| `/contact` Cumulative Layout Shift (mobile) | 0.209 (font swap) | 0 |
| Homepage mobile Lighthouse performance (3 runs) | 85–92, LCP 3.1–4.0 s | 92–96, LCP 2.5–2.7 s |
| `/areas/warrington` mobile performance | 87, FCP 2.9 s | 98, FCP 0.8 s |

Lighthouse simulates a throttled mobile connection, but the local build had no CDN in front of it, so treat the performance figures as directional and re-measure after deployment. Lighthouse SEO, accessibility and best-practice scores were 100 before and after.

## 1. What was already working

- HTTPS with HSTS, a single `www` host (all variants return 308 redirects), and trailing slashes normalised with 308s.
- Unknown URLs and slugs return real 404s.
- `robots.txt` and `sitemap.xml` are served and the sitemap is referenced.
- Every public page is `index, follow`. Private surfaces are correctly kept out of search: `/admin` has noindex metadata, and `/login`, `/d/*` and `/api/auth/*` send `X-Robots-Tag: noindex`.
- Every page had a unique title and description, and exactly one H1.
- URLs are clean and descriptive (`/services/…`, `/areas/…`, `/guides/…`), and pages are statically generated.
- No horizontal overflow on mobile. The contact form handles photos, a consent checkbox, a honeypot, idempotent retries, WhatsApp and email.
- The footer already linked every spoke page from every page.
- The copy was honest: stock photos are labelled as reference images and the service area is described as "selected" outside Warrington.

## 2. What was broken or weak

### High priority (all fixed in this branch)

1. **Location pages were thin and templated (doorway risk).** All nine area pages used one template with 39–48 unique words each (an intro, one sentence and a "focus" line). The rest was identical boilerplate, giving 42% average overlap between pages. Nothing on them was specific to the place.
2. **Service pages were thin.** Each had 29–35 unique words; "Our approach" and "Planning a project?" were identical on all four.
3. **The homepage didn't target the market.** The title was "D&M Painting & Decorating | The Difference Is in the Preparation" and the H1 was "Exceptional finishes. Nothing overlooked." Warrington appeared only in footer links. The page was a client component (`"use client"`), so it couldn't export its own metadata and hydrated in full.
4. **No canonical tags** except on `/contact`.
5. **No structured data anywhere:** no business entity, breadcrumbs, services or website name.
6. **No Open Graph or Twitter metadata,** so WhatsApp and Facebook shares had no image or controlled title.
7. **No real hub-and-spoke structure.**
   - All nine locations were flat siblings, although Stockton Heath, Grappenhall, Appleton and Lymm are in Warrington borough and Altrincham, Hale and Bowdon are in Trafford.
   - "Nearby areas" was simply the first eight other entries in array order. The South Manchester page listed Grappenhall and Appleton as "nearby".
   - There were no breadcrumbs, and spokes linked back to their hubs only through the generic navigation.
   - Service pages linked to every area, and area pages to every service, in identical sitewide blocks with no context.
   - The guides linked to all services rather than the relevant one.
8. **Hubs were buried.** `/services` and `/guides` were not linked from the homepage. The homepage service cards showed ↗ arrows but weren't links, and "What we do" only scrolled the page.
9. **`/room-designer` was nearly orphaned** (one inbound link) and missing from the sitemap.
10. **Calls to action took an extra click.** Spoke-page CTAs pointed to `/#contact`, a homepage section containing only another button to `/contact`.

### Medium priority (fixed)

- A render-blocking Google Fonts `@import` inside `globals.css` (page CSS → font CSS → font files). Lighthouse estimated 450–1,870 ms of savings, and the late font swap caused CLS 0.209 on `/contact`.
- Homepage mobile LCP was 3.6 s. The hero is a CSS background on images.unsplash.com and was discovered late, with no preload or preconnect.
- 98 KB of below-the-fold "Our work" images loaded eagerly as CSS backgrounds.
- The SEO pages had no `<main>` landmark.
- `robots.txt` used a Yandex-only `Host:` line and didn't disallow `/admin`.
- The 404 page was Next's bare default with no way back into the site.
- The page language was `lang="en"` rather than `en-GB`.

### Low priority / not code

- `http://dmpaintingdecorating.co.uk/` redirects in two hops (to https apex, then to www). This is a Vercel domain setting: point the apex directly at `https://www…`.
- The sitemap has no `lastmod`. That's fine; add it only if it can be kept accurate.
- The logo and brand SVGs trigger `@next/next/no-img-element` lint warnings. `next/image` gives no benefit for SVG, so these are left as they are.

## 3. What is missing (needs Mike — not invented)

These are deliberately **not** implemented, because each needs a business fact only Mike can confirm.

| Item | Why it matters | What's needed |
|---|---|---|
| A phone number customers can call | No `tel:` link exists anywhere. Click-to-call is a major local conversion route and part of NAP consistency. | Confirm a number, then set `SITE.phone` in `lib/site.ts`. Call links and schema `telephone` then appear automatically. |
| Google Business Profile | It's the biggest local-pack ranking factor. | Create or verify the profile as a service-area business, then use the same name, website and phone as the site. |
| Genuine reviews | Trust and local rankings. | Collect reviews on Google. Never add reviews or review schema that aren't real. |
| Real project photos | They replace the Unsplash placeholders (README to-do) and enable project and case-study content. | Mike's photos, with the location named only with the customer's consent. |
| Privacy policy | The contact form collects personal data and photos. | Written policy page (README to-do). |
| Search Console | Indexing, queries and cannibalisation monitoring. | Verify a **Domain** property via DNS, then submit `https://www.dmpaintingdecorating.co.uk/sitemap.xml`. |

### Possible new service pages (only if D&M offers them)

Wallpaper hanging and removal (the form placeholder already mentions old wallpaper), kitchen cabinet painting, staircase and banister painting, and commercial decorating. Each should have its own genuine content, like the four existing service pages.

### Possible new location targets (only if covered, and only with genuine content)

- **Sale and Didsbury.** The site already says D&M takes on work there. They are now targeted inside the South Manchester hub rather than as thin pages. Give them their own pages only when there is real local substance, such as completed projects there.
- **Thelwall, Walton/Stretton, Culcheth, Great Sankey/Penketh, Timperley, Hale Barns.** Only if Mike confirms he covers them. Don't create a page per postcode or village without something genuinely local to say.

## 4. Keyword and intent map (this branch)

| Page | Primary query target | Intent | Title |
|---|---|---|---|
| `/` | painters and decorators Warrington / South Manchester; brand | Commercial + navigational | Painters & Decorators in Warrington & South Manchester \| D&M |
| `/areas/warrington` (hub) | painter decorator Warrington | Local commercial | Painters & Decorators in Warrington, Cheshire \| D&M |
| `/areas/stockton-heath`, `/grappenhall`, `/appleton`, `/lymm` | painter decorator + village | Local commercial | Painters & Decorators in {place}, {postcode} \| D&M |
| `/areas/south-manchester` (hub) | painter decorator South Manchester; Sale; Didsbury | Local commercial | Painters & Decorators in South Manchester \| D&M |
| `/areas/altrincham`, `/hale`, `/bowdon` | painter decorator + town | Local commercial | Painters & Decorators in {place} \| D&M |
| `/services/interior-painting` | interior painting / decorating + region | Commercial | Interior Painting in Warrington & South Manchester \| D&M |
| `/services/woodwork-painting` | woodwork, door and skirting painting | Commercial | Woodwork Painting in Warrington & South Manchester \| D&M |
| `/services/exterior-decorating` | exterior house painting | Commercial | Exterior Decorating in Warrington & South Manchester \| D&M |
| `/services/whole-house-decorating` | whole-house redecoration | Commercial | Whole-House Decorating \| Warrington & South Manchester \| D&M |
| `/guides/*` | how-to and preparation questions (lead paint, distemper, new-build plaster…) | Informational, linking to the matching service | {guide title} \| D&M |
| `/contact` | decorating quote Warrington | Transactional | Contact D&M \| Painting & Decorating Quotes in Warrington |

### Cannibalisation

- **Homepage vs. Warrington hub.** Both mention Warrington, by design. The homepage is the brand page for the whole region, while the Warrington hub carries the local detail, the WA postcodes and the child villages, and the homepage links to it with descriptive anchor text. Check Search Console after a few weeks: if the homepage ranks for "painter decorator Warrington" ahead of the hub, that is acceptable; if the two alternate, strengthen the hub's internal links further.
- **Service × location combinations.** No pages like "/interior-painting-lymm" were created. They are the classic doorway pattern the brief rules out. Service pages target the service across the region, and location pages target the place.
- **Area page titles vs. H1s.** These were misaligned ("Painters & Decorators in X" vs. "Painting & decorating in X") and are now consistent.

## 5. What this branch changes

### Architecture
- **Two location hubs:**
  - Warrington → Stockton Heath, Grappenhall, Appleton, Lymm.
  - South Manchester → Altrincham, Hale, Bowdon.
- `/areas` is grouped into those two clusters.
- Every spoke links to its parent hub, and "Nearby areas" now lists genuine neighbours (Lymm ↔ Bowdon/Altrincham and Grappenhall, for example).
- Visible breadcrumbs plus BreadcrumbList schema on every hub, spoke and guide (for example Home / Areas we cover / Warrington / Stockton Heath).
- **Contextual cross-links:**
  - Area pages link each service with a short description, plus the guide most relevant to local housing.
  - Service pages link the relevant guides, group areas by hub and link the other services.
  - Guides link their specific services and the areas where they are most relevant.
- **Homepage:**
  - The service cards are now real links, and there is a "View all services" link.
  - A restrained "Where we work" section lists both clusters.
  - The navigation links the Services and Areas hubs, and the footer links every hub plus the room designer and contact page.
- All 24 indexable pages are one click from the homepage and listed in the sitemap.

### Content
These changes contain no new business claims; `tests/seo/content.test.ts` fails if words like "insured", "guaranteed", "award", "accredited" or "five-star reviews" appear.
- **Each location page now covers:**
  - the local housing stock and landmarks, such as the Bridgewater Canal, Victorian terraces in Stockton Heath, Bowdon's conservation area and Lymm's sandstone cottages;
  - three decorating considerations specific to those homes, such as lead paint, distemper, lime plaster, Artex, new-build settlement cracks and roof-lantern raking light;
  - two or three locally relevant FAQs.
- **Service pages** have "what's included", approach, typical projects and FAQs, all built from the existing service claims.
- **Three guides were expanded**, and two new ones added: "Decorating an older home" and "Decorating a new-build home".
- **The homepage H1** now leads with "Painters & decorators in Warrington & South Manchester" in the existing eyebrow style, so the visual design is unchanged.
- **FAQs** use `<details>`: visible, indexable and collapsible. FAQPage schema is intentionally omitted, because Google only shows FAQ rich results for government and health sites.

### Technical
- Per-page canonical, Open Graph and Twitter tags (`lib/seo.ts`) and a branded share image (`public/og-image.png`).
- **JSON-LD:**
  - `HousePainter` business data on the homepage and contact page. It has no address or phone, because neither is confirmed.
  - `WebSite` on the homepage.
  - `Service` on each service page.
  - `BreadcrumbList` on hubs, spokes and guides.
- **The homepage is now a server component.** Only the mobile menu is a client component (`components/HomeHeader.tsx`).
- **Fonts are self-hosted with `next/font`.** The stylesheets now use `var(--font-body)` and `var(--font-display)`; the admin and invoice CSS diffs are font-token swaps only, with the same typefaces.
- **Hero image:** preload (with media queries matching the CSS breakpoints) and a preconnect to images.unsplash.com. "Our work" images are now lazy-loaded `<img>` elements.
- **`robots.txt`:** disallows `/admin` and `/api/admin` and drops `Host:`. The ChatGPT OAuth/MCP endpoints, `/d/` and `/login` stay crawlable, so their noindex headers are still seen; an e2e test enforces this.
- **Sitemap** includes `/room-designer` and is generated from the same content data as the pages.
- **Smaller fixes:**
  - `<main>` landmark on all SEO pages.
  - A branded 404 page with links back into the site.
  - `lang="en-GB"`.
  - Logo width and height attributes.
  - CTAs go straight to `/contact`.
  - Enquiry panels offer the form, WhatsApp and email.
- **Unchanged:** admin, invoices, diary, shared documents, the ChatGPT MCP/OAuth integration, the contact API and the room designer logic. `ContactForm` now reads its email and WhatsApp number from `lib/site.ts`; the values are the same.

## 6. Verification

| Check | Result |
|---|---|
| `npm run lint` | Clean |
| `npm run typecheck` | Clean |
| `npm test` | 101/101 pass, including 7 new SEO tests |
| `npm run build` | Pass (40 static pages) |
| `npm run test:e2e` (desktop + mobile Chromium) | 44/44 pass, including 12 new SEO tests: robots, sitemap → 200 + self-canonical, homepage targeting, hub/spoke links, service → area links, 404 |
| Local crawl | 24 pages, all 200, depth ≤ 1, canonical + OG on every page, valid JSON-LD, no duplicate titles or descriptions |
| Screenshots | Desktop and mobile, no horizontal overflow on any checked page; design matches the existing system |

The e2e run here used the sandbox's Chromium build through a local config override, because the pinned Playwright expects a different browser revision. CI installs the matching browser and uses the normal config.

## 7. After merging and deploying

1. Check the sitemap: `curl https://www.dmpaintingdecorating.co.uk/sitemap.xml` should list 24 URLs, and `robots.txt` should show the `/admin` disallow.
2. Verify the domain in Search Console, submit the sitemap, and request indexing for the homepage, both hubs and the four service pages.
3. Run the homepage and a service page through Google's Rich Results Test. Expect valid Breadcrumb data, and a LocalBusiness "missing address" notice, which is expected for a service-area business without a public address.
4. Paste the homepage URL into WhatsApp to confirm the share preview.
5. Re-run Lighthouse on the live URLs.
6. Mike should **read every location page** and correct any local detail that doesn't match his experience. The descriptions of housing and landmarks are factual and general, but he knows these areas best.
7. Work through section 3: phone number, Google Business Profile, reviews, real photos, privacy policy.
