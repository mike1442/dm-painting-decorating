import { emptyData } from "./factories.ts";
import {
  kinds,
  payloadToSettings,
  recordLabel,
  recordsOf,
  recordToRow,
  rowToRecord,
  settingsToPayload,
  withRecords,
} from "./remote.ts";
import type { AdminRecord, DocKind, DocRow } from "./remote.ts";
import { errorMessage, RepoError } from "./repository.ts";
import type { AdminRepository } from "./repository.ts";
import type { AdminData, BusinessSettings } from "./types.ts";

// Keeps the in-memory AdminData in step with the database.
//
// - The UI changes data through apply(); the engine works out which records
//   changed and saves only those (flush()).
// - Every save carries the row's last known updated_at. If another device saved
//   in between, the database refuses and the engine records a conflict for the
//   person to resolve instead of overwriting.
// - refresh() pulls changes made elsewhere without touching unsaved local edits.
// - Nothing is reported as saved until the server has confirmed it.

export type Persistence = "saved" | "saving" | "offline" | "failed" | "conflict" | "signed-out";

export type RemoteSettings = { settings: BusinessSettings; lastBackupAt: string | null };

export type Conflict = {
  key: string;
  label: string;
  /** "changed": edited on another device. "deleted": removed on another device. */
  reason: "changed" | "deleted";
  remote: AdminRecord | RemoteSettings | null;
  remoteVersion: string | null;
};

export type SyncSnapshot = {
  phase: "loading" | "ready" | "error";
  data: AdminData | null;
  persistence: Persistence;
  message: string;
  conflicts: Conflict[];
  pending: number;
  loadError: string;
  lastSavedAt: string | null;
  /** Whether this account has saved its own business settings online yet. */
  settingsSaved: boolean;
};

export const SETTINGS_KEY = "settings";
export const keyOf = (kind: DocKind, id: string) => `${kind}:${id}`;
function parseKey(key: string): { kind: DocKind; id: string } {
  const at = key.indexOf(":");
  return { kind: key.slice(0, at) as DocKind, id: key.slice(at + 1) };
}

/** JSON with sorted keys, so equal values compare equal whatever order a database returns. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

/**
 * Field-by-field three-way merge of business settings. Changes made on different
 * devices to different fields are combined; document counters take the higher
 * value. Only the same field changed differently on both sides is a conflict.
 */
export function mergeSettings(base: BusinessSettings, local: BusinessSettings, remote: BusinessSettings) {
  const merged = { ...remote } as Record<string, unknown>;
  const conflicts: string[] = [];
  for (const key of Object.keys(local) as (keyof BusinessSettings)[]) {
    const l = local[key];
    const r = remote[key];
    const b = base[key];
    if (same(l, b) || same(l, r)) continue;
    if (same(r, b)) merged[key] = l;
    else if (key === "nextQuoteNumber" || key === "nextInvoiceNumber") merged[key] = Math.max(l as number, r as number);
    else conflicts.push(key);
  }
  return { settings: merged as BusinessSettings, conflicts };
}

function toRepoError(error: unknown): RepoError {
  if (error instanceof RepoError) return error;
  return new RepoError("unknown", error instanceof Error ? error.message : "Unexpected error");
}

export class SyncEngine {
  data: AdminData | null = null;
  private readonly repo: AdminRepository;
  private readonly now: () => string;
  private readonly onChange: () => void;
  private versions = new Map<string, string>();
  private settingsVersion: string | null = null;
  private settingsBase: BusinessSettings | null = null;
  private dirty = new Set<string>();
  private blocked = new Map<string, string>();
  private conflicts = new Map<string, Conflict>();
  private pushError: RepoError | null = null;
  private phase: SyncSnapshot["phase"] = "loading";
  private loadError = "";
  private lastSavedAt: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private snapshot: SyncSnapshot;

  constructor(repo: AdminRepository, options: { now: () => string; onChange?: () => void }) {
    this.repo = repo;
    this.now = options.now;
    this.onChange = options.onChange ?? (() => {});
    this.snapshot = this.buildSnapshot();
  }

  getSnapshot(): SyncSnapshot {
    return this.snapshot;
  }

  hasUnsaved(): boolean {
    return this.dirty.size > 0 || this.conflicts.size > 0;
  }

