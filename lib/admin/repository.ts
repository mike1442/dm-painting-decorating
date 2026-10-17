import type { DocKind, DocRow, DocWrite, SettingsPayload, SettingsRow } from "./remote.ts";

// What the sync engine needs from a backend. The app uses the Supabase
// implementation; tests use an in-memory one with the same rules.

export type RepoErrorCode =
  /** No connection, timeout or a temporary server problem: safe to retry. */
  | "network"
  /** The sign-in session has ended. */
  | "signed-out"
  /** Signed in, but not allowed (not an admin member, or row-level security refused). */
  | "forbidden"
  /** The document number is already used by another document. */
  | "duplicate-number"
  /** A row with this id already exists. */
  | "duplicate-id"
  /** Anything else; not retried automatically. */
  | "unknown";

export class RepoError extends Error {
  readonly code: RepoErrorCode;
  constructor(code: RepoErrorCode, message: string) {
    super(message);
    this.name = "RepoError";
    this.code = code;
  }
  get retryable() {
    return this.code === "network";
  }
}

export interface AdminRepository {
  loadDocuments(): Promise<DocRow[]>;
  loadSettings(): Promise<SettingsRow | null>;
  fetchDocument(id: string): Promise<DocRow | null>;
  insertDocument(row: DocWrite): Promise<DocRow>;
  /** Saves only if the row still has `version` as its updated_at; otherwise returns null. */
  updateDocument(row: DocWrite, version: string): Promise<DocRow | null>;
  deleteDocument(id: string): Promise<void>;
  insertSettings(payload: SettingsPayload): Promise<SettingsRow>;
  updateSettings(payload: SettingsPayload, version: string): Promise<SettingsRow | null>;
  /** Atomically reserves the next number, never lower than `min`. */
  allocateNumber(kind: Exclude<DocKind, "booking">, min: number): Promise<number>;
  sequenceState(): Promise<{ quote: number; invoice: number }>;
  /** Whether the sign-in session is still valid (used to tell "deleted elsewhere" from "signed out"). */
  hasSession(): Promise<boolean>;
}

export function errorMessage(error: unknown): string {
  if (error instanceof RepoError) {
    switch (error.code) {
      case "network":
        return "No connection to the server. Changes will be saved when the connection returns.";
      case "signed-out":
        return "You have been signed out. Sign in again to keep saving.";
      case "forbidden":
        return "This account isn't allowed to change D&M admin records.";
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

type PostgrestLikeError = { message?: string; code?: string; details?: string | null } | null | undefined;

/** Sorts a Supabase/PostgREST failure into what the app should do about it. */
export function classifyError(error: PostgrestLikeError, status: number): RepoError {
  const code = error?.code ?? "";
  const message = error?.message || "The server refused the request.";
  if (status === 0 || status === 408 || status === 429 || status >= 500) return new RepoError("network", message);
  if (status === 401 || code === "PGRST301" || code === "PGRST302" || code === "PGRST303") return new RepoError("signed-out", message);
  if (code === "42501" || status === 403) return new RepoError("forbidden", message);
  if (code === "23505") {
    const detail = `${message} ${error?.details ?? ""}`;
    return /document_number|owner_kind_number/.test(detail)
      ? new RepoError("duplicate-number", message)
      : new RepoError("duplicate-id", message);
  }
  return new RepoError("unknown", message);
}
