import { ADMIN_EMAIL, sameOrigin } from "../admin/auth.ts";
import { revokeCurrentSession } from "../server/session.ts";
import { BackendError, refreshSession, supabaseRequest, verifyAdmin, type AuthSession } from "../server/supabase.ts";
import {
  ACTIONS_PATH, ALL_SCOPES, AUTHORIZE_PATH, CODE_LIFETIME, CUSTOM_GPT_CLIENT_ID, GRANT_LIFETIME, IntegrationDisabled, MCP_PATH,
  REGISTER_PATH, REQUEST_LIFETIME, REVOKE_PATH, TOKEN_PATH, allowedRedirect, customGptRedirect, integrationKeys, isScope, originOf, resourcesFor,
  type Scope,
} from "./config.ts";
import { consentPage, problemPage } from "./consent-page.ts";
import { mac, randomId, sameSecret, seal, sha256, unseal } from "./seal.ts";

// A small OAuth 2.1 authorization server for exactly one person: Mike.
//
// When ChatGPT connects, Mike signs in on D&M's own page and approves. That
// opens a dedicated Supabase Auth session for ChatGPT, separate from his
// browsers. ChatGPT receives only sealed tokens that wrap the session and work
// at D&M's ChatGPT endpoints alone; it never sees his password, a Supabase JWT
// or refresh token, or any service-role credential. Every record operation
// still runs as Mike through the guarded Supabase functions, so revoking the
// session (Settings → ChatGPT, or ChatGPT's disconnect) ends access at once.

type AuthMethod = "none" | "client_secret_post" | "client_secret_basic";
type Client = { id: string; name: string; redirects: string[] | "custom-gpt"; auth: AuthMethod };
type SessionPayload = { a: string; r: string; e: number };
type GrantFields = { cid: string; aud: string; scope: Scope[]; gid: string; at: number };
type RequestPayload = { cid: string; ru: string; st: string | null; cc: string | null; scope: Scope[]; aud: string; exp: number };
type CodePayload = GrantFields & { ru: string; cc: string | null; s: SessionPayload; exp: number };
type AccessPayload = GrantFields & { sat: string; exp: number };
type RefreshPayload = GrantFields & { srt: string };

export type Grant = { client: string; scopes: Scope[]; grant: string; supabase: string; audience: string; origin: string };

const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};
const nowSeconds = () => Math.floor(Date.now() / 1000);

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...SECURITY_HEADERS, ...headers } });
}
const oauthError = (error: string, description: string, status = 400, headers: Record<string, string> = {}) =>
  jsonResponse({ error, error_description: description }, status, headers);
const disabled = () => jsonResponse({ error: "temporarily_unavailable", error_description: new IntegrationDisabled().message }, 503);