  /** Runs network work one task at a time so a refresh never interleaves with a save. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private emit() {
    this.snapshot = this.buildSnapshot();
    this.onChange();
  }

  load(): Promise<void> {
    return this.run(async () => {
      this.phase = "loading";
      try {
        const [rows, settingsRow] = await Promise.all([this.repo.loadDocuments(), this.repo.loadSettings()]);
        const now = this.now();
        let data = emptyData(now);
        this.versions.clear();
        if (settingsRow) {
          const remote = payloadToSettings(settingsRow.payload);
          data = { ...data, settings: remote.settings, meta: { ...data.meta, lastBackupAt: remote.lastBackupAt } };
          this.settingsVersion = settingsRow.updated_at;
        }
        this.settingsBase = data.settings;
        for (const kind of kinds) {
          const records = rows.filter(r => r.kind === kind).map(r => rowToRecord(r, data.settings, now));
          data = withRecords(data, kind, records);
          rows.filter(r => r.kind === kind).forEach(r => this.versions.set(keyOf(kind, r.id), r.updated_at));
        }
        data = await this.withServerCounters(data);
        this.data = data;
        this.phase = "ready";
        this.loadError = "";
      } catch (error) {
        const err = toRepoError(error);
        this.phase = "error";
        this.loadError = errorMessage(err);
        if (err.code === "signed-out") this.pushError = err;
      }
      this.emit();
    });
  }

  /** Shows the server's next numbers in Settings (display only; allocation is always server-side). */
  private async withServerCounters(data: AdminData): Promise<AdminData> {
    try {
      const counters = await this.repo.sequenceState();
      return {
        ...data,
        settings: {
          ...data.settings,
          nextQuoteNumber: Math.max(data.settings.nextQuoteNumber, counters.quote),
          nextInvoiceNumber: Math.max(data.settings.nextInvoiceNumber, counters.invoice),
        },
      };
    } catch {
      return data;
    }
  }

  /** Applies a change from the UI and marks the records it touched as unsaved. */
  apply(change: (data: AdminData) => AdminData): boolean {
    const prev = this.data;
    if (!prev) return false;
    const next = change(prev);
    if (next === prev) return false;
    for (const kind of kinds) {
      const before = recordsOf(prev, kind);
      const after = recordsOf(next, kind);
      if (before === after) continue;
      const previous = new Map(before.map(r => [r.id, r]));
      const present = new Set<string>();
      for (const record of after) {
        present.add(record.id);
        if (previous.get(record.id) !== record) this.markDirty(keyOf(kind, record.id));
      }
      for (const id of previous.keys()) if (!present.has(id)) this.markDirty(keyOf(kind, id));
    }
    if (prev.settings !== next.settings || prev.meta.lastBackupAt !== next.meta.lastBackupAt) this.markDirty(SETTINGS_KEY);
    this.data = next;
    this.emit();
    return true;
  }

  private markDirty(key: string) {
    this.dirty.add(key);
    this.blocked.delete(key);
  }

  /** Saves every unsaved change the server will currently accept. */
  flush(): Promise<void> {
    return this.run(async () => {
      if (!this.data) return;
      // Records edited while their save was in flight go round again; the cap stops
      // a misbehaving server from keeping this loop alive forever.
      let progress = true;
      for (let pass = 0; progress && pass < 25; pass++) {
        progress = false;
        for (const key of [...this.dirty]) {
          if (this.conflicts.has(key) || this.blocked.has(key)) continue;
          try {
            if (await this.push(key)) progress = true;
            this.pushError = null;
          } catch (error) {
            const err = toRepoError(error);
            if (err.code === "network" || err.code === "signed-out") {
              this.pushError = err;
              this.emit();
              return;
            }
            this.blocked.set(key, this.blockedMessage(key, err));
          }
          this.emit();
        }
      }
      this.emit();
    });
  }

  private blockedMessage(key: string, err: RepoError): string {
    const label = this.labelFor(key);
    if (err.code === "duplicate-number") {
      const record = this.recordFor(key);
      const number = record && record.kind !== "booking" ? record.number : "";
      return `${label} wasn't saved: the number ${number} is already used. Change the number to save it.`;
    }
    return `${label} wasn't saved: ${errorMessage(err)}`;
  }

  private recordFor(key: string): AdminRecord | undefined {
    if (key === SETTINGS_KEY || !this.data) return undefined;
    const { kind, id } = parseKey(key);
    return recordsOf(this.data, kind).find(r => r.id === id);
  }

  private labelFor(key: string): string {
    if (key === SETTINGS_KEY) return "Settings";
    const record = this.recordFor(key);
    return record ? recordLabel(record) : "A deleted record";
  }

  private markSaved() {
    this.lastSavedAt = this.now();
  }

