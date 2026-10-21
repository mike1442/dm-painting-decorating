import { createBackup, parseBackup } from "./backup.ts";
import type { ParsedBackup } from "./backup.ts";
import { todayIso } from "./dates.ts";
import { emptyData } from "./factories.ts";
import { normaliseAdminData } from "./normalise.ts";
import { loginPath } from "./return-path.ts";
import type { Clock } from "./operations.ts";
import type { AdminData } from "./types.ts";

/** Kept intact so records made by the original browser-only admin can be imported. */
export const STORAGE_KEY = "dm-admin:v1";
const RECOVERY_KEY = "dm-admin:pending:v1";
const RECOVERED_KEY = "dm-admin:recovered:v1";
const SAVE_DELAY_MS = 350;
const REFRESH_INTERVAL_MS = 20_000;
/** A failed first load is retried sooner than the regular check, backing off. */
const LOAD_RETRY_MS = [3_000, 6_000, 12_000];
/** Saves the server refused before writing anything (it sends Retry-After) are repeated. */
const SAVE_RETRY_MS = [3_000, 6_000];

export type Persistence = "saved" | "saving" | "unavailable" | "failed" | "conflict";
export type AdminState = {
  data: AdminData;
  ready: boolean;
  persistence: Persistence;
  message: string;
};

let state: AdminState | null = null;
let revision: number | null = null;
let mutation = 0;
let dirty = false;
let conflict = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let savePromise: Promise<boolean> | null = null;
let refreshPromise: Promise<boolean> | null = null;
let listening = false;
let loadRetryTimer: ReturnType<typeof setTimeout> | null = null;
let loadRetries = 0;
let stopListening: (() => void) | null = null;
const listeners = new Set<() => void>();

export function clock(): Clock {
  const now = new Date();
  return { today: todayIso(now), now: now.toISOString() };
}

function emit() {
  listeners.forEach(listener => listener());
}

function rememberPending() {
  if (!state || !dirty) return;
  try {
    // Recovery only: Supabase remains the source of truth. A refreshed tab asks
    // the admin to review/import this copy rather than silently replaying it.
    window.sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(createBackup(state.data, clock().now)));
  } catch {
    // The save error and beforeunload warning still protect pending edits when
    // browser policy blocks this optional recovery copy.
  }
}

function clearPending() {
  try { window.sessionStorage.removeItem(RECOVERY_KEY); } catch {}
}

function preserveRecoveredEdits() {
  try {
    const pending = window.sessionStorage.getItem(RECOVERY_KEY);
    const previous = window.sessionStorage.getItem(RECOVERED_KEY);
    let parsed: unknown = [];
    try { parsed = previous ? JSON.parse(previous) : []; }
    catch { parsed = previous; }
    // Support the original single-snapshot format as well as a history. No
    // earlier failed edit may be hidden by the recovery from a later visit.
    const snapshots = Array.isArray(parsed) && parsed.every(value => typeof value === "string") ? parsed as string[] : previous ? [previous] : [];
    if (pending && !snapshots.includes(pending)) {
      window.sessionStorage.setItem(RECOVERED_KEY, JSON.stringify([...snapshots, pending]));
    }
  } catch {}
}

function sessionExpired() {
  if (state) {
    state = { ...state, persistence: "failed", message: "Your session has expired. Sign in again to save your changes." };
    rememberPending();
    emit();
  }
  // Back to this page after signing in; the unsaved edits stay in the recovery copy.
  window.location.assign(loginPath(window.location.pathname, window.location.search));
}

async function cloudResponse(response: Response): Promise<{ data: AdminData; revision: number }> {
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("data" in result) || !("revision" in result)
    || !Number.isSafeInteger(result.revision) || Number(result.revision) < 0) {
    throw new Error("The server returned an invalid response.");
  }
  const data = result.data;
  if (!data || typeof data !== "object" || !("quotes" in data) || !Array.isArray(data.quotes)
    || !("invoices" in data) || !Array.isArray(data.invoices) || !("bookings" in data) || !Array.isArray(data.bookings)
    || !("settings" in data) || !data.settings || typeof data.settings !== "object") {
    throw new Error("The server returned invalid cloud records.");
  }
  return { data: normaliseAdminData(result.data, clock().now), revision: Number(result.revision) };
}

