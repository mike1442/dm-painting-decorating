import { ADMIN_EMAIL } from "../admin/auth.ts";
export class BackendError extends Error {
  status: number;
  code: string;
  constructor(status: number, code = "", message = "The database request failed.") { super(message); this.status = status; this.code = code; }
}
function configuration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new BackendError(503, "configuration", "Supabase is not configured. Contact the administrator.");
  if (new URL(url).hostname !== "kqjbgvjgsvbjflumorjr.supabase.co") throw new BackendError(503, "project", "The Supabase project configuration is incorrect.");
  let publicKey = key.startsWith("sb_publishable_");
  if (key.startsWith("eyJ")) {
    try { publicKey = JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role === "anon"; } catch { publicKey = false; }
  }
  if (!publicKey) throw new BackendError(503, "configuration", "Only a Supabase public API key may be configured for this application.");
  return { url, key };
}
export async function supabaseRequest(path: string, { token, method = "GET", body }: { token?: string; method?: string; body?: unknown } = {}) {
  const { url, key } = configuration();
  const response = await fetch(`${url}${path}`, {
    method, cache: "no-store", signal: AbortSignal.timeout(15000),
    headers: { apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new BackendError(response.status, String(result?.code || result?.error_code || ""));
  return result;
}
export async function publicRpc(name: string, body: Record<string, unknown>) {
  return supabaseRequest(`/rest/v1/rpc/${name}`, { method: "POST", body });
}
export async function adminRpc(token: string, name: string, body: Record<string, unknown> = {}) {
  return supabaseRequest(`/rest/v1/rpc/${name}`, { token, method: "POST", body });
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