  private async push(key: string): Promise<boolean> {
    if (key === SETTINGS_KEY) return this.pushSettings();
    const { id } = parseKey(key);
    const record = this.recordFor(key);
    if (!record) {
      await this.repo.deleteDocument(id);
      if (!this.recordFor(key)) {
        this.dirty.delete(key);
        this.versions.delete(key);
      }
      this.markSaved();
      return true;
    }
    const row = recordToRow(record);
    const version = this.versions.get(key);
    let saved: DocRow | null = null;
    if (version) {
      saved = await this.repo.updateDocument(row, version);
      if (!saved) return this.documentConflict(key, record, await this.repo.fetchDocument(id));
    } else {
      try {
        saved = await this.repo.insertDocument(row);
      } catch (error) {
        if (!(error instanceof RepoError) || error.code !== "duplicate-id") throw error;
        return this.documentConflict(key, record, await this.repo.fetchDocument(id));
      }
    }
    this.versions.set(key, saved.updated_at);
    if (this.recordFor(key) === record) this.dirty.delete(key);
    this.markSaved();
    return true;
  }

  /** The save was refused because the row changed or vanished. Decide whether that's a real conflict. */
  private async documentConflict(key: string, local: AdminRecord, remoteRow: DocRow | null): Promise<boolean> {
    if (!remoteRow && !(await this.repo.hasSession())) throw new RepoError("signed-out", "Signed out");
    const remote = remoteRow ? rowToRecord(remoteRow, this.data!.settings, this.now()) : null;
    if (remote && remoteRow && same(remote, local)) {
      // Our earlier save reached the server but its reply was lost.
      this.versions.set(key, remoteRow.updated_at);
      if (this.recordFor(key) === local) this.dirty.delete(key);
      this.markSaved();
      return true;
    }
    this.conflicts.set(key, {
      key,
      label: recordLabel(local),
      reason: remote ? "changed" : "deleted",
      remote,
      remoteVersion: remoteRow?.updated_at ?? null,
    });
    return false;
  }

  private async pushSettings(): Promise<boolean> {
    const data = this.data!;
    const sent = { settings: data.settings, lastBackupAt: data.meta.lastBackupAt };
    const payload = settingsToPayload(data);
    let row = null;
    if (this.settingsVersion) {
      row = await this.repo.updateSettings(payload, this.settingsVersion);
    } else {
      try {
        row = await this.repo.insertSettings(payload);
      } catch (error) {
        if (!(error instanceof RepoError) || error.code !== "duplicate-id") throw error;
      }
    }
    if (!row) return this.settingsConflict();
    this.settingsVersion = row.updated_at;
    this.settingsBase = sent.settings;
    const current = this.data!;
    if (current.settings === sent.settings && current.meta.lastBackupAt === sent.lastBackupAt) this.dirty.delete(SETTINGS_KEY);
    this.markSaved();
    return true;
  }

  /** Settings changed on another device: merge field by field, and only ask when the same field differs. */
  private async settingsConflict(): Promise<boolean> {
    const remoteRow = await this.repo.loadSettings();
    if (!remoteRow) {
      if (!(await this.repo.hasSession())) throw new RepoError("signed-out", "Signed out");
      this.settingsVersion = null;
      return true;
    }
    const remote = payloadToSettings(remoteRow.payload);
    const local = this.data!;
    const merged = mergeSettings(this.settingsBase ?? remote.settings, local.settings, remote.settings);
    const lastBackupAt = [local.meta.lastBackupAt, remote.lastBackupAt].filter(Boolean).sort().pop() ?? null;
    if (merged.conflicts.length) {
      this.conflicts.set(SETTINGS_KEY, {
        key: SETTINGS_KEY,
        label: "Business settings",
        reason: "changed",
        remote,
        remoteVersion: remoteRow.updated_at,
      });
      return false;
    }
    this.settingsBase = remote.settings;
    this.settingsVersion = remoteRow.updated_at;
    this.data = { ...local, settings: merged.settings, meta: { ...local.meta, lastBackupAt } };
    this.emit();
    return true;
  }