/** Read cloud records only when there are no pending edits, unless explicitly discarded. */
export async function refreshAdminData({ discardPending = false } = {}): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  if (savePromise) await savePromise;
  if (refreshPromise) return refreshPromise;
  if (dirty && !discardPending) return false;
  const startedAt = mutation;
  if (!state) {
    preserveRecoveredEdits();
    state = { data: emptyData(clock().now), ready: false, persistence: "saving", message: "" };
    emit();
  }
  refreshPromise = (async () => {
    try {
      const response = await fetch("/api/admin/data", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 401) { sessionExpired(); return false; }
      if (!response.ok) throw new Error("Cloud storage could not be reached.");
      const cloud = await cloudResponse(response);
      // A GET already in flight must never replace edits made while it waited.
      if (mutation !== startedAt) return false;
      revision = cloud.revision;
      dirty = false;
      conflict = false;
      state = { data: cloud.data, ready: true, persistence: "saved", message: "" };
      cancelLoadRetry();
      if (discardPending) clearPending();
      emit();
      return true;
    } catch {
      if (state) {
        state = {
          ...state,
          persistence: state.ready ? state.persistence : "unavailable",
          message: state.ready
            ? "Could not check for changes from other devices. Check your connection and try again."
            : "Could not load your records from secure cloud storage. Check your connection, then retry.",
        };
        emit();
        // A brief upstream stall must not leave Mike on this screen until the next regular check.
        if (!state.ready) scheduleLoadRetry();
      }
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

function reconcileNumbers(current: AdminData, canonical: AdminData): AdminData {
  const quoteNumbers = new Map(canonical.quotes.map(q => [q.id, q.number]));
  const invoiceNumbers = new Map(canonical.invoices.map(i => [i.id, i.number]));
  return {
    ...current,
    quotes: current.quotes.map(q => ({ ...q, number: quoteNumbers.get(q.id) ?? q.number })),
    invoices: current.invoices.map(i => ({
      ...i,
      number: invoiceNumbers.get(i.id) ?? i.number,
      quoteNumber: (i.quoteId && quoteNumbers.get(i.quoteId)) || i.quoteNumber,
    })),
    settings: {
      ...current.settings,
      nextQuoteNumber: Math.max(current.settings.nextQuoteNumber, canonical.settings.nextQuoteNumber),
      nextInvoiceNumber: Math.max(current.settings.nextInvoiceNumber, canonical.settings.nextInvoiceNumber),
    },
  };
}

async function saveChanges(): Promise<boolean> {
  let retries = 0;
  while (dirty && state?.ready && revision !== null) {
    const sentMutation = mutation;
    const data = state.data;
    state = { ...state, persistence: "saving", message: "" };
    emit();
    try {
      const response = await fetch("/api/admin/data", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, revision }),
      });
      if (response.status === 401) { sessionExpired(); return false; }
      if (response.status === 409) {
        conflict = true;
        state = {
          ...state,
          persistence: "conflict",
          message: "Another device changed these records. Your edits are kept here. Export them, then reload the cloud records before importing missing records.",
        };
        rememberPending();
        emit();
        return false;
      }
      if (response.status === 503 && response.headers.has("Retry-After") && retries < SAVE_RETRY_MS.length) {
        // Nothing was written (e.g. Supabase Auth did not answer), so repeating
        // the save cannot apply it twice. It sends the latest edits.
        await new Promise(resolve => setTimeout(resolve, SAVE_RETRY_MS[retries++]));
        continue;
      }
      if (!response.ok) throw new Error("Cloud storage could not save these changes.");
      retries = 0;
      const cloud = await cloudResponse(response);
      revision = cloud.revision;
      dirty = sentMutation !== mutation;
      state = {
        ...state,
        data: dirty ? reconcileNumbers(state.data, cloud.data) : cloud.data,
        persistence: dirty ? "saving" : "saved",
        message: "",
      };
      if (dirty) rememberPending();
      else clearPending();
      emit();
    } catch {
      state = {
        ...state,
        persistence: "failed",
        message: "Changes have not reached cloud storage. Keep this page open, retry saving, or export a backup of your edits.",
      };
      rememberPending();
      emit();
      return false;
    }
  }
  return !!state?.ready && !dirty;
}

/** Resolves only after all edits (including edits made during a save) reach Supabase. */
export function flush(): Promise<boolean> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (savePromise) return savePromise;
  if (conflict || !state?.ready || revision === null) return Promise.resolve(false);
  if (!dirty) return Promise.resolve(true);
  savePromise = saveChanges().then(saved => {
    savePromise = null;
    // An immediate edit queued by a subscriber as the final response arrives
    // must not be left behind on the promise that just completed.
    return saved && dirty ? flush() : saved;
  });
  return savePromise;
}

function cancelLoadRetry() {
  if (loadRetryTimer) clearTimeout(loadRetryTimer);
  loadRetryTimer = null;
  loadRetries = 0;
}

