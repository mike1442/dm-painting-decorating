import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scriptUrl = new URL("../../scripts/verify-oauth-discovery.mjs", import.meta.url).href;
const origin = "https://oauth-probe.example.test";
const clientId = "fixture-public-client-id-never-log";
type Scenario = "valid-405" | "valid-401" | "unavailable-metadata" | "missing-pkce" | "foreign-registration" | "missing-challenge" | "mismatched-challenge";

function runProbe(scenario: Scenario) {
  const source = `
const origin = ${JSON.stringify(origin)};
const scenario = ${JSON.stringify(scenario)};
const challenge = 'Bearer resource_metadata="' + origin + '/.well-known/oauth-protected-resource/api/mcp"';
const metadata = {
  issuer: origin,
  authorization_endpoint: origin + "/api/oauth/authorize",
  token_endpoint: origin + "/api/oauth/token",
  registration_endpoint: scenario === "foreign-registration" ? "https://untrusted.example.test/register" : origin + "/api/oauth/register",
  revocation_endpoint: origin + "/api/oauth/revoke",
  code_challenge_methods_supported: scenario === "missing-pkce" ? ["plain"] : ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  grant_types_supported: ["authorization_code", "refresh_token"],
};
// Install the mock before importing the probe. There is no real-fetch fallback.
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.origin !== origin) throw new Error("Unexpected request origin");
  if (url.pathname === "/api/mcp") {
    if (init.method === "POST") return Response.json({}, { status: 401, headers: { "www-authenticate": challenge } });
    if (scenario === "valid-405") return new Response(null, { status: 405, headers: { Allow: "POST" } });
    const headers = scenario === "missing-challenge" ? {} : { "www-authenticate": scenario === "mismatched-challenge" ? 'Bearer resource_metadata="https://untrusted.example.test/resource"' : challenge };
    return Response.json({}, { status: 401, headers });
  }
  if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
    return Response.json({ resource: origin + "/api/mcp", authorization_servers: [origin] });
  }
  if (url.pathname.startsWith("/.well-known/oauth-authorization-server")) {
    return scenario === "unavailable-metadata" ? Response.json({ error: "unavailable" }, { status: 503 }) : Response.json(metadata);
  }
  if (url.pathname === "/api/oauth/register" && init.method === "POST") {
    return Response.json({ client_id: ${JSON.stringify(clientId)}, token_endpoint_auth_method: "none" }, { status: 201 });
  }
  if (url.pathname === "/api/oauth/authorize" && url.searchParams.get("client_id") === ${JSON.stringify(clientId)}) {
    return new Response('<form><input name="password"></form>', { headers: { "content-type": "text/html" } });
  }
  return new Response(null, { status: 404 });
};
await import(${JSON.stringify(scriptUrl)});
`;
  // A literal environment keeps real credentials and NODE_OPTIONS out of children.
  const env: NodeJS.ProcessEnv = { BASE_URL: origin, NODE_ENV: "test" };
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    env, encoding: "utf8", timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(clientId), "client ID must stay out of output");
  return result;
}

for (const scenario of ["valid-405", "valid-401"] as const) {
  test(`discovery probe accepts ${scenario} through public registration and PKCE consent`, () => {
    const result = runProbe(scenario);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /POST dynamic client registration: HTTP 201/);
    assert.match(result.stdout, /GET PKCE authorization consent: HTTP 200/);
    assert.match(result.stdout, /OAuth discovery PASSED/);
  });
}

test("unavailable authorization metadata reports HTTP 503 without missing-capability cascades", () => {
  const result = runProbe("unavailable-metadata");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Authorization server metadata:.*HTTP 503/);
  assert.doesNotMatch(result.stderr, /S256|public client authentication|authorization_code grant|trusted same-origin/);
});

for (const [scenario, failure] of [
  ["missing-pkce", /S256 PKCE must be advertised/],
  ["foreign-registration", /require trusted same-origin metadata endpoints/],
  ["missing-challenge", /HTTP 401 GET must advertise the same Bearer challenge as POST/],
  ["mismatched-challenge", /HTTP 401 GET must advertise the same Bearer challenge as POST/],
] as const) {
  test(`discovery probe rejects ${scenario}`, () => {
    const result = runProbe(scenario);
    assert.equal(result.status, 1);
    assert.match(result.stderr, failure);
  });
}
