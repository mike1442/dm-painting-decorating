import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE, accessCookieMaxAge, adminSecurityHeaders } from "@/lib/admin/auth";
import { loginPath } from "@/lib/admin/return-path";
import { BackendError, refreshSession, verifyAdmin, type AuthSession } from "@/lib/server/supabase";
const RETRY_SECONDS = 3;
// Shown instead of a bare JSON error when a page cannot be authorised because
// Supabase Auth did not answer; it retries itself, so a brief stall recovers.
const RECONNECTING_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="${RETRY_SECONDS}"><title>Reconnecting | D&amp;M admin</title></head><body style="font-family:system-ui,sans-serif;max-width:34rem;margin:12vh auto;padding:0 16px;line-height:1.5"><h1>Reconnecting…</h1><p role="status">Sign-in could not be checked because the secure service did not respond. This page tries again automatically.</p><p><a href="">Try again now</a></p></body></html>`;
export async function middleware(request: NextRequest) {
  const api = request.nextUrl.pathname.startsWith("/api/");
  let token = request.cookies.get(ACCESS_COOKIE)?.value ?? "";
  let session: AuthSession | null = null;
  let allowed = false;
  let unavailable = false;
  try {
    // Supabase Auth reports an expired or invalid access JWT as 401 or 403
    // (bad_jwt/session_not_found); either way the refresh token decides.
    try { allowed = await verifyAdmin(token); } catch (error) {
      if (!(error instanceof BackendError) || (error.status !== 401 && error.status !== 403)) throw error;
    }
    if (!allowed && request.cookies.get(REFRESH_COOKIE)?.value) {
      session = await refreshSession(request.cookies.get(REFRESH_COOKIE)!.value);
      token = session.access_token;
      allowed = await verifyAdmin(token);
    }
  } catch (error) { unavailable = !(error instanceof BackendError) || error.status === 429 || error.status >= 500; }
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
      response.cookies.set(ACCESS_COOKIE, token, { ...options, maxAge: accessCookieMaxAge(session.expires_in) });
      response.cookies.set(REFRESH_COOKIE, session.refresh_token, { ...options, maxAge: 60 * 60 * 24 * 30 });
    }
  } else if (unavailable) {
    response = api
      ? NextResponse.json({ error: "Authentication is temporarily unavailable. Please try again." }, { status: 503, headers: { "Retry-After": String(RETRY_SECONDS) } })
      : new NextResponse(RECONNECTING_PAGE, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Retry-After": String(RETRY_SECONDS) } });
  } else {
    // A page opened with an expired session (e.g. a Quick quote link from ChatGPT) is reopened after sign-in.
    const login = request.method === "GET" ? loginPath(request.nextUrl.pathname, request.nextUrl.search) : "/login";
    response = api ? NextResponse.json({ error: "Please sign in." }, { status: 401 }) : NextResponse.redirect(new URL(login, request.url));
    response.cookies.delete(ACCESS_COOKIE); response.cookies.delete(REFRESH_COOKIE);
  }
  for (const [key, value] of Object.entries(adminSecurityHeaders)) response.headers.set(key, value);
  return response;
}
export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
