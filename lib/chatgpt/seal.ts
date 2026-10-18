import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { integrationKeys } from "./config.ts";

// Every value handed to ChatGPT or the browser during the connection flow is
// sealed with AES-256-GCM under a server-only key. Each kind has its own prefix
// and authenticated context, so an authorization code can never be replayed as
// an access token, nor a refresh token presented to the tools. Nothing is
// stored: Supabase remains the only database and the only session authority.

export type SealedKind = "client" | "request" | "code" | "access" | "refresh";
const PREFIX: Record<SealedKind, string> = { client: "dmcl_", request: "dmrq_", code: "dmac_", access: "dmat_", refresh: "dmrt_" };
const MAX_SEALED_LENGTH = 8000;

export function seal(kind: SealedKind, payload: Record<string, unknown>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", integrationKeys().seal, iv);
  cipher.setAAD(Buffer.from(`dm-chatgpt:${kind}`));
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return PREFIX[kind] + Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
}

/** The payload, or null when the value is not an intact, unexpired value of this kind. */
export function unseal<T extends Record<string, unknown>>(kind: SealedKind, value: unknown, nowSeconds = Math.floor(Date.now() / 1000)): T | null {
  if (typeof value !== "string" || !value.startsWith(PREFIX[kind]) || value.length > MAX_SEALED_LENGTH) return null;
  const raw = Buffer.from(value.slice(PREFIX[kind].length), "base64url");
  if (raw.length < 12 + 16 + 2) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", integrationKeys().seal, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(`dm-chatgpt:${kind}`));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    const text = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8");
    const payload: unknown = JSON.parse(text);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const exp = (payload as { exp?: unknown }).exp;
    if (exp !== undefined && (typeof exp !== "number" || exp <= nowSeconds)) return null;
    return payload as T;
  } catch { return null; }
}

export function mac(purpose: string, ...parts: string[]): string {
  return createHmac("sha256", integrationKeys().mac).update([purpose, ...parts].join("\u0000")).digest("base64url");
}

export function sameSecret(given: unknown, expected: string): boolean {
  if (typeof given !== "string") return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b) && given.length === expected.length;
}

export const randomId = (bytes = 16) => randomBytes(bytes).toString("base64url");
export const sha256 = (value: string) => createHash("sha256").update(value).digest("base64url");
