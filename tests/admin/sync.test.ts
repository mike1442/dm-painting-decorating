import test from "node:test";
import assert from "node:assert/strict";
import { FakeServer } from "./fake-repository.ts";
import { createInvoice, createQuote, deleteQuote, updateQuote } from "../../lib/admin/operations.ts";
import { mergeSettings, SyncEngine } from "../../lib/admin/sync.ts";
import { defaultSettings } from "../../lib/admin/factories.ts";
import type { Quote } from "../../lib/admin/types.ts";

const MIKE = "11111111-1111-4111-8111-111111111111";
const clock = { today: "2026-10-17", now: "2026-10-17T10:00:00.000Z" };
const at = (minute: number) => `2026-10-17T10:${String(minute).padStart(2, "0")}:00.000Z`;

function account() {
  const server = new FakeServer();
  server.members.add(MIKE);
  return server;
}

async function device(server: FakeServer, owner = MIKE) {
  const repo = server.device(owner);
  const engine = new SyncEngine(repo, { now: () => clock.now });
  await engine.load();
  return { repo, engine };
}

async function newQuote(engine: SyncEngine, title: string): Promise<Quote> {
  const n = await engine.allocateNumber("quote");
  let quote!: Quote;
  engine.apply(d => {
    const created = createQuote(d, clock, { title }, n);
    quote = created.quote;
    return created.data;
  });
  return quote;
}

const rename = (engine: SyncEngine, id: string, title: string, minute = 1) =>
  engine.apply(d => updateQuote(d, id, q => ({ ...q, title }), at(minute)));

const titleOn = (server: FakeServer, id: string) => (server.docs.get(id)?.payload as Quote | undefined)?.title;

test("loads an empty account as saved", async () => {
  const { engine } = await device(account());
  const snap = engine.getSnapshot();
  assert.equal(snap.phase, "ready");
  assert.equal(snap.persistence, "saved");
  assert.deepEqual(snap.data?.quotes, []);
});

test("creates, edits and deletes on the server, and only reports saved once confirmed", async () => {
  const server = account();
  const { engine } = await device(server);
  const quote = await newQuote(engine, "Lounge");
  assert.equal(quote.number, "Q-0001");
  assert.equal(engine.getSnapshot().persistence, "saving");
  assert.equal(server.docs.size, 0, "nothing is written until flush");

  await engine.flush();
  assert.equal(engine.getSnapshot().persistence, "saved");
  assert.equal(engine.getSnapshot().pending, 0);
  const row = server.docs.get(quote.id)!;
  assert.equal(row.kind, "quote");
  assert.equal(row.document_number, "Q-0001");
  assert.equal(row.owner_id, MIKE);
  assert.equal(titleOn(server, quote.id), "Lounge");

  rename(engine, quote.id, "Lounge and hall");
  await engine.flush();
  assert.equal(titleOn(server, quote.id), "Lounge and hall");

  engine.apply(d => deleteQuote(d, quote.id));
  await engine.flush();
  assert.equal(server.docs.size, 0);
  assert.equal(engine.getSnapshot().persistence, "saved");
});

test("a second device sees creates, edits and deletes after refreshing", async () => {
  const server = account();
  const phone = await device(server);
  const laptop = await device(server);

  const quote = await newQuote(phone.engine, "Hallway");
  await phone.engine.flush();
  await laptop.engine.refresh();
  assert.equal(laptop.engine.data!.quotes[0].title, "Hallway");

  rename(laptop.engine, quote.id, "Hallway and stairs");
  await laptop.engine.flush();
  await phone.engine.refresh();
  assert.equal(phone.engine.data!.quotes[0].title, "Hallway and stairs");

  phone.engine.apply(d => deleteQuote(d, quote.id));
  await phone.engine.flush();
  await laptop.engine.refresh();
  assert.equal(laptop.engine.data!.quotes.length, 0);
});

test("simultaneous edits become a conflict instead of a silent overwrite", async () => {
  const server = account();
  const phone = await device(server);
  const quote = await newQuote(phone.engine, "Original");
  await phone.engine.flush();
  const laptop = await device(server);

  rename(phone.engine, quote.id, "From phone");
  await phone.engine.flush();
  rename(laptop.engine, quote.id, "From laptop");
  await laptop.engine.flush();

  const snap = laptop.engine.getSnapshot();
  assert.equal(snap.persistence, "conflict");
  assert.equal(snap.conflicts.length, 1);
  assert.equal(snap.conflicts[0].reason, "changed");
  assert.equal(titleOn(server, quote.id), "From phone", "the server keeps the first save");

  laptop.engine.resolveConflict(snap.conflicts[0].key, "theirs");
  await laptop.engine.flush();
  assert.equal(laptop.engine.data!.quotes[0].title, "From phone");
  assert.equal(laptop.engine.getSnapshot().persistence, "saved");
});

