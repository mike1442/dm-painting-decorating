import type { NextRequest } from "next/server";

// Authentication boundary for /admin. middleware.ts sends every admin request
// through checkAdminAccess, so this is the single place to add real sign-in
// (e.g. a Supabase Auth session check) when a secure backend is connected.
//
// There is deliberately NO login today. Nothing here is a password or a fake
// check: the admin pages contain no customer data, because every record lives
// only in the browser of the device that created it. Anyone opening /admin on
// another device sees an empty app.
//
// Server endpoints are different: they could expose shared data, so anything
// under /api/admin is refused until real authentication exists.

export type AdminAccess =
  | { allowed: true; mode: "device-only" }
  | { allowed: false; status: 401; reason: string };

export function checkAdminAccess(request: NextRequest): AdminAccess {
  if (request.nextUrl.pathname.startsWith("/api/admin")) {
    return { allowed: false, status: 401, reason: "Admin API routes require authentication, which is not configured yet." };
  }
  return { allowed: true, mode: "device-only" };
}

/** Headers for every admin response: never indexed, framed or leaked via referrer. */
export const adminSecurityHeaders: Record<string, string> = {
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
};
