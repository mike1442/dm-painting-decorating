// Access rules for /admin and /api/admin. middleware.ts applies them to every
// request, and the admin layout checks again on the server. Everything fails
// closed: no Supabase configuration, no session, or no confirmed admin membership
// means no admin pages and no admin API.

/** Pages that must work while signed out. */
export const PUBLIC_ADMIN_PATHS = ["/admin/login", "/admin/auth/confirm"];

export type GateInput = {
  configured: boolean;
  path: string;
  /** Path plus query string, used to come back after signing in. */
  pathWithQuery?: string;
  signedIn: boolean;
  /** true or false from the database; null when it couldn't be checked. */
  member: boolean | null;
};

export type GateResult =
  | { action: "allow" }
  | { action: "redirect"; to: string }
  | { action: "json"; status: 401 | 403 | 503; error: string };

export const isPublicAdminPath = (path: string) => PUBLIC_ADMIN_PATHS.some(p => path === p || path.startsWith(`${p}/`));

/** Only allow returning to admin pages on this site after signing in. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/admin") || next.startsWith("//") || /[\\\r\n]/.test(next)) return "/admin";
  if (isPublicAdminPath(next.split("?")[0])) return "/admin";
  return next;
}

export function adminGate({ configured, path, pathWithQuery, signedIn, member }: GateInput): GateResult {
  const api = path.startsWith("/api/admin");
  const publicPage = isPublicAdminPath(path);
  if (!configured) {
    if (api) return { action: "json", status: 503, error: "The admin is not configured." };
    return publicPage ? { action: "allow" } : { action: "redirect", to: "/admin/login" };
  }
  if (publicPage) {
    if (path === "/admin/login" && signedIn && member === true) return { action: "redirect", to: "/admin" };
    return { action: "allow" };
  }
  if (!signedIn) {
    if (api) return { action: "json", status: 401, error: "Sign in required." };
    return { action: "redirect", to: `/admin/login?next=${encodeURIComponent(pathWithQuery ?? path)}` };
  }
  if (member !== true) {
    if (api) return { action: "json", status: 403, error: "Not an admin member." };
    return { action: "redirect", to: member === false ? "/admin/login?error=not-authorised" : "/admin/login?error=check-failed" };
  }
  return { action: "allow" };
}

/** Headers for every admin response: never indexed, cached, framed or leaked via referrer. */
export const adminSecurityHeaders: Record<string, string> = {
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, no-store",
};
