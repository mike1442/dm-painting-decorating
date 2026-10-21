import test from "node:test";
import assert from "node:assert/strict";
import { emptyData } from "../../lib/admin/factories.ts";
import { createBackup } from "../../lib/admin/backup.ts";
import { createQuote } from "../../lib/admin/operations.ts";
import { commit, flush, getAdminData, importMissingRecords, readBrowserImport, refreshAdminData, STORAGE_KEY } from "../../lib/admin/cloud-store.ts";
import type { AdminData } from "../../lib/admin/types.ts";

const now = "2026-10-17T10:00:00.000Z";
const clock = { today: "2026-10-17", now };
const response = (data: AdminData, revision: number) => Response.json({ data, revision });

test("cloud saves serialize edits, adopt assigned numbers, and preserve failures without overwriting remote data", async context => {
  const session = new Map<string, string>();
  const legacy = new Map<string, string>();
  const redirects: string[] = [];
  const storage = (values: Map<string, string>) => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    sessionStorage: storage(session), localStorage: storage(legacy),
    location: { pathname: "/admin/quick-quote", search: "?for=John%20Smith&total=1250", assign: (url: string) => { redirects.push(url); } },
  } });
  context.after(() => {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });

  const initial = createQuote(emptyData(now), clock, { title: "Cloud original" });
  let cloud = initial.data;
  let cloudRevision = 6;
  const writes: { data: AdminData; revision: number }[] = [];
  let getCount = 0;
  let mode: "normal" | "hold" | "conflict" | "offline" | "unauthorised" | "hold-get" = "normal";
  let releaseSave: ((result: Response) => void) | undefined;
  let releaseGet: ((result: Response) => void) | undefined;
  context.mock.method(globalThis, "fetch", async (_url: unknown, options?: RequestInit) => {
    if (options?.method !== "PUT") {
      getCount += 1;
      if (mode === "offline") throw new TypeError("Network unavailable");
      if (mode === "hold-get") return new Promise<Response>(resolve => { releaseGet = resolve; });
      return response(cloud, cloudRevision);
    }
    const payload = JSON.parse(String(options.body)) as { data: AdminData; revision: number };
    writes.push(payload);
    if (mode === "hold") {
      mode = "normal";
      return new Promise<Response>(resolve => { releaseSave = resolve; });
    }
    if (mode === "conflict") return new Response(null, { status: 409 });
    if (mode === "offline") throw new TypeError("Network unavailable");
    if (mode === "unauthorised") return new Response(null, { status: 401 });
    assert.equal(payload.revision, cloudRevision, "each save uses the preceding canonical revision");
    cloud = payload.data;
    cloudRevision += 1;
    return response(cloud, cloudRevision);
  });

  mode = "offline";
  assert.equal(await refreshAdminData(), false);
  commit(data => createQuote(data, clock, { title: "Blocked before cloud load" }).data);
  assert.equal(getAdminData()?.quotes.length, 0, "the admin cannot edit unknown/unloaded cloud data");
  mode = "normal";
  assert.equal(await refreshAdminData(), true);
  mode = "hold";
  commit(data => ({ ...data, quotes: data.quotes.map(quote => ({ ...quote, title: "First edit" })) }));
  const saving = flush();
  assert.equal(writes.length, 1);
  commit(data => ({ ...data, quotes: data.quotes.map(quote => ({ ...quote, title: "Edit while saving" })) }));
  cloud = { ...writes[0].data, quotes: writes[0].data.quotes.map(quote => ({ ...quote, number: "Q-0042" })), settings: { ...writes[0].data.settings, nextQuoteNumber: 43 } };
  cloudRevision = 7;
  assert.ok(releaseSave);
  releaseSave(response(cloud, cloudRevision));
  assert.equal(await saving, true);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].data.quotes[0].title, "Edit while saving");
  assert.equal(writes[1].data.quotes[0].number, "Q-0042");
  assert.equal(getAdminData()?.settings.nextQuoteNumber, 43);
  assert.equal(session.get("dm-admin:pending:v1"), undefined);

  mode = "conflict";
  commit(data => ({ ...data, quotes: data.quotes.map(quote => ({ ...quote, title: "Conflict edit to export" })) }));
  assert.equal(await flush(), false);
  const attemptedWrites = writes.length;
  const attemptedReads = getCount;
  assert.equal(await flush(), false, "a conflict cannot automatically retry the stale revision");
  assert.equal(await refreshAdminData(), false, "background refresh cannot discard pending edits");
  assert.equal(writes.length, attemptedWrites);
  assert.equal(getCount, attemptedReads);
  assert.equal(getAdminData()?.quotes[0].title, "Conflict edit to export");
  assert.match(session.get("dm-admin:pending:v1") ?? "", /Conflict edit to export/);
  mode = "normal";
  assert.equal(await refreshAdminData({ discardPending: true }), true);
  assert.equal(getAdminData()?.quotes[0].title, "Edit while saving");

  mode = "offline";
  commit(data => ({ ...data, quotes: data.quotes.map(quote => ({ ...quote, title: "Offline edit" })) }));
  assert.equal(await flush(), false);
  assert.equal(getAdminData()?.quotes[0].title, "Offline edit");
  assert.match(session.get("dm-admin:pending:v1") ?? "", /Offline edit/);
  mode = "normal";
  assert.equal(await flush(), true, "the same pending edit can be retried once the connection returns");

  mode = "hold-get";
  const refreshing = refreshAdminData();
  commit(data => ({ ...data, quotes: data.quotes.map(quote => ({ ...quote, title: "Edit during refresh" })) }));
  assert.ok(releaseGet);
  releaseGet(response(cloud, cloudRevision));
  assert.equal(await refreshing, false);
  assert.equal(getAdminData()?.quotes[0].title, "Edit during refresh");
  mode = "normal";
  assert.equal(await flush(), true);

  const legacyRaw = JSON.stringify(initial.data);
  legacy.set(STORAGE_KEY, legacyRaw);
  assert.equal(readBrowserImport("legacy")?.ok, true);
  assert.equal(legacy.get(STORAGE_KEY), legacyRaw, "import preview never rewrites the original browser data");

  mode = "unauthorised";
  commit(data => ({ ...data, quotes: data.quotes.map(quote => ({ ...quote, title: "Expired-session edit" })) }));
  assert.equal(await flush(), false);
  assert.deepEqual(redirects, ["/login?next=%2Fadmin%2Fquick-quote%3Ffor%3DJohn%2520Smith%26total%3D1250"], "sign-in returns to the page, keeping a Quick quote link's details");
  assert.match(session.get("dm-admin:pending:v1") ?? "", /Expired-session edit/);
});

