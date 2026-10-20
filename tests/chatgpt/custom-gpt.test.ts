import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { ALL_SCOPES, CUSTOM_GPT_CLIENT_ID, GRANT_LIFETIME } from "../../lib/chatgpt/config.ts";
import { handleAction, openApiDocument } from "../../lib/chatgpt/mcp.ts";
import { clientSecret, handleAuthorizeGet, handleAuthorizePost, handleRevoke, handleToken, protectedResourceMetadata } from "../../lib/chatgpt/oauth.ts";
import { serverInstructions, tools } from "../../lib/chatgpt/tools.ts";
import { configure, fakeSupabase, ORIGIN, PASSWORD } from "./fake-supabase.ts";

// The Custom GPT route: the one that works in ChatGPT's iPhone app. A GPT's
// Actions are described by /api/chatgpt/openapi.json, sign in with the fixed
// dm-custom-gpt client and its secret, and call /api/chatgpt/actions/<name>
// with JSON. These tests follow exactly what ChatGPT does, including the older
// chat.openai.com callback that ChatGPT redirects to chatgpt.com.

const NOW = Date.parse("2026-10-16T09:30:00.000Z"); // a Friday
const CALLBACK = "https://chat.openai.com/aip/g-dmAdmin123/oauth/callback";
const SECRET_OF_GPT = () => clientSecret(CUSTOM_GPT_CLIENT_ID);

const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const form = (url: string, body: Record<string, string>, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers, body: new URLSearchParams(body) });

type Tokens = { access_token: string; refresh_token: string; expires_in: number; token_type: string; scope: string };

/** Mike presses "Sign in" in the GPT, approves on D&M's page, and ChatGPT exchanges the code ("Default (POST request)"). */
async function signIn(scope = ALL_SCOPES.join(" ")) {
  const url = new URL(`${ORIGIN}/oauth/authorize`);
  for (const [key, value] of Object.entries({ response_type: "code", client_id: CUSTOM_GPT_CLIENT_ID, redirect_uri: CALLBACK, state: "gpt-state", scope })) url.searchParams.set(key, value);
  const page = await handleAuthorizeGet(new Request(url));
  assert.equal(page.status, 200);
  const request = /name="request" value="([^"]+)"/.exec(await page.text())![1];
  const approved = await handleAuthorizePost(form(url.href, { request, decision: "allow", password: PASSWORD, allow_delete: "on" }, { origin: ORIGIN, "sec-fetch-site": "same-origin" }));
  assert.equal(approved.status, 303);
  const location = new URL(approved.headers.get("location")!);
  assert.equal(`${location.origin}${location.pathname}`, CALLBACK);
  assert.equal(location.searchParams.get("state"), "gpt-state");
  const code = location.searchParams.get("code")!;
  const issued = await handleToken(json(`${ORIGIN}/api/oauth/token`, { grant_type: "authorization_code", code, redirect_uri: CALLBACK, client_id: CUSTOM_GPT_CLIENT_ID, client_secret: SECRET_OF_GPT() }));
  assert.equal(issued.status, 200);
  return { page, tokens: await issued.json() as Tokens };
}

