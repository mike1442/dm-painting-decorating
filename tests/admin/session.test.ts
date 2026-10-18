import test from "node:test";
import assert from "node:assert/strict";
import { revokeCurrentSession } from "../../lib/server/session.ts";

test("logout revokes an expired-access session using its private refresh token", async context => {
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
  const calls: string[] = [];
  let mode: "normal" | "expired" | "expired-403" | "session-gone" | "invalid-refresh" | "outage" = "normal";
  context.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    if (path.endsWith("/token")) {
      if (mode === "invalid-refresh") return Response.json({ code: "refresh_token_not_found" }, { status: 401 });
      assert.deepEqual(JSON.parse(String(init?.body)), { refresh_token: "private-refresh-fixture" });
      return Response.json({ access_token: "fresh-access-fixture", refresh_token: "rotated-refresh-fixture", expires_in: 3600 });
    }
    if (mode === "outage") return Response.json({}, { status: 503 });
    const token = new Headers(init?.headers).get("authorization");
    if (mode === "expired" && token === "Bearer expired-access-fixture") return Response.json({ code: "bad_jwt" }, { status: 401 });
    // Hosted Supabase Auth's actual responses for an expired JWT and a revoked session.
    if (mode === "expired-403" && token === "Bearer expired-access-fixture") return Response.json({ code: 403, error_code: "bad_jwt" }, { status: 403 });
    if (mode === "session-gone") return Response.json({ code: 403, error_code: "session_not_found" }, { status: 403 });
    return new Response(null, { status: 204 });
  });
  assert.equal(await revokeCurrentSession(), true);
  assert.equal(calls.length, 0);
  assert.equal(await revokeCurrentSession("active-access-fixture"), true);
  calls.length = 0;
  assert.equal(await revokeCurrentSession(undefined, "private-refresh-fixture"), true);
  assert.deepEqual(calls, ["/auth/v1/token", "/auth/v1/logout"]);
  calls.length = 0;
  mode = "expired";
  assert.equal(await revokeCurrentSession("expired-access-fixture", "private-refresh-fixture"), true);
  assert.deepEqual(calls, ["/auth/v1/logout", "/auth/v1/token", "/auth/v1/logout"]);
  calls.length = 0;
  mode = "expired-403";
  assert.equal(await revokeCurrentSession("expired-access-fixture", "private-refresh-fixture"), true);
  assert.deepEqual(calls, ["/auth/v1/logout", "/auth/v1/token", "/auth/v1/logout"], "403 bad_jwt must revoke through the refresh token");
  calls.length = 0;
  mode = "session-gone";
  assert.equal(await revokeCurrentSession("active-access-fixture", "private-refresh-fixture"), true, "Auth confirming the session no longer exists counts as revoked");
  assert.deepEqual(calls, ["/auth/v1/logout"], "A session Auth no longer has must not be refreshed");
  calls.length = 0;
  mode = "invalid-refresh";
  assert.equal(await revokeCurrentSession(undefined, "private-refresh-fixture"), false);
  assert.deepEqual(calls, ["/auth/v1/token"]);
  calls.length = 0;
  mode = "outage";
  assert.equal(await revokeCurrentSession("active-access-fixture", "private-refresh-fixture"), false);
  assert.deepEqual(calls, ["/auth/v1/logout"], "An outage must not create extra Auth sessions or loop");
});
