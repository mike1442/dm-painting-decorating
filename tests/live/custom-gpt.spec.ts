import { ACCESS_COOKIE, REFRESH_COOKIE } from "../../lib/admin/auth";
import { documentTotal, expect, field, layoutFits, readCloud, region, test } from "./support/fixtures";
import { adminNavigate, customerNavigate, liveApi, prepareLiveBrowser, privateNavigate } from "./support/live-environment";

// Mike's Custom GPT, the route that works in ChatGPT's iPhone app, end to end
// against the real application and database. The test does what ChatGPT does:
// it imports the OpenAPI document, uses the client values Mike copies from
// Settings → ChatGPT, sends Mike to D&M's approval page (here in the project's
// desktop or phone browser) with a GPT callback on chat.openai.com (intercepted,
// never reached), exchanges the code and calls the actions. Every document is a TEST document, deleted at the
// end after confirmation, and the GPT's session is revoked even when a step fails.

const GPT_CALLBACK = "https://chat.openai.com/aip/g-dmLiveTest/oauth/callback";

type Connection = { instructions: string; openApiUrl: string; authorizationUrl: string; tokenUrl: string; clientId: string; clientSecret: string; scope: string };
type Tokens = { access_token: string; refresh_token: string };
type Saved = { kind: string; id: string; number: string; customer: string; amount: string; status: string; balance?: string; customerLink: string | null; customerLinkStatus: string; verified: boolean };
type Answer = { message: string; status: string; error?: boolean; document?: Saved; customerLink?: string; confirmationCode?: string; from?: string; to?: string; invoices?: { number: string }[] };