/** What a GPT sends for one action: POST with a JSON body (none for an action without inputs). */
async function action(name: string, token: string, body?: Record<string, unknown>) {
  const response = await handleAction(new Request(`${ORIGIN}/api/chatgpt/actions/${name}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
  }), name);
  return { response, result: response.status === 200 ? await response.json() as Record<string, unknown> & { message: string; status: string; document?: Record<string, unknown> } : null };
}

function setup(context: TestContext) {
  configure(context);
  context.mock.timers.enable({ apis: ["Date"], now: NOW });
  return fakeSupabase(context);
}

type Schema = Record<string, unknown>;
function walk(value: unknown, visit: (schema: Schema, path: string) => void, path = "$") {
  if (Array.isArray(value)) value.forEach((item, index) => walk(item, visit, `${path}[${index}]`));
  else if (value && typeof value === "object") {
    visit(value as Schema, path);
    for (const [key, item] of Object.entries(value)) walk(item, visit, `${path}.${key}`);
  }
}

test("the OpenAPI document imports into the GPT builder and exposes every operation Mike needs", async context => {
  setup(context);
  const response = openApiDocument(new Request(`${ORIGIN}/api/chatgpt/openapi.json`));
  assert.equal(response.status, 200);
  const raw = await response.text();
  const doc = JSON.parse(raw);
  assert.ok(raw.length < 100_000, "Small enough for the GPT builder");
  assert.match(doc.openapi, /^3\.1\./);
  assert.deepEqual(doc.servers, [{ url: ORIGIN }]);
  assert.ok(doc.info.description.length <= 300);
  const flow = doc.components.securitySchemes.dmOAuth.flows.authorizationCode;
  assert.equal(flow.authorizationUrl, `${ORIGIN}/oauth/authorize`);
  assert.equal(flow.tokenUrl, `${ORIGIN}/api/oauth/token`, "OAuth runs on the API's own domain");

  const operations = Object.entries(doc.paths as Record<string, { post: Schema & { operationId: string; description: string; summary: string; requestBody?: { content: { "application/json": { schema: Schema } } } } }>);
  assert.ok(operations.length <= 30, "A GPT accepts at most 30 operations");
  const ids = operations.map(([, path]) => path.post.operationId);
  assert.equal(new Set(ids).size, ids.length);
  for (const needed of ["create_quote", "update_quote", "get_quote", "list_quotes", "create_invoice", "update_invoice", "get_invoice", "list_invoices", "record_payment",
    "create_customer_link", "revoke_customer_link", "list_bookings", "check_availability", "create_booking", "update_booking", "get_business_settings"]) {
    assert.ok(ids.includes(needed), `The GPT can ${needed}`);
  }
  for (const [path, { post }] of operations) {
    assert.equal(path, `/api/chatgpt/actions/${post.operationId}`);
    assert.match(post.operationId, /^[a-zA-Z0-9_-]+$/);
    assert.ok(post.summary && post.description.length <= 300, `${post.operationId}: descriptions are limited to 300 characters`);
    assert.equal(post["x-openai-isConsequential"], tools.find(tool => tool.name === post.operationId)!.kind !== "read", "ChatGPT asks Mike before any change");
    const schema = post.requestBody?.content["application/json"].schema;
    if (schema) {
      assert.equal(schema.type, "object");
      assert.ok(Object.keys(schema.properties as object).length, `${post.operationId}: a request body has properties`);
    } else {
      assert.equal(Object.keys((tools.find(tool => tool.name === post.operationId)!.inputSchema as { properties: object }).properties).length, 0, `${post.operationId} takes no input`);
    }
  }
  walk(doc, (schema, at) => {
    assert.ok(!(Array.isArray(schema.required) && !schema.required.length), `${at}: no empty required list`);
    for (const combinator of ["oneOf", "anyOf", "allOf"]) assert.ok(!(combinator in schema), `${at}: no ${combinator}`);
    if (typeof schema.$ref === "string") assert.ok(schema.$ref.startsWith("#/components/schemas/") && doc.components.schemas[schema.$ref.split("/").pop()!], `${at}: $ref resolves`);
    if (at.includes(".properties.") && !at.endsWith(".properties") && !("$ref" in schema) && /\.properties\.[^.]+$/.test(at)) assert.ok("type" in schema, `${at}: every property has a type`);
  });
  const resource = await protectedResourceMetadata(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/api/chatgpt`), "/api/chatgpt").json();
  assert.equal(resource.resource, `${ORIGIN}/api/chatgpt`);
});

