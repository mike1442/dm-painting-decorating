import test from "node:test";
import assert from "node:assert/strict";
import { adminReturnPath, loginPath } from "../../lib/admin/return-path.ts";

const origin = "https://www.dmpaintingdecorating.co.uk";

test("an admin page opened with an expired session is reopened, with its details, after sign-in", () => {
  const login = loginPath("/admin/quick-quote", "?for=John%20Smith&total=1250&add=Walls%7CCeilings");
  assert.equal(login, "/login?next=%2Fadmin%2Fquick-quote%3Ffor%3DJohn%2520Smith%26total%3D1250%26add%3DWalls%257CCeilings");
  const next = new URL(login, origin).searchParams.get("next");
  assert.equal(adminReturnPath(next, origin), "/admin/quick-quote?for=John%20Smith&total=1250&add=Walls%7CCeilings");
  assert.equal(loginPath("/admin"), "/login?next=%2Fadmin");
  assert.equal(adminReturnPath("/admin/invoices/abc", origin), "/admin/invoices/abc");
});

test("only pages of this admin on this site are remembered or returned to", () => {
  for (const path of [undefined, null, 7, "/login", "/", "/administrator", "/d/abc", "/api/admin/data"]) assert.equal(loginPath(path), "/login", String(path));
  assert.equal(loginPath("/admin/quotes", "not-a-query"), "/login?next=%2Fadmin%2Fquotes");
  for (const next of [
    null, "", "admin/quotes", "https://evil.example/admin/quotes", "//evil.example/admin/quotes", "/\\evil.example/admin",
    "/login?next=/admin", "/api/admin/data", "/administrator", "/d/abc", "javascript:alert(1)", "/admin/../login", "/%2e%2e/login",
  ]) {
    assert.equal(adminReturnPath(next, origin), "/admin/quotes", String(next));
  }
  assert.equal(adminReturnPath("/admin/quotes#fragment", origin), "/admin/quotes", "fragments are dropped");
});
