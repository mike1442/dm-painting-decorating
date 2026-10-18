import assert from "node:assert/strict";
import test from "node:test";
import { adminRpc, BackendError, supabaseRequest, verifyAdmin } from "../../lib/server/supabase.ts";

test("stalled reads are retried once, writes never, and unreadable answers are failures", async context => {
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
  const warnings: string[] = [];
  context.mock.method(console, "warn", (message: string) => { warnings.push(message); });

  const calls: string[] = [];
  let stallOnce = new Set<string>();
  let reply: () => Response = () => Response.json(true);
  context.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    assert.ok(init?.signal instanceof AbortSignal, "Every upstream request needs a deadline");
    if (stallOnce.has(path)) {
      stallOnce.delete(path);
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }
    if (path === "/auth/v1/user") return Response.json({ email: "mike@dmpaintingdecorating.co.uk", email_confirmed_at: "2026-10-18" });
    return reply();
  });

  // One stalled connection on each read recovers without signing Mike out.
  stallOnce = new Set(["/auth/v1/user", "/rest/v1/rpc/dm_admin_is_member"]);
  assert.equal(await verifyAdmin("private-access-fixture"), true);
  assert.deepEqual(calls, ["/auth/v1/user", "/auth/v1/user", "/rest/v1/rpc/dm_admin_is_member", "/rest/v1/rpc/dm_admin_is_member"]);
  assert.equal(warnings.length, 2);
  for (const warning of warnings) {
    assert.match(warning, /^Supabase (GET|POST) \/(auth\/v1\/user|rest\/v1\/rpc\/dm_admin_is_member) failed; retrying after \d+ ms$/);
    assert.equal(warning.includes("private-access-fixture"), false, "Logs must never contain tokens");
  }

  // A read that stalls twice fails instead of waiting indefinitely.
  calls.length = 0;
  stallOnce = new Set(["/rest/v1/rpc/dm_get_data"]);
  reply = () => Response.json({ data: {}, revision: 1 });
  assert.deepEqual(await adminRpc("private-access-fixture", "dm_get_data"), { data: {}, revision: 1 });
  assert.equal(calls.length, 2);

  // Writes are attempted once: repeating a save or share change could apply it twice.
  for (const write of ["dm_save_data", "dm_create_share", "dm_revoke_share"]) {
    calls.length = 0;
    stallOnce = new Set([`/rest/v1/rpc/${write}`]);
    await assert.rejects(adminRpc("private-access-fixture", write, {}), (error: unknown) => !(error instanceof BackendError));
    assert.equal(calls.length, 1, `${write} must not be retried`);
  }
  calls.length = 0;
  stallOnce = new Set(["/auth/v1/token"]);
  await assert.rejects(supabaseRequest("/auth/v1/token?grant_type=password", { method: "POST", body: {} }));
  assert.equal(calls.length, 1, "A password grant must not be repeated");
  assert.ok(warnings.every(warning => !warning.includes("grant_type")), "Logs contain the path only, never the query");

  // A successful status with an unreadable body is a failure, not an empty answer.
  reply = () => new Response("<html>gateway</html>", { status: 200 });
  await assert.rejects(adminRpc("private-access-fixture", "dm_get_data"), (error: unknown) => error instanceof BackendError && error.status === 502);
  // A deliberately empty response (e.g. logout's 204) is still accepted.
  reply = () => new Response(null, { status: 204 });
  assert.equal(await supabaseRequest("/auth/v1/logout?scope=local", { token: "private-access-fixture", method: "POST" }), null);
  // HTTP errors keep their status and reason, and are not retried.
  calls.length = 0;
  reply = () => Response.json({ code: 403, error_code: "bad_jwt" }, { status: 403 });
  await assert.rejects(adminRpc("private-access-fixture", "dm_get_data"), (error: unknown) => error instanceof BackendError && error.status === 403 && error.code === "bad_jwt");
  assert.equal(calls.length, 1);
});