test("on the iPhone route ChatGPT signs in through chat.openai.com and runs Mike's five requests, each read back from D&M's records", async context => {
  const supabase = setup(context);
  const before = structuredClone(supabase.state.data);
  const { page, tokens } = await signIn();
  // Older GPT callbacks on chat.openai.com redirect to chatgpt.com; the approval form may follow both.
  assert.match(page.headers.get("content-security-policy")!, /form-action 'self' https:\/\/chatgpt\.com https:\/\/chat\.openai\.com https:\/\/platform\.openai\.com;/);
  assert.equal(tokens.token_type, "Bearer");
  assert.equal(tokens.scope, "dm:read dm:write dm:delete");
  assert.ok(tokens.expires_in <= 3540, "ChatGPT refreshes before the wrapped session expires");

  const settings = await action("get_business_settings", tokens.access_token);
  assert.equal(settings.result?.today, "2026-10-16");

  // "Create an invoice for John Smith for £850 decorating labour."
  const invoice = await action("create_invoice", tokens.access_token, {
    customer: { name: "John Smith" }, title: "Decorating labour", works: [{ description: "Decorating labour", quantity: 1, unitPrice: 850 }], expectedSubtotal: 850,
  });
  assert.equal(invoice.result?.status, "created");
  assert.equal(invoice.result?.error, undefined);
  const saved = invoice.result!.document!;
  assert.deepEqual([saved.kind, saved.number, saved.customer, saved.amount, saved.status, saved.customerLinkStatus, saved.verified], ["invoice", "INV-0001", "John Smith", "£850.00", "draft", "new", true]);
  assert.match(saved.customerLink as string, /^https:\/\/www\.dmpaintingdecorating\.co\.uk\/d\/[a-f0-9]{64}$/);
  assert.equal(supabase.state.data.invoices.find(record => record.id === saved.id)!.number, "INV-0001");
  assert.match(invoice.result!.message, /^Created invoice INV-0001 for John Smith: Decorating labour\. Total £850\.00 \(no VAT\), due 30 October 2026\. Customer link: https:/);

  // A dropped connection makes ChatGPT repeat the action: no second invoice.
  const repeat = await action("create_invoice", tokens.access_token, {
    customer: { name: "John Smith" }, title: "Decorating labour", works: [{ description: "Decorating labour", quantity: 1, unitPrice: 850 }], expectedSubtotal: 850,
  });
  assert.equal(repeat.result?.status, "already_created");
  assert.equal(repeat.result?.document?.number, "INV-0001");
  assert.equal(supabase.state.data.invoices.length, 1);

  // "Create a quote for a three-day painting job, £1,500 labour and £200 materials." Without a customer, nothing is made.
  const anonymous = await action("create_quote", tokens.access_token, { title: "Three-day painting job", works: [{ description: "Painting labour", quantity: 3, unit: "day", unitPrice: 500 }], expectedSubtotal: 1500 });
  assert.equal(anonymous.result?.error, true);
  assert.match(anonymous.result!.message, /customer\.name is required/);
  const quote = await action("create_quote", tokens.access_token, {
    customer: { name: "Sarah Jones" }, title: "Three-day painting job",
    works: [{ description: "Painting labour", quantity: 3, unit: "day", unitPrice: 500 }], materials: [{ description: "Materials", quantity: 1, unitPrice: 200 }], expectedSubtotal: 1700,
  });
  assert.deepEqual([quote.result?.status, quote.result?.document?.number, quote.result?.document?.amount, quote.result?.document?.verified], ["created", "Q-0001", "£1,700.00", true]);

  // "Show my diary for next week."
  const diary = await action("list_bookings", tokens.access_token, { period: "next-week" });
  assert.deepEqual([diary.result?.from, diary.result?.to], ["2026-10-19", "2026-10-25"]);
  assert.equal(diary.result?.message, "Nothing booked next week (Mon 19 Oct – Sun 25 Oct).");
  const booked = await action("create_booking", tokens.access_token, { start: "2026-10-19", days: 3, quote: "Q-0001" });
  assert.equal(booked.result?.status, "booked");
  assert.equal((await action("list_bookings", tokens.access_token, { period: "next-week" })).result?.message, "1 booking next week (Mon 19 Oct – Sun 25 Oct).");

  // "Mark invoice INV-0001 as paid."
  const paid = await action("record_payment", tokens.access_token, { invoice: "INV-0001", payRemainingBalance: true });
  assert.deepEqual([paid.result?.status, paid.result?.document?.status, paid.result?.document?.balance, paid.result?.document?.verified], ["recorded", "paid", "£0.00", true]);

  // "Find John's invoice and give me the customer link."
  const found = await action("list_invoices", tokens.access_token, { search: "John" });
  const number = (found.result?.invoices as { number: string }[])[0].number;
  const ask = await action("create_customer_link", tokens.access_token, { document: number });
  assert.equal(ask.result?.status, "confirmation_required", "A paid invoice's customer may hold the link, so Mike confirms first");
  const link = await action("create_customer_link", tokens.access_token, { document: number, confirmationCode: ask.result?.confirmationCode });
  assert.deepEqual([link.result?.status, link.result?.document?.number, link.result?.document?.customerLinkStatus], ["created", "INV-0001", "new"]);
  assert.equal(link.result?.customerLink, link.result?.document?.customerLink);
  assert.notEqual(link.result?.customerLink, saved.customerLink, "Any earlier link stops working");
  assert.equal(supabase.state.shares.get(saved.id as string), (link.result!.customerLink as string).slice(-64));

  for (const record of before.quotes) assert.deepEqual(supabase.state.data.quotes.find(item => item.id === record.id), record);
});

