import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import { ALL_SCOPES, CUSTOM_GPT_CLIENT_ID } from "../../lib/chatgpt/config.ts";
import { handleAction, handleMcpGet, handleMcpOther, handleMcpPost, openApiDocument } from "../../lib/chatgpt/mcp.ts";
import {
  authorizationServerMetadata, bearerGrant, clientSecret, handleAuthorizeGet, handleAuthorizePost, handleRegister, handleRevoke, handleToken, protectedResourceMetadata,
} from "../../lib/chatgpt/oauth.ts";
import { tools } from "../../lib/chatgpt/tools.ts";
import { configure, fakeSupabase, ORIGIN, PASSWORD } from "./fake-supabase.ts";

const REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
const MCP = `${ORIGIN}/api/mcp`;
const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const form = (url: string, body: Record<string, string>, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers, body: new URLSearchParams(body) });
const approval = (body: Record<string, string>, origin = ORIGIN) =>
  form(`${ORIGIN}/oauth/authorize`, body, { origin, "sec-fetch-site": origin === ORIGIN ? "same-origin" : "cross-site" });

async function register(metadata: Record<string, unknown> = {}) {
  const response = await handleRegister(json(`${ORIGIN}/api/oauth/register`, {
    client_name: "ChatGPT", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], ...metadata,
  }));
  return { response, client: await response.json() as { client_id: string; client_secret?: string } };
}

function authorizeUrl(clientId: string, extra: Record<string, string | null> = {}) {
  const verifier = randomBytes(32).toString("base64url");
  const url = new URL(`${ORIGIN}/oauth/authorize`);
  const params: Record<string, string | null> = {
    response_type: "code", client_id: clientId, redirect_uri: REDIRECT, state: "state-123",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", resource: MCP, scope: ALL_SCOPES.join(" "), ...extra,
  };
  for (const [key, value] of Object.entries(params)) if (value !== null) url.searchParams.set(key, value);
  return { url, verifier };
}

/** What ChatGPT does: register, send Mike to approve, then exchange the code with PKCE. */
async function connect({ allowDelete = true } = {}) {
  const { client } = await register();
  const { url, verifier } = authorizeUrl(client.client_id);
  const page = await handleAuthorizeGet(new Request(url));
  const request = /name="request" value="([^"]+)"/.exec(await page.text())![1];
  const approved = await handleAuthorizePost(approval({ request, decision: "allow", password: PASSWORD, ...(allowDelete ? { allow_delete: "on" } : {}) }));
  const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
  const exchange = () => handleToken(form(`${ORIGIN}/api/oauth/token`, { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: verifier, resource: MCP }));
  const response = await exchange();
  const tokens = await response.json() as { access_token: string; refresh_token: string; scope: string; expires_in: number; token_type: string };
  return { client, tokens, response, exchange };
}

const rpc = (token: string | null, body: unknown, headers: Record<string, string> = {}) =>
  handleMcpPost(json(MCP, body, { accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }));

