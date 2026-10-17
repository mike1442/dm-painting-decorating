// Integration tests against a real Supabase project: Auth, PostgREST, row-level
// security and the functions in supabase/migrations. They create their own users,
// so ONLY run them against a local stack (`supabase start`) or a disposable
// project, never production:
//
//   SUPABASE_TEST_URL=http://127.0.0.1:54321 \
//   SUPABASE_TEST_PUBLISHABLE_KEY=sb_publishable_... \
//   SUPABASE_TEST_SECRET_KEY=sb_secret_... \
//   npm run test:integration
//
// The secret key is used only here, to create and delete test users.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createQuote, updateQuote } from "../../lib/admin/operations.ts";
import { RepoError } from "../../lib/admin/repository.ts";
import { SupabaseAdminRepository } from "../../lib/admin/supabase-repository.ts";
import { SyncEngine } from "../../lib/admin/sync.ts";
import type { Quote } from "../../lib/admin/types.ts";

const url = process.env.SUPABASE_TEST_URL ?? "";
const publishable = process.env.SUPABASE_TEST_PUBLISHABLE_KEY ?? "";
const secret = process.env.SUPABASE_TEST_SECRET_KEY ?? "";
const configured = Boolean(url && publishable && secret);
const PASSWORD = "integration-Pass-2026!";
const clock = { today: "2026-10-17", now: "2026-10-17T10:00:00.000Z" };

const admin = configured ? createClient(url, secret, { auth: { persistSession: false } }) : (null as unknown as SupabaseClient);
const run = Date.now().toString(36);
const users: Record<"a" | "b" | "outsider", { id: string; email: string }> = {} as never;

async function signedIn(who: keyof typeof users) {
  const client = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: users[who].email, password: PASSWORD });
  assert.equal(error, null, `sign-in failed for ${who}`);
  return client;
}

async function engineFor(who: "a" | "b") {
  const client = await signedIn(who);
  const repo = new SupabaseAdminRepository(client, users[who].id);
  const engine = new SyncEngine(repo, { now: () => new Date().toISOString() });
  await engine.load();
  assert.equal(engine.getSnapshot().phase, "ready", engine.getSnapshot().loadError);
  return { client, repo, engine };
}

before(async () => {
  if (!configured) return;
  for (const who of ["a", "b", "outsider"] as const) {
    const email = `${who}-${run}@dm-admin.test`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    assert.equal(error, null);
    users[who] = { id: data.user!.id, email };
  }
  // Membership is granted explicitly, exactly as for Mike in production.
  const { error } = await admin.from("admin_members").insert([{ user_id: users.a.id }, { user_id: users.b.id }]);
  assert.equal(error, null);
});

after(async () => {
  if (!configured) return;
  for (const user of Object.values(users)) {
    await admin.from("admin_documents").delete().eq("owner_id", user.id);
    await admin.from("admin_settings").delete().eq("owner_id", user.id);
    await admin.from("admin_sequences").delete().eq("owner_id", user.id);
    await admin.from("admin_members").delete().eq("user_id", user.id);
    await admin.auth.admin.deleteUser(user.id);
  }
});

const skip = configured ? false : "set SUPABASE_TEST_URL, SUPABASE_TEST_PUBLISHABLE_KEY and SUPABASE_TEST_SECRET_KEY";

test("anonymous visitors can't read or write admin data", { skip }, async () => {
  const anon = createClient(url, publishable, { auth: { persistSession: false } });
  const read = await anon.from("admin_documents").select("id");
  assert.notEqual(read.error, null, "anonymous read must fail");
  const write = await anon.from("admin_documents").insert({ owner_id: users.a.id, kind: "quote", payload: {} });
  assert.notEqual(write.error, null);
  const rpc = await anon.rpc("dm_admin_allocate_number", { p_kind: "quote", p_min: 1 });
  assert.notEqual(rpc.error, null);
});

test("a signed-in non-member sees nothing and can't write", { skip }, async () => {
  const client = await signedIn("outsider");
  assert.equal((await client.rpc("dm_admin_is_member")).data, false);
  const repo = new SupabaseAdminRepository(client, users.outsider.id);
  assert.deepEqual(await repo.loadDocuments(), []);
  await assert.rejects(
    repo.insertDocument({ id: crypto.randomUUID(), kind: "quote", document_number: "Q-9999", payload: {} as never, created_at: clock.now }),
    (e: RepoError) => e.code === "forbidden",
  );
  await assert.rejects(repo.allocateNumber("quote", 1), (e: RepoError) => e.code === "forbidden");
});