test.describe("Custom GPT (the iPhone route)", () => {
  test.describe.configure({ mode: "serial" });

  let gpt: Connection | null = null;
  let tokens: Tokens | null = null;
  /** An authorization code not yet exchanged; its session still needs revoking. */
  let pendingCode = "";
  let invoice: Saved | null = null;
  let quote: Saved | null = null;
  let firstLink = "";
  let link = "";
  const title = (runId: string, job: string) => `TEST ${runId} ${job}`;
  const customer = "John Smith (TEST)";

  async function action(baseURL: string, name: string, body?: Record<string, unknown>): Promise<{ status: number; answer: Answer | null; challenge: string | null }> {
    const response = await fetch(new URL(`/api/chatgpt/actions/${name}`, baseURL), {
      method: "POST",
      headers: { Authorization: `Bearer ${tokens!.access_token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, answer: response.status === 200 ? await response.json() as Answer : null, challenge: response.headers.get("www-authenticate") };
  }
  const tokenRequest = (baseURL: string, body: Record<string, string>, basic = false) => fetch(new URL("/api/oauth/token", baseURL), {
    method: "POST",
    headers: basic
      ? { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${gpt!.clientId}:${gpt!.clientSecret}`).toString("base64")}` }
      : { "Content-Type": "application/json" },
    body: basic ? new URLSearchParams(body).toString() : JSON.stringify({ ...body, client_id: gpt!.clientId, client_secret: gpt!.clientSecret }),
  });

  test.afterAll(async ({ live }) => {
    // Whatever happened above, the GPT's dedicated Supabase session must not stay live.
    if (pendingCode && !tokens && gpt) {
      const exchanged = await tokenRequest(live.baseURL, { grant_type: "authorization_code", code: pendingCode, redirect_uri: GPT_CALLBACK }).catch(() => null);
      if (exchanged?.ok) tokens = await exchanged.json() as Tokens;
    }
    if (tokens && gpt) {
      await fetch(new URL("/api/oauth/revoke", live.baseURL), {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: tokens.refresh_token, client_id: gpt.clientId, client_secret: gpt.clientSecret }).toString(),
      }).catch(() => {});
    }
  });

  test("Settings → ChatGPT gives Mike everything the GPT needs, and the GPT's OpenAPI document imports", async ({ admin, live }) => {
    // A tab of its own, so the signed-in page the other suites share is left where it was.
    const page = await admin.context.newPage();
    try {
      await adminNavigate(page, "/admin/settings");
      const card = region(page, "ChatGPT");
      await expect(card.getByText("Works on iPhone: your own D&M GPT.")).toBeVisible();
      await expect(field(card, "Instructions")).toHaveValue(/never estimate or invent a price/);
      await expect(field(card, "Client ID")).toHaveValue("dm-custom-gpt");
      await layoutFits(page);
    } finally {
      await page.close();
    }

    const settings = await liveApi(admin.context.request, live.baseURL, "/api/admin/chatgpt");
    expect(settings.status()).toBe(200);
    gpt = (await settings.json() as { customGpt: Connection }).customGpt;
    expect(gpt.openApiUrl).toBe(`${live.baseURL}/api/chatgpt/openapi.json`);
    expect(gpt.clientSecret.length).toBeGreaterThan(20);

    const imported = await fetch(gpt.openApiUrl);
    expect(imported.status).toBe(200);
    const openapi = await imported.json() as { servers: { url: string }[]; paths: Record<string, unknown>; components: { securitySchemes: { dmOAuth: { flows: { authorizationCode: { authorizationUrl: string; tokenUrl: string } } } } } };
    expect(openapi.servers).toEqual([{ url: live.baseURL }]);
    expect(openapi.components.securitySchemes.dmOAuth.flows.authorizationCode).toEqual({ authorizationUrl: gpt.authorizationUrl, tokenUrl: gpt.tokenUrl, scopes: expect.any(Object) });
    for (const name of ["create_invoice", "create_quote", "list_bookings", "record_payment", "list_invoices", "create_customer_link", "delete_invoice", "delete_quote"]) {
      expect(Object.keys(openapi.paths), `The GPT must be offered ${name}`).toContain(`/api/chatgpt/actions/${name}`);
    }
  });

  test("Mike signs in from the GPT on D&M's page, and the approval returns to the GPT's callback", async ({ browser, live }) => {
    const authorize = new URL(gpt!.authorizationUrl);
    for (const [key, value] of Object.entries({ response_type: "code", client_id: gpt!.clientId, redirect_uri: GPT_CALLBACK, state: `state-${live.runId}`, scope: gpt!.scope })) {
      authorize.searchParams.set(key, value);
    }
    // Mike's own browser on this project's device, with no admin session.
    const context = await browser.newContext(live.device);
    try {
      await prepareLiveBrowser(context);
      // Nothing in this test may reach the real ChatGPT. Routes do not see a
      // navigation's redirect target, so the approval's 303 is read where it is
      // answered and the browser is shown a stand-in ChatGPT page instead.
      await context.route(/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//, route => route.abort());
      let returned: URL | null = null;
      await context.route(url => url.origin === live.baseURL && url.pathname === "/oauth/authorize", async route => {
        if (route.request().method() !== "POST") return route.continue();
        const response = await route.fetch({ maxRedirects: 0 });
        const location = response.headers().location;
        if (response.status() !== 303 || !location?.startsWith("https://chat.openai.com/")) return route.fulfill({ response });
        returned = new URL(location);
        await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>ChatGPT</title><p>Returned to ChatGPT</p>" });
      });
      const page = await context.newPage();
      const consent = await privateNavigate(page, authorize.href);
      expect(consent?.status(), "The approval page must load for the GPT's sign-in").toBe(200);
      // ChatGPT redirects chat.openai.com callbacks to chatgpt.com; the approval form must be allowed to follow.
      expect(consent?.headers()["content-security-policy"]).toContain("form-action 'self' https://chatgpt.com https://chat.openai.com https://platform.openai.com;");
      await expect(page.getByRole("heading", { name: "Connect ChatGPT to D&M admin" })).toBeVisible();
      await expect(page.getByText("Your D&M Custom GPT")).toBeVisible();
      await layoutFits(page);
      // Never locator.fill(password): its failure log could print the value.
      await page.evaluate(value => { document.querySelector<HTMLInputElement>('input[name="password"]')!.value = value; }, live.password);
      await page.getByRole("button", { name: "Allow", exact: true }).click();
      await expect(page.getByText("Returned to ChatGPT")).toBeVisible();
      const callback = returned as URL | null;
      expect(callback && `${callback.origin}${callback.pathname}`).toBe(GPT_CALLBACK);
      expect(callback!.searchParams.get("state")).toBe(`state-${live.runId}`);
      const code = callback!.searchParams.get("code")!;
      expect(code).toMatch(/^dmac_/);
      pendingCode = code;
      expect((await context.cookies(live.baseURL)).some(cookie => [ACCESS_COOKIE, REFRESH_COOKIE].includes(cookie.name)), "Approving the GPT must not sign this browser in").toBe(false);

      // ChatGPT's server exchanges the code ("Default (POST request)").
      const exchanged = await tokenRequest(live.baseURL, { grant_type: "authorization_code", code, redirect_uri: GPT_CALLBACK });
      expect(exchanged.status).toBe(200);
      tokens = await exchanged.json() as Tokens;
      pendingCode = "";
      expect(tokens.access_token).toMatch(/^dmat_/);
    } finally {
      await context.close();
    }
  });

  test("ChatGPT creates Mike's £850 invoice and £1,700 quote once each, read back with checked links", async ({ admin, ledger, live }) => {
    const before = await readCloud(admin.context.request, live.baseURL);
    const invoiceRequest = {
      customer: { name: customer }, title: title(live.runId, "Decorating labour"), testDocument: true, vat: { enabled: false, rate: 20 },
      works: [{ description: "Decorating labour", quantity: 1, unitPrice: 850 }], expectedSubtotal: 850,
    };
    const created = await action(live.baseURL, "create_invoice", invoiceRequest);
    if (created.answer?.document) ledger.owned.add(created.answer.document.id);
    expect(created.status).toBe(200);
    expect(created.answer!.status, created.answer!.message).toBe("created");
    invoice = created.answer!.document!;
    expect(invoice).toMatchObject({ kind: "invoice", customer, amount: "£850.00", status: "draft", customerLinkStatus: "new", verified: true });
    expect(invoice.number, "A test invoice must not use one of Mike's invoice numbers").toMatch(/^TEST-/);
    expect(invoice.customerLink).toMatch(new RegExp(`^${live.baseURL}/d/[a-f0-9]{64}$`));
    firstLink = invoice.customerLink!;

    // A dropped connection makes ChatGPT repeat the action: no second invoice.
    const repeated = await action(live.baseURL, "create_invoice", invoiceRequest);
    expect(repeated.answer!.status, repeated.answer!.message).toBe("already_created");
    expect(repeated.answer!.document!.id).toBe(invoice.id);

    const made = await action(live.baseURL, "create_quote", {
      customer: { name: customer }, title: title(live.runId, "Three-day painting job"), testDocument: true, vat: { enabled: false, rate: 20 },
      works: [{ description: "Painting labour", quantity: 3, unit: "day", unitPrice: 500 }], materials: [{ description: "Paint and materials", quantity: 1, unitPrice: 200 }],
      expectedSubtotal: 1700, createCustomerLink: false,
    });
    if (made.answer?.document) ledger.owned.add(made.answer.document.id);
    expect(made.answer!.status, made.answer!.message).toBe("created");
    quote = made.answer!.document!;
    expect(quote).toMatchObject({ kind: "quote", amount: "£1,700.00", customerLink: null, customerLinkStatus: "not-requested", verified: true });

    const after = await readCloud(admin.context.request, live.baseURL);
    expect(after.data.invoices.filter(record => record.title === invoiceRequest.title)).toHaveLength(1);
    expect(after.data.settings.nextInvoiceNumber, "Test documents use no issued numbers").toBe(before.data.settings.nextInvoiceNumber);
    expect(after.data.settings.nextQuoteNumber).toBe(before.data.settings.nextQuoteNumber);
    for (const group of ["quotes", "invoices", "bookings"] as const) {
      for (const record of before.data[group]) {
        expect(JSON.stringify(after.data[group].find(item => item.id === record.id)), `Existing ${record.kind} records must be preserved`).toBe(JSON.stringify(record));
      }
    }
  });

  test("the diary for next week, marking the invoice paid, and finding it again for a new link", async ({ live }) => {
    const diary = await action(live.baseURL, "list_bookings", { period: "next-week" });
    expect(diary.status).toBe(200);
    const from = new Date(`${diary.answer!.from}T00:00:00Z`);
    expect(from.getUTCDay(), "Next week starts on a Monday").toBe(1);
    expect(diary.answer!.to).toBe(new Date(from.getTime() + 6 * 86_400_000).toISOString().slice(0, 10));

    const paid = await action(live.baseURL, "record_payment", { invoice: invoice!.number, payRemainingBalance: true });
    expect(paid.answer!.status, paid.answer!.message).toBe("recorded");
    expect(paid.answer!.document).toMatchObject({ number: invoice!.number, status: "paid", balance: "£0.00", verified: true });

    const found = await action(live.baseURL, "list_invoices", { search: title(live.runId, "Decorating") });
    expect(found.answer!.invoices!.map(item => item.number)).toEqual([invoice!.number]);
    const ask = await action(live.baseURL, "create_customer_link", { document: invoice!.number });
    expect(ask.answer!.status, "A paid invoice's customer may hold the link, so Mike confirms first").toBe("confirmation_required");
    const replaced = await action(live.baseURL, "create_customer_link", { document: invoice!.number, confirmationCode: ask.answer!.confirmationCode });
    expect(replaced.answer!.status, replaced.answer!.message).toBe("created");
    link = replaced.answer!.customerLink!;
    expect(replaced.answer!.document).toMatchObject({ number: invoice!.number, customerLink: link, customerLinkStatus: "new", verified: true });
    expect(link).not.toBe(firstLink);
  });

  test("the customer opens the link and sees the canonical invoice, paid; the replaced link fails closed", async ({ customer: visitor, live }) => {
    const { page } = visitor;
    expect((await customerNavigate(page, link))?.status()).toBe(200);
    const article = page.getByRole("article");
    await expect(article).toContainText(invoice!.number);
    await expect(article).toContainText(customer);
    await expect(article).toContainText("Decorating labour");
    await expect(documentTotal(page, "Total")).toHaveText("£850.00");
    await expect(documentTotal(page, "Balance due")).toHaveText("£0.00");
    await expect(page.getByText("Test document · Not issued · No payment required")).toBeVisible();
    await layoutFits(page);
    expect((await page.request.get(new URL("/api/admin/data", live.baseURL).href, { maxRedirects: 0 })).status(), "A customer link grants no admin access").toBe(401);
    const old = await customerNavigate(page, firstLink);
    expect(old?.status(), "The replaced link must stop working").toBe(404);
  });

  test("deleting needs Mike's yes, and an ended connection is refused", async ({ admin, live }) => {
    for (const [name, key, doc] of [["delete_invoice", "invoice", invoice!], ["delete_quote", "quote", quote!]] as const) {
      const ask = await action(live.baseURL, name, { [key]: doc.number });
      expect(ask.answer!.status).toBe("confirmation_required");
      expect((await readCloud(admin.context.request, live.baseURL)).data[`${key}s`].some(record => record.id === doc.id), "Nothing changes before Mike confirms").toBe(true);
      const done = await action(live.baseURL, name, { [key]: doc.number, confirmationCode: ask.answer!.confirmationCode });
      expect(done.answer!.status, done.answer!.message).toBe("deleted");
      expect((await readCloud(admin.context.request, live.baseURL)).data[`${key}s`].some(record => record.id === doc.id)).toBe(false);
    }

    // The GPT refreshes with the builder's other token exchange method, then is disconnected.
    const refreshed = await tokenRequest(live.baseURL, { grant_type: "refresh_token", refresh_token: tokens!.refresh_token }, true);
    expect(refreshed.status).toBe(200);
    tokens = await refreshed.json() as Tokens;
    expect((await action(live.baseURL, "get_business_settings")).status).toBe(200);
    const revoked = await fetch(new URL("/api/oauth/revoke", live.baseURL), {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.refresh_token, client_id: gpt!.clientId, client_secret: gpt!.clientSecret }).toString(),
    });
    expect(revoked.status).toBe(200);
    const after = await action(live.baseURL, "get_business_settings");
    expect(after.status, "A revoked GPT must be refused").toBe(401);
    expect(after.challenge).toContain('error="invalid_token"');
    tokens = null;
  });
});
