import { randomBytes } from "node:crypto";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import sharp from "sharp";
import type { Photo } from "../../lib/photos";
import { expect, field, layoutFits, test as base } from "./support/fixtures";
import { adminNavigate, liveApi } from "./support/live-environment";

// The photo library on the selected viewport: Mike uploads from the Photos
// section, copies a URL in one tap, and an anonymous phone or desktop browser
// loads it as genuine WebP. Every photo is titled "TEST <run id> …" and removed
// (files and record) by the worker fixture below, even when a step fails.

const automated = /^TEST [0-9a-f]{12} /;
const STALE_AFTER_MS = 20 * 60_000;

async function listPhotos(request: APIRequestContext, origin: string): Promise<Photo[]> {
  const response = await liveApi(request, origin, "/api/admin/photos");
  expect(response.status(), "The signed-in photo library must load; apply supabase/site-photos.sql first").toBe(200);
  return (await response.json()).photos;
}

async function removePhotos(request: APIRequestContext, origin: string, select: (photo: Photo) => boolean) {
  const doomed = (await listPhotos(request, origin)).filter(select);
  for (const photo of doomed) {
    expect((await liveApi(request, origin, `/api/admin/photos/${photo.id}`, "DELETE")).status(), "A TEST photo must be removable").toBe(200);
  }
  return doomed.length;
}

const test = base.extend<object, { photoRun: { prefix: string } }>({
  photoRun: [async ({ admin, live }, use) => {
    const request = admin.context.request;
    const swept = await removePhotos(request, live.baseURL, photo => automated.test(photo.title) && Date.now() - Date.parse(photo.createdAt) > STALE_AFTER_MS);
    if (swept) console.log(`Removed ${swept} TEST photo(s) left by earlier interrupted runs.`);
    const prefix = `TEST ${live.runId} `;
    try {
      await use({ prefix });
    } finally {
      await removePhotos(request, live.baseURL, photo => photo.title.startsWith(prefix));
      if ((await listPhotos(request, live.baseURL)).some(photo => photo.title.startsWith(prefix))) {
        throw new Error("Temporary TEST photos remain after cleanup. Review the Photos page for this run's TEST photos.");
      }
    }
  }, { scope: "worker", timeout: 60_000 }],
});

/** A camera JPEG stored sideways: left half red, right half blue, EXIF orientation 6 (and a GPS position). */
async function sidewaysPhoto(width: number, height: number, noise = false) {
  const half = Math.round(width / 2);
  const base = noise
    ? sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } })
    : sharp({ create: { width, height, channels: 3, background: "#1e4fd8" } });
  const painted = await base.composite([{ input: { create: { width: half, height, channels: 3, background: "#e0261d" } }, left: 0, top: 0, blend: noise ? "multiply" : "over" }]).png().toBuffer();
  return sharp(painted).jpeg({ quality: noise ? 95 : 88 }).withMetadata({ orientation: 6 })
    .withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "53/1 23/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "2/1 35/1 0/1" } }).toBuffer();
}

/** Fetch a public photo URL anonymously; a fresh query string bypasses any CDN copy. */
async function publicPhoto(request: APIRequestContext, url: string, fresh = false) {
  const response = await request.get(fresh ? `${url}?check=${randomBytes(6).toString("hex")}` : url, { maxRedirects: 0 });
  return { response, body: response.ok() ? await response.body() : Buffer.alloc(0) };
}

async function expectWebp(request: APIRequestContext, url: string, width: number, height: number) {
  const { response, body } = await publicPhoto(request, url);
  expect(response.status(), "A photo URL must open without signing in").toBe(200);
  expect(response.headers()["content-type"]).toBe("image/webp");
  expect(response.headers()["cache-control"]).toContain("max-age=31536000");
  expect(body.toString("ascii", 0, 4) + body.toString("ascii", 8, 12), "The served bytes must be a real WebP file").toBe("RIFFWEBP");
  const metadata = await sharp(body).metadata();
  expect([metadata.format, metadata.width, metadata.height]).toEqual(["webp", width, height]);
  expect(metadata.exif, "Camera metadata, including GPS position, must be removed").toBeUndefined();
  return body;
}

/** Load the image the way a web page would, in this viewport's browser. */
async function pageLoads(page: Page, url: string) {
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width"><img src="${url}" alt="" style="max-width:100%">`);
  return page.locator("img").evaluate(async (image: HTMLImageElement) => {
    if (!image.complete) await new Promise(resolve => { image.onload = image.onerror = resolve; });
    return { width: image.naturalWidth, height: image.naturalHeight, shown: image.getBoundingClientRect().width };
  });
}

const card = (page: Page, title: string) => page.getByRole("article", { name: title, exact: true });
const photoNamed = (photos: Photo[], title: string) => photos.find(photo => photo.title === title);

