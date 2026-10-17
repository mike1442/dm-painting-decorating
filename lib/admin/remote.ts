import { defaultSettings } from "./factories.ts";
import { normaliseBooking, normaliseInvoice, normaliseQuote, normaliseSettings, obj } from "./normalise.ts";
import { SCHEMA_VERSION } from "./types.ts";
import type { AdminData, Booking, BusinessSettings, Invoice, Quote } from "./types.ts";

// Mapping between the app's records and the Supabase tables:
//   admin_documents(id, owner_id, kind, document_number, payload, created_at, updated_at)
//   admin_settings(owner_id, payload, updated_at)
// Each quote, invoice and booking is stored whole as JSON in `payload`; the columns
// mirror the fields the database needs for security, uniqueness and versioning.

export type DocKind = "quote" | "invoice" | "booking";
export type AdminRecord = Quote | Invoice | Booking;

/** A row as read from admin_documents. `updated_at` is the server-owned version. */
export type DocRow = {
  id: string;
  kind: DocKind;
  document_number: string | null;
  payload: unknown;
  created_at: string;
  updated_at: string;
};

/** The writable part of a document row. owner_id is added by the repository. */
export type DocWrite = {
  id: string;
  kind: DocKind;
  document_number: string | null;
  payload: AdminRecord;
  created_at: string;
};

export type SettingsPayload = {
  schemaVersion: number;
  settings: BusinessSettings;
  meta: { lastBackupAt: string | null };
};

export type SettingsRow = { payload: unknown; updated_at: string };

export const collectionFor = { quote: "quotes", invoice: "invoices", booking: "bookings" } as const;
export const kinds: DocKind[] = ["quote", "invoice", "booking"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

export function recordToRow(record: AdminRecord): DocWrite {
  const number = record.kind === "booking" ? "" : record.number.trim();
  return {
    id: record.id,
    kind: record.kind,
    document_number: number || null,
    payload: record,
    created_at: record.createdAt,
  };
}

/** Turns a stored row back into a record, repairing anything malformed. */
export function rowToRecord(row: DocRow, settings: BusinessSettings, now: string): AdminRecord {
  const payload: Record<string, unknown> = { ...obj(row.payload), id: row.id };
  if (!("createdAt" in payload)) payload.createdAt = row.created_at;
  if (!("updatedAt" in payload)) payload.updatedAt = row.updated_at;
  if (row.kind === "quote") return normaliseQuote(payload, settings, now);
  if (row.kind === "invoice") return normaliseInvoice(payload, settings, now);
  return normaliseBooking(payload, now);
}

export function settingsToPayload(data: Pick<AdminData, "settings" | "meta">): SettingsPayload {
  return { schemaVersion: SCHEMA_VERSION, settings: data.settings, meta: { lastBackupAt: data.meta.lastBackupAt } };
}

export function payloadToSettings(payload: unknown): { settings: BusinessSettings; lastBackupAt: string | null } {
  const raw = obj(payload);
  const meta = obj(raw.meta);
  return {
    settings: "settings" in raw ? normaliseSettings(raw.settings) : defaultSettings(),
    lastBackupAt: typeof meta.lastBackupAt === "string" ? meta.lastBackupAt : null,
  };
}

export function recordsOf(data: AdminData, kind: DocKind): AdminRecord[] {
  return data[collectionFor[kind]];
}

export function withRecords(data: AdminData, kind: DocKind, records: AdminRecord[]): AdminData {
  return { ...data, [collectionFor[kind]]: records } as AdminData;
}

/** Display name for a record in messages, e.g. "Quote Q-0003". */
export function recordLabel(record: AdminRecord): string {
  if (record.kind === "booking") return `Booking${record.job ? `: ${record.job}` : ""}`;
  return `${record.kind === "quote" ? "Quote" : "Invoice"} ${record.number || "(no number)"}`;
}
