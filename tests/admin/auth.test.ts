import test from "node:test";
import assert from "node:assert/strict";
import { adminGate, safeNext } from "../../lib/admin/auth.ts";

const base = { configured: true, signedIn: true, member: true as boolean | null };

test("signed-in admin members can use admin pages and the admin API", () => {
  assert.deepEqual(adminGate({ ...base, path: "/admin/quotes" }), { action: "allow" });
  assert.deepEqual(adminGate({ ...base, path: "/api/admin/anything" }), { action: "allow" });
});

test("signed-out visitors are sent to sign in, keeping where they were going", () => {
  const page = adminGate({ ...base, signedIn: false, member: null, path: "/admin/quotes/abc", pathWithQuery: "/admin/quotes/abc?x=1" });
  assert.deepEqual(page, { action: "redirect", to: "/admin/login?next=%2Fadmin%2Fquotes%2Fabc%3Fx%3D1" });
  assert.deepEqual(adminGate({ ...base, signedIn: false, member: null, path: "/api/admin/x" }), {
    action: "json",
    status: 401,
    error: "Sign in required.",
  });
});

test("signed-in non-members are refused, and so is anyone when membership can't be checked", () => {
  assert.deepEqual(adminGate({ ...base, member: false, path: "/admin" }), { action: "redirect", to: "/admin/login?error=not-authorised" });
  assert.deepEqual(adminGate({ ...base, member: null, path: "/admin" }), { action: "redirect", to: "/admin/login?error=check-failed" });
  assert.equal(adminGate({ ...base, member: false, path: "/api/admin/x" }).action, "json");
  assert.equal(adminGate({ ...base, member: null, path: "/admin/settings" }).action, "redirect");
});

test("without Supabase configuration the admin fails closed", () => {
  assert.deepEqual(adminGate({ configured: false, signedIn: false, member: null, path: "/admin/invoices" }), { action: "redirect", to: "/admin/login" });
  assert.equal(adminGate({ configured: false, signedIn: false, member: null, path: "/api/admin/x" }).action, "json");
  assert.deepEqual(adminGate({ configured: false, signedIn: false, member: null, path: "/admin/login" }), { action: "allow" });
});

test("the sign-in and email-link pages stay reachable; members skip sign-in", () => {
  assert.deepEqual(adminGate({ ...base, signedIn: false, member: null, path: "/admin/login" }), { action: "allow" });
  assert.deepEqual(adminGate({ ...base, signedIn: false, member: null, path: "/admin/auth/confirm" }), { action: "allow" });
  assert.deepEqual(adminGate({ ...base, path: "/admin/login" }), { action: "redirect", to: "/admin" });
  assert.deepEqual(adminGate({ ...base, member: false, path: "/admin/login" }), { action: "allow" }, "non-members can see why they were refused");
  assert.equal(adminGate({ ...base, signedIn: false, member: null, path: "/admin/loginx" }).action, "redirect", "no prefix tricks");
});

test("only same-site admin paths are accepted as a return address", () => {
  assert.equal(safeNext("/admin/quotes?x=1"), "/admin/quotes?x=1");
  assert.equal(safeNext("https://evil.example/admin"), "/admin");
  assert.equal(safeNext("//evil.example"), "/admin");
  assert.equal(safeNext("/admin\\@evil"), "/admin");
  assert.equal(safeNext("/contact"), "/admin");
  assert.equal(safeNext("/admin/login"), "/admin");
  assert.equal(safeNext(null), "/admin");
});
