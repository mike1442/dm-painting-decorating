import assert from "node:assert/strict";
import test from "node:test";
import { BackendError, publicRpc } from "../../lib/server/supabase.ts";

test("Supabase transport always targets the pinned project, needs no deployment variables and never sends a privileged key", async context => {
  const envNames = ["NEXT_PUBLIC_SUPABASE_URL", "DM_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
  const previous = new Map(envNames.map(name => [name, process.env[name]]));
  context.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const clear = () => { for (const name of envNames) delete process.env[name]; };
  const fixtureJwt = (role: string) => [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ role })).toString("base64url"),
    "test-only-signature",
  ].join(".");
  const requested: { url: string; key: string | null }[] = [];
  context.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    requested.push({ url: String(input), key: new Headers(init?.headers).get("apikey") });
    return Response.json(null);
  });
  const request = async () => {
    await publicRpc("dm_get_shared_document", { p_token: "test-only-token" });
    return requested.at(-1)!;
  };
  const pinned = "https://fdctgtncawolrapwwevm.supabase.co/rest/v1/rpc/dm_get_shared_document";

  // A deployment with no Supabase variables uses the project's own public key.
  clear();
  assert.deepEqual(await request(), { url: pinned, key: "sb_publishable_6VBwZ_uNQJsUQ6ygEWtUWg_T_LlGL3K" });

  // Variables left by an integration for another project change nothing.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://kqjbgvjgsvbjflumorjr.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_other_project_fixture";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_other_project_fixture";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = fixtureJwt("anon");
  assert.deepEqual(await request(), { url: pinned, key: "sb_publishable_6VBwZ_uNQJsUQ6ygEWtUWg_T_LlGL3K" }, "Another project's URL or keys must never be used");

  // This project's own host on another port (the isolated emulator) is honoured.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fdctgtncawolrapwwevm.supabase.co:54443/ignored-path";
  assert.equal((await request()).url, "https://fdctgtncawolrapwwevm.supabase.co:54443/rest/v1/rpc/dm_get_shared_document");
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://fdctgtncawolrapwwevm.supabase.co";
  assert.equal((await request()).url, pinned, "Plain HTTP is never used");
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;

  // An explicit server-only key overrides it (e.g. after a key rotation, or the isolated emulator).
  process.env.DM_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_rotated_fixture";
  assert.deepEqual(await request(), { url: pinned, key: "sb_publishable_rotated_fixture" });
  const legacyAnon = fixtureJwt("anon");
  process.env.DM_SUPABASE_PUBLISHABLE_KEY = legacyAnon;
  assert.equal((await request()).key, legacyAnon, "Legacy anon JWTs remain supported");

  for (const forbidden of ["sb_secret_forbidden_fixture", fixtureJwt("service_role"), "not-a-supabase-key"]) {
    process.env.DM_SUPABASE_PUBLISHABLE_KEY = forbidden;
    const before = requested.length;
    await assert.rejects(publicRpc("dm_get_shared_document", { p_token: "test-only-token" }),
      (error: unknown) => error instanceof BackendError && error.status === 503 && error.code === "configuration");
    assert.equal(requested.length, before, "A privileged or unknown key must never be sent upstream");
  }
});
