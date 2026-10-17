import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { adminGate, adminSecurityHeaders, isPublicAdminPath } from "@/lib/admin/auth";
import { fetchWithTimeout, supabaseConfig } from "@/lib/supabase/config";

// Runs only for the admin area; the public website is untouched. Refreshes the
// Supabase session cookie, verifies the sign-in, asks the database whether the
// user is an admin member, then applies the rules in lib/admin/auth.ts.
export async function middleware(request: NextRequest) {
  const config = supabaseConfig();
  const path = request.nextUrl.pathname;
  let response = NextResponse.next({ request });
  let signedIn = false;
  let member: boolean | null = null;

  if (config) {
    const supabase = createServerClient(config.url, config.key, {
      global: { fetch: fetchWithTimeout },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: list => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub);
    if (signedIn && (!isPublicAdminPath(path) || path === "/admin/login")) {
      const { data: isMember, error } = await supabase.rpc("dm_admin_is_member");
      member = error ? null : isMember === true;
    }
  }

  const result = adminGate({ configured: Boolean(config), path, pathWithQuery: path + request.nextUrl.search, signedIn, member });
  let final = response;
  if (result.action !== "allow") {
    final =
      result.action === "redirect"
        ? NextResponse.redirect(new URL(result.to, request.url))
        : NextResponse.json({ error: result.error }, { status: result.status });
    // Keep any refreshed session cookies.
    response.cookies.getAll().forEach(cookie => final.cookies.set(cookie));
  }
  for (const [name, value] of Object.entries(adminSecurityHeaders)) final.headers.set(name, value);
  return final;
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*"],
};
