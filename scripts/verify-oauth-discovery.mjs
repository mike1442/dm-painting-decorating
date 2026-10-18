import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

// This probe never signs in, exchanges tokens or reads customer records. Dynamic
// registration is stateless on this server: its response stays in memory only.
// Do not log response bodies, registration credentials, cookies or query strings.
const failures = [];
let base;
try {
  base = new URL(process.env.BASE_URL || "https://www.dmpaintingdecorating.co.uk");
  assert(!base.username && !base.password && !base.search && !base.hash, "BASE_URL must contain only an origin");
  assert(base.pathname === "/", "BASE_URL must contain only an origin");
  assert(base.protocol === "https:" || (base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)), "BASE_URL must use HTTPS (HTTP is allowed for localhost)");
} catch {
  console.error("FAIL: BASE_URL must be a valid HTTPS origin, or a local HTTP origin.");
  process.exit(1);
}
const origin = base.origin;
const mcpUrl = `${origin}/api/mcp`;
const resourcePath = "/.well-known/oauth-protected-resource/api/mcp";
const asPath = "/.well-known/oauth-authorization-server";

function verify(label, condition, message) {
  try { assert(condition, message); }
  catch { failures.push(`${label}: ${message}`); }
}

function publicUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash ? url : null;
  } catch { return null; }
}

async function probe(label, url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: "application/json", ...options.headers },
    });
    const type = response.headers.get("content-type") || "(missing)";
    // Read bodies only in memory. Neither HTML errors nor OAuth credentials are
    // emitted, even when a later validation fails.
    const body = await response.text();
    let data = null;
    if (body.length <= 262_144 && /(?:application\/json|\+json)(?:;|$)/i.test(type)) {
      try { data = JSON.parse(body); } catch { /* Report JSON validity below. */ }
    }
    const challenge = response.headers.get("www-authenticate");
    console.log(`${label}: HTTP ${response.status}; content-type=${JSON.stringify(type)}`);
    if (challenge) console.log(`${label}: www-authenticate=${JSON.stringify(challenge)}`);
    return { status: response.status, type, data, body, challenge, allow: response.headers.get("allow") };
  } catch {
    // Native fetch errors can contain the authorization URL and its client ID.
    console.log(`${label}: HTTP unavailable; content-type=unavailable`);
    failures.push(`${label}: request failed or timed out`);
    return null;
  }
}

function metadata(label, result, expectedResource) {
  if (result?.status !== 200) {
    verify(label, false, `metadata must return HTTP 200 without a redirect (received ${result ? `HTTP ${result.status}` : "no response"})`);
    return null;
  }
  verify(label, result.data && typeof result.data === "object" && !Array.isArray(result.data), "metadata must be a JSON object");
  if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) return null;
  const data = result.data;
  for (const key of ["resource", "issuer", "authorization_endpoint", "token_endpoint", "registration_endpoint", "revocation_endpoint"]) {
    if (publicUrl(data[key])) console.log(`${label}: ${key}=${JSON.stringify(data[key])}`);
  }
  if (expectedResource) {
    verify(label, data.resource === expectedResource, "resource identifier must exactly match the MCP URL");
    verify(label, Array.isArray(data.authorization_servers) && data.authorization_servers.includes(origin), "authorization_servers must advertise the public origin");
    for (const issuer of Array.isArray(data.authorization_servers) ? data.authorization_servers : []) {
      if (publicUrl(issuer)) console.log(`${label}: authorization_server=${JSON.stringify(issuer)}`);
    }
  }
  return data;
}

console.log(`OAuth discovery target: ${origin}`);
const initialize = {
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "dm-oauth-discovery-check", version: "1.0.0" } },
};
// Collect all fixed discovery responses before checking any result, so a broken
// endpoint cannot hide the status of the remaining deployment routes.
const probes = [
  ["GET /api/mcp", mcpUrl, { headers: { Accept: "text/event-stream" } }],
  ["POST /api/mcp initialize", mcpUrl, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify(initialize) }],
  [`GET ${resourcePath}`, `${origin}${resourcePath}`],
  ["GET /.well-known/oauth-protected-resource", `${origin}/.well-known/oauth-protected-resource`],
  [`GET ${asPath}`, `${origin}${asPath}`],
  ["GET /.well-known/oauth-authorization-server/api/mcp (fallback)", `${origin}/.well-known/oauth-authorization-server/api/mcp`],
  ["GET /.well-known/openid-configuration (optional)", `${origin}/.well-known/openid-configuration`],
  ["GET /api/mcp/.well-known/openid-configuration (optional)", `${origin}/api/mcp/.well-known/openid-configuration`],
];
const results = await Promise.all(probes.map(([label, url, options]) => probe(label, url, options)));
const [getMcp, postMcp, scopedResource, rootResource, authorizationServer] = results;

