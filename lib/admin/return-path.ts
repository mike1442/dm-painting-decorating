// After signing in, Mike returns to the admin page that sent him to /login, so
// a Quick quote link opened from ChatGPT with an expired session keeps its
// details. Only a page of this admin on this site is accepted: never another
// origin, a protocol-relative URL or the login page itself.

export const DEFAULT_ADMIN_PATH = "/admin/quotes";

const isAdminPath = (path: string) => path === "/admin" || path.startsWith("/admin/");

/** The sign-in page, remembering an admin page (path and query) to return to. */
export function loginPath(pathname: unknown, search: unknown = ""): string {
  if (typeof pathname !== "string" || !isAdminPath(pathname)) return "/login";
  const query = typeof search === "string" && search.startsWith("?") ? search : "";
  return `/login?${new URLSearchParams({ next: pathname + query })}`;
}

/** Where the login form goes after signing in: the remembered admin page, else Quotes. */
export function adminReturnPath(next: string | null | undefined, origin: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return DEFAULT_ADMIN_PATH;
  try {
    const url = new URL(next, origin);
    if (url.origin !== origin || !isAdminPath(url.pathname)) return DEFAULT_ADMIN_PATH;
    return url.pathname + url.search;
  } catch {
    return DEFAULT_ADMIN_PATH;
  }
}
