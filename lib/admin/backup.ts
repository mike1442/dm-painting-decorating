import { normaliseAdminData, obj } from "./normalise.ts";
import type { AdminData } from "./types.ts";

export const BACKUP_FORMAT = "dm-admin-backup";

export type Backup = {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  data: AdminData;
};

export function createBackup(data: AdminData, now: string): Backup {
  return { format: BACKUP_FORMAT, schemaVersion: data.schemaVersion, exportedAt: now, data };
}

export function backupFileName(now: string): string {
  return `dm-admin-backup-${now.slice(0, 10)}.json`;
}

export type ParsedBackup = { ok: true; data: AdminData; exportedAt: string } | { ok: false; error: string };

export function parseBackup(fileText: string, now: string): ParsedBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileText);
  } catch {
    return { ok: false, error: "This file isn't valid JSON." };
  }
  const raw = obj(parsed);
  if (raw.format !== BACKUP_FORMAT || !raw.data) return { ok: false, error: "This isn't a D&M admin backup file." };
  return {
    ok: true,
    data: normaliseAdminData(raw.data, now),
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
  };
}

function mergeById<T extends { id: string; updatedAt: string }>(current: T[], incoming: T[]): T[] {
  const byId = new Map(current.map(item => [item.id, item]));
  for (const item of incoming) {
    const existing = byId.get(item.id);
    if (!existing || item.updatedAt > existing.updatedAt) byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Combines a backup with this device's records, keeping the most recently
 * edited copy of each. This device's business settings are kept, but document
 * numbering always moves forward so numbers are never reused.
 */
export function mergeData(current: AdminData, incoming: AdminData): AdminData {
  return {
    ...current,
    quotes: mergeById(current.quotes, incoming.quotes),
    invoices: mergeById(current.invoices, incoming.invoices),
    bookings: mergeById(current.bookings, incoming.bookings),
    settings: {
      ...current.settings,
      nextQuoteNumber: Math.max(current.settings.nextQuoteNumber, incoming.settings.nextQuoteNumber),
      nextInvoiceNumber: Math.max(current.settings.nextInvoiceNumber, incoming.settings.nextInvoiceNumber),
    },
  };
}
