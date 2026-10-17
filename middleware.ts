import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE, adminSecurityHeaders } from "@/lib/admin/auth";
import { BackendError, refreshSession, verifyAdmin, type AuthSession } from "@/lib/server/supabase";
export async function middleware(request: NextRequest) {
  let token = request.cookies.get(ACCESS_COOKIE)?.value ?? "";
  let session: AuthSession | null = null;
  let allowed = false;
  let unavailable = false;
  try {
    try { allowed = await verifyAdmin(token); } catch (error) {
      if (!(error instanceof BackendError) || error.status !== 401) throw error;
    }
    if (!allowed && request.cookies.get(REFRESH_COOKIE)?.value) {
      session = await refreshSession(request.cookies.get(REFRESH_COOKIE)!.value);
      token = session.access_token;
      allowed = await verifyAdmin(token);
    }
  } catch (error) { unavailable = !(error instanceof BackendError) || error.status >= 500; }
  let response: NextResponse;
  if (allowed) {
    const headers = new Headers(request.headers);
    if (session) {
      request.cookies.set(ACCESS_COOKIE, token);
      request.cookies.set(REFRESH_COOKIE, session.refresh_token);
      headers.set("cookie", request.cookies.toString());
    }
    response = NextResponse.next({ request: { headers } });
    if (session) {
      const options = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };
      response.cookies.set(ACCESS_COOKIE, token, { ...options, maxAge: session.expires_in });
      response.cookies.set(REFRESH_COOKIE, session.refresh_token, { ...options, maxAge: 60 * 60 * 24 * 30 });
    }
  } else if (unavailable) {
    response = NextResponse.json({ error: "Authentication is temporarily unavailable. Please try again." }, { status: 503 });
  } else {
    response = request.nextUrl.pathname.startsWith("/api/") ? NextResponse.json({ error: "Please sign in." }, { status: 401 }) : NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete(ACCESS_COOKIE); response.cookies.delete(REFRESH_COOKIE);
  }
  for (const [key, value] of Object.entries(adminSecurityHeaders)) response.headers.set(key, value);
  return response;
}
export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
