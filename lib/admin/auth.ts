export const ADMIN_EMAIL = "mike@dmpaintingdecorating.co.uk";
export const ACCESS_COOKIE = "dm-access";
export const REFRESH_COOKIE = "dm-refresh";
/** Drop the access cookie a minute before its JWT expires, so requests refresh instead of failing. */
export const accessCookieMaxAge = (expiresIn: number) => Number.isFinite(expiresIn) ? Math.max(60, Math.floor(expiresIn) - 60) : 3540;
export const adminSecurityHeaders: Record<string, string> = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
};
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin && request.headers.get("sec-fetch-site") !== "cross-site";
}
