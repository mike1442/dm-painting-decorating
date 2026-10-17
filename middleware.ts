import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { adminSecurityHeaders, checkAdminAccess } from "@/lib/admin/auth";

// Runs only for the admin area; the public website is untouched.
export function middleware(request: NextRequest) {
  const access = checkAdminAccess(request);
  const response = access.allowed ? NextResponse.next() : NextResponse.json({ error: access.reason }, { status: access.status });
  for (const [name, value] of Object.entries(adminSecurityHeaders)) response.headers.set(name, value);
  return response;
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*"],
};