async function thumbnailWidth(scope: Locator) {
  return scope.locator("img").evaluate((image: HTMLImageElement) => image.complete ? image.naturalWidth : 0);
}

test.describe("photo library", () => {
  test.describe.configure({ mode: "serial" });

  const titles = { hallway: "", logo: "", large: "", renamed: "" };
  let hallway: Photo;

  test("Mike uploads phone photos, a PNG and a large photo from the Photos section", async ({ admin, live, photoRun }) => {
    const { page } = admin;
    titles.hallway = `${photoRun.prefix}Hallway repaint Stockton Heath`;
    titles.logo = `${photoRun.prefix}D&M logo`;
    titles.large = `${photoRun.prefix}Large exterior photo`;
    await adminNavigate(page, "/admin/photos");
    await expect(page.getByRole("heading", { name: "Photos", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Photos", exact: true }).filter({ visible: true })).toHaveAttribute("aria-current", "page");
    await layoutFits(page);

    const logo = await sharp({ create: { width: 640, height: 320, channels: 4, background: { r: 121, g: 189, b: 183, alpha: 0.5 } } }).png().toBuffer();
    // Over the 4 MB request budget: the browser must shrink it (keeping it upright) before upload.
    const large = await sidewaysPhoto(3600, 2700, true);
    expect(large.length, "fixture must exceed the direct-upload budget").toBeGreaterThan(4_000_000);
    await page.getByLabel("Choose photos", { exact: true }).setInputFiles([
      { name: "IMG_2034.JPG", mimeType: "image/jpeg", buffer: await sidewaysPhoto(3000, 2000) },
      { name: "logo.png", mimeType: "image/png", buffer: logo },
      { name: "IMG_2035.JPG", mimeType: "image/jpeg", buffer: large },
    ]);
    const sheet = page.getByRole("dialog", { name: "Add 3 photos" });
    await expect(sheet).toBeVisible();

    // Nothing uploads until every photo has a title.
    await sheet.getByRole("button", { name: "Upload 3 photos", exact: true }).click();
    await expect(sheet.getByRole("alert").first()).toContainText("Give the photo a short title");
    const first = sheet.getByRole("region", { name: "Photo 1 of 3" });
    await field(first, "Title").fill(titles.hallway);
    await field(first, "Description for Google").fill("Freshly painted hallway with white woodwork");
    await field(sheet.getByRole("region", { name: "Photo 2 of 3" }), "Title").fill(titles.logo);
    await field(sheet.getByRole("region", { name: "Photo 3 of 3" }), "Title").fill(titles.large);
    await field(sheet, "Category").selectOption("interior");
    await sheet.getByRole("button", { name: "Upload 3 photos", exact: true }).click();
    await expect(sheet).toBeHidden({ timeout: 45_000 });
    await expect(page.getByRole("status").filter({ hasText: "3 photos uploaded." })).toBeVisible();

    const photos = await listPhotos(admin.context.request, live.baseURL);
    hallway = photoNamed(photos, titles.hallway)!;
    expect(hallway, "The uploaded photo must be recorded").toBeTruthy();
    expect([hallway.width, hallway.height, hallway.thumbWidth, hallway.thumbHeight], "upright, at most 1600 px wide, aspect ratio kept").toEqual([1600, 2400, 480, 720]);
    expect([hallway.altText, hallway.category]).toEqual(["Freshly painted hallway with white woodwork", "interior"]);
    expect(hallway.url, "a descriptive file name").toMatch(new RegExp(`/storage/v1/object/public/site-photos/test-${live.runId}-hallway-repaint-stockton-heath\\.webp$`));
    const logoPhoto = photoNamed(photos, titles.logo)!;
    expect([logoPhoto.width, logoPhoto.height, logoPhoto.thumbWidth], "small images are not enlarged").toEqual([640, 320, 480]);
    const largePhoto = photoNamed(photos, titles.large)!;
    // Shrunk in the browser first (to 2400, 2000 or 1600 px wide), so the height may differ by a pixel of rounding.
    expect(largePhoto.width, "a large photo is shrunk in the browser and still turned upright").toBe(1600);
    expect(Math.abs(largePhoto.height - 2133)).toBeLessThanOrEqual(1);

    // Thumbnails load in the library on this viewport.
    await expect(card(page, titles.hallway)).toBeVisible();
    await expect.poll(() => thumbnailWidth(card(page, titles.hallway))).toBe(480);
    await expect.poll(() => thumbnailWidth(card(page, titles.logo))).toBe(480);
    await expect(card(page, titles.hallway)).toContainText("Interior painting");
    await layoutFits(page);
  });

  test("one tap copies a permanent HTTPS URL that serves genuine WebP to an anonymous browser", async ({ admin, customer, live }) => {
    const { page, context } = admin;
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: live.baseURL });
    const photo = card(page, titles.hallway);
    await photo.getByRole("button", { name: "Copy URL", exact: true }).click();
    await expect(photo.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(hallway.url);
    expect(copied).toMatch(/^https:\/\/fdctgtncawolrapwwevm\.supabase\.co(:\d+)?\/storage\/v1\/object\/public\/site-photos\/[a-z0-9-]+\.webp$/);

    // An anonymous visitor (no admin cookies) receives real, upright WebP.
    expect((await customer.context.cookies()).length).toBe(0);
    const body = await expectWebp(customer.context.request, copied, 1600, 2400);
    const top = await sharp(body).extract({ left: 800, top: 40, width: 1, height: 1 }).raw().toBuffer();
    expect(top[0] > 180 && top[2] < 90, "the red half of the sideways photo must be at the top").toBe(true);
    await expectWebp(customer.context.request, hallway.thumbUrl, 480, 720);

    // A web page in this viewport's browser loads and fits both sizes.
    expect(await pageLoads(customer.page, copied)).toMatchObject({ width: 1600, height: 2400 });
    const shown = await pageLoads(customer.page, hallway.thumbUrl);
    expect(shown).toMatchObject({ width: 480, height: 720 });
    expect(shown.shown).toBeLessThanOrEqual(customer.page.viewportSize()!.width);

    // Admin photo endpoints stay closed to the anonymous browser.
    const request = customer.context.request;
    for (const response of [
      await request.get(`${live.baseURL}/api/admin/photos`),
      await request.post(`${live.baseURL}/api/admin/photos`, { headers: { Origin: live.baseURL }, multipart: { title: "x", photo: { name: "x.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff]) } } }),
      await request.patch(`${live.baseURL}/api/admin/photos/${hallway.id}`, { headers: { Origin: live.baseURL }, data: { title: "Hijacked" } }),
      await request.delete(`${live.baseURL}/api/admin/photos/${hallway.id}`, { headers: { Origin: live.baseURL } }),
    ]) expect(response.status()).toBe(401);
  });

  test("a photo can be renamed and recategorised without changing its address", async ({ admin, live }) => {
    const { page } = admin;
    titles.renamed = titles.hallway.replace("Hallway repaint", "Victorian hallway");
    await card(page, titles.hallway).getByRole("button", { name: `Edit ${titles.hallway}`, exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Photo details" });
    await expect(sheet).toBeVisible();
    await expect(field(sheet, "Web address")).toHaveValue(hallway.url);
    await field(sheet, "Title").fill(titles.renamed);
    await field(sheet, "Description for Google").fill("Victorian hallway after repainting");
    await field(sheet, "Category").selectOption("before-after");
    await layoutFits(page);
    await sheet.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /^Photo saved\.$/ })).toBeVisible();
    await expect(card(page, titles.renamed)).toContainText("Before & after");
    const saved = photoNamed(await listPhotos(admin.context.request, live.baseURL), titles.renamed)!;
    expect([saved.url, saved.altText, saved.category]).toEqual([hallway.url, "Victorian hallway after repainting", "before-after"]);
    hallway = saved;
  });

  test("asking for a new web address moves the files; deleting removes them", async ({ admin, customer, live }) => {
    const { page } = admin;
    const oldUrl = hallway.url;
    await card(page, titles.renamed).getByRole("button", { name: `Edit ${titles.renamed}`, exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Photo details" });
    await sheet.getByRole("switch", { name: "Also change the web address", exact: true }).check();
    await sheet.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Photo saved with a new web address." })).toBeVisible();
    const moved = photoNamed(await listPhotos(admin.context.request, live.baseURL), titles.renamed)!;
    expect(moved.url).toMatch(new RegExp(`/site-photos/test-${live.runId}-victorian-hallway-stockton-heath\\.webp$`));
    await expectWebp(customer.context.request, moved.url, 1600, 2400);
    expect((await publicPhoto(customer.context.request, oldUrl, true)).response.ok(), "the old address stops working").toBe(false);

    page.once("dialog", dialog => void dialog.accept());
    await card(page, titles.renamed).getByRole("button", { name: `Edit ${titles.renamed}`, exact: true }).click();
    await page.getByRole("dialog", { name: "Photo details" }).getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Photo deleted." })).toBeVisible();
    await expect(card(page, titles.renamed)).toHaveCount(0);
    expect(photoNamed(await listPhotos(admin.context.request, live.baseURL), titles.renamed)).toBeUndefined();
    for (const url of [moved.url, moved.thumbUrl]) {
      expect((await publicPhoto(customer.context.request, url, true)).response.ok(), "deleted files leave the public bucket").toBe(false);
    }
    await layoutFits(page);
  });
});
