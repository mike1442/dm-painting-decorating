import { RepoError } from "../../lib/admin/repository.ts";
import type { AdminRepository, RepoErrorCode } from "../../lib/admin/repository.ts";
import type { DocRow, DocWrite, SettingsPayload, SettingsRow } from "../../lib/admin/remote.ts";

// An in-memory stand-in for the Supabase tables with the same rules as the
// real database: rows belong to one owner, numbers are unique per owner and kind,
// updates need the current updated_at, and counters are atomic.

type StoredDoc = DocRow & { owner_id: string };

/** Mimics jsonb: a fresh copy with keys in a different order from what was sent. */
function asJsonb<T>(value: T): T {
  const reorder = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(reorder);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).reverse().map(([k, x]) => [k, reorder(x)]));
    }
    return v;
  };
  return reorder(JSON.parse(JSON.stringify(value))) as T;
}

export class FakeServer {
  docs = new Map<string, StoredDoc>();
  settings = new Map<string, SettingsRow>();
  counters = new Map<string, number>();
  members = new Set<string>();
  offline = false;
  private tick = Date.parse("2026-10-17T10:00:00.000Z");

  version(): string {
    this.tick += 1;
    return new Date(this.tick).toISOString();
  }

  device(owner: string): FakeRepository {
    return new FakeRepository(this, owner);
  }

  docsOf(owner: string): StoredDoc[] {
    return [...this.docs.values()].filter(d => d.owner_id === owner);
  }
}

export class FakeRepository implements AdminRepository {
  signedIn = true;
  /** Fails the next call with this error. */
  failNext: RepoErrorCode | null = null;
  /** Saves the next insert, then pretends the reply never arrived. */
  loseNextReply = false;
  private readonly server: FakeServer;
  private readonly owner: string;

  constructor(server: FakeServer, owner: string) {
    this.server = server;
    this.owner = owner;
  }

  private async gate(write = false) {
    await Promise.resolve();
    if (this.server.offline) throw new RepoError("network", "offline");
    if (!this.signedIn) throw new RepoError("signed-out", "no session");
    if (this.failNext) {
      const code = this.failNext;
      this.failNext = null;
      throw new RepoError(code, `injected ${code}`);
    }
    if (write && !this.server.members.has(this.owner)) throw new RepoError("forbidden", "row-level security");
  }

  private visible(): boolean {
    return this.server.members.has(this.owner);
  }

  private row(doc: StoredDoc): DocRow {
    const { owner_id: _owner, ...row } = doc;
    return asJsonb(row);
  }

  private numberTaken(row: DocWrite): boolean {
    return (
      row.document_number !== null &&
      this.server.docsOf(this.owner).some(d => d.id !== row.id && d.kind === row.kind && d.document_number === row.document_number)
    );
  }

  async loadDocuments() {
    await this.gate();
    return this.visible() ? this.server.docsOf(this.owner).map(d => this.row(d)) : [];
  }

  async loadSettings() {
    await this.gate();
    const row = this.visible() ? this.server.settings.get(this.owner) : undefined;
    return row ? asJsonb(row) : null;
  }

  async fetchDocument(id: string) {
    await this.gate();
    const doc = this.server.docs.get(id);
    return doc && doc.owner_id === this.owner && this.visible() ? this.row(doc) : null;
  }

  async insertDocument(row: DocWrite) {
    await this.gate(true);
    if (this.server.docs.has(row.id)) throw new RepoError("duplicate-id", "duplicate key");
    if (this.numberTaken(row)) throw new RepoError("duplicate-number", "duplicate number");
    const stored: StoredDoc = { ...asJsonb(row), owner_id: this.owner, updated_at: this.server.version() };
    this.server.docs.set(row.id, stored);
    if (this.loseNextReply) {
      this.loseNextReply = false;
      throw new RepoError("network", "reply lost");
    }
    return this.row(stored);
  }

  async updateDocument(row: DocWrite, version: string) {
    await this.gate(true);
    const current = this.server.docs.get(row.id);
    if (!current || current.owner_id !== this.owner || current.updated_at !== version) return null;
    if (this.numberTaken(row)) throw new RepoError("duplicate-number", "duplicate number");
    const stored: StoredDoc = {
      ...current,
      document_number: row.document_number,
      payload: asJsonb(row.payload),
      updated_at: this.server.version(),
    };
    this.server.docs.set(row.id, stored);
    return this.row(stored);
  }

  async deleteDocument(id: string) {
    await this.gate(true);
    const current = this.server.docs.get(id);
    if (current && current.owner_id === this.owner) this.server.docs.delete(id);
  }

  async insertSettings(payload: SettingsPayload) {
    await this.gate(true);
    if (this.server.settings.has(this.owner)) throw new RepoError("duplicate-id", "duplicate key");
    const row = { payload: asJsonb(payload), updated_at: this.server.version() };
    this.server.settings.set(this.owner, row);
    return asJsonb(row);
  }

  async updateSettings(payload: SettingsPayload, version: string) {
    await this.gate(true);
    const current = this.server.settings.get(this.owner);
    if (!current || current.updated_at !== version) return null;
    const row = { payload: asJsonb(payload), updated_at: this.server.version() };
    this.server.settings.set(this.owner, row);
    return asJsonb(row);
  }

  async allocateNumber(kind: "quote" | "invoice", min: number) {
    await this.gate(true);
    const key = `${this.owner}:${kind}`;
    const n = Math.max(this.server.counters.get(key) ?? 1, Math.max(min, 1));
    this.server.counters.set(key, n + 1);
    return n;
  }

  async sequenceState() {
    await this.gate();
    return {
      quote: this.server.counters.get(`${this.owner}:quote`) ?? 1,
      invoice: this.server.counters.get(`${this.owner}:invoice`) ?? 1,
    };
  }

  async hasSession() {
    return this.signedIn;
  }
}
