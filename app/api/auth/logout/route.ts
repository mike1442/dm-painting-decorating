import { cookies } from "next/headers";
import { ACCESS_COOKIE, REFRESH_COOKIE, sameOrigin } from "@/lib/admin/auth";
import { refreshSession, supabaseRequest } from "@/lib/server/supabase";
import { json } from "@/lib/server/http";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  const jar = await cookies();
  let token = jar.get(ACCESS_COOKIE)?.value;
  let revoked = true;
  try {
    if (!token && jar.get(REFRESH_COOKIE)?.value) token = (await refreshSession(jar.get(REFRESH_COOKIE)!.value)).access_token;
    if (token) await supabaseRequest("/auth/v1/logout?scope=local", { token, method: "POST" });
  } catch { revoked = false; }
  const response = json({ ok: true, revoked });
  response.cookies.delete(ACCESS_COOKIE); response.cookies.delete(REFRESH_COOKIE);
  return response;
}