test("public discovery stays available while an absent or weak secret disables access", async context => {
  for (const secret of [null, "too-short", "a".repeat(40)]) {
    configure(context, secret);
    const metadata = authorizationServerMetadata(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`));
    assert.equal(metadata.status, 200);
    assert.equal((await metadata.json()).issuer, ORIGIN);
    for (const path of ["", "/api/mcp"]) {
      const resource = protectedResourceMetadata(new Request(`${ORIGIN}/.well-known/oauth-protected-resource${path}`), path);
      assert.equal(resource.status, 200);
      assert.equal((await resource.json()).resource, MCP);
    }
    assert.equal((await register()).response.status, 503);
    assert.equal((await rpc("dmat_x", { jsonrpc: "2.0", id: 1, method: "ping" })).status, 503);
    const anonymousPost = await rpc(null, { jsonrpc: "2.0", id: 1, method: "initialize" });
    const anonymousGet = handleMcpGet(new Request(MCP));
    assert.equal(anonymousPost.status, 401);
    assert.equal(anonymousGet.status, 401);
    assert.match(anonymousPost.headers.get("www-authenticate")!, /resource_metadata="https:\/\/www\.dmpaintingdecorating\.co\.uk\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
    assert.equal(anonymousGet.headers.get("www-authenticate"), anonymousPost.headers.get("www-authenticate"));
    assert.equal(handleMcpGet(new Request(MCP, { headers: { authorization: "Bearer dmat_forged" } })).status, 503);
    assert.equal((await handleAuthorizeGet(new Request(`${ORIGIN}/oauth/authorize`))).status, 503);
  }
});

test("discovery describes the protected MCP server and its authorization server", async context => {
  configure(context);
  const resource = await protectedResourceMetadata(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`), "/api/mcp").json();
  assert.deepEqual(resource.authorization_servers, [ORIGIN]);
  assert.equal(resource.resource, MCP);
  assert.equal((await protectedResourceMetadata(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`), "").json()).resource, MCP);
  assert.equal(protectedResourceMetadata(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/x`), "/x").status, 404);
  const server = await authorizationServerMetadata(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`)).json();
  assert.equal(server.issuer, ORIGIN);
  assert.deepEqual(server.code_challenge_methods_supported, ["S256"]);
  assert.equal(server.registration_endpoint, `${ORIGIN}/api/oauth/register`);

  const challenge = await rpc(null, { jsonrpc: "2.0", id: 1, method: "initialize" });
  assert.equal(challenge.status, 401);
  assert.match(challenge.headers.get("www-authenticate")!, /^Bearer realm="D&M", resource_metadata="https:\/\/www\.dmpaintingdecorating\.co\.uk\/\.well-known\/oauth-protected-resource\/api\/mcp", scope="dm:read dm:write dm:delete"$/);
  const getChallenge = handleMcpGet(new Request(MCP));
  assert.equal(getChallenge.status, 401);
  assert.equal(getChallenge.headers.get("www-authenticate"), challenge.headers.get("www-authenticate"));
  const forgedGet = handleMcpGet(new Request(MCP, { headers: { authorization: "Bearer dmat_forged" } }));
  assert.equal(forgedGet.status, 401);
  assert.match(forgedGet.headers.get("www-authenticate")!, /error="invalid_token"/);
});

test("only ChatGPT's own https redirect addresses can be registered", async context => {
  configure(context);
  for (const redirect of ["https://evil.example/callback", "http://chatgpt.com/connector_platform_oauth_redirect", "https://chatgpt.com.evil.example/cb", "https://chatgpt.com:8443/cb", "https://user@chatgpt.com/cb", "javascript:alert(1)"]) {
    const { response, client } = await register({ redirect_uris: [redirect] });
    assert.equal(response.status, 400, redirect);
    assert.equal((client as unknown as { error: string }).error, "invalid_redirect_uri");
  }
  const { response, client } = await register({ token_endpoint_auth_method: undefined });
  assert.equal(response.status, 201);
  assert.match(client.client_id, /^dmcl_/);
  assert.equal(client.client_secret, clientSecret(client.client_id), "RFC 7591's default method receives a secret");
});

test("Mike approves on D&M's own page; ChatGPT receives only sealed tokens for a dedicated session", async context => {
  configure(context);
  const supabase = fakeSupabase(context);
  const { client } = await register({ client_name: "ChatGPT <script>alert(1)</script>" });
  const { url, verifier } = authorizeUrl(client.client_id);

  const page = await handleAuthorizeGet(new Request(url));
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.equal(page.headers.get("referrer-policy"), "same-origin", "The approval form must carry its origin, and nothing leaks to ChatGPT");
  assert.match(page.headers.get("content-security-policy")!, /default-src 'none'.*form-action 'self' https:\/\/chatgpt\.com; frame-ancestors 'none'/);
  assert.ok(!html.includes("<script>") && html.includes("&lt;script&gt;"), "The client's name is escaped");
  assert.match(html, /Read quotes, invoices, the diary/);
  assert.ok(!/<script/i.test(html), "The consent page runs no scripts");
  const request = /name="request" value="([^"]+)"/.exec(html)![1];

  assert.equal((await handleAuthorizePost(approval({ request, decision: "allow", password: PASSWORD }, "https://evil.example"))).status, 403);
  const wrong = await handleAuthorizePost(approval({ request, decision: "allow", password: "not the password" }));
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get("location"), null);
  assert.match(await wrong.text(), /That password was not accepted/);
  assert.equal([...supabase.state.sessions.values()].filter(session => session.alive).length, 0);
  const tampered = request.slice(0, -4) + (request.endsWith("AAAA") ? "BBBB" : "AAAA");
  assert.equal((await handleAuthorizePost(approval({ request: tampered, decision: "allow", password: PASSWORD }))).status, 400);

  const approved = await handleAuthorizePost(approval({ request, decision: "allow", password: PASSWORD, allow_delete: "on" }));
  assert.equal(approved.status, 303);
  const location = new URL(approved.headers.get("location")!);
  assert.equal(`${location.origin}${location.pathname}`, REDIRECT);
  assert.equal(location.searchParams.get("state"), "state-123");
  assert.equal(location.searchParams.get("iss"), ORIGIN);
  const code = location.searchParams.get("code")!;
  assert.match(code, /^dmac_/);

  const exchange = (body: Record<string, string>) => handleToken(form(`${ORIGIN}/api/oauth/token`, { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: client.client_id, ...body }));
  assert.equal((await (await exchange({ code_verifier: "x".repeat(43) })).json()).error, "invalid_grant", "PKCE is checked");
  const issued = await exchange({ code_verifier: verifier, resource: MCP });
  const tokens = await issued.json();
  assert.equal(issued.status, 200);
  assert.equal(issued.headers.get("cache-control"), "no-store");
  assert.equal(tokens.token_type, "Bearer");
  assert.equal(tokens.scope, "dm:read dm:write dm:delete");
  assert.match(tokens.access_token, /^dmat_/);
  assert.match(tokens.refresh_token, /^dmrt_/);
  for (const secret of [...supabase.state.access.keys(), ...supabase.state.refresh.keys(), PASSWORD]) {
    assert.ok(!JSON.stringify(tokens).includes(secret), "No Supabase token or password is visible to ChatGPT");
  }
  assert.equal([...supabase.state.sessions.values()].filter(session => session.alive).length, 1, "One dedicated Supabase session for ChatGPT");
  assert.equal((await (await exchange({ code_verifier: verifier })).json()).error, "invalid_grant", "A code works once");

  const grant = bearerGrant(new Request(MCP, { headers: { authorization: `Bearer ${tokens.access_token}` } }));
  assert.deepEqual(grant?.scopes, ALL_SCOPES);
  assert.equal(bearerGrant(new Request(MCP, { headers: { authorization: `Bearer ${tokens.refresh_token}` } })), null, "A refresh token is not an access token");
  assert.equal(bearerGrant(new Request(MCP, { headers: { authorization: `Bearer ${code}` } })), null);
  assert.equal(bearerGrant(new Request("https://dm-preview.vercel.app/api/mcp", { headers: { authorization: `Bearer ${tokens.access_token}` } })), null, "Tokens are bound to the site that issued them");
  const flipped = tokens.access_token.slice(0, 30) + (tokens.access_token[30] === "A" ? "B" : "A") + tokens.access_token.slice(31);
  assert.equal(bearerGrant(new Request(MCP, { headers: { authorization: `Bearer ${flipped}` } })), null);
});

test("refresh rotates the wrapped session; spent refresh tokens and ended sessions fail closed", async context => {
  configure(context);
  const supabase = fakeSupabase(context);
  const { client, tokens } = await connect();
  const refresh = (token: string) => handleToken(form(`${ORIGIN}/api/oauth/token`, { grant_type: "refresh_token", refresh_token: token, client_id: client.client_id }));
  const renewed = await refresh(tokens.refresh_token);
  const next = await renewed.json();
  assert.equal(renewed.status, 200);
  assert.notEqual(next.refresh_token, tokens.refresh_token);
  assert.equal((await (await refresh(tokens.refresh_token)).json()).error, "invalid_grant", "A spent refresh token is refused");
  assert.equal((await handleToken(form(`${ORIGIN}/api/oauth/token`, { grant_type: "refresh_token", refresh_token: next.refresh_token, client_id: "dmcl_other" }))).status, 401);

  const revoked = await handleRevoke(form(`${ORIGIN}/api/oauth/revoke`, { token: next.refresh_token, client_id: client.client_id }));
  assert.equal(revoked.status, 200);
  assert.equal([...supabase.state.sessions.values()].filter(session => session.alive).length, 0, "Revocation ends the Supabase session");
  const after = await rpc(next.access_token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_quotes", arguments: {} } });
  assert.equal(after.status, 401);
  assert.match(after.headers.get("www-authenticate")!, /error="invalid_token"/);
  assert.equal((await handleRevoke(form(`${ORIGIN}/api/oauth/revoke`, { token: next.refresh_token, client_id: client.client_id }))).status, 200, "Revoking twice is harmless");
});

test("Mike can decline, or leave out deletion; PKCE and client secrets are enforced", async context => {
  configure(context);
  fakeSupabase(context);
  const { client } = await register();
  const page = await handleAuthorizeGet(new Request(authorizeUrl(client.client_id).url));
  const request = /name="request" value="([^"]+)"/.exec(await page.text())![1];
  const declined = new URL((await handleAuthorizePost(approval({ request, decision: "deny" }))).headers.get("location")!);
  assert.equal(declined.searchParams.get("error"), "access_denied");
  assert.equal(declined.searchParams.get("state"), "state-123");

  const { tokens } = await connect({ allowDelete: false });
  assert.equal(tokens.scope, "dm:read dm:write");
  const listed = await (await rpc(tokens.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
  const names = listed.result.tools.map((tool: { name: string }) => tool.name);
  assert.ok(names.includes("create_quote") && !names.includes("delete_quote") && !names.includes("revoke_customer_link"));

  const noPkce = await handleAuthorizeGet(new Request(authorizeUrl(client.client_id, { code_challenge: null, code_challenge_method: null }).url));
  assert.equal(new URL(noPkce.headers.get("location")!).searchParams.get("error"), "invalid_request", "Public clients must use PKCE");
  const plain = await handleAuthorizeGet(new Request(authorizeUrl(client.client_id, { code_challenge_method: "plain" }).url));
  assert.equal(new URL(plain.headers.get("location")!).searchParams.get("error"), "invalid_request");
  const unknownClient = await handleAuthorizeGet(new Request(authorizeUrl("dmcl_forged").url));
  assert.equal(unknownClient.status, 400);
  assert.equal(unknownClient.headers.get("location"), null, "An unverified client is never redirected to");
  const otherRedirect = await handleAuthorizeGet(new Request(authorizeUrl(client.client_id, { redirect_uri: "https://chatgpt.com/other" }).url));
  assert.equal(otherRedirect.status, 400);

  const confidential = (await register({ token_endpoint_auth_method: "client_secret_basic" })).client;
  const missing = await handleToken(form(`${ORIGIN}/api/oauth/token`, { grant_type: "refresh_token", refresh_token: "dmrt_x", client_id: confidential.client_id }));
  assert.equal(missing.status, 401);
  const basic = Buffer.from(`${encodeURIComponent(confidential.client_id)}:${encodeURIComponent(confidential.client_secret!)}`).toString("base64");
  const authenticated = await handleToken(form(`${ORIGIN}/api/oauth/token`, { grant_type: "refresh_token", refresh_token: "dmrt_x" }, { authorization: `Basic ${basic}` }));
  assert.equal((await authenticated.json()).error, "invalid_grant", "Authenticated, then refused for the bad refresh token");
});

test("a Custom GPT uses the fixed client, its derived secret and its own callback", async context => {
  configure(context);
  fakeSupabase(context);
  const callback = "https://chatgpt.com/aip/g-abc123/oauth/callback";
  const url = new URL(`${ORIGIN}/oauth/authorize`);
  for (const [key, value] of Object.entries({ response_type: "code", client_id: CUSTOM_GPT_CLIENT_ID, redirect_uri: callback, state: "s", scope: "dm:read dm:write" })) url.searchParams.set(key, value);
  const page = await handleAuthorizeGet(new Request(url));
  assert.equal(page.status, 200);
  const request = /name="request" value="([^"]+)"/.exec(await page.text())![1];
  const code = new URL((await handleAuthorizePost(approval({ request, decision: "allow", password: PASSWORD }))).headers.get("location")!).searchParams.get("code")!;
  const exchange = (secret: string) => handleToken(form(`${ORIGIN}/api/oauth/token`, { grant_type: "authorization_code", code, redirect_uri: callback, client_id: CUSTOM_GPT_CLIENT_ID, client_secret: secret }));
  assert.equal((await exchange("wrong")).status, 401);
  const tokens = await (await exchange(clientSecret(CUSTOM_GPT_CLIENT_ID))).json();
  assert.equal(tokens.scope, "dm:read dm:write");
  const action = await handleAction(json(`${ORIGIN}/api/chatgpt/actions/list_quotes`, {}, { authorization: `Bearer ${tokens.access_token}` }), "list_quotes");
  assert.equal(action.status, 200);
  assert.equal((await action.json()).message, "No quotes match.");
  assert.equal((await handleAction(json(`${ORIGIN}/api/chatgpt/actions/list_quotes`, {}), "list_quotes")).status, 401);
  url.searchParams.set("redirect_uri", "https://chatgpt.com/connector_platform_oauth_redirect");
  assert.equal((await handleAuthorizeGet(new Request(url))).status, 400, "The Custom GPT client only returns to a GPT callback");

  const openapi = await openApiDocument(new Request(`${ORIGIN}/api/chatgpt/openapi.json`)).json();
  const operations = Object.values(openapi.paths as Record<string, { post: { operationId: string; description: string; "x-openai-isConsequential": boolean } }>).map(path => path.post);
  assert.ok(operations.length <= 30, "Custom GPTs accept at most 30 operations");
  for (const operation of operations) {
    assert.ok(operation.description.length <= 300, `${operation.operationId}: Custom GPT descriptions are limited to 300 characters`);
    assert.equal(operation["x-openai-isConsequential"], tools.find(tool => tool.name === operation.operationId)!.kind !== "read");
  }
  assert.equal(openapi.components.securitySchemes.dmOAuth.flows.authorizationCode.tokenUrl, `${ORIGIN}/api/oauth/token`);
});

test("the MCP endpoint speaks the protocol ChatGPT uses and runs the tools as Mike", async context => {
  configure(context);
  const supabase = fakeSupabase(context);
  const { tokens } = await connect();
  const call = (body: unknown, headers?: Record<string, string>) => rpc(tokens.access_token, body, headers);

  const init = await (await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } })).json();
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } });
  assert.match(init.result.instructions, /never estimate or invent a price/);
  assert.equal((await (await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2099-01-01" } })).json()).result.protocolVersion, "2025-11-25");
  assert.equal((await call({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  assert.equal((await call({ jsonrpc: "2.0", id: 2, method: "ping" }, { "mcp-protocol-version": "1999-01-01" })).status, 400);

  const listed = (await (await call({ jsonrpc: "2.0", id: 3, method: "tools/list" }, { "mcp-protocol-version": "2025-11-25" })).json()).result.tools;
  assert.equal(listed.length, tools.length);
  const byName = new Map(listed.map((tool: { name: string }) => [tool.name, tool])) as Map<string, { annotations: Record<string, boolean>; inputSchema: { type: string } }>;
  assert.equal(byName.get("delete_quote")!.annotations.destructiveHint, true);
  assert.equal(byName.get("list_quotes")!.annotations.readOnlyHint, true);
  assert.equal(byName.get("create_quote")!.annotations.readOnlyHint, false);
  assert.ok(listed.every((tool: { inputSchema: { type: string } }) => tool.inputSchema.type === "object"));

  const created = await (await call({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "create_quote", arguments: {
    customer: { name: "Paul Finn", address: "6 Falkstone Close, Gorse Covert, WA3 6SU" }, title: "Living room",
    works: [{ description: "Living room walls (25 m²)", quantity: 2, unit: "day", unitPrice: 200 }], materials: [{ description: "Materials", quantity: 1, unitPrice: 118 }], expectedSubtotal: 518,
  } } })).json();
  assert.equal(created.result.isError, false);
  assert.equal(created.result.structuredContent.quote.total, "£518.00");
  assert.equal(created.result.structuredContent.quote.number, "Q-0001");
  assert.match(created.result.content[0].text, /^Created quote Q-0001 for Paul Finn/);
  assert.match(created.result.structuredContent.customerLink, /^https:\/\/www\.dmpaintingdecorating\.co\.uk\/d\/[a-f0-9]{64}$/);

  const refused = await (await call({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "create_quote", arguments: { customer: { name: "X" }, title: "Y", works: [], expectedSubtotal: 1 } } })).json();
  assert.equal(refused.result.isError, true);
  assert.equal((await (await call({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "drop_tables" } })).json()).error.code, -32602);
  assert.equal((await (await call({ jsonrpc: "2.0", id: 7, method: "resources/list" })).json()).error.code, -32601);
  assert.equal((await (await handleMcpPost(new Request(MCP, { method: "POST", headers: { authorization: `Bearer ${tokens.access_token}` }, body: "{" }))).json()).error.code, -32700);
  assert.equal(handleMcpOther().status, 405);
  assert.equal(handleMcpGet(new Request(MCP, { headers: { authorization: `Bearer ${tokens.access_token}` } })).status, 405);

  // Settings → Disconnect ends every other session, including this connection.
  const browser = supabase.signIn();
  await fetch("https://fdctgtncawolrapwwevm.supabase.co/auth/v1/logout?scope=others", { method: "POST", headers: { authorization: `Bearer ${browser}` } });
  const after = await call({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "list_quotes", arguments: {} } });
  assert.equal(after.status, 401, "ChatGPT is told to reauthorise; it does not see a silent failure");
});

