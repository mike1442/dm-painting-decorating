import { ADMIN_EMAIL, ACCESS_COOKIE, REFRESH_COOKIE, sameOrigin } from "@/lib/admin/auth";
import { BackendError, supabaseRequest, verifyAdmin, type AuthSession } from "@/lib/server/supabase";
import { failure, json, readBody } from "@/lib/server/http";
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
    const body = await readBody(request, 4000);
    if (body.email?.trim().toLowerCase() !== ADMIN_EMAIL || typeof body.password !== "string" || body.password.length < 8 || body.password.length > 200) return json({ error: "Check your email and password." }, 400);
    const session: AuthSession = await supabaseRequest("/auth/v1/token?grant_type=password", { method: "POST", body: { email: ADMIN_EMAIL, password: body.password } });
    if (!await verifyAdmin(session.access_token)) return json({ error: "This account is not authorised as the administrator." }, 403);
    const response = json({ ok: true });
    const options = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };
    response.cookies.set(ACCESS_COOKIE, session.access_token, { ...options, maxAge: session.expires_in });
    response.cookies.set(REFRESH_COOKIE, session.refresh_token, { ...options, maxAge: 60 * 60 * 24 * 30 });
    return response;
  } catch (error) {
    if (error instanceof BackendError && error.status < 500) return json({ error: error.status === 429 ? "Too many attempts. Wait a few minutes and try again." : "Sign-in failed. Check your email and password, and confirm your email address." }, error.status === 429 ? 429 : 401);
    return failure(error);
  }
}