test("each fresh visit retains older and latest recovery snapshots after later successful saves", async context => {
  const values = new Map<string, string>();
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    },
  } });
  context.after(() => {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const original = createQuote(emptyData(now), clock, { title: "Earlier failed edit" }).data;
  const latest = { ...original, quotes: original.quotes.map(quote => ({ ...quote, title: "Latest failed edit" })) };
  values.set("dm-admin:pending:v1", JSON.stringify(createBackup(original, now)));
  context.mock.method(globalThis, "fetch", async (_url: unknown, options?: RequestInit) => options?.method === "PUT"
    ? response((JSON.parse(String(options.body)) as { data: AdminData }).data, 2)
    : response(emptyData(now), 1));
  const moduleUrl = new URL("../../lib/admin/cloud-store.ts", import.meta.url).href;
  const firstVisit = await import(`${moduleUrl}?recovery-visit=one`);
  assert.equal(await firstVisit.refreshAdminData(), true);
  values.set("dm-admin:pending:v1", JSON.stringify(createBackup(latest, "2026-10-18T10:00:00.000Z")));
  const secondVisit = await import(`${moduleUrl}?recovery-visit=two`);
  assert.equal(await secondVisit.refreshAdminData(), true);
  const snapshots = secondVisit.readRecoveryImports() as ReturnType<typeof import("../../lib/admin/cloud-store.ts").readRecoveryImports>;
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].ok && snapshots[0].data.quotes[0].title, "Latest failed edit");
  assert.equal(snapshots[1].ok && snapshots[1].data.quotes[0].title, "Earlier failed edit");
  secondVisit.commit((data: AdminData) => ({ ...data, meta: { ...data.meta, lastBackupAt: now } }));
  assert.equal(await secondVisit.flush(), true);
  assert.equal(values.has("dm-admin:pending:v1"), false);
  assert.equal(secondVisit.readRecoveryImports().length, 2, "a later successful save cannot delete inaccessible older edits");
});

test("safe imports preserve current records and only replace settings by explicit choice", () => {
  const first = createQuote(emptyData(now), clock, { title: "Cloud version" });
  const second = createQuote(first.data, clock, { title: "Missing browser quote" });
  const incoming = { ...second.data, quotes: second.data.quotes.map(quote => quote.id === first.quote.id ? { ...quote, title: "Conflicting backup version", updatedAt: "2026-10-18T10:00:00.000Z" } : quote), settings: { ...second.data.settings, phone: "01234 567890", nextQuoteNumber: 200 } };
  const merged = importMissingRecords(first.data, incoming);
  assert.equal(merged.quotes.length, 2);
  assert.equal(merged.quotes.find(quote => quote.id === first.quote.id)?.title, "Cloud version");
  assert.equal(merged.settings.phone, first.data.settings.phone);
  assert.equal(merged.settings.nextQuoteNumber, 200);
  assert.equal(importMissingRecords(first.data, incoming, true).settings.phone, "01234 567890");
  assert.equal(first.data.quotes.length, 1, "preview/import does not mutate the existing snapshot");
});

