import { expect, test, type Page } from "@playwright/test";
import { MAX_CONTACT_PHOTO_BYTES } from "../../lib/contact";

// These tests intercept the public endpoint. They verify browser behavior and
// upload encoding; delivery still requires a verified sender and live preview.
test.beforeEach(async ({ page }) => {
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.goto("/contact");
});

async function completeEnquiry(page: Page) {
  await page.getByLabel("Your name").fill("TEST ONLY — website verification");
  await page.getByLabel("Email address").fill("test@example.com");
  await page.getByLabel("Phone number").fill("00000000000");
  await page.getByLabel("Postcode or area").fill("TEST ONLY");
  await page.getByLabel("Tell us a little about the work").fill("Verification only. Please ignore. Not a real job or customer.");
  await page.getByRole("checkbox").check();
}

test("public enquiry form fits the viewport and submits a resized photo", async ({ page }) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await completeEnquiry(page);
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 2000; canvas.height = 1200;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#faf4e8"; ctx.fillRect(0, 0, 2000, 1200);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  // A valid PNG with trailing bytes exercises the large phone-photo resize path.
  const largePhoto = Buffer.concat([Buffer.from(png, "base64"), Buffer.alloc(MAX_CONTACT_PHOTO_BYTES + 1)]);
  await page.getByLabel("Choose project photos").setInputFiles({ name: "test-wall.png", mimeType: "image/png", buffer: largePhoto });
  await expect(page.getByRole("button", { name: "Remove test-wall.png" })).toBeVisible();
  let submitted = false;
  await page.route("**/api/contact", async route => {
    const request = route.request();
    const fd = await new Request(request.url(), { method: "POST", headers: request.headers(), body: new Uint8Array(request.postDataBuffer()!) }).formData();
    expect(fd.get("name")).toBe("TEST ONLY — website verification");
    expect(fd.get("consent")).toBe("on");
    expect(fd.get("requestId")).toMatch(/^[0-9a-f-]{36}$/);
    const photos = fd.getAll("photos") as File[];
    expect(photos).toHaveLength(1);
    expect(photos[0].name).toBe("test-wall.jpg");
    expect(photos[0].type).toBe("image/jpeg");
    expect(photos[0].size).toBeLessThan(MAX_CONTACT_PHOTO_BYTES);
    submitted = true;
    await route.fulfill({ status: 200, json: { ok: true } });
  });
  await page.getByRole("button", { name: "Send my enquiry" }).click();
  await expect(page.getByRole("status")).toContainText("Thanks, we've got your enquiry.");
  expect(submitted).toBe(true);
  await page.getByRole("button", { name: "Send another enquiry" }).click();
  await expect(page.getByLabel("Your name")).toHaveValue("");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("failed enquiry preserves details and uses the same idempotency key when retried", async ({ page }) => {
  await completeEnquiry(page);
  const ids: string[] = [];
  await page.route("**/api/contact", async route => {
    const request = route.request();
    const fd = await new Request(request.url(), { method: "POST", headers: request.headers(), body: new Uint8Array(request.postDataBuffer()!) }).formData();
    ids.push(String(fd.get("requestId")));
    await route.fulfill(ids.length === 1 ? { status: 502, json: { error: "Test delivery unavailable. Please try again." } } : { status: 200, json: { ok: true } });
  });
  await page.getByRole("button", { name: "Send my enquiry" }).click();
  await expect(page.locator(".dm-contact-form-wrap").getByRole("alert")).toContainText("Test delivery unavailable");
  await expect(page.getByLabel("Email address")).toHaveValue("test@example.com");
  await page.getByRole("button", { name: "Send my enquiry" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
});

test("unsupported attachments are rejected before submitting", async ({ page }) => {
  await page.getByLabel("Choose project photos").setInputFiles({ name: "not-a-photo.txt", mimeType: "text/plain", buffer: Buffer.from("not a photo") });
  await expect(page.locator(".dm-contact-form-wrap").getByRole("alert")).toContainText("Please use JPG, PNG, WEBP or HEIC photos.");
  await expect(page.getByRole("button", { name: "Remove not-a-photo.txt" })).toHaveCount(0);
});

test("unconfirmed HTTP success preserves enquiry details and photos for retry", async ({ page }) => {
  await completeEnquiry(page);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGm0AAAAASUVORK5CYII=", "base64");
  await page.getByLabel("Choose project photos").setInputFiles({ name: "test-wall.png", mimeType: "image/png", buffer: png });
  let attempts = 0;
  await page.route("**/api/contact", async route => {
    attempts++;
    if (attempts === 1) await route.fulfill({ status: 200, contentType: "text/html", body: "<html>Unexpected proxy response</html>" });
    else if (attempts === 2) await route.fulfill({ status: 200, json: { ok: false } });
    else await route.fulfill({ status: 200, json: { ok: true } });
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("button", { name: "Send my enquiry" }).click();
    await expect(page.locator(".dm-contact-form-wrap").getByRole("alert")).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.getByLabel("Email address")).toHaveValue("test@example.com");
    await expect(page.getByRole("button", { name: "Remove test-wall.png" })).toBeVisible();
  }
  await page.getByRole("button", { name: "Send my enquiry" }).click();
  await expect(page.getByRole("status")).toContainText("Thanks, we've got your enquiry.");
  expect(attempts).toBe(3);
});
