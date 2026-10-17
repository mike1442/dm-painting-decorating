"use client";
import { normaliseAdminData } from "./normalise";
import type { AdminData } from "./types";

// Records saved by the earlier device-only version of the admin live in this
// browser's localStorage. They are only ever read for a reviewed import and are
// never deleted without the person asking.

export const LEGACY_KEY = "dm-admin:v1";
const IMPORTED_KEY = "dm-admin:v1:imported-at";

export type LegacyRecords = { data: AdminData; raw: string; importedAt: string | null };

export function readLegacyRecords(): LegacyRecords | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      data: normaliseAdminData(parsed, new Date().toISOString()),
      raw,
      importedAt: window.localStorage.getItem(IMPORTED_KEY),
    };
  } catch {
    return null;
  }
}

export function markLegacyImported(now: string) {
  try {
    window.localStorage.setItem(IMPORTED_KEY, now);
  } catch {}
}

export function removeLegacyRecords() {
  try {
    window.localStorage.removeItem(LEGACY_KEY);
    window.localStorage.removeItem(IMPORTED_KEY);
  } catch {}
}
