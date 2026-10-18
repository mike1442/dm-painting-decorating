import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { BackendError } from "../../lib/server/supabase.ts";

test("real middleware preserves sessions on upstream rate limits and fails closed", async context => {
  // Only framework adapters and project path resolution are substituted. The
  // actual middleware, Supabase client and HTTP failure mapper execute intact.
  const adapter = new URL("../support/next-response.ts", import.meta.url).href;
  const httpUrl = new URL("../../lib/server/http.ts", import.meta.url).href;
  const hooks = registerHooks({
    resolve(specifier, resolution, nextResolve) {
      if (specifier === "next/server" || specifier === "next/headers") return { url: adapter, shortCircuit: true };
      if (specifier.startsWith("@/")) return { url: new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
      if (resolution.parentURL === httpUrl && ["../admin/auth", "./supabase"].includes(specifier)) {
        return { url: new URL(`${specifier}.ts`, httpUrl).href, shortCircuit: true };
      }
      return nextResolve(specifier, resolution);
    },
  });
  context.after(() => hooks.deregister());
  const { middleware } = await import("../../middleware.ts");
  const { failure } = await import("../../lib/server/http.ts");

  const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fdctgtncawolrapwwevm.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_unit_test";
  context.after(() => {
    if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = oldKey;
  });

  type Mode = "user-rate-limit" | "member-rate-limit" | "refresh-rate-limit" | "invalid" | "expired" | "outage" | "allowed";
  let mode: Mode = "allowed";
  const calls: string[] = [];
  context.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    if (path.endsWith("/user")) {
      if (mode === "user-rate-limit") return Response.json({}, { status: 429 });
      if (mode === "outage") return Response.json({}, { status: 503 });
      if (mode === "invalid" || mode === "refresh-rate-limit") return Response.json({}, { status: 401 });
      // Hosted Supabase Auth reports an expired access JWT as 403 bad_jwt.
      if (mode === "expired" && new Headers(init?.headers).get("authorization") === "Bearer access-fixture") {
        return Response.json({ code: 403, error_code: "bad_jwt", msg: "invalid JWT: token is expired" }, { status: 403 });
      }
      return Response.json({ email: "mike@dmpaintingdecorating.co.uk", email_confirmed_at: "2026-10-18" });
    }
    if (path.endsWith("/token") && mode === "expired") return Response.json({ access_token: "fresh-access-fixture", refresh_token: "rotated-refresh-fixture", expires_in: 3600 });
    if (path.endsWith("/token")) return Response.json({}, { status: mode === "refresh-rate-limit" ? 429 : 400 });
    return mode === "member-rate-limit" ? Response.json({}, { status: 429 }) : Response.json(true);
  });

  function request(path: string) {
    const url = new URL(path, "https://admin.example.test");
    const values = new Map([["dm-access", "access-fixture"], ["dm-refresh", "refresh-fixture"]]);
    return {
      url: url.href, nextUrl: url, headers: new Headers(),
      cookies: {
        get: (name: string) => values.has(name) ? { value: values.get(name)! } : undefined,
        set: (name: string, value: string) => { values.set(name, value); },
        toString: () => [...values].map(([name, value]) => `${name}=${value}`).join("; "),
      },
    } as unknown as Parameters<typeof middleware>[0];
  }

  for (const rateLimit of ["user-rate-limit", "member-rate-limit", "refresh-rate-limit"] as const) {
    mode = rateLimit;
    calls.length = 0;
    for (const path of ["/api/admin/data", "/admin/quotes"]) {
      const response = await middleware(request(path));
      assert.equal(response.status, 503, `${rateLimit}: protected requests remain unavailable`);
      assert.equal(response.headers.get("x-middleware-next"), null, "Rate limits must never grant admin access");
      assert.deepEqual(response.headers.getSetCookie(), [], "A temporary rate limit must preserve both session cookies");
      assert.equal(response.headers.get("location"), null, "A valid session must not be redirected to sign-in");
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    }
    if (rateLimit === "member-rate-limit") assert.ok(calls.includes("/rest/v1/rpc/dm_admin_is_member"));
    if (rateLimit === "refresh-rate-limit") assert.ok(calls.includes("/auth/v1/token"));
  }

  mode = "invalid";
  for (const path of ["/api/admin/data", "/admin/quotes"]) {
    const response = await middleware(request(path));
    assert.equal(response.status, path.startsWith("/api/") ? 401 : 307);
    assert.deepEqual(response.headers.getSetCookie(), ["dm-access=; Max-Age=0", "dm-refresh=; Max-Age=0"], "Invalid sessions must still be cleared");
    assert.equal(response.headers.get("x-middleware-next"), null);
  }

  mode = "expired";
  for (const path of ["/api/admin/data", "/admin/quotes"]) {
    calls.length = 0;
    const response = await middleware(request(path));
    assert.equal(response.headers.get("x-middleware-next"), "1", "An expired access JWT must be refreshed instead of signing the admin out");
    assert.deepEqual(response.headers.getSetCookie(), ["dm-access=fresh-access-fixture", "dm-refresh=rotated-refresh-fixture"], "The rotated session must replace both cookies");
    assert.deepEqual(calls, ["/auth/v1/user", "/auth/v1/token", "/auth/v1/user", "/rest/v1/rpc/dm_admin_is_member"]);
  }

  mode = "outage";
  const unavailable = await middleware(request("/api/admin/data"));
  assert.equal(unavailable.status, 503);
  assert.deepEqual(unavailable.headers.getSetCookie(), [], "Upstream outages must preserve cookies");

  mode = "allowed";
  const allowed = await middleware(request("/api/admin/data"));
  assert.equal(allowed.headers.get("x-middleware-next"), "1", "Verified admin sessions must still proceed");

  const rateLimited = failure(new BackendError(429, "over_request_rate_limit"));
  assert.equal(rateLimited.status, 429, "Route-level upstream rate limits must remain retryable");
  assert.match((await rateLimited.json()).error, /retry/);
  assert.deepEqual(rateLimited.headers.getSetCookie(), []);
  assert.match(rateLimited.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(failure(new BackendError(401)).status, 401);
  assert.equal(failure(new BackendError(503)).status, 503);
});