function htmlResponse(html: string, status: number, formTarget?: string) {
  const formAction = ["'self'", formTarget].filter(Boolean).join(" ");
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...SECURITY_HEADERS,
      // With no-referrer, browsers send "Origin: null" on the approval form, so
      // its origin could not be checked. same-origin still sends ChatGPT nothing.
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}; frame-ancestors 'none'; base-uri 'none'`,
    },
  });
}

async function readParams(request: Request, limit = 20_000): Promise<URLSearchParams> {
  const type = request.headers.get("content-type") ?? "";
  const text = await request.text();
  if (text.length > limit) throw new BackendError(413, "size");
  if (type.startsWith("application/json")) {
    const body: unknown = JSON.parse(text || "{}");
    const params = new URLSearchParams();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      for (const [key, value] of Object.entries(body)) if (typeof value === "string") params.set(key, value);
    }
    return params;
  }
  return new URLSearchParams(text);
}

const parseScopes = (value: string | null): Scope[] | null => {
  if (!value?.trim()) return [...ALL_SCOPES];
  const requested = [...new Set(value.trim().split(/\s+/))];
  return requested.every(isScope) ? ALL_SCOPES.filter(scope => requested.includes(scope)) : null;
};

/* Clients ---------------------------------------------------------------- */

export function resolveClient(id: unknown): Client | null {
  if (id === CUSTOM_GPT_CLIENT_ID) return { id, name: "Your D&M Custom GPT", redirects: "custom-gpt", auth: "client_secret_post" };
  const payload = unseal<{ n: string; r: string[]; m: AuthMethod }>("client", id);
  if (!payload || !Array.isArray(payload.r) || !payload.r.every(allowedRedirect)) return null;
  return { id: id as string, name: payload.n, redirects: payload.r, auth: payload.m };
}

export const clientSecret = (clientId: string) => mac("client-secret", clientId);

const redirectAllowed = (client: Client, uri: string) =>
  client.redirects === "custom-gpt" ? customGptRedirect(uri) : client.redirects.includes(uri);

/** RFC 7591 dynamic registration, limited to ChatGPT's own redirect hosts. Nothing is stored. */
export async function handleRegister(request: Request): Promise<Response> {
  try { integrationKeys(); } catch { return disabled(); }
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 10_000) return oauthError("invalid_client_metadata", "The registration request is too large.");
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch { return oauthError("invalid_client_metadata", "Send the client metadata as a JSON object."); }

  const redirects = body.redirect_uris;
  if (!Array.isArray(redirects) || !redirects.length || redirects.length > 5 || !redirects.every(allowedRedirect)) {
    return oauthError("invalid_redirect_uri", "This private connection only accepts ChatGPT's own https redirect addresses.");
  }
  const auth = (body.token_endpoint_auth_method ?? "client_secret_basic") as AuthMethod;
  if (!["none", "client_secret_post", "client_secret_basic"].includes(auth)) {
    return oauthError("invalid_client_metadata", "Supported token endpoint authentication: none, client_secret_post or client_secret_basic.");
  }
  const grants = body.grant_types ?? ["authorization_code"];
  const responses = body.response_types ?? ["code"];
  if (!Array.isArray(grants) || !grants.every(grant => ["authorization_code", "refresh_token"].includes(grant as string))
    || !Array.isArray(responses) || !responses.every(type => type === "code")) {
    return oauthError("invalid_client_metadata", "Only the authorization code and refresh token grants are supported.");
  }
  const name = typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 80) : "ChatGPT";
  const issuedAt = nowSeconds();
  const clientId = seal("client", { n: name, r: [...new Set(redirects as string[])], m: auth, iat: issuedAt });
  return jsonResponse({
    client_id: clientId,
    client_id_issued_at: issuedAt,
    ...(auth === "none" ? {} : { client_secret: clientSecret(clientId), client_secret_expires_at: 0 }),
    client_name: name,
    redirect_uris: [...new Set(redirects as string[])],
    token_endpoint_auth_method: auth,
    grant_types: grants,
    response_types: ["code"],
    scope: ALL_SCOPES.join(" "),
  }, 201);
}

/* Metadata --------------------------------------------------------------- */

export function authorizationServerMetadata(request: Request): Response {
  // Discovery is public configuration. A missing signing secret must not hide
  // these URLs; registration, approval and token issuance remain disabled.
  const origin = originOf(request);
  const methods = ["none", "client_secret_post", "client_secret_basic"];
  return jsonResponse({
    issuer: origin,
    authorization_endpoint: `${origin}${AUTHORIZE_PATH}`,
    token_endpoint: `${origin}${TOKEN_PATH}`,
    registration_endpoint: `${origin}${REGISTER_PATH}`,
    revocation_endpoint: `${origin}${REVOKE_PATH}`,
    scopes_supported: ALL_SCOPES,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: methods,
    revocation_endpoint_auth_methods_supported: methods,
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/admin/settings`,
  }, 200, { "Access-Control-Allow-Origin": "*" });
}

/** RFC 9728 metadata for /api/mcp (also served at the bare well-known path) and the Custom GPT API. */
export function protectedResourceMetadata(request: Request, suffix: string): Response {
  const origin = originOf(request);
  const path = suffix === "" ? MCP_PATH : suffix;
  if (![MCP_PATH, ACTIONS_PATH].includes(path)) return jsonResponse({ error: "not_found" }, 404);
  return jsonResponse({
    resource: `${origin}${path}`,
    authorization_servers: [origin],
    scopes_supported: ALL_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "D&M Painting & Decorating admin",
    resource_documentation: `${origin}/admin/settings`,
  }, 200, { "Access-Control-Allow-Origin": "*" });
}

/* Authorization ---------------------------------------------------------- */

function redirectWith(uri: string, params: Record<string, string | null>, origin: string) {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) if (value !== null) url.searchParams.set(key, value);
  url.searchParams.set("iss", origin);
  return new Response(null, { status: 303, headers: { Location: url.href, ...SECURITY_HEADERS } });
}

type Validated = { ok: true; client: Client; request: RequestPayload } | { ok: false; response: Response };

