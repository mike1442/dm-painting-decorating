import { BackendError, refreshSession, supabaseRequest } from "./supabase.ts";

/** Revoke the current Auth session even if its access JWT expired first. */
export async function revokeCurrentSession(access?: string, refresh?: string): Promise<boolean> {
  if (!access && !refresh) return true;
  try {
    let token = access;
    let refreshed = false;
    if (!token && refresh) {
      token = (await refreshSession(refresh)).access_token;
      refreshed = true;
    }
    try {
      await supabaseRequest("/auth/v1/logout?scope=local", { token, method: "POST" });
    } catch (error) {
      if (!(error instanceof BackendError) || error.status !== 401 || refreshed || !refresh) throw error;
      token = (await refreshSession(refresh)).access_token;
      await supabaseRequest("/auth/v1/logout?scope=local", { token, method: "POST" });
    }
    return true;
  } catch { return false; }
}
