import { randomBytes } from "node:crypto";
import type { TestContext } from "node:test";
import { emptyData } from "../../lib/admin/factories.ts";
import type { AdminData } from "../../lib/admin/types.ts";

// In-memory stand-in for the hosted Supabase project, behind a mocked fetch.
// It follows the real contracts the integration depends on: GoTrue password,
// refresh-token rotation (a spent refresh token is refused at once here; hosted
// Supabase first allows a 10-second reuse interval), user and logout
// endpoints; the guarded RPCs, including the revision lock, canonical
// numbering with reserved numbers, and hashed, rotating customer links; and the
// anonymous dm_get_shared_document a customer link opens, with the same field
// allowlist as supabase/production-admin.sql.

export const PASSWORD = "correct horse battery staple";
export const SECRET = "unit-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
export const ORIGIN = "https://www.dmpaintingdecorating.co.uk";

type Session = { id: string; alive: boolean };

/** `null` leaves the deployment without DM_CHATGPT_SECRET. */
export function configure(context: TestContext, secret: string | null = SECRET) {
  const saved = Object.fromEntries(["DM_CHATGPT_SECRET", "NEXT_PUBLIC_SUPABASE_URL", "DM_SUPABASE_PUBLISHABLE_KEY"].map(key => [key, process.env[key]]));
  if (secret === null) delete process.env.DM_CHATGPT_SECRET;
  else process.env.DM_CHATGPT_SECRET = secret;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fdctgtncawolrapwwevm.supabase.co";
  process.env.DM_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_unit_test";
  context.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  context.mock.method(console, "info", () => {});
  context.mock.method(console, "warn", () => {});
}

