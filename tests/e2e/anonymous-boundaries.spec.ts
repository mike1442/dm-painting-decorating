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

test("the ChatGPT connection refuses anonymous callers, forged tokens and non-ChatGPT apps", async ({ request }) => {
  const metadata = await request.get("/.well-known/oauth-authorization-server");
  expect(metadata.status()).toBe(200);
  const server = await metadata.json();
  // Next's local server can normalize 127.0.0.1 to localhost in Request.url.
  // Permit only those HTTP loopback aliases; public deployment hosts stay exact.
  const normalizeLocalOrigin = (value: string) => {
    const url = new URL(value);
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) url.hostname = "localhost";
    return url.origin;
  };
  const origin = new URL(server.issuer).origin;
  expect(server.issuer).toBe(origin);
  expect(normalizeLocalOrigin(origin)).toBe(normalizeLocalOrigin(metadata.url()));
  expect(server.code_challenge_methods_supported).toEqual(["S256"]);
  expect(server.registration_endpoint).toBe(`${origin}/api/oauth/register`);
  for (const path of ["", "/api/mcp"]) {
    const resource = await request.get(`/.well-known/oauth-protected-resource${path}`);
    expect(resource.status()).toBe(200);
    expect(await resource.json()).toMatchObject({ resource: `${origin}/api/mcp`, authorization_servers: [server.issuer] });
  }
  const tools = { jsonrpc: "2.0", id: 1, method: "tools/list" };
  const headers = { Accept: "application/json, text/event-stream" };
  const anonymous = await request.post("/api/mcp", { data: tools, headers });
  const getProbe = await request.get("/api/mcp", { headers });
  expect(anonymous.status()).toBe(401);
  expect(getProbe.status()).toBe(401);
  expect(getProbe.headers()["www-authenticate"]).toBe(anonymous.headers()["www-authenticate"]);
  expect(anonymous.headers()["www-authenticate"]).toMatch(/^Bearer realm="D&M", resource_metadata="https?:\/\/[^"]+\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
  expect(anonymous.headers()["www-authenticate"]).toContain(`resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`);
  expect(anonymous.headers()["cache-control"]).toContain("no-store");

  // Discovery and its challenge stay public even when registration is disabled.
  const invalidRegistration = await request.post("/api/oauth/register", { data: { redirect_uris: ["https://unrelated.example/callback"] } });
  if (invalidRegistration.status() === 503) {
    expect((await request.post("/api/mcp", { data: tools, headers: { ...headers, Authorization: "Bearer dmat_forged-token-value" } })).status()).toBe(503);
    return;
  }
  expect(invalidRegistration.status()).toBe(400);

  const forged = await request.post("/api/mcp", { data: tools, headers: { ...headers, Authorization: "Bearer dmat_forged-token-value" } });
  expect(forged.status()).toBe(401);
  expect(forged.headers()["www-authenticate"]).toContain('error="invalid_token"');
  expect((await request.post("/api/chatgpt/actions/list_quotes", { data: {} })).status()).toBe(401);
  expect((await request.post("/api/oauth/token", { form: { grant_type: "authorization_code", code: "dmac_forged", client_id: "dmcl_forged" } })).status()).toBe(401);
  const settings = await request.get("/api/admin/chatgpt");
  expect(settings.status(), "Connection details are for the signed-in administrator only").toBe(401);
});

test("the ChatGPT consent page cannot be framed and never returns an unknown app to ChatGPT", async ({ page }) => {
  const response = await page.goto("/oauth/authorize?response_type=code&client_id=dmcl_forged&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fconnector_platform_oauth_redirect&code_challenge_method=S256");
  test.skip(response?.status() === 503, "This deployment has not switched the ChatGPT connection on.");
  expect(response?.status()).toBe(400);
  expect(new URL(page.url()).pathname).toBe("/oauth/authorize");
  await expect(page.getByRole("heading", { name: "This connection request is not valid" })).toBeVisible();
  await expect(page.locator("input[type=password]")).toHaveCount(0);
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(response?.headers()["x-robots-tag"]).toContain("noindex");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


test("a Custom GPT's approval page loads for a chat.openai.com callback and may continue to chatgpt.com", async ({ page }) => {
  // GPT editors may still show a chat.openai.com callback, which ChatGPT redirects
  // to chatgpt.com. Browsers check the consent form's form-action on every hop.
  const callback = "https://chat.openai.com/aip/g-e2eProbe/oauth/callback";
  const response = await page.goto(`/oauth/authorize?response_type=code&client_id=dm-custom-gpt&redirect_uri=${encodeURIComponent(callback)}&state=e2e&scope=dm%3Aread`);
  test.skip(response?.status() === 503, "This deployment has not switched the ChatGPT connection on.");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Connect ChatGPT to D&M admin" })).toBeVisible();
  await expect(page.getByText("Your D&M Custom GPT")).toBeVisible();
  const policy = response?.headers()["content-security-policy"] ?? "";
  expect(/form-action ([^;]+)/.exec(policy)?.[1].split(" ").sort()).toEqual(["'self'", "https://chat.openai.com", "https://chatgpt.com", "https://platform.openai.com"]);
  expect(policy).toContain("frame-ancestors 'none'");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
