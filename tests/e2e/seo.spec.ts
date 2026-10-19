import { expect, test } from "@playwright/test";
import { areas, services } from "../../lib/seo-content";

const SITE = "https://www.dmpaintingdecorating.co.uk";

test("robots.txt keeps the private admin out without blocking the ChatGPT connection", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  expect(robots).toContain("Disallow: /admin");
  for (const path of ["/api/mcp", "/api/oauth", "/.well-known", "/oauth", "/d/"]) {
    expect(robots.split("\n").filter(line => line.startsWith("Disallow:")).some(line => path.startsWith(line.slice(9).trim()))).toBe(false);
  }
});

test("every sitemap URL is a live, self-canonical page", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text();
  const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
  for (const path of ["/", "/services", "/areas", "/guides", "/contact", "/room-designer", ...areas.map(a => `/areas/${a.slug}`), ...services.map(s => `/services/${s.slug}`)]) {
    expect(urls).toContain(SITE + path);
  }
  for (const url of urls) {
    const path = url.slice(SITE.length);
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const canonical = (await response.text()).match(/<link rel="canonical" href="([^"]+)"/)?.[1];
    expect(canonical, path).toBe(path === "/" ? SITE : url);
  }
});

test("homepage targets the service area and links into every hub and service", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Warrington & South Manchester/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Painters & decorators in Warrington & South Manchester");
  for (const service of services) await expect(page.locator(`.service-list a[href="/services/${service.slug}"]`)).toHaveCount(1);
  for (const hub of ["/services", "/areas", "/guides"]) expect(await page.locator(`a[href="${hub}"]`).count()).toBeGreaterThan(0);
  const schema = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(schema.map(s => JSON.parse(s)["@type"])).toEqual(expect.arrayContaining(["WebSite", "HousePainter"]));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a location spoke links back to its hub, its neighbours and the services", async ({ page }) => {
  await page.goto("/areas/stockton-heath");
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs.getByRole("link")).toHaveText(["Home", "Areas we cover", "Warrington"]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Painters & decorators in Stockton Heath");
  await expect(page.locator('aside a[href="/areas/warrington"]').first()).toBeVisible();
  for (const service of services) await expect(page.locator(`main a[href="/services/${service.slug}"]`).first()).toBeVisible();
  await expect(page.locator('main a[href="/contact"]').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a service page links to every area it is offered in", async ({ page }) => {
  await page.goto("/services/interior-painting");
  for (const area of areas) await expect(page.locator(`main a[href="/areas/${area.slug}"]`).first()).toBeAttached();
  await page.getByText("How long should new plaster dry before painting?").click();
  await expect(page.getByText(/mist coat or a primer/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("unknown locations return a real 404 with a way back", async ({ page }) => {
  const response = await page.goto("/areas/not-a-real-place");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("link", { name: "Request a quote ↗" }).first()).toBeVisible();
});