  /** Pulls changes made on other devices. Records with unsaved local edits are left alone. */
  refresh(): Promise<void> {
    return this.run(async () => {
      if (!this.data) return;
      let rows: DocRow[];
      let settingsRow;
      try {
        [rows, settingsRow] = await Promise.all([this.repo.loadDocuments(), this.repo.loadSettings()]);
      } catch (error) {
        const err = toRepoError(error);
        if (err.code === "signed-out") {
          this.pushError = err;
          this.emit();
        }
        return;
      }
      const now = this.now();
      let data = this.data;
      let changed = false;
      const busy = (key: string) => this.dirty.has(key) || this.conflicts.has(key);

      if (settingsRow && settingsRow.updated_at !== this.settingsVersion && !busy(SETTINGS_KEY)) {
        const remote = payloadToSettings(settingsRow.payload);
        data = { ...data, settings: remote.settings, meta: { ...data.meta, lastBackupAt: remote.lastBackupAt } };
        this.settingsBase = remote.settings;
        this.settingsVersion = settingsRow.updated_at;
        changed = true;
      }

      for (const kind of kinds) {
        const remoteRows = rows.filter(r => r.kind === kind);
        const remoteIds = new Set(remoteRows.map(r => r.id));
        let records = recordsOf(data, kind);
        let kindChanged = false;
        for (const row of remoteRows) {
          const key = keyOf(kind, row.id);
          if (busy(key) || this.versions.get(key) === row.updated_at) continue;
          const record = rowToRecord(row, data.settings, now);
          const at = records.findIndex(r => r.id === row.id);
          records = at >= 0 ? records.map((r, i) => (i === at ? record : r)) : [record, ...records];
          this.versions.set(key, row.updated_at);
          kindChanged = true;
        }
        const kept = records.filter(r => {
          const key = keyOf(kind, r.id);
          const deletedElsewhere = !remoteIds.has(r.id) && this.versions.has(key) && !busy(key);
          if (deletedElsewhere) this.versions.delete(key);
          return !deletedElsewhere;
        });
        if (kept.length !== records.length) kindChanged = true;
        if (kindChanged) {
          data = withRecords(data, kind, kept);
          changed = true;
        }
      }

      if (changed) this.data = data;
      if (this.pushError?.code === "signed-out") this.pushError = null;
      this.emit();
    });
  }

  /** Keeps either this device's version or the other device's version of a conflicting record. */
  resolveConflict(key: string, choice: "mine" | "theirs") {
    const conflict = this.conflicts.get(key);
    if (!conflict || !this.data) return;
    this.conflicts.delete(key);
    if (key === SETTINGS_KEY) {
      const remote = conflict.remote as RemoteSettings | null;
      this.settingsVersion = conflict.remoteVersion;
      if (choice === "theirs" && remote) {
        this.data = { ...this.data, settings: remote.settings, meta: { ...this.data.meta, lastBackupAt: remote.lastBackupAt } };
        this.settingsBase = remote.settings;
        this.dirty.delete(key);
      } else {
        if (remote) this.settingsBase = remote.settings;
        this.markDirty(key);
      }
      this.emit();
      return;
    }
    const { kind, id } = parseKey(key);
    const remote = conflict.remote as AdminRecord | null;
    if (choice === "theirs") {
      const records = recordsOf(this.data, kind);
      const next = remote ? records.map(r => (r.id === id ? remote : r)) : records.filter(r => r.id !== id);
      this.data = withRecords(this.data, kind, next);
      if (conflict.remoteVersion) this.versions.set(key, conflict.remoteVersion);
      else this.versions.delete(key);
      this.dirty.delete(key);
    } else {
      if (conflict.remoteVersion) this.versions.set(key, conflict.remoteVersion);
      else this.versions.delete(key);
      this.markDirty(key);
    }
    this.emit();
  }

  /** Lets blocked records try again (for example after a temporary server fault). */
  retryBlocked() {
    this.blocked.clear();
    this.emit();
  }

  /** Reserves a quote or invoice number on the server. Never lower than the business's chosen next number. */
  allocateNumber(kind: "quote" | "invoice", min?: number): Promise<number> {
    const settings = this.data?.settings;
    const floor = min ?? (kind === "quote" ? settings?.nextQuoteNumber : settings?.nextInvoiceNumber) ?? 1;
    return this.repo.allocateNumber(kind, floor);
  }

  private persistence(): Persistence {
    if (this.pushError?.code === "signed-out") return "signed-out";
    if (this.conflicts.size) return "conflict";
    if (this.blocked.size) return "failed";
    if (this.dirty.size) return this.pushError?.code === "network" ? "offline" : "saving";
    return "saved";
  }

  private message(persistence: Persistence): string {
    switch (persistence) {
      case "signed-out":
        return "You've been signed out. Sign in again to save your changes.";
      case "conflict":
        return this.conflicts.size === 1
          ? "A record was changed on another device. Choose which version to keep."
          : `${this.conflicts.size} records were changed on another device. Choose which versions to keep.`;
      case "failed":
        return [...this.blocked.values()][0] ?? "";
      case "offline":
        return `No connection. ${this.dirty.size} unsaved change${this.dirty.size === 1 ? "" : "s"} will be saved when you're back online. Keep this page open.`;
      default:
        return "";
    }
  }

  private buildSnapshot(): SyncSnapshot {
    const persistence = this.persistence();
    return {
      phase: this.phase,
      data: this.data,
      persistence,
      message: this.message(persistence),
      conflicts: [...this.conflicts.values()],
      pending: this.dirty.size,
      loadError: this.loadError,
      lastSavedAt: this.lastSavedAt,
      settingsSaved: this.settingsVersion !== null,
    };
  }
}
