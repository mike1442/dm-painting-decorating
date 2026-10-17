"use client";
import { useSyncExternalStore } from "react";
import { todayIso } from "./dates.ts";
import { emptyData } from "./factories.ts";
import { normaliseAdminData } from "./normalise.ts";
import type { Clock } from "./operations.ts";
import type { AdminData } from "./types.ts";

// TEMPORARY STORAGE. Records live only in this browser's localStorage on this
// device: they are not synchronised, not backed up and can be cleared by the
// browser. Replace this module with a backend-backed store (e.g. Supabase)
// that implements the same operations from operations.ts.

export const STORAGE_KEY = "dm-admin:v1";
const SAVE_DELAY_MS = 250;

export type Persistence = "saved" | "saving" | "unavailable" | "failed";

export type AdminState = {
  data: AdminData;
  persistence: Persistence;
  message: string;
};

let state: AdminState | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
const listeners = new Set<() => void>();

export function clock(): Clock {
  const now = new Date();
  return { today: todayIso(now), now: now.toISOString() };
}

function load(): AdminState {
  const now = new Date().toISOString();
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return {
      data: emptyData(now),
      persistence: "unavailable",
      message: "This browser is blocking storage, so nothing you enter can be kept. Check private browsing or cookie settings.",
    };
  }
  if (!raw) return { data: emptyData(now), persistence: "saved", message: "" };
  try {
    return { data: normaliseAdminData(JSON.parse(raw), now), persistence: "saved", message: "" };
  } catch {
    try {
      window.localStorage.setItem(`${STORAGE_KEY}:unreadable:${now}`, raw);
    } catch {}
    return {
      data: emptyData(now),
      persistence: "saved",
      message: "Saved records on this device could not be read. A copy was kept; restore from a backup if you have one.",
    };
  }
}

function emit() {
  listeners.forEach(listener => listener());
}

function getState(): AdminState {
  if (!state) state = load();
  return state;
}

/** Writes pending changes now. Called automatically after edits and when the page is hidden. */
export function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const current = getState();
  if (current.persistence !== "saving") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current.data));
    state = { ...current, persistence: "saved", message: "" };
  } catch {
    state = {
      ...current,
      persistence: "failed",
      message: "Couldn't save on this device. Browser storage may be full or blocked. Export a backup now.",
    };
  }
  emit();
}

function startListening() {
  if (listening) return;
  listening = true;
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("storage", event => {
    // Another tab saved: reload unless this tab has unsaved edits of its own.
    if (event.key !== STORAGE_KEY || saveTimer) return;
    state = load();
    emit();
  });
}

function subscribe(listener: () => void) {
  startListening();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Applies a change to the data set and saves it to this device shortly after. */
export function commit(change: (data: AdminData) => AdminData, { immediate = false } = {}) {
  const current = getState();
  const data = change(current.data);
  if (data === current.data) return;
  if (current.persistence === "unavailable") {
    state = { ...current, data };
    emit();
    return;
  }
  state = { ...current, data, persistence: "saving" };
  emit();
  if (saveTimer) clearTimeout(saveTimer);
  if (immediate) flush();
  else saveTimer = setTimeout(flush, SAVE_DELAY_MS);
}

/** Removes every admin record from this device. */
export function eraseDevice() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {}
  state = load();
  emit();
}

/** Approximate size of the saved records, in bytes. */
export function storedBytes(): number {
  try {
    return (window.localStorage.getItem(STORAGE_KEY) ?? "").length * 2;
  } catch {
    return 0;
  }
}

/** Current state, or null while rendering on the server. */
export function useAdminState(): AdminState | null {
  return useSyncExternalStore(subscribe, getState, () => null);
}
