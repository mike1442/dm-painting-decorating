import type { APIRequestContext, APIResponse, BrowserContext, Page } from "@playwright/test";

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

export async function liveApi(request: APIRequestContext, origin: string, path: string, method: "GET" | "PUT" | "POST" = "GET", data?: unknown): Promise<APIResponse> {
  const url = new URL(path, origin);
  if (url.origin !== origin || !url.pathname.startsWith("/api/")) throw new Error("Refusing an API request outside the selected application origin.");
  try {
    return await request.fetch(url.href, {
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
}

export async function privateNavigate(page: Page, path: string) {
  try { return await page.goto(path); }
  catch { throw new Error("The selected page could not be loaded. Confirm preview access and application availability."); }
}
