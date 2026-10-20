import { documentTotals } from "../admin/money.ts";
import { normaliseAdminData, normaliseLines, normaliseVat } from "../admin/normalise.ts";
import { validFinancialRecords } from "../admin/validation.ts";
import type { AdminData, Invoice, Quote } from "../admin/types.ts";
import { adminRpc, BackendError, publicRpc } from "../server/supabase.ts";

// The same storage path as the admin's own browser: read every record with
// dm_get_data, apply one of the shared pure operations, and save the complete
// set with dm_save_data under its revision lock, which allocates the canonical
// document numbers. All calls run as Mike's own ChatGPT session.

export type Snapshot = { data: AdminData; revision: number };

/** Supabase no longer accepts the session: ChatGPT must refresh or reconnect. */
export class AuthRequired extends Error {}
/** A failure Mike should hear about in plain words. `data` adds facts ChatGPT may relay, e.g. an unverified save. */
export class ToolError extends Error {
  data: Record<string, unknown>;
  constructor(message: string, data: Record<string, unknown> = {}) { super(message); this.data = data; }
}

const SAVE_ATTEMPTS = 3;

function translate(error: unknown): never {
  if (error instanceof BackendError && (error.status === 401 || error.status === 403 || error.code === "42501")) throw new AuthRequired();
  throw error;
}

export async function readRecords(token: string): Promise<Snapshot> {
  let result: { data?: unknown; revision?: unknown } | null;
  try { result = await adminRpc(token, "dm_get_data"); } catch (error) { translate(error); }
  if (!result || !result.data || typeof result.data !== "object" || !Number.isSafeInteger(result.revision) || Number(result.revision) < 0) {
    throw new BackendError(502, "response");
  }
  return { data: normaliseAdminData(result.data, new Date().toISOString()), revision: Number(result.revision) };
}

const conflict = (error: unknown) => error instanceof BackendError && (error.code === "40001" || error.status === 409);
/** The request may or may not have reached the database. */
const uncertain = (error: unknown) => !(error instanceof BackendError) || error.status >= 500 || error.status === 429;

/**
 * Applies `change` to the latest records and saves them. `change` must be pure
 * and must recognise its own earlier result (stable IDs, duplicate checks), so
 * it can safely run again after another device saved first, or after a write
 * whose answer was lost. It returns no `data` when nothing needs saving.
 *
 * `proposed` is the last complete set this call sent that may have been saved
 * (null if none), so the caller can check what it reads back against it.
 */
export async function changeRecords<T>(token: string, change: (data: AdminData) => { data?: AdminData; result: T }): Promise<{ result: T; records: AdminData; proposed: AdminData | null }> {
  // A write refused for a newer revision was not applied; one without an answer may have been.
  let proposed: AdminData | null = null;
  for (let attempt = 1; ; attempt += 1) {
    const current = await readRecords(token);
    const { data, result } = change(current.data);
    if (!data || data === current.data) return { result, records: current.data, proposed };
    if (!validFinancialRecords(data)) throw new ToolError("A quantity or price is not a valid amount. Nothing was saved.");
    try {
      const saved = await adminRpc(token, "dm_save_data", { p_data: data, p_revision: current.revision });
      if (!saved?.data) throw new BackendError(502, "response");
      return { result, records: normaliseAdminData(saved.data, new Date().toISOString()), proposed: data };
    } catch (error) {
      if (error instanceof BackendError && (error.status === 401 || error.status === 403 || error.code === "42501")) throw new AuthRequired();
      if (uncertain(error)) proposed = data;
      if (attempt < SAVE_ATTEMPTS && (conflict(error) || uncertain(error))) {
        console.warn(`ChatGPT save ${conflict(error) ? "met a newer revision" : "had no answer"}; re-reading (attempt ${attempt})`);
        continue;
      }
      if (conflict(error)) {
        throw new ToolError(proposed
          ? "The records were being changed on another device at the same moment, and an earlier attempt had no answer, so this change may or may not have been saved. Check with the matching get_ or list_ tool before trying again."
          : "The records were being changed on another device at the same moment. Nothing was saved; please try again.");
      }
      throw error;
    }
  }
}

/** Reads the records again after a save, so the answer reflects what Supabase now holds. */
export async function readBack(token: string): Promise<AdminData> {
  return (await readRecords(token)).data;
}

/** A new link replaces any earlier one for the same document. Returns the full customer URL. */
export async function createShare(token: string, id: string, origin: string): Promise<string> {
  let secret: unknown;
  try { secret = await adminRpc(token, "dm_create_share", { p_id: id }); } catch (error) { translate(error); }
  if (typeof secret !== "string" || !/^[a-f0-9]{64}$/.test(secret)) throw new BackendError(502, "share");
  return `${origin}/d/${secret}`;
}

export async function revokeShare(token: string, id: string): Promise<void> {
  try { await adminRpc(token, "dm_revoke_share", { p_id: id }); } catch (error) { translate(error); }
}

/**
 * Opens a customer link the way the customer's page does (anonymously, through
 * dm_get_shared_document) and checks that it shows this document with this
 * total. Only a link that passes is ever given to Mike.
 */
export async function linkOpens(url: string, doc: Quote | Invoice): Promise<boolean> {
  const token = /\/d\/([a-f0-9]{64})$/.exec(url)?.[1];
  if (!token) return false;
  let shared: { document?: Record<string, unknown> } | null;
  try { shared = await publicRpc("dm_get_shared_document", { p_token: token }); }
  catch { return false; }
  const shown = shared?.document;
  if (!shown || shown.kind !== doc.kind || shown.number !== doc.number) return false;
  const totals = documentTotals({ works: normaliseLines(shown.works), materials: normaliseLines(shown.materials), vat: normaliseVat(shown.vat, { enabled: false, rate: 0 }) });
  return totals.totalPence === documentTotals(doc).totalPence;
}