test("the Custom GPT's sign-in refuses wrong secrets and other sites, and expired or ended sessions ask Mike to sign in again", async context => {
  const supabase = setup(context);
  const { tokens } = await signIn();
  const challenge = (response: Response) => response.headers.get("www-authenticate") ?? "";

  // No token, a forged token, a refresh token or a token for another site: 401 with where to sign in.
  for (const header of [null, "Bearer dmat_forged", `Bearer ${tokens.refresh_token}`]) {
    const response = await handleAction(new Request(`${ORIGIN}/api/chatgpt/actions/list_quotes`, { method: "POST", headers: header ? { authorization: header } : {} }), "list_quotes");
    assert.equal(response.status, 401);
    assert.match(challenge(response), /resource_metadata="https:\/\/www\.dmpaintingdecorating\.co\.uk\/\.well-known\/oauth-protected-resource\/api\/chatgpt"/);
  }
  const elsewhere = await handleAction(new Request("https://dm-preview.vercel.app/api/chatgpt/actions/list_quotes", { method: "POST", headers: { authorization: `Bearer ${tokens.access_token}` } }), "list_quotes");
  assert.equal(elsewhere.status, 401);
  assert.equal((await handleToken(form(`${ORIGIN}/api/oauth/token`, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: CUSTOM_GPT_CLIENT_ID, client_secret: "wrong" }))).status, 401);

  // An hour later the access token has expired: ChatGPT is told to refresh, then carries on.
  context.mock.timers.tick(3600_000);
  const expired = await action("list_quotes", tokens.access_token, {});
  assert.equal(expired.response.status, 401);
  assert.match(challenge(expired.response), /error="invalid_token"/);
  const basic = Buffer.from(`${CUSTOM_GPT_CLIENT_ID}:${SECRET_OF_GPT()}`).toString("base64");
  const renewed = await handleToken(form(`${ORIGIN}/api/oauth/token`, { grant_type: "refresh_token", refresh_token: tokens.refresh_token }, { authorization: `Basic ${basic}` }));
  assert.equal(renewed.status, 200, "Both token exchange methods the GPT builder offers are accepted");
  const next = await renewed.json() as Tokens;
  assert.equal((await action("list_quotes", next.access_token, {})).result?.message, "No quotes match.");

  // Supabase ends the session (Settings → Disconnect ChatGPT): actions fail closed with 401.
  for (const session of supabase.state.sessions.values()) session.alive = false;
  const ended = await action("create_quote", next.access_token, { customer: { name: "X" }, title: "X", works: [{ description: "X", quantity: 1, unitPrice: 1 }], expectedSubtotal: 1 });
  assert.equal(ended.response.status, 401);
  assert.match(challenge(ended.response), /error="invalid_token"/);
  assert.equal(supabase.state.data.quotes.length, 0, "Nothing was saved");
  const refused = await handleToken(form(`${ORIGIN}/api/oauth/token`, { grant_type: "refresh_token", refresh_token: next.refresh_token, client_id: CUSTOM_GPT_CLIENT_ID, client_secret: SECRET_OF_GPT() }));
  assert.equal((await refused.json()).error, "invalid_grant", "A refresh cannot revive an ended session");
});

test("after 90 days the GPT must be approved again, and its session is ended", async context => {
  const supabase = setup(context);
  const { tokens } = await signIn();
  context.mock.timers.tick((GRANT_LIFETIME + 60) * 1000);
  const refused = await handleToken(form(`${ORIGIN}/api/oauth/token`, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: CUSTOM_GPT_CLIENT_ID, client_secret: SECRET_OF_GPT() }));
  assert.equal((await refused.json()).error, "invalid_grant");
  assert.equal([...supabase.state.sessions.values()].filter(session => session.alive).length, 0);
  const revoked = await handleRevoke(form(`${ORIGIN}/api/oauth/revoke`, { token: tokens.refresh_token, client_id: CUSTOM_GPT_CLIENT_ID, client_secret: SECRET_OF_GPT() }));
  assert.equal(revoked.status, 200, "Disconnecting the GPT afterwards is harmless");
});

test("the setup guide gives Mike exactly the instructions the GPT needs", () => {
  const guide = readFileSync(new URL("../../docs/chatgpt.md", import.meta.url), "utf8");
  assert.ok(guide.includes(serverInstructions), "docs/chatgpt.md must contain the current GPT instructions verbatim");
  assert.ok(serverInstructions.length < 8000, "A GPT's instructions are limited to 8,000 characters");
});
