"use client";
import { useSyncExternalStore } from "react";
import { todayIso } from "./dates";
import type { Clock } from "./operations";
import { SupabaseAdminRepository } from "./supabase-repository";
import { SyncEngine } from "./sync";
import type { Persistence, SyncSnapshot } from "./sync";
import type { AdminData } from "./types";
import { browserSupabase } from "@/lib/supabase/client";

// The admin's data, held in memory and saved to Supabase by the sync engine.
// Components read it with useAdminState() and change it with commit(); edits are
// saved shortly after they stop, retried when the connection returns, and
// refreshed from other devices when this page regains focus.

export type { Persistence };

export type AdminState = {
  data: AdminData;
  persistence: Persistence;
  message: string;
};

const SAVE_DELAY_MS = 700;
const REFRESH_INTERVAL_MS = 45_000;
const FOCUS_REFRESH_GAP_MS = 5_000;

const idle: SyncSnapshot = {
  phase: "loading",
  data: null,
  persistence: "saved",
  message: "",
  conflicts: [],
  pending: 0,
  loadError: "",
  lastSavedAt: null,
  settingsSaved: false,
};

let engine: SyncEngine | null = null;
let ownerId: string | null = null;
let snapshot: SyncSnapshot = idle;
let state: AdminState | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let retryDelay = 2_000;
let lastRefresh = 0;
let detach: (() => void) | null = null;
const listeners = new Set<() => void>();

export function clock(): Clock {
  const now = new Date();
  return { today: todayIso(now), now: now.toISOString() };
}

function emit() {
  listeners.forEach(listener => listener());
}

function onEngineChange() {
  if (!engine) return;
  snapshot = engine.getSnapshot();
  const { data, persistence, message } = snapshot;
  if (snapshot.phase !== "ready" || !data) state = null;
  else if (!state || state.data !== data || state.persistence !== persistence || state.message !== message) {
    state = { data, persistence, message };
  }
  emit();
}

function clearTimer(timer: ReturnType<typeof setTimeout> | null) {
  if (timer) clearTimeout(timer);
}

function save(delay = SAVE_DELAY_MS) {
  clearTimer(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const current = engine;
    void current?.flush().then(() => afterSave(current));
  }, delay);
}

function afterSave(current: SyncEngine) {
  if (current !== engine) return;
  clearTimer(retryTimer);
  retryTimer = null;
  if (current.getSnapshot().persistence === "offline") {
    retryTimer = setTimeout(() => save(0), retryDelay);
    retryDelay = Math.min(retryDelay * 2, 60_000);
  } else {
    retryDelay = 2_000;
  }
}

function refresh(force = false) {
  if (!engine || engine.getSnapshot().phase !== "ready") return;
  const now = Date.now();
  if (!force && now - lastRefresh < FOCUS_REFRESH_GAP_MS) return;
  lastRefresh = now;
  void engine.refresh();
  if (engine.hasUnsaved()) save(0);
}

function attachBrowserEvents() {
  const onVisible = () => {
    if (document.visibilityState === "visible") refresh();
    else if (engine?.hasUnsaved()) save(0);
  };
  const onOnline = () => {
    retryDelay = 2_000;
    save(0);
    refresh(true);
  };
  const onFocus = () => refresh();
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!engine?.hasUnsaved()) return;
    save(0);
    event.preventDefault();
    event.returnValue = "";
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onOnline);
  window.addEventListener("focus", onFocus);
  window.addEventListener("beforeunload", onBeforeUnload);
  pollTimer = setInterval(() => {
    if (document.visibilityState === "visible") refresh(true);
  }, REFRESH_INTERVAL_MS);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("beforeunload", onBeforeUnload);
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };
}

/** Starts loading the signed-in member's records. Safe to call repeatedly. */
export function startAdminStore(user: { id: string }) {
  if (engine && ownerId === user.id) return;
  stopAdminStore();
  const supabase = browserSupabase();
  if (!supabase) {
    snapshot = { ...idle, phase: "error", loadError: "The admin isn't connected to its database. Check the Supabase settings." };
    emit();
    return;
  }
  ownerId = user.id;
  engine = new SyncEngine(new SupabaseAdminRepository(supabase, user.id), {
    now: () => new Date().toISOString(),
    onChange: onEngineChange,
  });
  detach = attachBrowserEvents();
  lastRefresh = Date.now();
  onEngineChange();
  void engine.load();
}

/** Forgets everything in memory, e.g. when signing out. */
export function stopAdminStore() {
  clearTimer(saveTimer);
  clearTimer(retryTimer);
  saveTimer = retryTimer = null;
  detach?.();
  detach = null;
  engine = null;
  ownerId = null;
  state = null;
  snapshot = idle;
  emit();
}

/** Applies a change; it is saved to the server shortly afterwards. */
export function commit(change: (data: AdminData) => AdminData, { immediate = false } = {}) {
  if (engine?.apply(change)) save(immediate ? 0 : SAVE_DELAY_MS);
}

/** Reserves the next quote or invoice number on the server. Throws when it can't. */
export async function allocateNumber(kind: "quote" | "invoice", min?: number): Promise<number> {
  if (!engine) throw new Error("The admin hasn't finished loading.");
  return engine.allocateNumber(kind, min);
}

export function resolveConflict(key: string, choice: "mine" | "theirs") {
  engine?.resolveConflict(key, choice);
  save(0);
}

export function retrySaving() {
  engine?.retryBlocked();
  retryDelay = 2_000;
  save(0);
}

export function reloadAdminData() {
  void engine?.load();
}

/** Saves anything pending now and resolves once the server has answered. */
export async function saveNow(): Promise<boolean> {
  clearTimer(saveTimer);
  saveTimer = null;
  if (!engine) return true;
  await engine.flush();
  return !engine.hasUnsaved();
}

export function hasUnsavedChanges(): boolean {
  return engine?.hasUnsaved() ?? false;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The loaded records, or null while loading (and on the server). */
export function useAdminState(): AdminState | null {
  return useSyncExternalStore(subscribe, () => state, () => null);
}

/** Loading, saving, conflict and error details for the app shell. */
export function useSyncStatus(): SyncSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => idle);
}
