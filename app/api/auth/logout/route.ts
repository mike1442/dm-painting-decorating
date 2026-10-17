import { cookies } from "next/headers";
import { ACCESS_COOKIE, REFRESH_COOKIE, sameOrigin } from "@/lib/admin/auth";
import { revokeCurrentSession } from "@/lib/server/session";
import { json } from "@/lib/server/http";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  const jar = await cookies();
  const revoked = await revokeCurrentSession(jar.get(ACCESS_COOKIE)?.value, jar.get(REFRESH_COOKIE)?.value);
  const response = json({ ok: true, revoked });
  response.cookies.delete(ACCESS_COOKIE); response.cookies.delete(REFRESH_COOKIE);
  return response;
}