/** Validates an authorization request. Errors before the redirect is trusted never redirect. */
function validateAuthorization(params: URLSearchParams, origin: string): Validated {
  const problem = (message: string) => ({ ok: false as const, response: htmlResponse(problemPage("This connection request is not valid", message), 400) });
  const client = resolveClient(params.get("client_id"));
  if (!client) return problem("ChatGPT sent an unknown or damaged app registration. Remove the D&M app in ChatGPT and add it again.");
  let redirect = params.get("redirect_uri");
  if (!redirect && Array.isArray(client.redirects) && client.redirects.length === 1) redirect = client.redirects[0];
  if (!redirect || !redirectAllowed(client, redirect)) return problem("The return address is not one registered for ChatGPT.");

  const state = params.get("state");
  const fail = (error: string, description: string) => ({ ok: false as const, response: redirectWith(redirect, { error, error_description: description, state }, origin) });
  if (params.get("response_type") !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  const challenge = params.get("code_challenge");
  const method = params.get("code_challenge_method") ?? (challenge ? "plain" : null);
  if (challenge !== null && (method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge))) return fail("invalid_request", "PKCE must use a valid S256 code challenge.");
  if (!challenge && client.auth === "none") return fail("invalid_request", "PKCE is required.");
  const scopes = parseScopes(params.get("scope"));
  if (!scopes?.length) return fail("invalid_scope", `Supported scopes: ${ALL_SCOPES.join(" ")}.`);
  const resource = params.get("resource")?.replace(/\/+$/, "") ?? null;
  const audiences = resourcesFor(origin);
  if (resource !== null && resource !== origin && !audiences.includes(resource)) return fail("invalid_target", "Unknown resource.");
  const aud = resource && resource !== origin ? resource : client.redirects === "custom-gpt" ? audiences[1] : audiences[0];
  return {
    ok: true,
    client,
    request: { cid: client.id, ru: redirect, st: state, cc: challenge, scope: scopes, aud, exp: nowSeconds() + REQUEST_LIFETIME },
  };
}

export async function handleAuthorizeGet(request: Request): Promise<Response> {
  try { integrationKeys(); } catch { return htmlResponse(problemPage("ChatGPT is not set up yet", new IntegrationDisabled().message), 503); }
  const origin = originOf(request);
  const validated = validateAuthorization(new URL(request.url).searchParams, origin);
  if (!validated.ok) return validated.response;
  const { client, request: pending } = validated;
  return htmlResponse(consentPage({ clientName: client.name, scopes: pending.scope, request: seal("request", pending) }), 200, new URL(pending.ru).origin);
}

async function signInAsMike(password: string): Promise<AuthSession | "invalid" | "busy" | "unauthorised"> {
  let session: AuthSession;
  try {
    session = await supabaseRequest("/auth/v1/token?grant_type=password", { method: "POST", body: { email: ADMIN_EMAIL, password } });
  } catch (error) {
    if (error instanceof BackendError && error.status === 429) return "busy";
    if (error instanceof BackendError && error.status < 500) return "invalid";
    throw error;
  }
  let authorised = false;
  try { authorised = await verifyAdmin(session.access_token); }
  finally {
    // A session that will not be handed to ChatGPT must not stay live in Supabase.
    if (!authorised) await revokeCurrentSession(session.access_token, session.refresh_token);
  }
  return authorised ? session : "unauthorised";
}

export async function handleAuthorizePost(request: Request): Promise<Response> {
  try { integrationKeys(); } catch { return htmlResponse(problemPage("ChatGPT is not set up yet", new IntegrationDisabled().message), 503); }
  if (!sameOrigin(request)) return htmlResponse(problemPage("This approval was not sent from D&M", "For your security, approvals are only accepted from the D&M sign-in page itself."), 403);
  const origin = originOf(request);
  let form: URLSearchParams;
  try { form = await readParams(request); } catch { return htmlResponse(problemPage("This approval could not be read", "Please try again."), 400); }
  const pending = unseal<RequestPayload>("request", form.get("request"));
  const client = pending && resolveClient(pending.cid);
  if (!pending || !client || !redirectAllowed(client, pending.ru)) {
    return htmlResponse(problemPage("This sign-in request has expired", "The request was older than 15 minutes or was changed."), 400);
  }
  const again = (error: string, status: number) =>
    htmlResponse(consentPage({ clientName: client.name, scopes: pending.scope, request: seal("request", pending), error }), status, new URL(pending.ru).origin);
  if (form.get("decision") !== "allow") return redirectWith(pending.ru, { error: "access_denied", error_description: "Mike declined the connection.", state: pending.st }, origin);

  const password = form.get("password") ?? "";
  if (password.length < 8 || password.length > 200) return again("Enter your D&M admin password.", 400);
  let session: Awaited<ReturnType<typeof signInAsMike>>;
  try { session = await signInAsMike(password); }
  catch { return again("D&M's secure sign-in service did not respond. Please try again in a moment.", 503); }
  if (session === "invalid") return again("That password was not accepted. Check it and try again.", 401);
  if (session === "busy") return again("Too many attempts. Wait a few minutes and try again.", 429);
  if (session === "unauthorised") return again("This account is not authorised as the D&M administrator.", 403);

  const scope = form.get("allow_delete") === "on" ? pending.scope : pending.scope.filter(item => item !== "dm:delete");
  const code = seal("code", {
    cid: pending.cid, ru: pending.ru, cc: pending.cc, aud: pending.aud, scope, gid: randomId(), at: nowSeconds(),
    s: { a: session.access_token, r: session.refresh_token, e: session.expires_in }, exp: nowSeconds() + CODE_LIFETIME,
  });
  console.info("ChatGPT connection approved by the administrator");
  return redirectWith(pending.ru, { code, state: pending.st }, origin);
}