function scheduleLoadRetry() {
  if (!listening || loadRetryTimer || loadRetries >= LOAD_RETRY_MS.length) return;
  loadRetryTimer = setTimeout(() => {
    loadRetryTimer = null;
    void refreshAdminData();
  }, LOAD_RETRY_MS[loadRetries++]);
}

function startListening() {
  if (listening) return;
  listening = true;
  void refreshAdminData();
  const focus = () => { void refreshAdminData(); };
  const online = () => {
    if (dirty) void flush();
    else void refreshAdminData();
  };
  const hide = () => { void flush(); };
  const leaving = (event: BeforeUnloadEvent) => {
    if (!dirty) return;
    rememberPending();
    event.preventDefault();
    event.returnValue = "";
  };
  const visibility = () => {
    if (document.visibilityState === "hidden") void flush();
    else void refreshAdminData();
  };
  window.addEventListener("focus", focus);
  window.addEventListener("online", online);
  window.addEventListener("pagehide", hide);
  window.addEventListener("beforeunload", leaving);
  document.addEventListener("visibilitychange", visibility);
  const interval = window.setInterval(() => {
    if (document.visibilityState === "visible") void refreshAdminData();
  }, REFRESH_INTERVAL_MS);
  stopListening = () => {
    window.removeEventListener("focus", focus);
    window.removeEventListener("online", online);
    window.removeEventListener("pagehide", hide);
    window.removeEventListener("beforeunload", leaving);
    document.removeEventListener("visibilitychange", visibility);
    window.clearInterval(interval);
    cancelLoadRetry();
    listening = false;
    stopListening = null;
  };
}

export function subscribeAdminState(listener: () => void) {
  listeners.add(listener);
  startListening();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) stopListening?.();
  };
}

/** Applies an edit locally, then serially saves it using the current cloud revision. */
export function commit(change: (data: AdminData) => AdminData, { immediate = false } = {}) {
  if (!state?.ready) return;
  const data = change(state.data);
  if (data === state.data) return;
  mutation += 1;
  dirty = true;
  state = { ...state, data, persistence: conflict ? "conflict" : "saving", message: conflict ? state.message : "" };
  rememberPending();
  emit();
  if (saveTimer) clearTimeout(saveTimer);
  if (conflict) return;
  if (immediate) void flush();
  else saveTimer = setTimeout(() => { void flush(); }, SAVE_DELAY_MS);
}

/** Current in-memory data, including canonical document numbers returned after flush. */
export function getAdminData(): AdminData | null {
  return state?.data ?? null;
}

/** Optional copies are reviewed explicitly; the original browser data is never altered. */
export function readBrowserImport(source: "legacy" | "recovery"): ParsedBackup | null {
  try {
    if (source === "recovery") return readRecoveryImports()[0] ?? null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("quotes" in parsed) || !("invoices" in parsed) || !("bookings" in parsed)) {
      return { ok: false, error: "The original browser records could not be read. They have been left untouched." };
    }
    return { ok: true, data: normaliseAdminData(parsed, clock().now), exportedAt: "" };
  } catch {
    return { ok: false, error: "Browser records could not be read. They have been left untouched; you can still import an exported backup." };
  }
}

/** Most recent first; every recovery remains exportable for the life of this tab. */
export function readRecoveryImports(): ParsedBackup[] {
  try {
    const raw = window.sessionStorage.getItem(RECOVERED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    const snapshots = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [raw];
    return snapshots.reverse().map(snapshot => parseBackup(snapshot, clock().now));
  } catch {
    return [{ ok: false, error: "Recovered edits could not be read. The original recovery copy has been left untouched." }];
  }
}

/** Imports add missing records, preserving every current cloud record with the same ID. */
export function importMissingRecords(current: AdminData, incoming: AdminData, importSettings = false): AdminData {
  const missing = <T extends { id: string }>(existing: T[], imported: T[]) => {
    const ids = new Set(existing.map(record => record.id));
    return [...existing, ...imported.filter(record => !ids.has(record.id))];
  };
  const settings = importSettings ? incoming.settings : current.settings;
  return {
    ...current,
    quotes: missing(current.quotes, incoming.quotes),
    invoices: missing(current.invoices, incoming.invoices),
    bookings: missing(current.bookings, incoming.bookings),
    settings: {
      ...settings,
      nextQuoteNumber: Math.max(current.settings.nextQuoteNumber, incoming.settings.nextQuoteNumber),
      nextInvoiceNumber: Math.max(current.settings.nextInvoiceNumber, incoming.settings.nextInvoiceNumber),
    },
  };
}

export function storedBytes(): number {
  return state ? JSON.stringify(state.data).length * 2 : 0;
}

/** A stable snapshot for React subscriptions and persistence verification. */
export function getAdminState(): AdminState | null {
  return state;
}
