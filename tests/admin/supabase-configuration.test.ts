import assert from "node:assert/strict";
import test from "node:test";
import { BackendError, publicRpc } from "../../lib/server/supabase.ts";

test("Supabase transport accepts the existing Vercel publishable key name with safe precedence", async context => {
  const keyNames = ["SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
  const envNames = ["NEXT_PUBLIC_SUPABASE_URL", ...keyNames];
  const previous = new Map(envNames.map(name => [name, process.env[name]]));
  context.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fdctgtncawolrapwwevm.supabase.co";
  const fixtureJwt = (role: string) => [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ role })).toString("base64url"),
    "test-only-signature",
  ].join(".");
  const legacyAnon = fixtureJwt("anon");
  const requestedKeys: (string | null)[] = [];
  context.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    assert.equal(String(input), "https://fdctgtncawolrapwwevm.supabase.co/rest/v1/rpc/dm_get_shared_document");
    requestedKeys.push(new Headers(init?.headers).get("apikey"));
    return Response.json(null);
  });
  const request = () => publicRpc("dm_get_shared_document", { p_token: "test-only-token" });
  const clearKeys = () => { for (const name of keyNames) delete process.env[name]; };
  const configurationError = (error: unknown) => error instanceof BackendError && error.status === 503 && error.code === "configuration";

  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_server_fixture";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_vercel_fixture";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = legacyAnon;
  await request();
  assert.equal(requestedKeys.at(-1), "sb_publishable_server_fixture", "Server-only configuration has first priority");

  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  await request();
  assert.equal(requestedKeys.at(-1), "sb_publishable_vercel_fixture", "The modern public name precedes the legacy alias");
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  await request();
  assert.equal(requestedKeys.at(-1), "sb_publishable_vercel_fixture", "The existing Vercel URL plus modern public key works on its own");

  clearKeys();
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = legacyAnon;
  await request();
  assert.equal(requestedKeys.at(-1), legacyAnon, "Legacy anon JWTs remain supported");

  for (const name of keyNames) {
    for (const forbidden of ["sb_secret_forbidden_fixture", fixtureJwt("service_role")]) {
      clearKeys();
      process.env[name] = forbidden;
      const before = requestedKeys.length;
      await assert.rejects(request(), configurationError, `${name} must reject privileged keys`);
      assert.equal(requestedKeys.length, before, "A privileged key must never be sent upstream");
    }
  }

  clearKeys();
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_secret_forbidden_fixture";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_vercel_fixture";
  await assert.rejects(request(), configurationError, "An invalid preferred key must fail closed rather than fall through");

  clearKeys();
  await assert.rejects(request(), configurationError, "Missing API keys remain a configuration failure");
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_vercel_fixture";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://different-project.supabase.co";
  const before = requestedKeys.length;
  await assert.rejects(request(), (error: unknown) => error instanceof BackendError && error.status === 503 && error.code === "project");
  assert.equal(requestedKeys.length, before, "Supporting the new name must not allow another Supabase project");
});