test("a failed first load is retried after 3, 6 and 12 s, then left to the regular check", async context => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  context.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    sessionStorage: storage, localStorage: storage, location: { assign: () => {} },
    addEventListener: () => {}, removeEventListener: () => {},
    setInterval: (callback: () => void, ms: number) => setInterval(callback, ms),
    clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
  } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} } });
  const stops: (() => void)[] = [];
  context.after(() => {
    for (const stop of stops) stop();
    for (const [name, old] of [["window", oldWindow], ["document", oldDocument]] as const) {
      if (old) Object.defineProperty(globalThis, name, old);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  let loads = 0;
  let available = false;
  context.mock.method(globalThis, "fetch", async () => {
    loads += 1;
    return available ? response(emptyData(now), 1) : Response.json({ error: "Authentication is temporarily unavailable." }, { status: 503 });
  });
  const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise(resolve => setImmediate(resolve)); };
  const advance = async (ms: number) => { context.mock.timers.tick(ms); await settle(); };

  const store = await import(`${new URL("../../lib/admin/cloud-store.ts", import.meta.url).href}?load-retry`);
  stops.push(store.subscribeAdminState(() => {}));
  await settle();
  assert.equal(loads, 1);
  assert.equal(store.getAdminState()?.persistence, "unavailable");
  await advance(2_999);
  assert.equal(loads, 1);
  await advance(1);
  assert.equal(loads, 2, "first retry after 3 s");
  await advance(6_000);
  assert.equal(loads, 3, "second retry 6 s later");
  await advance(11_000);
  assert.equal(loads, 4, "the regular 20 s check still runs");
  await advance(1_000);
  assert.equal(loads, 5, "third retry 12 s after the second");
  await advance(18_999);
  assert.equal(loads, 5, "no further prompt retries once the backoff is spent");
  available = true;
  await advance(1);
  assert.equal(loads, 6);
  assert.equal(store.getAdminState()?.ready, true, "the regular check recovers once Supabase answers");

  // A later failed first load (fresh store) that recovers on its first retry leaves no retry pending.
  const again = await import(`${new URL("../../lib/admin/cloud-store.ts", import.meta.url).href}?load-retry-recovers`);
  available = false;
  loads = 0;
  stops.push(again.subscribeAdminState(() => {}));
  await settle();
  available = true;
  await advance(3_000);
  assert.equal(loads, 2);
  assert.equal(again.getAdminState()?.ready, true);
  await advance(16_999);
  assert.equal(loads, 2, "a successful retry cancels the remaining backoff");
});

test("a save refused before writing is repeated automatically; an ambiguous failed write is not", async context => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: storage, localStorage: storage, location: { assign: () => {} } } });
  context.after(() => {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise(resolve => setImmediate(resolve)); };
  let cloudRevision = 1;
  let refusals: ("retry" | "ambiguous")[] = [];
  const writes: number[] = [];
  context.mock.method(globalThis, "fetch", async (_url: unknown, options?: RequestInit) => {
    if (options?.method !== "PUT") return response(emptyData(now), cloudRevision);
    const payload = JSON.parse(String(options.body)) as { data: AdminData; revision: number };
    writes.push(payload.revision);
    const refusal = refusals.shift();
    if (refusal === "retry") return Response.json({ error: "Authentication is temporarily unavailable." }, { status: 503, headers: { "Retry-After": "3" } });
    if (refusal === "ambiguous") return Response.json({ error: "The service is temporarily unavailable." }, { status: 503 });
    cloudRevision += 1;
    return response(payload.data, cloudRevision);
  });
  const store = await import(`${new URL("../../lib/admin/cloud-store.ts", import.meta.url).href}?save-retry`);
  assert.equal(await store.refreshAdminData(), true);

  refusals = ["retry", "retry"];
  store.commit((data: AdminData) => createQuote(data, clock, { title: "Saved after Auth recovers" }).data);
  const saved = store.flush();
  await settle();
  assert.equal(store.getAdminState()?.persistence, "saving", "A refused save keeps showing that it is still saving");
  context.mock.timers.tick(3_000); await settle();
  context.mock.timers.tick(6_000); await settle();
  assert.equal(await saved, true);
  assert.deepEqual(writes, [1, 1, 1], "Each repeat uses the same revision, since nothing was written");
  assert.equal(store.getAdminState()?.persistence, "saved");

  // Retries are bounded, and an ambiguous write failure is reported, never repeated.
  for (const [refused, attempts] of [[["retry", "retry", "retry"], 3], [["ambiguous"], 1]] as const) {
    writes.length = 0;
    refusals = [...refused];
    store.commit((data: AdminData) => createQuote(data, clock, { title: "Not saved yet" }).data);
    const failed = store.flush();
    for (let i = 0; i < 4; i += 1) { await settle(); context.mock.timers.tick(6_000); }
    assert.equal(await failed, false);
    assert.equal(writes.length, attempts);
    assert.equal(store.getAdminState()?.persistence, "failed");
  }
});