test("members save, version and delete their own records", { skip }, async () => {
  const { engine } = await engineFor("a");
  const n = await engine.allocateNumber("quote");
  let quote!: Quote;
  engine.apply(d => {
    const created = createQuote(d, clock, { title: "Integration lounge" }, n);
    quote = created.quote;
    return created.data;
  });
  await engine.flush();
  assert.equal(engine.getSnapshot().persistence, "saved", engine.getSnapshot().message);
  const stored = await admin.from("admin_documents").select("owner_id, kind, document_number, payload, updated_at").eq("id", quote.id).single();
  assert.equal(stored.data!.owner_id, users.a.id);
  assert.equal(stored.data!.document_number, quote.number);
  assert.equal((stored.data!.payload as Quote).title, "Integration lounge");

  engine.apply(d => updateQuote(d, quote.id, q => ({ ...q, title: "Edited" }), new Date().toISOString()));
  await engine.flush();
  const edited = await admin.from("admin_documents").select("payload, updated_at").eq("id", quote.id).single();
  assert.equal((edited.data!.payload as Quote).title, "Edited");
  assert.ok(edited.data!.updated_at > stored.data!.updated_at, "the database advanced the version");

  engine.apply(d => ({ ...d, quotes: d.quotes.filter(q => q.id !== quote.id) }));
  await engine.flush();
  const gone = await admin.from("admin_documents").select("id").eq("id", quote.id);
  assert.deepEqual(gone.data, []);
});

test("one member can't see or change another member's records", { skip }, async () => {
  const a = await engineFor("a");
  const n = await a.engine.allocateNumber("quote");
  let quote!: Quote;
  a.engine.apply(d => {
    const created = createQuote(d, clock, { title: "Private to A" }, n);
    quote = created.quote;
    return created.data;
  });
  await a.engine.flush();

  const b = await engineFor("b");
  assert.equal(b.engine.data!.quotes.some(q => q.id === quote.id), false);
  const hijack = await b.client.from("admin_documents").update({ payload: { title: "hacked" } }).eq("id", quote.id).select("id");
  assert.deepEqual(hijack.data, []);
  const steal = await b.client.from("admin_documents").insert({ owner_id: users.a.id, kind: "quote", payload: {} });
  assert.notEqual(steal.error, null);
  const check = await admin.from("admin_documents").select("payload").eq("id", quote.id).single();
  assert.equal((check.data!.payload as Quote).title, "Private to A");
});

test("two devices: changes appear after refresh and simultaneous edits conflict", { skip }, async () => {
  const phone = await engineFor("a");
  const laptop = await engineFor("a");
  const n = await phone.engine.allocateNumber("quote");
  let quote!: Quote;
  phone.engine.apply(d => {
    const created = createQuote(d, clock, { title: "Two devices" }, n);
    quote = created.quote;
    return created.data;
  });
  await phone.engine.flush();
  await laptop.engine.refresh();
  assert.equal(laptop.engine.data!.quotes.find(q => q.id === quote.id)?.title, "Two devices");

  phone.engine.apply(d => updateQuote(d, quote.id, q => ({ ...q, title: "Phone wins" }), new Date().toISOString()));
  await phone.engine.flush();
  laptop.engine.apply(d => updateQuote(d, quote.id, q => ({ ...q, title: "Laptop edit" }), new Date().toISOString()));
  await laptop.engine.flush();
  const conflict = laptop.engine.getSnapshot().conflicts.find(c => c.key === `quote:${quote.id}`);
  assert.ok(conflict, "laptop must be told about the conflict");
  const server = await admin.from("admin_documents").select("payload").eq("id", quote.id).single();
  assert.equal((server.data!.payload as Quote).title, "Phone wins");
  laptop.engine.resolveConflict(conflict.key, "theirs");
  await laptop.engine.flush();
  assert.equal(laptop.engine.getSnapshot().persistence, "saved");
});

test("numbers are unique across devices, and a reused number is refused", { skip }, async () => {
  const phone = await engineFor("b");
  const laptop = await engineFor("b");
  const numbers = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? phone : laptop).engine.allocateNumber("invoice")));
  assert.equal(new Set(numbers).size, 20);

  const repo = phone.repo;
  const row = { kind: "quote" as const, document_number: `Q-${run}`, payload: {} as never, created_at: clock.now };
  await repo.insertDocument({ ...row, id: crypto.randomUUID() });
  await assert.rejects(repo.insertDocument({ ...row, id: crypto.randomUUID() }), (e: RepoError) => e.code === "duplicate-number");
});

test("an ended session is reported as signed out", { skip }, async () => {
  const { client, repo } = await engineFor("a");
  await client.auth.signOut({ scope: "local" });
  await assert.rejects(repo.loadDocuments(), (e: RepoError) => e.code === "signed-out");
});
