import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Typeface delivery is unrelated to authentication or document privacy.
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});

test("admin login remains usable on the selected viewport", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("mike@dmpaintingdecorating.co.uk");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const path of ["/admin", "/admin/quotes", "/admin/invoices", "/admin/diary", "/admin/settings", "/admin/invoices/private-record/preview"]) {
  test(`anonymous browser cannot enter ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
    await expect(page.locator(".adm-tabs")).toHaveCount(0);
  });
}

test("invalid customer tokens return unavailable without admin access", async ({ page }) => {
  const response = await page.goto("/d/invalid-customer-token");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "This document is unavailable" })).toBeVisible();
  await expect(page.locator(".adm-tabs, .adm-top, input[type=password]")).toHaveCount(0);
  await expect(page.getByText("Bill Gates")).toHaveCount(0);
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("anonymous API requests cannot read or mutate admin data", async ({ request }) => {
  const responses = await Promise.all([
    request.get("/api/admin/data"),
    request.put("/api/admin/data", { data: {} }),
    request.post("/api/admin/share", { data: { id: "private-record", action: "create" } }),
    request.post("/api/admin/share", { data: { id: "private-record", action: "revoke" } }),
  ]);
  for (const response of responses) {
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: "Please sign in." });
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
});

test("off-origin requests cannot initiate an admin sign-in", async ({ request }) => {
  const response = await request.post("/api/auth/login", {
    headers: { Origin: "https://unrelated.example" },
    data: {},
  });
  expect(response.status()).toBe(403);
  expect(response.headers()["set-cookie"]).toBeUndefined();
});
