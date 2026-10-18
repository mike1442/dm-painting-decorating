import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "../../lib/admin/auth";
import { documentTotal, expect, field, layoutFits, readCloud, test } from "./support/fixtures";
import { customerNavigate, prepareLiveBrowser } from "./support/live-environment";

// Mike's ChatGPT connection, end to end, against the real application and
// database: the official MCP SDK client stands in for ChatGPT and follows the
// same discovery, dynamic registration, PKCE and token steps, returning to
// ChatGPT's real redirect address (intercepted in the browser). Mike approves
// in a fresh browser; ChatGPT creates a quote from his words; the customer link
// opens for an anonymous visitor; revocation and disconnection fail closed.
// Every record is a TEST document removed by the worker fixtures, and the
// ChatGPT session is revoked even when a step fails.

const CHATGPT_REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";

class ChatGptStandIn implements OAuthClientProvider {
  registration?: OAuthClientInformationMixed;
  saved?: OAuthTokens;
  verifier = "";
  authorization?: URL;
  readonly expectedState = randomUUID();
  get redirectUrl() { return CHATGPT_REDIRECT; }
  get clientMetadata(): OAuthClientMetadata {
    return { client_name: "ChatGPT", redirect_uris: [CHATGPT_REDIRECT], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
  }
  state() { return this.expectedState; }
  clientInformation() { return this.registration; }
  saveClientInformation(information: OAuthClientInformationMixed) { this.registration = information; }
  tokens() { return this.saved; }
  saveTokens(tokens: OAuthTokens) { this.saved = tokens; }
  redirectToAuthorization(url: URL) { this.authorization = url; }
  saveCodeVerifier(verifier: string) { this.verifier = verifier; }
  codeVerifier() { return this.verifier; }
}

type Structured = { status: string; message: string; confirmationCode?: string; customerLink?: string; quote?: { id: string; number: string; total: string; customer: { name: string } } };
const structured = (result: unknown) => (result as { structuredContent: Structured }).structuredContent;

async function unavailable(page: Page, url: string) {
  const response = await customerNavigate(page, url);
  expect(response?.status(), "A replaced or revoked customer link must fail closed").toBe(404);
  await expect(page.getByRole("heading", { name: "This document is unavailable" })).toBeVisible();
}

test.describe("ChatGPT connection", () => {
  test.describe.configure({ mode: "serial" });

  const chatgpt = new ChatGptStandIn();
  let client: Client | null = null;
  /** An authorization code not yet exchanged; its session still needs revoking. */
  let pendingCode = "";
  let quote = { id: "", number: "" };
  let firstLink = "";
  let link = "";
  const quoteTitle = (runId: string) => `TEST ${runId} Living room redecoration`;
  const request = (runId: string) => ({
    customer: { name: "Paul Finn", address: "6 Falkstone Close, Gorse Covert, WA3 6SU" },
    title: quoteTitle(runId),
    works: [{ description: "Living room walls (25 m²): preparation and two coats", quantity: 2, unit: "day", unitPrice: 200 }],
    materials: [{ description: "Paint and materials", quantity: 1, unitPrice: 118 }],
    expectedSubtotal: 518,
    // A real run must never use one of Mike's issued quote numbers.
    testDocument: true,
  });

  async function endpoint(baseURL: string, path: string, body: Record<string, string>) {
    return fetch(new URL(path, baseURL), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  }

  test.afterAll(async ({ live }) => {
    // Whatever happened above, the dedicated Supabase session must not stay live.
    await client?.close().catch(() => {});
    if (pendingCode && !chatgpt.saved) {
      await new StreamableHTTPClientTransport(new URL("/api/mcp", live.baseURL), { authProvider: chatgpt }).finishAuth(pendingCode).catch(() => {});
    }
    if (chatgpt.saved?.refresh_token && chatgpt.registration) {
      await endpoint(live.baseURL, "/api/oauth/revoke", { token: chatgpt.saved.refresh_token, client_id: chatgpt.registration.client_id }).catch(() => {});
    }
  });

  test("Mike connects ChatGPT by approving on D&M's own sign-in page", async ({ browser, live }) => {
    const mcp = new URL("/api/mcp", live.baseURL);
    const first = new Client({ name: "chatgpt-stand-in", version: "1.0.0" });
    // No token yet: the server's 401 starts discovery, registration and the authorization redirect.
    await expect(first.connect(new StreamableHTTPClientTransport(mcp, { authProvider: chatgpt }))).rejects.toThrow(UnauthorizedError);
    const authorization = chatgpt.authorization!;
    expect(`${authorization.origin}${authorization.pathname}`).toBe(`${live.baseURL}/oauth/authorize`);
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("resource")).toBe(mcp.href);
    expect(chatgpt.registration?.client_id).toMatch(/^dmcl_/);

    // Mike's own browser, with no admin session.
    const context = await browser.newContext(live.device);
    try {
      await prepareLiveBrowser(context);
      // Nothing in this test may reach the real ChatGPT. Routes do not see a
      // navigation's redirect target, so the approval's 303 is read where it is
      // answered, and the browser is shown a stand-in ChatGPT page instead.
      await context.route("https://chatgpt.com/**", route => route.abort());
      let returned: URL | null = null;
      // The form posts back to the page's own address, query string included.
      await context.route(url => url.origin === live.baseURL && url.pathname === "/oauth/authorize", async route => {
        if (route.request().method() !== "POST") return route.continue();
        const response = await route.fetch({ maxRedirects: 0 });
        const location = response.headers().location;
        if (response.status() !== 303 || !location?.startsWith("https://chatgpt.com/")) return route.fulfill({ response });
        returned = new URL(location);
        await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>ChatGPT</title><p>Connected to ChatGPT</p>" });
      });
      const page = await context.newPage();
      expect((await page.goto(authorization.href))?.status(), "The consent page must load for ChatGPT's authorization request").toBe(200);
      await expect(page.getByRole("heading", { name: "Connect ChatGPT to D&M admin" })).toBeVisible();
      await expect(page.getByText("Create and update quotes, invoices, payments, diary bookings and customer links")).toBeVisible();
      await expect(field(page, "Email")).toHaveValue("mike@dmpaintingdecorating.co.uk");
      await layoutFits(page);

      // A wrong password is refused on D&M's page and nothing returns to ChatGPT.
      await field(page, "D&M admin password").fill("not-the-password");
      await page.getByRole("button", { name: "Allow", exact: true }).click();
      await expect(page.getByRole("alert")).toHaveText("That password was not accepted. Check it and try again.");
      expect(returned).toBeNull();

      // Never locator.fill(password): its failure log could print the value.
      await page.evaluate(value => { document.querySelector<HTMLInputElement>('input[name="password"]')!.value = value; }, live.password);
      await page.getByRole("button", { name: "Allow", exact: true }).click();
      await expect(page.getByText("Connected to ChatGPT")).toBeVisible();
      const callback = returned as URL | null;
      expect(callback && `${callback.origin}${callback.pathname}`).toBe(CHATGPT_REDIRECT);
      expect(callback!.searchParams.get("state")).toBe(chatgpt.expectedState);
      expect(callback!.searchParams.get("iss")).toBe(live.baseURL);
      const code = callback!.searchParams.get("code")!;
      expect(code).toMatch(/^dmac_/);
      pendingCode = code;
      expect((await context.cookies(live.baseURL)).some(cookie => [ACCESS_COOKIE, REFRESH_COOKIE].includes(cookie.name)), "Approving ChatGPT must not sign this browser in").toBe(false);

      await new StreamableHTTPClientTransport(mcp, { authProvider: chatgpt }).finishAuth(code);
      pendingCode = "";
    } finally {
      await context.close();
    }
    expect(chatgpt.saved?.access_token).toMatch(/^dmat_/);
    expect(chatgpt.saved?.scope).toBe("dm:read dm:write dm:delete");

    client = new Client({ name: "chatgpt-stand-in", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(mcp, { authProvider: chatgpt }));
    const names = (await client.listTools()).tools.map(tool => tool.name);
    for (const name of ["create_quote", "update_quote", "list_quotes", "create_invoice", "record_payment", "create_booking", "check_availability", "update_booking", "create_customer_link", "revoke_customer_link", "delete_quote"]) {
      expect(names, `ChatGPT must be offered ${name}`).toContain(name);
    }
  });

  test("ChatGPT creates the £518 quote from Mike's words, once, and returns its customer link", async ({ admin, ledger, live }) => {
    const before = await readCloud(admin.context.request, live.baseURL);
    const created = structured(await client!.callTool({ name: "create_quote", arguments: request(live.runId) }));
    if (created.quote) ledger.owned.add(created.quote.id);
    expect(created.status, created.message).toBe("created");
    expect(created.quote!.total).toBe("£518.00");
    expect(created.quote!.number).toMatch(/^TEST-/);
    expect(created.message).toContain(`Total £518.00`);
    expect(created.customerLink).toMatch(new RegExp(`^${live.baseURL}/d/[a-f0-9]{64}$`));
    quote = { id: created.quote!.id, number: created.quote!.number };
    firstLink = created.customerLink!;

    // ChatGPT repeats the call, as after a dropped connection: no second quote,
    // and the link Mike may already have sent keeps working.
    const repeated = structured(await client!.callTool({ name: "create_quote", arguments: request(live.runId) }));
    expect(repeated.status, repeated.message).toBe("already_created");
    expect(repeated.quote!.id).toBe(quote.id);
    expect(repeated.customerLink).toBeUndefined();

    // Asked for the link again, ChatGPT makes a replacement; the first one stops working.
    const replacement = structured(await client!.callTool({ name: "create_customer_link", arguments: { document: quote.number } }));
    expect(replacement.status, replacement.message).toBe("created");
    link = replacement.customerLink!;
    expect(link).toMatch(new RegExp(`^${live.baseURL}/d/[a-f0-9]{64}$`));
    expect(link).not.toBe(firstLink);

    const after = await readCloud(admin.context.request, live.baseURL);
    expect(after.data.quotes.filter(record => record.title === quoteTitle(live.runId))).toHaveLength(1);
    const saved = after.data.quotes.find(record => record.id === quote.id)!;
    expect(saved.source).toBe("chatgpt");
    expect(saved.customer.address).toEqual({ line1: "6 Falkstone Close", line2: "", town: "Gorse Covert", postcode: "WA3 6SU" });
    expect(after.data.settings.nextQuoteNumber, "A test quote must not use an issued number").toBe(before.data.settings.nextQuoteNumber);
    for (const group of ["quotes", "invoices", "bookings"] as const) {
      for (const record of before.data[group]) {
        expect(JSON.stringify(after.data[group].find(item => item.id === record.id)), `Existing ${record.kind} records must be preserved`).toBe(JSON.stringify(record));
      }
    }
  });

  test("the customer link opens the quote for anyone, without admin access", async ({ customer, live }) => {
    const { page } = customer;
    const response = await customerNavigate(page, link);
    expect(response?.status()).toBe(200);
    const article = page.getByRole("article");
    await expect(article).toContainText(quote.number);
    await expect(article).toContainText("Paul Finn");
    await expect(article).toContainText("6 Falkstone Close");
    await expect(article).toContainText("WA3 6SU");
    await expect(article).toContainText("Living room walls (25 m²): preparation and two coats");
    await expect(documentTotal(page, "Total")).toHaveText("£518.00");
    await expect(page.getByText("Test document · Not issued · No payment required")).toBeVisible();
    await layoutFits(page);
    expect((await page.request.get(new URL("/api/admin/data", live.baseURL).href, { maxRedirects: 0 })).status(), "A customer link grants no admin access").toBe(401);
    // The replacement link works; the first one stopped working.
    await unavailable(page, firstLink);
  });

  test("revoking customer access and deleting need Mike's confirmation first", async ({ admin, customer, live }) => {
    const preview = structured(await client!.callTool({ name: "revoke_customer_link", arguments: { document: quote.number } }));
    expect(preview.status).toBe("confirmation_required");
    expect((await customerNavigate(customer.page, link))?.status(), "Nothing changes before Mike confirms").toBe(200);
    const revoked = structured(await client!.callTool({ name: "revoke_customer_link", arguments: { document: quote.number, confirmationCode: preview.confirmationCode } }));
    expect(revoked.status).toBe("revoked");
    await unavailable(customer.page, link);

    const askDelete = structured(await client!.callTool({ name: "delete_quote", arguments: { quote: quote.number } }));
    expect(askDelete.status).toBe("confirmation_required");
    expect((await readCloud(admin.context.request, live.baseURL)).data.quotes.some(record => record.id === quote.id)).toBe(true);
    const deleted = structured(await client!.callTool({ name: "delete_quote", arguments: { quote: quote.number, confirmationCode: askDelete.confirmationCode } }));
    expect(deleted.status).toBe("deleted");
    expect((await readCloud(admin.context.request, live.baseURL)).data.quotes.some(record => record.id === quote.id)).toBe(false);
  });

  test("the connection refreshes, and revoking it ends ChatGPT's session at once", async ({ live }) => {
    const clientId = chatgpt.registration!.client_id;
    const refreshed = await endpoint(live.baseURL, "/api/oauth/token", { grant_type: "refresh_token", refresh_token: chatgpt.saved!.refresh_token!, client_id: clientId });
    expect(refreshed.status).toBe(200);
    const tokens = await refreshed.json() as OAuthTokens;
    expect(tokens.refresh_token, "Each refresh rotates the wrapped session's refresh token").not.toBe(chatgpt.saved!.refresh_token);
    chatgpt.saveTokens(tokens);

    const call = () => fetch(new URL("/api/mcp", live.baseURL), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${tokens.access_token}`, "MCP-Protocol-Version": "2025-11-25" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_business_settings", arguments: {} } }),
    });
    expect((await call()).status).toBe(200);
    expect((await endpoint(live.baseURL, "/api/oauth/revoke", { token: tokens.refresh_token!, client_id: clientId })).status).toBe(200);
    const after = await call();
    expect(after.status, "A revoked connection must be refused").toBe(401);
    expect(after.headers.get("www-authenticate")).toContain('error="invalid_token"');
    chatgpt.saved = undefined;
  });
});