test("choosing my version overwrites the other device's save", async () => {
  const server = account();
  const phone = await device(server);
  const quote = await newQuote(phone.engine, "Original");
  await phone.engine.flush();
  const laptop = await device(server);
  rename(phone.engine, quote.id, "From phone");
  await phone.engine.flush();
  rename(laptop.engine, quote.id, "From laptop");
  await laptop.engine.flush();

  laptop.engine.resolveConflict(laptop.engine.getSnapshot().conflicts[0].key, "mine");
  await laptop.engine.flush();
  assert.equal(titleOn(server, quote.id), "From laptop");
  assert.equal(laptop.engine.getSnapshot().persistence, "saved");
  await phone.engine.refresh();
  assert.equal(phone.engine.data!.quotes[0].title, "From laptop");
});

test("editing a record deleted on another device asks before restoring it", async () => {
  const server = account();
  const phone = await device(server);
  const quote = await newQuote(phone.engine, "Kitchen");
  await phone.engine.flush();
  const laptop = await device(server);

  phone.engine.apply(d => deleteQuote(d, quote.id));
  await phone.engine.flush();
  rename(laptop.engine, quote.id, "Kitchen and utility");
  await laptop.engine.flush();
  const conflict = laptop.engine.getSnapshot().conflicts[0];
  assert.equal(conflict.reason, "deleted");
  assert.equal(server.docs.size, 0);

  laptop.engine.resolveConflict(conflict.key, "mine");
  await laptop.engine.flush();
  assert.equal(titleOn(server, quote.id), "Kitchen and utility", "restored on request");
});

test("refreshing never discards unsaved local edits", async () => {
  const server = account();
  const phone = await device(server);
  const quote = await newQuote(phone.engine, "Bedroom");
  await phone.engine.flush();
  const laptop = await device(server);

  rename(laptop.engine, quote.id, "Unsaved laptop edit");
  rename(phone.engine, quote.id, "Phone edit");
  await phone.engine.flush();
  await laptop.engine.refresh();
  assert.equal(laptop.engine.data!.quotes[0].title, "Unsaved laptop edit");
  await laptop.engine.flush();
  assert.equal(laptop.engine.getSnapshot().persistence, "conflict");
});

test("offline changes wait, are reported, and save when the connection returns", async () => {
  const server = account();
  const { engine } = await device(server);
  const quote = await newQuote(engine, "Landing");
  await engine.flush();

  server.offline = true;
  rename(engine, quote.id, "Landing, offline edit");
  await engine.flush();
  const snap = engine.getSnapshot();
  assert.equal(snap.persistence, "offline");
  assert.match(snap.message, /1 unsaved change will be saved/);
  assert.equal(titleOn(server, quote.id), "Landing");
  assert.ok(engine.hasUnsaved());

  server.offline = false;
  await engine.flush();
  assert.equal(engine.getSnapshot().persistence, "saved");
  assert.equal(titleOn(server, quote.id), "Landing, offline edit");
});

test("a save whose reply was lost is recognised, not duplicated or flagged", async () => {
  const server = account();
  const { repo, engine } = await device(server);
  const quote = await newQuote(engine, "Porch");
  repo.loseNextReply = true;
  await engine.flush();
  assert.equal(engine.getSnapshot().persistence, "offline");
  await engine.flush();
  assert.equal(engine.getSnapshot().persistence, "saved");
  assert.equal(engine.getSnapshot().conflicts.length, 0);
  assert.equal(server.docsOf(MIKE).length, 1);
  rename(engine, quote.id, "Porch and door");
  await engine.flush();
  assert.equal(titleOn(server, quote.id), "Porch and door");
});

test("a number already used is refused and reported until it is changed", async () => {
  const server = account();
  const phone = await device(server);
  await newQuote(phone.engine, "First");
  await phone.engine.flush();

  const laptop = await device(server);
  let clash!: Quote;
  laptop.engine.apply(d => {
    const created = createQuote(d, clock, { title: "Typed by hand" }, 1);
    clash = created.quote;
    return created.data;
  });
  await laptop.engine.flush();
  const snap = laptop.engine.getSnapshot();
  assert.equal(snap.persistence, "failed");
  assert.match(snap.message, /Q-0001 is already used/);

  laptop.engine.apply(d => updateQuote(d, clash.id, q => ({ ...q, number: "Q-0099" }), at(2)));
  await laptop.engine.flush();
  assert.equal(laptop.engine.getSnapshot().persistence, "saved");
  assert.equal(server.docs.get(clash.id)!.document_number, "Q-0099");
});

test("numbers allocated from several devices at once are unique and honour the chosen start", async () => {
  const server = account();
  const phone = await device(server);
  const laptop = await device(server);
  const numbers = await Promise.all(
    Array.from({ length: 30 }, (_, i) => (i % 2 ? phone : laptop).engine.allocateNumber("invoice")),
  );
  assert.equal(new Set(numbers).size, 30);
  assert.deepEqual([...numbers].sort((a, b) => a - b), Array.from({ length: 30 }, (_, i) => i + 1));

  phone.engine.apply(d => ({ ...d, settings: { ...d.settings, nextQuoteNumber: 250 } }));
  assert.equal(await phone.engine.allocateNumber("quote"), 250);
  assert.equal(await laptop.engine.allocateNumber("quote"), 251, "the server counter, not local settings, decides");
});