export function fakeSupabase(context: TestContext, initial?: AdminData) {
  const state = {
    data: structuredClone(initial ?? emptyData("2026-10-18T09:00:00.000Z")) as AdminData,
    revision: 0,
    shares: new Map<string, string>(),
    reserved: new Set<string>(),
    sessions: new Map<string, Session>(),
    access: new Map<string, string>(),
    refresh: new Map<string, { session: string; spent: boolean }>(),
    calls: [] as string[],
    /** Runs once, just before the next save is applied (e.g. another device saving first). */
    beforeSave: null as null | (() => void),
    /** Applies the next save but loses its answer, like a dropped connection. */
    loseNextSaveAnswer: false,
    /** Runs once, just after the next save is stored (e.g. another device editing straight away). */
    afterSave: null as null | (() => void),
    /** The next customer link opened finds nothing, as if the share had not been stored. */
    breakNextShareOpen: false,
    /** Anonymous customer-link openings, as the customer's page makes them. */
    opened: [] as string[],
  };
  for (const doc of [...state.data.quotes, ...state.data.invoices]) state.reserved.add(`${doc.kind}:${doc.number}`);

  const issue = (session: string) => {
    const access = `access-${randomBytes(8).toString("hex")}`;
    const refresh = `refresh-${randomBytes(8).toString("hex")}`;
    state.access.set(access, session);
    state.refresh.set(refresh, { session, spent: false });
    return { access_token: access, refresh_token: refresh, expires_in: 3600, token_type: "bearer" };
  };
  const live = (authorization: string | null) => {
    const session = state.access.get(/^Bearer (.+)$/.exec(authorization ?? "")?.[1] ?? "");
    return session && state.sessions.get(session)?.alive ? session : null;
  };
  const reply = (status: number, body?: unknown) => body === undefined ? new Response(null, { status }) : Response.json(body, { status });

  function save(next: AdminData) {
    const known = new Map([...state.data.quotes, ...state.data.invoices].map(doc => [doc.id, doc.number]));
    for (const kind of ["quote", "invoice"] as const) {
      const docs = kind === "quote" ? next.quotes : next.invoices;
      const prefix = kind === "quote" ? next.settings.quotePrefix : next.settings.invoicePrefix;
      const key = kind === "quote" ? "nextQuoteNumber" : "nextInvoiceNumber";
      let counter = Math.max(state.data.settings[key], next.settings[key]);
      for (const doc of docs) {
        if (known.has(doc.id)) { doc.number = known.get(doc.id)!; continue; }
        if (!doc.number || state.reserved.has(`${kind}:${doc.number}`)) {
          do { doc.number = `${prefix}${String(counter).padStart(4, "0")}`; counter += 1; } while (state.reserved.has(`${kind}:${doc.number}`));
        }
        state.reserved.add(`${kind}:${doc.number}`);
        const suffix = doc.number.startsWith(prefix) ? Number(doc.number.slice(prefix.length)) : NaN;
        if (Number.isInteger(suffix)) counter = Math.max(counter, suffix + 1);
      }
      next.settings[key] = counter;
    }
    const ids = new Set([...next.quotes, ...next.invoices].map(doc => doc.id));
    for (const id of state.shares.keys()) if (!ids.has(id)) state.shares.delete(id);
    state.data = structuredClone(next);
    state.revision += 1;
  }

  /** What an anonymous customer sees for a link: the public fields only, or null. */
  function sharedDocument(token: string) {
    state.opened.push(token);
    if (state.breakNextShareOpen) { state.breakNextShareOpen = false; return null; }
    const id = [...state.shares].find(([, value]) => value === token)?.[0];
    const doc = [...state.data.quotes, ...state.data.invoices].find(record => record.id === id);
    if (!doc) return null;
    const keys = ["kind", "number", "status", "title", "issueDate", "scope", "works", "materials", "materialsNote", "vat", "isTest",
      ...(doc.kind === "quote" ? ["validUntil", "intro", "deposit", "terms"] : ["dueDate", "quoteNumber", "payments", "bank", "paymentNote"])];
    const document: Record<string, unknown> = Object.fromEntries(Object.entries(structuredClone(doc)).filter(([key]) => keys.includes(key)));
    document.customer = { name: doc.customer.name, address: doc.customer.address, email: "", phone: "" };
    if (doc.kind === "invoice") {
      document.payments = doc.payments.map(payment => ({ date: payment.date, amount: payment.amount, method: payment.method, label: "" }));
      if (doc.isTest) document.bank = { accountName: "", sortCode: "", accountNumber: "" };
    }
    const { businessName, address, phone, email, website, vatNumber, companyNumber } = state.data.settings;
    return { document, business: { businessName, address, phone, email, website, vatNumber, companyNumber } };
  }

  context.mock.method(globalThis, "fetch", async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    state.calls.push(path === "/auth/v1/token" ? `${path}?${url.searchParams.get("grant_type")}` : path);
    const session = live(headers.get("authorization"));

    if (path === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
      if (body?.email !== "mike@dmpaintingdecorating.co.uk" || body?.password !== PASSWORD) return reply(400, { error_code: "invalid_credentials" });
      const id = `session-${state.sessions.size + 1}`;
      state.sessions.set(id, { id, alive: true });
      return reply(200, issue(id));
    }
    if (path === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
      const record = state.refresh.get(body?.refresh_token);
      if (!record || record.spent || !state.sessions.get(record.session)?.alive) return reply(400, { error_code: "refresh_token_not_found" });
      record.spent = true;
      return reply(200, issue(record.session));
    }
    if (path === "/auth/v1/user") {
      return session ? reply(200, { email: "mike@dmpaintingdecorating.co.uk", email_confirmed_at: "2026-10-01T00:00:00Z" }) : reply(403, { error_code: "session_not_found" });
    }
    if (path === "/auth/v1/logout") {
      if (!session) return reply(403, { error_code: "session_not_found" });
      const scope = url.searchParams.get("scope");
      for (const item of state.sessions.values()) if (scope === "others" ? item.id !== session : scope === "local" ? item.id === session : true) item.alive = false;
      return reply(204);
    }
    const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(path)?.[1];
    if (!rpc) return reply(404, { message: "not found" });
    if (rpc === "dm_get_shared_document") return reply(200, sharedDocument(String(body?.p_token ?? "")));
    if (!session) return reply(401, { code: "42501", message: "Administrator access required" });
    switch (rpc) {
      case "dm_admin_is_member": return reply(200, true);
      case "dm_get_data": return reply(200, { data: structuredClone(state.data), revision: state.revision });
      case "dm_save_data": {
        if (state.beforeSave) { const run = state.beforeSave; state.beforeSave = null; run(); }
        if (body.p_revision !== state.revision) return reply(409, { code: "40001", message: "Records changed on another device" });
        save(body.p_data);
        if (state.afterSave) { const run = state.afterSave; state.afterSave = null; run(); }
        if (state.loseNextSaveAnswer) { state.loseNextSaveAnswer = false; throw new TypeError("fetch failed"); }
        return reply(200, { data: structuredClone(state.data), revision: state.revision });
      }
      case "dm_create_share": {
        if (![...state.data.quotes, ...state.data.invoices].some(doc => doc.id === body.p_id)) return reply(404, { code: "P0002" });
        const token = randomBytes(32).toString("hex");
        state.shares.set(body.p_id, token);
        return reply(200, token);
      }
      case "dm_revoke_share": state.shares.delete(body.p_id); return reply(204);
      default: return reply(404, { code: "PGRST202" });
    }
  });

  /** Simulates Mike's ChatGPT sign-in, returning its live Supabase access token. */
  const signIn = () => {
    const id = `session-${state.sessions.size + 1}`;
    state.sessions.set(id, { id, alive: true });
    return issue(id).access_token;
  };
  return { state, signIn };
}
