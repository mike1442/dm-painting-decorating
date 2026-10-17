import test from "node:test";
import assert from "node:assert/strict";
import { emptyData, newBooking } from "../../lib/admin/factories.ts";
import { applyImport, planImport, remapIds } from "../../lib/admin/importer.ts";
import { createInvoice, createQuote, updateQuote } from "../../lib/admin/operations.ts";
import { isUuid } from "../../lib/admin/remote.ts";
import type { AdminData } from "../../lib/admin/types.ts";

const clock = { today: "2026-10-17", now: "2026-10-17T10:00:00.000Z" };

/** Online: Q-0001 "Shared". This browser: the same quote edited, plus its own Q-0001, Q-0002 and an invoice. */
function scenario() {
  let online = emptyData(clock.now);
  const shared = createQuote(online, clock, { title: "Shared" });
  online = shared.data;

  let local: AdminData = { ...emptyData(clock.now), quotes: [shared.quote] };
  local = updateQuote(local, shared.quote.id, q => ({ ...q, title: "Shared, edited in browser" }), "2026-10-18T09:00:00.000Z");
  const own1 = createQuote({ ...local, settings: { ...local.settings, nextQuoteNumber: 1 } }, clock, { title: "Browser Q-0001" });
  local = { ...own1.data };
  const own2 = createQuote(local, clock, { title: "Browser Q-0002" });
  local = own2.data;
  const invoice = createInvoice(local, clock, own2.quote.id);
  local = invoice.data;
  local = { ...local, bookings: [newBooking("2026-10-20", clock.now, { job: "Browser booking", quoteId: own2.quote.id })] };
  return { online, local, shared: shared.quote, own1: own1.quote, own2: own2.quote, invoice: invoice.invoice };
}

test("classifies records and never pre-selects anything that would replace online data", () => {
  const { online, local, shared, own1, own2, invoice } = scenario();
  const plan = planImport(online, local, { onlineSettingsSaved: true });
  const byId = new Map(plan.items.map(i => [i.record.id, i]));
  assert.equal(byId.get(shared.id)!.status, "different");
  assert.equal(byId.get(shared.id)!.selected, false);
  assert.equal(byId.get(shared.id)!.newer, "incoming");
  assert.equal(byId.get(own1.id)!.status, "number-clash", "Q-0001 is already used online");
  assert.equal(byId.get(own1.id)!.selected, true);
  assert.equal(byId.get(own2.id)!.status, "new");
  assert.equal(byId.get(invoice.id)!.status, "new");
  assert.equal(plan.items.filter(i => i.kind === "booking")[0].status, "new");
  assert.equal(plan.importSettings, false, "online settings are kept when they have been saved");
  assert.equal(plan.floors.quote, 3);
});

test("importing the same backup twice changes nothing the second time", () => {
  const { online, local } = scenario();
  const first = planImport(online, local, { onlineSettingsSaved: true });
  const numbers = new Map(first.items.filter(i => i.status === "number-clash").map(i => [i.key, 7]));
  const after = applyImport(online, first, { selected: new Set(first.items.filter(i => i.selected).map(i => i.key)), importSettings: false, numbers });
  const second = planImport(after.data, local, { onlineSettingsSaved: true });
  const selectedAgain = second.items.filter(i => i.selected && i.status === "new");
  assert.deepEqual(selectedAgain, [], "nothing new on a second import");
});

test("applies selections: adds new records, renumbers clashes and only replaces what was ticked", () => {
  const { online, local, shared, own1, own2 } = scenario();
  const plan = planImport(online, local, { onlineSettingsSaved: true });
  const clash = plan.items.find(i => i.record.id === own1.id)!;
  const selected = new Set(plan.items.filter(i => i.selected).map(i => i.key));
  const result = applyImport(online, plan, { selected, importSettings: false, numbers: new Map([[clash.key, 3]]) });

  assert.equal(result.data.quotes.find(q => q.id === shared.id)!.title, "Shared", "online copy untouched by default");
  assert.equal(result.data.quotes.find(q => q.id === own1.id)!.number, "Q-0003");
  assert.deepEqual(result.renumbered, [{ from: "Q-0001", to: "Q-0003" }]);
  assert.equal(result.data.quotes.find(q => q.id === own2.id)!.number, "Q-0002");
  assert.equal(result.data.invoices.length, 1);
  assert.equal(result.data.invoices[0].quoteId, own2.id, "links survive the import");
  assert.equal(result.data.bookings.length, 1);
  assert.ok(result.data.settings.nextQuoteNumber >= 3, "the counter moves past imported numbers");

  selected.add(plan.items.find(i => i.record.id === shared.id)!.key);
  const replaced = applyImport(online, plan, { selected, importSettings: false, numbers: new Map([[clash.key, 3]]) });
  assert.equal(replaced.data.quotes.find(q => q.id === shared.id)!.title, "Shared, edited in browser");
});

test("a clash without a reserved number is refused rather than duplicated", () => {
  const { online, local } = scenario();
  const plan = planImport(online, local, { onlineSettingsSaved: true });
  const selected = new Set(plan.items.filter(i => i.selected).map(i => i.key));
  assert.throws(() => applyImport(online, plan, { selected, importSettings: false, numbers: new Map() }), /No new number/);
});

test("settings are offered when the online account has none of its own yet", () => {
  const { online, local } = scenario();
  const customised = { ...local, settings: { ...local.settings, phone: "01925 000000" } };
  const plan = planImport(online, customised, { onlineSettingsSaved: false });
  assert.equal(plan.importSettings, true);
  const result = applyImport(online, plan, { selected: new Set(), importSettings: true, numbers: new Map() });
  assert.equal(result.data.settings.phone, "01925 000000");
});

test("non-UUID ids from old backups get new ids and their links follow", () => {
  const data: AdminData = {
    ...emptyData(clock.now),
    quotes: [{ ...createQuote(emptyData(clock.now), clock).quote, id: "legacy-quote-1" }],
  };
  const withInvoice = { ...data, invoices: [{ ...createInvoice(data, clock, "legacy-quote-1").invoice, id: "legacy-inv-1" }] };
  const { data: remapped, remapped: count } = remapIds(withInvoice);
  assert.equal(count, 2);
  assert.ok(isUuid(remapped.quotes[0].id));
  assert.equal(remapped.invoices[0].quoteId, remapped.quotes[0].id);
});