test("quote to invoice conversion survives a reload on another device", async () => {
  const server = account();
  const phone = await device(server);
  const quote = await newQuote(phone.engine, "Exterior");
  const n = await phone.engine.allocateNumber("invoice");
  phone.engine.apply(d => createInvoice(d, clock, quote.id, n).data);
  await phone.engine.flush();

  const laptop = await device(server);
  const invoice = laptop.engine.data!.invoices[0];
  assert.equal(invoice.number, "INV-0001");
  assert.equal(invoice.quoteId, quote.id);
  assert.equal(laptop.engine.data!.quotes[0].status, "accepted");
});

test("settings changed on two devices are merged field by field", async () => {
  const server = account();
  const phone = await device(server);
  const laptop = await device(server);

  phone.engine.apply(d => ({ ...d, settings: { ...d.settings, phone: "01925 000000" } }));
  await phone.engine.flush();
  laptop.engine.apply(d => ({ ...d, settings: { ...d.settings, bank: { ...d.settings.bank, accountName: "D&M" } } }));
  await laptop.engine.flush();
  assert.equal(laptop.engine.getSnapshot().persistence, "saved");

  const stored = server.settings.get(MIKE)!.payload as { settings: { phone: string; bank: { accountName: string } } };
  assert.equal(stored.settings.phone, "01925 000000");
  assert.equal(stored.settings.bank.accountName, "D&M");

  await newQuote(phone.engine, "A");
  await newQuote(laptop.engine, "B");
  await phone.engine.flush();
  await laptop.engine.flush();
  assert.equal(laptop.engine.getSnapshot().conflicts.length, 0, "creating quotes on both devices is not a conflict");
  assert.deepEqual(
    server.docsOf(MIKE).map(d => d.document_number).sort(),
    ["Q-0001", "Q-0002"],
  );
});

test("the same setting changed differently on two devices asks which to keep", async () => {
  const server = account();
  const phone = await device(server);
  const laptop = await device(server);
  phone.engine.apply(d => ({ ...d, settings: { ...d.settings, phone: "111" } }));
  await phone.engine.flush();
  laptop.engine.apply(d => ({ ...d, settings: { ...d.settings, phone: "222" } }));
  await laptop.engine.flush();
  const conflict = laptop.engine.getSnapshot().conflicts[0];
  assert.equal(conflict.key, "settings");
  laptop.engine.resolveConflict("settings", "theirs");
  await laptop.engine.flush();
  assert.equal(laptop.engine.data!.settings.phone, "111");
  assert.equal(laptop.engine.getSnapshot().persistence, "saved");
});

test("mergeSettings combines different fields and keeps the higher counter", () => {
  const base = defaultSettings();
  const local = { ...base, phone: "1", nextQuoteNumber: 5 };
  const remote = { ...base, email: "x@example.com", nextQuoteNumber: 7 };
  const { settings, conflicts } = mergeSettings(base, local, remote);
  assert.deepEqual(conflicts, []);
  assert.equal(settings.phone, "1");
  assert.equal(settings.email, "x@example.com");
  assert.equal(settings.nextQuoteNumber, 7);
  assert.deepEqual(mergeSettings(base, { ...base, phone: "1" }, { ...base, phone: "2" }).conflicts, ["phone"]);
});

test("a signed-out session is reported, not mistaken for a deletion", async () => {
  const server = account();
  const { repo, engine } = await device(server);
  const quote = await newQuote(engine, "Study");
  await engine.flush();
  repo.signedIn = false;
  rename(engine, quote.id, "Study, edited");
  await engine.flush();
  const snap = engine.getSnapshot();
  assert.equal(snap.persistence, "signed-out");
  assert.match(snap.message, /signed out/);
  assert.equal(snap.conflicts.length, 0);
});

test("a non-member's saves are refused with a clear message", async () => {
  const server = account();
  const { engine } = await device(server, "99999999-9999-4999-8999-999999999999");
  await newQuote(engine, "Should not save").catch(error => assert.equal(error.code, "forbidden"));
  engine.apply(d => createQuote(d, clock, { title: "Local only" }).data);
  await engine.flush();
  assert.equal(engine.getSnapshot().persistence, "failed");
  assert.match(engine.getSnapshot().message, /isn't allowed/);
  assert.equal(server.docs.size, 0);
});

test("load failures are reported for a retry", async () => {
  const server = account();
  server.offline = true;
  const { engine } = await device(server);
  assert.equal(engine.getSnapshot().phase, "error");
  assert.match(engine.getSnapshot().loadError, /No connection/);
  server.offline = false;
  await engine.load();
  assert.equal(engine.getSnapshot().phase, "ready");
});

test("a record created and removed before saving never reaches the server", async () => {
  const server = account();
  const { engine } = await device(server);
  const quote = await newQuote(engine, "Temporary");
  engine.apply(d => deleteQuote(d, quote.id));
  await engine.flush();
  assert.equal(server.docs.size, 0);
  assert.equal(engine.getSnapshot().persistence, "saved");
});