/* Tokens ----------------------------------------------------------------- */

function authenticateClient(request: Request, params: URLSearchParams): Client | Response {
  let id = params.get("client_id");
  let secret = params.get("client_secret");
  const basic = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(request.headers.get("authorization") ?? "");
  if (basic) {
    const decoded = Buffer.from(basic[1], "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    if (colon < 0) return oauthError("invalid_client", "Malformed client credentials.", 401, { "WWW-Authenticate": 'Basic realm="D&M"' });
    id = decodeURIComponent(decoded.slice(0, colon).replace(/\+/g, " "));
    secret = decodeURIComponent(decoded.slice(colon + 1).replace(/\+/g, " "));
  }
  const client = resolveClient(id);
  if (!client) return oauthError("invalid_client", "Unknown client.", 401, basic ? { "WWW-Authenticate": 'Basic realm="D&M"' } : {});
  if (client.auth !== "none" && !sameSecret(secret, clientSecret(client.id))) {
    return oauthError("invalid_client", "Client authentication failed.", 401, basic ? { "WWW-Authenticate": 'Basic realm="D&M"' } : {});
  }
  return client;
}

function issueTokens(grant: GrantFields, session: AuthSession) {
  const lifetime = Math.max(60, Math.min(Number.isFinite(session.expires_in) ? session.expires_in : 3600, 3600) - 60);
  const fields: GrantFields = { cid: grant.cid, aud: grant.aud, scope: grant.scope, gid: grant.gid, at: grant.at };
  return jsonResponse({
    access_token: seal("access", { ...fields, sat: session.access_token, exp: nowSeconds() + lifetime }),
    token_type: "Bearer",
    expires_in: lifetime,
    refresh_token: seal("refresh", { ...fields, srt: session.refresh_token }),
    scope: grant.scope.join(" "),
  });
}

/** Rotates the wrapped Supabase session and confirms it still belongs to the administrator. */
async function renewSession(refreshToken: string): Promise<AuthSession | Response> {
  let session: AuthSession;
  try { session = await refreshSession(refreshToken); }
  catch (error) {
    if (error instanceof BackendError && error.status < 500 && error.status !== 429) return oauthError("invalid_grant", "This ChatGPT connection has ended. Reconnect it from ChatGPT.");
    return oauthError("temporarily_unavailable", "D&M's sign-in service did not respond. Try again shortly.", 503, { "Retry-After": "3" });
  }
  let authorised = false;
  try { authorised = await verifyAdmin(session.access_token); }
  catch { return oauthError("temporarily_unavailable", "D&M's sign-in service did not respond. Try again shortly.", 503, { "Retry-After": "3" }); }
  if (!authorised) {
    await revokeCurrentSession(session.access_token, session.refresh_token);
    return oauthError("invalid_grant", "This account is no longer the D&M administrator.");
  }
  return session;
}

export async function handleToken(request: Request): Promise<Response> {
  try { integrationKeys(); } catch { return disabled(); }
  let params: URLSearchParams;
  try { params = await readParams(request); } catch { return oauthError("invalid_request", "The token request could not be read."); }
  const client = authenticateClient(request, params);
  if (client instanceof Response) return client;
  const origin = originOf(request);
  const resource = params.get("resource")?.replace(/\/+$/, "") ?? null;

  if (params.get("grant_type") === "authorization_code") {
    const code = unseal<CodePayload>("code", params.get("code"));
    if (!code || code.cid !== client.id) return oauthError("invalid_grant", "The authorization code is invalid or has expired.");
    const redirect = params.get("redirect_uri");
    if (redirect !== null && redirect !== code.ru) return oauthError("invalid_grant", "redirect_uri does not match the authorization request.");
    if (new URL(code.aud).origin !== origin || (resource !== null && resource !== origin && resource !== code.aud)) return oauthError("invalid_target", "The code was issued for another resource.");
    const verifier = params.get("code_verifier");
    if (code.cc) {
      if (!verifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || sha256(verifier) !== code.cc) return oauthError("invalid_grant", "PKCE verification failed.");
    } else if (client.auth === "none") return oauthError("invalid_grant", "PKCE is required.");
    // Spending the code's Supabase refresh token now makes a replayed code useless:
    // Supabase rejects a rotated token, and ends the session on late reuse.
    const session = await renewSession(code.s.r);
    if (session instanceof Response) return session;
    console.info("ChatGPT connection issued its first tokens");
    return issueTokens(code, session);
  }

  if (params.get("grant_type") === "refresh_token") {
    const token = unseal<RefreshPayload>("refresh", params.get("refresh_token"));
    if (!token || token.cid !== client.id || new URL(token.aud).origin !== origin) return oauthError("invalid_grant", "The refresh token is invalid.");
    if (nowSeconds() - token.at > GRANT_LIFETIME) {
      await revokeCurrentSession(undefined, token.srt);
      return oauthError("invalid_grant", "This connection has expired. Reconnect D&M in ChatGPT.");
    }
    const narrowed = params.get("scope") ? parseScopes(params.get("scope")) : token.scope;
    if (!narrowed || !narrowed.every(scope => token.scope.includes(scope))) return oauthError("invalid_scope", "A refresh cannot add permissions.");
    const session = await renewSession(token.srt);
    if (session instanceof Response) return session;
    return issueTokens({ ...token, scope: narrowed }, session);
  }
  return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
}

/** RFC 7009: ends the wrapped Supabase session. Always 200, as the specification requires. */
export async function handleRevoke(request: Request): Promise<Response> {
  try { integrationKeys(); } catch { return disabled(); }
  let params: URLSearchParams;
  try { params = await readParams(request); } catch { return oauthError("invalid_request", "The revocation request could not be read."); }
  const client = authenticateClient(request, params);
  if (client instanceof Response) return client;
  const value = params.get("token");
  const refresh = unseal<RefreshPayload>("refresh", value);
  const access = refresh ? null : unseal<AccessPayload>("access", value);
  const token = refresh ?? access;
  if (token && token.cid === client.id) {
    if (!await endSession(access?.sat, refresh?.srt)) return oauthError("temporarily_unavailable", "The connection could not be ended right now. Try again.", 503, { "Retry-After": "3" });
    console.info("ChatGPT connection revoked by its client");
  }
  return jsonResponse({});
}

/** False only when Supabase could not be reached; a token Supabase already rejects no longer works. */
async function endSession(access?: string, refresh?: string): Promise<boolean> {
  const rejected = (error: unknown) => error instanceof BackendError && error.status < 500 && error.status !== 429;
  try {
    let token = access;
    if (refresh) {
      try { token = (await refreshSession(refresh)).access_token; }
      catch (error) { if (rejected(error)) return true; throw error; }
    }
    try { await supabaseRequest("/auth/v1/logout?scope=local", { token, method: "POST" }); }
    catch (error) { if (!rejected(error)) throw error; }
    return true;
  } catch { return false; }
}

/* Resource access -------------------------------------------------------- */

/** The grant carried by a bearer token presented to one of D&M's ChatGPT endpoints, if valid. */
export function bearerGrant(request: Request): Grant | null {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) return null;
  const token = unseal<AccessPayload>("access", match[1]);
  const origin = originOf(request);
  if (!token || !resourcesFor(origin).includes(token.aud) || typeof token.sat !== "string") return null;
  if (nowSeconds() - token.at > GRANT_LIFETIME) return null;
  return { client: token.cid, scopes: token.scope.filter(isScope), grant: token.gid, supabase: token.sat, audience: token.aud, origin };
}

/** 401 that tells ChatGPT where to authorise (RFC 9728) or to refresh an expired token. */
export function unauthorised(request: Request, resourcePath: string, presented: boolean): Response {
  const origin = originOf(request);
  const challenge = [
    'Bearer realm="D&M"',
    `resource_metadata="${origin}/.well-known/oauth-protected-resource${resourcePath}"`,
    `scope="${ALL_SCOPES.join(" ")}"`,
    ...(presented ? ['error="invalid_token"', 'error_description="The access token is invalid or has expired"'] : []),
  ].join(", ");
  return jsonResponse({ error: presented ? "invalid_token" : "unauthorized", error_description: "Connect D&M in ChatGPT and sign in as Mike." }, 401, { "WWW-Authenticate": challenge });
}

export { disabled as integrationDisabledResponse };

