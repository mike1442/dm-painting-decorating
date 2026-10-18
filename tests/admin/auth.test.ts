import assert from "node:assert/strict";
import { accessCookieMaxAge, sameOrigin } from "../../lib/admin/auth.ts";
import { BackendError, verifyAdmin, publicRpc } from "../../lib/server/supabase.ts";

// The access cookie must expire before its JWT, so the browser refreshes instead of presenting an expired token.
assert.equal(accessCookieMaxAge(3600), 3540);
assert.equal(accessCookieMaxAge(30), 60);
assert.equal(accessCookieMaxAge(Number.NaN), 3540);

const url = "https://dm-painting-decorating.vercel.app/api/admin/data";
assert.equal(sameOrigin(new Request(url, { headers: { origin: new URL(url).origin } })), true);
for (const origin of ["https://attacker.example", "null", "https://dm-painting-decorating.vercel.app.attacker.example"]) {
  assert.equal(sameOrigin(new Request(url, { headers: { origin } })), false);
}
assert.equal(sameOrigin(new Request(url)), false);
assert.equal(sameOrigin(new Request(url, { headers: { origin: new URL(url).origin, "sec-fetch-site": "cross-site" } })), false);

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fdctgtncawolrapwwevm.supabase.co";
process.env.DM_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
const originalFetch = globalThis.fetch;
let calls = 0;
let user = { email: "other@example.com", email_confirmed_at: "2026-10-17" };
let membership = true;
globalThis.fetch = (async (input, init) => {
  calls++;
  assert.equal(new Headers(init?.headers).get("authorization"), "Bearer user-session");
  return Response.json(String(input).endsWith("/user") ? user : membership);
}) as typeof fetch;
try {
  assert.equal(await verifyAdmin(""), false);
  assert.equal(calls, 0);
  assert.equal(await verifyAdmin("user-session"), false);
  assert.equal(calls, 1, "Other emails must fail before any database access");
  user = { email: "mike@dmpaintingdecorating.co.uk", email_confirmed_at: "" };
  assert.equal(await verifyAdmin("user-session"), false);
  user.email_confirmed_at = "2026-10-17";
  membership = false;
  assert.equal(await verifyAdmin("user-session"), false, "The email alone does not confer membership");
  membership = true;
  assert.equal(await verifyAdmin("user-session"), true);
  process.env.DM_SUPABASE_PUBLISHABLE_KEY = "sb_secret_rejected";
  await assert.rejects(publicRpc("anything", {}), (e: unknown) => e instanceof BackendError && e.status === 503);
} finally { globalThis.fetch = originalFetch; }
