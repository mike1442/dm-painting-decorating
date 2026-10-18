import { ADMIN_EMAIL } from "../admin/auth.ts";
export class BackendError extends Error {
  status: number;
  code: string;
  constructor(status: number, code = "", message = "The database request failed.") { super(message); this.status = status; this.code = code; }
}
/** The only Supabase project this application uses. */
const PROJECT_HOST = "fdctgtncawolrapwwevm.supabase.co";
// Publishable keys are public by design: Auth, RLS and the guarded functions
// protect every record, never this key. Shipping it means a deployment needs
// no Supabase variables, and stale ones (e.g. an integration for another
// project) cannot redirect or break the admin.
const PROJECT_PUBLISHABLE_KEY = "sb_publishable_6VBwZ_uNQJsUQ6ygEWtUWg_T_LlGL3K";
function projectUrl() {
  // A configured address is honoured only for this project's own host (the
  // isolated emulator serves it on another port); any other project is ignored.
  try {
    const configured = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
    if (configured.protocol === "https:" && configured.hostname === PROJECT_HOST) return configured.origin;
  } catch {}
  return `https://${PROJECT_HOST}`;
}
function configuration() {
  const url = projectUrl();
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || PROJECT_PUBLISHABLE_KEY;
  let publicKey = key.startsWith("sb_publishable_");
  if (key.startsWith("eyJ")) {
    try { publicKey = JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role === "anon"; } catch { publicKey = false; }
  }
  if (!publicKey) throw new BackendError(503, "configuration", "Only a Supabase public API key may be configured for this application.");
  return { url, key };
}
const READ_TIMEOUT_MS = 5000;
const WRITE_TIMEOUT_MS = 15000;
const SLOW_MS = 2000;
/** Read-only RPCs may be repeated safely; every other RPC writes. */
const READ_ONLY_RPCS = new Set(["dm_admin_is_member", "dm_get_data", "dm_get_shared_document"]);

/** Operational log: method and path only, never the query, tokens or bodies. */
function logUpstream(method: string, path: string, outcome: string, started: number) {
  console.warn(`Supabase ${method} ${path.split("?")[0]} ${outcome} after ${Date.now() - started} ms`);
}

export async function supabaseRequest(path: string, { token, method = "GET", body, retryable = method === "GET" }: { token?: string; method?: string; body?: unknown; retryable?: boolean } = {}) {
  const { url, key } = configuration();
  // Every admin request waits on several sequential Supabase calls, so one stalled
  // connection must not hold it for long. Reads get a short deadline and one
  // retry; writes get one longer attempt, because repeating them is unsafe.
  for (let attempt = 1; ; attempt += 1) {
    const started = Date.now();
    let response: Response;
    let text: string;
    try {
      response = await fetch(`${url}${path}`, {
        method, cache: "no-store", signal: AbortSignal.timeout(retryable ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS),
        headers: { apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      text = await response.text();
    } catch (error) {
      const retry = retryable && attempt === 1;
      logUpstream(method, path, retry ? "failed; retrying" : "failed", started);
      if (retry) continue;
      throw error;
    }
    if (Date.now() - started > SLOW_MS) logUpstream(method, path, `returned HTTP ${response.status}`, started);
    let result: ReturnType<typeof JSON.parse> = null;
    // An unreadable success body is a failed request, never an empty answer.
    if (text) {
      try { result = JSON.parse(text); }
      catch { if (response.ok) throw new BackendError(502, "response"); }
    }
    // Auth errors carry a numeric HTTP `code` and the reason in `error_code`; database errors carry the SQLSTATE in `code`.
    if (!response.ok) throw new BackendError(response.status, String(typeof result?.error_code === "string" ? result.error_code : result?.code ?? ""));
    return result;
  }
}
export async function publicRpc(name: string, body: Record<string, unknown>) {
  return supabaseRequest(`/rest/v1/rpc/${name}`, { method: "POST", body, retryable: READ_ONLY_RPCS.has(name) });
}
export async function adminRpc(token: string, name: string, body: Record<string, unknown> = {}) {
  return supabaseRequest(`/rest/v1/rpc/${name}`, { token, method: "POST", body, retryable: READ_ONLY_RPCS.has(name) });
}
export async function verifyAdmin(token: string): Promise<boolean> {
  if (!token) return false;
  const user = await supabaseRequest("/auth/v1/user", { token });
  if (user?.email?.toLowerCase() !== ADMIN_EMAIL || !user.email_confirmed_at) return false;
  return (await adminRpc(token, "dm_admin_is_member")) === true;
}
export type AuthSession = { access_token: string; refresh_token: string; expires_in: number; user?: { email?: string; email_confirmed_at?: string } };
export async function refreshSession(refresh: string): Promise<AuthSession> {
  return supabaseRequest("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: refresh } });
}
