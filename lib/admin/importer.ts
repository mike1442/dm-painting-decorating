import { formatDocNumber, newId } from "./factories.ts";
import { collectionFor, isUuid, kinds, recordLabel, recordsOf, withRecords } from "./remote.ts";
import type { AdminRecord, DocKind } from "./remote.ts";
import { stableJson } from "./sync.ts";
import type { AdminData, BusinessSettings } from "./types.ts";

// Reviewable import of records from a backup file or from this browser's old
// device-only storage into the online account. Nothing already online is
// replaced unless the person ticks it, and numbers already used online are
// given new ones rather than duplicated.

export type ImportStatus = "new" | "identical" | "different" | "number-clash";

export type ImportItem = {
  key: string;
  kind: DocKind;
  record: AdminRecord;
  label: string;
  status: ImportStatus;
  /** Ticked by default? Never true for records that would replace something online. */
  selected: boolean;
  /** For "different": which copy was edited more recently. */
  newer?: "incoming" | "online" | "same";
};

export type ImportPlan = {
  items: ImportItem[];
  settings: BusinessSettings;
  settingsDiffer: boolean;
  /** Suggested only when the online account has never saved its own settings. */
  importSettings: boolean;
  /** Lowest safe next numbers once these records are online. */
  floors: { quote: number; invoice: number };
  remapped: number;
};

const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);
const itemKey = (kind: DocKind, id: string) => `${kind}:${id}`;

/** Gives records with non-UUID ids (the database requires UUIDs) new ids, keeping links intact. */
export function remapIds(data: AdminData): { data: AdminData; remapped: number } {
  const ids = new Map<string, string>();
  for (const kind of kinds) for (const r of recordsOf(data, kind)) if (!isUuid(r.id)) ids.set(r.id, newId());
  if (!ids.size) return { data, remapped: 0 };
  const swap = (id: string | null) => (id && ids.get(id)) || id;
  return {
    remapped: ids.size,
    data: {
      ...data,
      quotes: data.quotes.map(q => ({ ...q, id: swap(q.id)! })),
      invoices: data.invoices.map(i => ({ ...i, id: swap(i.id)!, quoteId: swap(i.quoteId) })),
      bookings: data.bookings.map(b => ({ ...b, id: swap(b.id)!, quoteId: swap(b.quoteId), invoiceId: swap(b.invoiceId) })),
    },
  };
}

function highestNumber(records: AdminRecord[], prefix: string): number {
  let high = 0;
  for (const r of records) {
    if (r.kind === "booking" || !r.number.startsWith(prefix)) continue;
    const n = Number(r.number.slice(prefix.length));
    if (Number.isInteger(n) && n > high) high = n;
  }
  return high;
}

export function planImport(online: AdminData, incomingRaw: AdminData, options: { onlineSettingsSaved: boolean }): ImportPlan {
  const { data: incoming, remapped } = remapIds(incomingRaw);
  const items: ImportItem[] = [];
  for (const kind of kinds) {
    const onlineRecords = recordsOf(online, kind);
    const usedNumbers = new Set(onlineRecords.map(r => (r.kind === "booking" ? "" : r.number)).filter(Boolean));
    for (const record of recordsOf(incoming, kind)) {
      const existing = onlineRecords.find(r => r.id === record.id);
      const base = { key: itemKey(kind, record.id), kind, record, label: recordLabel(record) };
      if (existing) {
        if (same(existing, record)) items.push({ ...base, status: "identical", selected: false });
        else {
          const newer = record.updatedAt > existing.updatedAt ? "incoming" : record.updatedAt < existing.updatedAt ? "online" : "same";
          items.push({ ...base, status: "different", selected: false, newer });
        }
        continue;
      }
      const number = record.kind === "booking" ? "" : record.number.trim();
      if (number && usedNumbers.has(number)) items.push({ ...base, status: "number-clash", selected: true });
      else items.push({ ...base, status: "new", selected: true });
      if (number) usedNumbers.add(number);
    }
  }

  const s = online.settings;
  const all = (kind: "quote" | "invoice") => [...recordsOf(online, kind), ...recordsOf(incoming, kind)];
  const floors = {
    quote: Math.max(s.nextQuoteNumber, incoming.settings.nextQuoteNumber, highestNumber(all("quote"), s.quotePrefix) + 1),
    invoice: Math.max(s.nextInvoiceNumber, incoming.settings.nextInvoiceNumber, highestNumber(all("invoice"), s.invoicePrefix) + 1),
  };
  const settingsDiffer = !same(online.settings, incoming.settings);
  return {
    items,
    settings: incoming.settings,
    settingsDiffer,
    importSettings: settingsDiffer && !options.onlineSettingsSaved,
    floors,
    remapped,
  };
}

export type ImportChoices = {
  selected: Set<string>;
  importSettings: boolean;
  /** New numbers (from the server) for selected "number-clash" items. */
  numbers: Map<string, number>;
};

/** Adds the chosen records to the online data. Returns the new data and what was renumbered. */
export function applyImport(online: AdminData, plan: ImportPlan, choices: ImportChoices) {
  const baseSettings = choices.importSettings ? plan.settings : online.settings;
  const settings: BusinessSettings = {
    ...baseSettings,
    nextQuoteNumber: Math.max(baseSettings.nextQuoteNumber, online.settings.nextQuoteNumber, plan.floors.quote),
    nextInvoiceNumber: Math.max(baseSettings.nextInvoiceNumber, online.settings.nextInvoiceNumber, plan.floors.invoice),
  };
  let data: AdminData = { ...online, settings };
  const renumbered: { from: string; to: string }[] = [];
  let imported = 0;
  for (const kind of kinds) {
    let records = recordsOf(data, kind);
    for (const item of plan.items) {
      if (item.kind !== kind || !choices.selected.has(item.key) || item.status === "identical") continue;
      let record = item.record;
      // Another device may have added the same record since the review was prepared.
      if (item.status !== "different" && records.some(r => r.id === record.id)) continue;
      if (item.status === "number-clash" && record.kind !== "booking") {
        const n = choices.numbers.get(item.key);
        if (!n) throw new Error(`No new number was reserved for ${item.label}.`);
        const prefix = record.kind === "quote" ? settings.quotePrefix : settings.invoicePrefix;
        const number = formatDocNumber(prefix, n);
        renumbered.push({ from: record.number, to: number });
        record = { ...record, number };
      }
      records = item.status === "different" ? records.map(r => (r.id === record.id ? record : r)) : [record, ...records];
      imported += 1;
    }
    data = withRecords(data, kind, records);
  }
  return { data, imported, renumbered };
}

export function countRecords(data: Pick<AdminData, (typeof collectionFor)[DocKind]>): number {
  return data.quotes.length + data.invoices.length + data.bookings.length;
}
