// Public Supabase settings. Both values are safe in the browser: access to data is
// enforced by Supabase Auth and row-level security, not by keeping these secret.
// When either is missing the admin fails closed (no sign-in, no data).

export type SupabaseConfig = { url: string; key: string };

function isSecretKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  // A legacy service_role JWT must never reach the browser either.
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const claims = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return claims?.role === "service_role";
  } catch {
    return false;
  }
}

export function supabaseConfig(): SupabaseConfig | null {
  // Written out in full so Next.js can inline them at build time.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key || isSecretKey(key)) return null;
  try {
    const parsed = new URL(url);
    const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "https:" && !local) return null;
  } catch {
    return null;
  }
  return { url: url.replace(/\/+$/, ""), key };
}

const REQUEST_TIMEOUT_MS = 20_000;

/** fetch with a timeout, so a dead mobile connection reports "offline" instead of hanging. */
export const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  init?.signal?.addEventListener("abort", () => controller.abort());
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};
