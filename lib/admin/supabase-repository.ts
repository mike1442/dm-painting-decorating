import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyError, RepoError } from "./repository.ts";
import type { AdminRepository } from "./repository.ts";
import type { DocRow, DocWrite, SettingsPayload, SettingsRow } from "./remote.ts";

// The AdminRepository backed by Supabase. Row-level security in the database is
// what keeps each owner's records private; the owner filters here only keep
// queries on the right index.

const DOC_COLUMNS = "id, kind, document_number, payload, created_at, updated_at";
const SETTINGS_COLUMNS = "payload, updated_at";
const PAGE_SIZE = 500;

type Result<T> = { data: T | null; error: { message?: string; code?: string; details?: string | null } | null; status: number };

function check<T>(result: Result<T>): T | null {
  if (result.error) throw classifyError(result.error, result.status);
  return result.data;
}

export class SupabaseAdminRepository implements AdminRepository {
  private readonly client: SupabaseClient;
  private readonly ownerId: string;

  constructor(client: SupabaseClient, ownerId: string) {
    this.client = client;
    this.ownerId = ownerId;
  }

  /** Without a session every request would run as an anonymous visitor; stop before that. */
  private async requireSession() {
    const { data } = await this.client.auth.getSession();
    if (!data.session || data.session.user.id !== this.ownerId) throw new RepoError("signed-out", "No active session");
  }

  async hasSession() {
    const { data } = await this.client.auth.getSession();
    return !!data.session && data.session.user.id === this.ownerId;
  }

  async loadDocuments(): Promise<DocRow[]> {
    await this.requireSession();
    const rows: DocRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const page = check(
        await this.client
          .from("admin_documents")
          .select(DOC_COLUMNS)
          .eq("owner_id", this.ownerId)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, from + PAGE_SIZE - 1),
      ) as DocRow[] | null;
      rows.push(...(page ?? []));
      if (!page || page.length < PAGE_SIZE) return rows;
    }
  }

  async loadSettings(): Promise<SettingsRow | null> {
    await this.requireSession();
    return check(await this.client.from("admin_settings").select(SETTINGS_COLUMNS).eq("owner_id", this.ownerId).maybeSingle());
  }

  async fetchDocument(id: string): Promise<DocRow | null> {
    await this.requireSession();
    return check(await this.client.from("admin_documents").select(DOC_COLUMNS).eq("id", id).maybeSingle()) as DocRow | null;
  }

  async insertDocument(row: DocWrite): Promise<DocRow> {
    await this.requireSession();
    // updated_at is replaced by the database trigger; sending it keeps versioning
    // working even before that trigger is installed.
    const saved = check(
      await this.client
        .from("admin_documents")
        .insert({ ...row, owner_id: this.ownerId, updated_at: new Date().toISOString() })
        .select(DOC_COLUMNS)
        .single(),
    );
    if (!saved) throw new RepoError("unknown", "The server didn't return the saved document.");
    return saved as unknown as DocRow;
  }

  async updateDocument(row: DocWrite, version: string): Promise<DocRow | null> {
    await this.requireSession();
    const saved = check(
      await this.client
        .from("admin_documents")
        .update({ document_number: row.document_number, payload: row.payload, updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("updated_at", version)
        .select(DOC_COLUMNS),
    ) as DocRow[] | null;
    return saved?.[0] ?? null;
  }

  async deleteDocument(id: string): Promise<void> {
    await this.requireSession();
    check(await this.client.from("admin_documents").delete().eq("id", id));
  }

  async insertSettings(payload: SettingsPayload): Promise<SettingsRow> {
    await this.requireSession();
    const saved = check(
      await this.client
        .from("admin_settings")
        .insert({ owner_id: this.ownerId, payload, updated_at: new Date().toISOString() })
        .select(SETTINGS_COLUMNS)
        .single(),
    );
    if (!saved) throw new RepoError("unknown", "The server didn't return the saved settings.");
    return saved as unknown as SettingsRow;
  }

  async updateSettings(payload: SettingsPayload, version: string): Promise<SettingsRow | null> {
    await this.requireSession();
    const saved = check(
      await this.client
        .from("admin_settings")
        .update({ payload, updated_at: new Date().toISOString() })
        .eq("owner_id", this.ownerId)
        .eq("updated_at", version)
        .select(SETTINGS_COLUMNS),
    ) as SettingsRow[] | null;
    return saved?.[0] ?? null;
  }

  async allocateNumber(kind: "quote" | "invoice", min: number): Promise<number> {
    await this.requireSession();
    const n = check(await this.client.rpc("dm_admin_allocate_number", { p_kind: kind, p_min: Math.max(1, Math.floor(min)) }));
    if (typeof n !== "number") throw new RepoError("unknown", "The server didn't return a number.");
    return n;
  }

  async sequenceState(): Promise<{ quote: number; invoice: number }> {
    await this.requireSession();
    const state = check(await this.client.rpc("dm_admin_sequence_state")) as { quote?: number; invoice?: number } | null;
    return { quote: Number(state?.quote) || 1, invoice: Number(state?.invoice) || 1 };
  }
}