// Streamable HTTP permits HTTP 405 when the server offers no SSE stream.
// Discovery still requires the anonymous POST's complete OAuth challenge.
verify("GET /api/mcp", getMcp?.status === 401 || getMcp?.status === 405, "unauthenticated GET must return HTTP 401 or HTTP 405 when no SSE stream is offered");
if (getMcp?.status === 401) {
  verify("GET /api/mcp", getMcp.challenge === postMcp?.challenge && /^Bearer\b/i.test(getMcp.challenge ?? ""), "HTTP 401 GET must advertise the same Bearer challenge as POST");
} else if (getMcp?.status === 405) {
  verify("GET /api/mcp", /(?:^|,)\s*POST\s*(?:,|$)/i.test(getMcp.allow ?? ""), "HTTP 405 GET must advertise POST in its Allow header");
}
verify("POST /api/mcp", postMcp?.status === 401, "unauthenticated initialize must return HTTP 401");
verify("POST /api/mcp", /^Bearer\b/i.test(postMcp?.challenge ?? ""), "HTTP 401 must contain a Bearer WWW-Authenticate challenge");
metadata("Scoped resource metadata", scopedResource, mcpUrl);
metadata("Root resource metadata", rootResource, mcpUrl);
const server = metadata("Authorization server metadata", authorizationServer);

// Follow the exact resource_metadata URL supplied to an unauthenticated client.
const resourceMatch = /\bresource_metadata\s*=\s*"([^"\r\n]+)"/i.exec(postMcp?.challenge ?? "");
const challengeUrl = publicUrl(resourceMatch?.[1]);
verify("Bearer challenge", challengeUrl?.origin === origin && challengeUrl.pathname === resourcePath, "resource_metadata must point to the public scoped resource metadata URL");
if (challengeUrl?.origin === origin && challengeUrl.pathname === resourcePath) {
  const challengedResource = await probe("GET challenge resource_metadata", challengeUrl);
  const resource = metadata("Challenge resource metadata", challengedResource, mcpUrl);
  const issuer = resource?.authorization_servers?.[0];
  if (resource) verify("Challenge discovery", issuer === origin, "first authorization server must be the public origin");
  if (issuer === origin) {
    const discoveredAs = await probe("GET discovered authorization server metadata", `${issuer}${asPath}`);
    metadata("Discovered authorization server metadata", discoveredAs);
  }
}

if (server) {
  verify("Authorization server", server.issuer === origin, "issuer must exactly match the public origin");
  for (const key of ["authorization_endpoint", "token_endpoint", "registration_endpoint", "revocation_endpoint"]) {
    verify("Authorization server", publicUrl(server[key])?.origin === origin, `${key} must be an absolute URL on the public origin`);
  }
  verify("Authorization server", server.code_challenge_methods_supported?.includes("S256"), "S256 PKCE must be advertised");
  verify("Authorization server", server.token_endpoint_auth_methods_supported?.includes("none"), "public client authentication must be advertised");
  verify("Authorization server", server.grant_types_supported?.includes("authorization_code"), "authorization_code grant must be advertised");
}

// Register a public client without a secret. D&M seals the client metadata in
// the returned ID and persists nothing; no registration management is needed.
const registrationUrl = publicUrl(server?.registration_endpoint);
const authorizationUrl = publicUrl(server?.authorization_endpoint);
if (registrationUrl?.origin === origin && authorizationUrl?.origin === origin) {
  const callback = "https://chatgpt.com/connector_platform_oauth_redirect";
  const registration = await probe("POST dynamic client registration", registrationUrl, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "D&M OAuth discovery verification",
      redirect_uris: [callback],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  verify("Dynamic registration", registration?.status === 201, "public client registration must return HTTP 201");
  verify("Dynamic registration", typeof registration?.data?.client_id === "string" && registration.data.client_id.length > 0, "registration must return a client ID");
  verify("Dynamic registration", registration?.data?.token_endpoint_auth_method === "none", "registration must support a public client without credentials");
  verify("Dynamic registration", !registration?.data?.client_secret, "public registration must not return a client secret");
  if (registration?.status === 201 && typeof registration.data?.client_id === "string") {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    authorizationUrl.search = new URLSearchParams({
      client_id: registration.data.client_id,
      redirect_uri: callback,
      response_type: "code",
      scope: "dm:read",
      resource: mcpUrl,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: randomBytes(16).toString("base64url"),
    }).toString();
    const consent = await probe("GET PKCE authorization consent", authorizationUrl, { headers: { Accept: "text/html" } });
    verify("PKCE authorization", consent?.status === 200, "valid ChatGPT authorization request must return HTTP 200 without a redirect");
    verify("PKCE authorization", /^text\/html(?:;|$)/i.test(consent?.type ?? ""), "authorization response must be an HTML consent page");
    verify("PKCE authorization", /<form\b/i.test(consent?.body ?? "") && /name=["']password["']/i.test(consent?.body ?? ""), "consent page must offer the administrator sign-in form");
  }
} else if (server) {
  failures.push("Discovery flow: registration and authorization require trusted same-origin metadata endpoints");
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  console.error(`OAuth discovery FAILED (${failures.length} checks). No administrator sign-in or customer-data request was performed.`);
  process.exitCode = 1;
} else {
  console.log("OAuth discovery PASSED: unauthenticated MCP → resource metadata → authorization metadata → public registration → PKCE consent. No administrator sign-in or customer-data request was performed.");
}
