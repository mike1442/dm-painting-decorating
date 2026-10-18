import { expect, type APIRequestContext, type APIResponse, type BrowserContext, type Page } from "@playwright/test";

const approvedPreview = "https://dm-painting-decorating-git-fix-production-admin-mike-b7b4.vercel.app";

/** Exact preview allowlist protects production even if a caller mistypes a URL. */
export function liveEnvironment() {
  if (process.env.E2E_RUN_LIVE !== "1") {
    throw new Error("Live verification requires explicit E2E_RUN_LIVE=1. No real workflow was verified.");
  }
  const value = process.env.E2E_BASE_URL;
  if (!value) throw new Error("Set E2E_BASE_URL to the approved PR #6 preview or http://localhost:3000 using the existing Supabase project.");
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("E2E_BASE_URL must be a valid, approved origin."); }
  const loopback = url.origin === "http://localhost:3000";
  if ((!loopback && url.origin !== approvedPreview) || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new Error("Live writes are allowed only on the approved PR #6 preview or http://localhost:3000. Production, other local origins and other projects are refused.");
  }
  if (!process.env.E2E_ADMIN_PASSWORD || process.env.E2E_ADMIN_PASSWORD.length < 8) {
    throw new Error("Mike must first activate his confirmed Supabase Auth account and privately provide E2E_ADMIN_PASSWORD. No password is generated and no authenticated workflow was verified.");
  }
  return { baseURL: url.origin, password: process.env.E2E_ADMIN_PASSWORD, isLoopback: loopback };
}

function previewHeaders(origin: string): Record<string, string> {
  const token = process.env.E2E_VERCEL_TRUSTED_OIDC_TOKEN;
  return token && origin === approvedPreview ? { "x-vercel-trusted-oidc-idp-token": token } : {};
}

/** Never put a Vercel credential in global extraHTTPHeaders. */
export async function prepareLiveBrowser(context: BrowserContext, origin: string) {
  await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  if (!Object.keys(previewHeaders(origin)).length) return;
  await context.route(`${origin}/**`, async route => {
    // Fetch without following redirects so an access header cannot be forwarded
    // to Vercel's login page or any other origin. The browser follows the 302.
    try {
      const response = await route.fetch({ headers: { ...route.request().headers(), ...previewHeaders(origin) }, maxRedirects: 0 });
      await route.fulfill({ response });
    } catch {
      await route.abort("failed");
    }
  });
}

const UNAVAILABLE_ATTEMPTS = 3;
const UNAVAILABLE_RETRY_MS = 3_000;

/**
 * Hosted Supabase Auth occasionally leaves a request unanswered for about ten
 * seconds; the app then answers 503 and its own pages retry by themselves.
 * Verification requests do the same as the app's own client: a read is repeated
 * after any 503, a write only when the 503 says nothing was written.
 */
function upstreamUnavailable(response: APIResponse, method: string) {
  // The app sends Retry-After only when it failed before writing anything.
  return response.status() === 503 && (method === "GET" || response.headers()["retry-after"] !== undefined);
}

export async function liveApi(request: APIRequestContext, origin: string, path: string, method: "GET" | "PUT" | "POST" = "GET", data?: unknown): Promise<APIResponse> {
  const url = new URL(path, origin);
  if (url.origin !== origin || !url.pathname.startsWith("/api/")) throw new Error("Refusing an API request outside the selected application origin.");
  for (let attempt = 1; ; attempt += 1) {
    let response: APIResponse;
    try {
      response = await request.fetch(url.href, {
        method,
        headers: { Origin: origin, ...previewHeaders(origin) },
        ...(data !== undefined ? { data } : {}),
        maxRedirects: 0,
      });
    } catch {
      // Playwright's raw transport error can contain headers. Keep credentials out
      // of reporter output while still failing the verification.
      throw new Error("The selected application's API was unreachable. Check the preview access and server before repeating live verification.");
    }
    if (attempt === UNAVAILABLE_ATTEMPTS || !upstreamUnavailable(response, method)) return response;
    console.warn(`Live ${method} ${url.pathname} answered 503 because Supabase did not respond; retrying in ${UNAVAILABLE_RETRY_MS / 1000} s`);
    await new Promise(resolve => setTimeout(resolve, UNAVAILABLE_RETRY_MS));
  }
}

export async function privateNavigate(page: Page, path: string) {
  try { return await page.goto(path); }
  catch { throw new Error("The selected page could not be loaded. Confirm preview access and application availability."); }
}

/**
 * Open a customer link. When the document service does not answer, the page
 * shows a server error and retries itself; verification retries the same way,
 * so an answer (the document, or 404 for a revoked link) is always asserted.
 */
export async function customerNavigate(page: Page, url: string) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await privateNavigate(page, url);
    if (attempt === UNAVAILABLE_ATTEMPTS || (response?.status() ?? 0) < 500) return response;
    console.warn(`A customer link answered ${response?.status()} because the document service did not respond; retrying in ${UNAVAILABLE_RETRY_MS / 1000} s`);
    await new Promise(resolve => setTimeout(resolve, UNAVAILABLE_RETRY_MS));
  }
}

/**
 * Wait until an admin page has loaded its cloud records. Allows for one
 * unanswered Supabase read and its retry (about 10 s), after which the app
 * retries by itself: the reconnecting page refreshes after 3 s and a failed
 * first data load is retried after 3 s.
 */
export async function adminReady(page: Page) {
  await expect(page.getByRole("link", { name: "Saved to cloud", exact: true }), "The admin page must load its records from cloud storage").toBeVisible({ timeout: 30_000 });
}

/**
 * Leave an admin page only once its edits are saved. The admin deliberately
 * blocks unloading while a save is pending, which would cancel the navigation.
 */
export async function adminNavigate(page: Page, path: string) {
  if (page.url().startsWith("http") && new URL(page.url()).pathname.startsWith("/admin")) {
    await expect(page.getByRole("link", { name: "Saved to cloud", exact: true }), "Edits must reach cloud storage before leaving the page").toBeVisible();
  }
  const response = await privateNavigate(page, path);
  await adminReady(page);
  return response;
}
