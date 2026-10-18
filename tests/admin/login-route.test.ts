import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

test("sign-in revokes any Auth session it will not hand to the browser", async context => {
  // Only framework adapters and project path resolution are substituted. The
  // actual route, Supabase client, session revocation and HTTP mapping execute intact.
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
  const { POST } = await import("../../app/api/auth/login/route.ts");

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

  let membership: "member" | "not-member" | "outage" = "member";
  const calls: string[] = [];
  context.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const authorization = new Headers(init?.headers).get("authorization");
    calls.push(`${url.pathname}${authorization ? ` ${authorization}` : ""}`);
    if (url.pathname === "/auth/v1/token") return Response.json({ access_token: "issued-access-fixture", refresh_token: "issued-refresh-fixture", expires_in: 3600 });
    if (url.pathname === "/auth/v1/user") return Response.json({ email: "mike@dmpaintingdecorating.co.uk", email_confirmed_at: "2026-10-18" });
    if (url.pathname === "/auth/v1/logout") return new Response(null, { status: 204 });
    if (membership === "outage") return Response.json({}, { status: 503 });
    return Response.json(membership === "member");
  });

  const origin = "https://admin.example.test";
  const signIn = () => POST(new Request(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email: "mike@dmpaintingdecorating.co.uk", password: "fixture-password-only" }),
  }));
  const revocation = "/auth/v1/logout Bearer issued-access-fixture";

  for (const scenario of ["not-member", "outage"] as const) {
    membership = scenario;
    calls.length = 0;
    const response = await signIn();
    assert.equal(response.status, scenario === "not-member" ? 403 : 503);
    assert.deepEqual(response.headers.getSetCookie(), [], "No session cookie may be issued without admin membership");
    assert.equal(calls.at(-1), revocation, `${scenario}: the newly issued Auth session must be revoked`);
  }

  membership = "member";
  calls.length = 0;
  const response = await signIn();
  assert.equal(response.status, 200);
  assert.deepEqual(response.headers.getSetCookie(), ["dm-access=issued-access-fixture", "dm-refresh=issued-refresh-fixture"]);
  assert.equal(calls.includes(revocation), false, "An authorised sign-in keeps its session");
});
