import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { emptyData } from "../../lib/admin/factories.ts";

test("a save the server refused before writing is marked safe to repeat; a failed write is not", async context => {
  // Only framework adapters and project path resolution are substituted. The
  // actual route, Supabase client and HTTP failure mapping execute intact.
  const response = new URL("../support/next-response.ts", import.meta.url).href;
  const headers = new URL("../support/next-headers.ts", import.meta.url).href;
  const httpUrl = new URL("../../lib/server/http.ts", import.meta.url).href;
  const hooks = registerHooks({
    resolve(specifier, resolution, nextResolve) {
      if (specifier === "next/server") return { url: response, shortCircuit: true };
      if (specifier === "next/headers") return { url: headers, shortCircuit: true };
      if (specifier.startsWith("@/")) return { url: new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
      if (resolution.parentURL === httpUrl && ["../admin/auth", "./supabase"].includes(specifier)) {
        return { url: new URL(`${specifier}.ts`, httpUrl).href, shortCircuit: true };
      }
      return nextResolve(specifier, resolution);
    },
  });
  context.after(() => hooks.deregister());
  const { PUT } = await import("../../app/api/admin/data/route.ts");
  const { requestCookies } = await import("../support/next-headers.ts");

  const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.DM_SUPABASE_PUBLISHABLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fdctgtncawolrapwwevm.supabase.co";
  process.env.DM_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_unit_test";
  context.after(() => {
    if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.DM_SUPABASE_PUBLISHABLE_KEY;
    else process.env.DM_SUPABASE_PUBLISHABLE_KEY = oldKey;
  });
  context.mock.method(console, "warn", () => {});
  requestCookies.set("dm-access", "access-fixture");

  const now = "2026-10-18T12:00:00.000Z";
  let unanswered = "";
  const calls: string[] = [];
  context.mock.method(globalThis, "fetch", async (input: unknown) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    if (path === unanswered) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    if (path === "/auth/v1/user") return Response.json({ email: "mike@dmpaintingdecorating.co.uk", email_confirmed_at: "2026-10-18" });
    if (path.endsWith("/dm_admin_is_member")) return Response.json(true);
    if (path.endsWith("/dm_get_data")) return Response.json({ data: emptyData(now), revision: 4 });
    return Response.json({ data: emptyData(now), revision: 5 });
  });
  const save = (revision = 4) => PUT(new Request("https://admin.example.test/api/admin/data", {
    method: "PUT",
    headers: { "content-type": "application/json", origin: "https://admin.example.test", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ revision, data: emptyData(now) }),
  }));

  for (const path of ["/auth/v1/user", "/rest/v1/rpc/dm_admin_is_member", "/rest/v1/rpc/dm_get_data"]) {
    unanswered = path;
    calls.length = 0;
    const refused = await save();
    assert.equal(refused.status, 503);
    assert.equal(refused.headers.get("retry-after"), "3", `${path}: nothing was written, so the save may be repeated`);
    assert.equal(calls.includes("/rest/v1/rpc/dm_save_data"), false);
  }

  unanswered = "/rest/v1/rpc/dm_save_data";
  const ambiguous = await save();
  assert.equal(ambiguous.status, 503);
  assert.equal(ambiguous.headers.get("retry-after"), null, "A write that may have been applied must not be repeated automatically");

  unanswered = "";
  assert.equal((await save()).status, 200);
  const stale = await save(3);
  assert.equal(stale.status, 409);
  assert.equal(stale.headers.get("retry-after"), null);
});
