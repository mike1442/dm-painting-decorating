import { hkdfSync } from "node:crypto";

// Configuration for Mike's private ChatGPT connection. The connection is off
// unless the deployment holds DM_CHATGPT_SECRET, a random server-only value
// that seals every token handed to ChatGPT. Rotating it disconnects ChatGPT.

export const MCP_PATH = "/api/mcp";
export const ACTIONS_PATH = "/api/chatgpt";
export const AUTHORIZE_PATH = "/oauth/authorize";
export const TOKEN_PATH = "/api/oauth/token";
export const REGISTER_PATH = "/api/oauth/register";
export const REVOKE_PATH = "/api/oauth/revoke";

export type Scope = "dm:read" | "dm:write" | "dm:delete";
export const ALL_SCOPES: Scope[] = ["dm:read", "dm:write", "dm:delete"];
export const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
  "dm:read": "Read quotes, invoices, the diary and business settings",
  "dm:write": "Create and update quotes, invoices, payments, diary bookings and customer links",
  "dm:delete": "Delete records and revoke customer links (ChatGPT asks you to confirm each one)",
};
export const isScope = (value: unknown): value is Scope => ALL_SCOPES.includes(value as Scope);

/** Fixed client for a Custom GPT, which cannot register itself. Its secret is derived, never stored. */
export const CUSTOM_GPT_CLIENT_ID = "dm-custom-gpt";

/**
 * Authorization codes are only ever delivered to OpenAI's own ChatGPT hosts.
 * A client registered with any other redirect is refused, so a sign-in page
 * opened from elsewhere can never hand Mike's access to a third party.
 */
const REDIRECT_HOSTS = new Set(["chatgpt.com", "chat.openai.com", "platform.openai.com"]);
export function allowedRedirect(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > 500) return false;
  try {
    const url = new URL(uri);
    return url.protocol === "https:" && REDIRECT_HOSTS.has(url.hostname) && !url.port && !url.username && !url.password && !url.hash;
  } catch { return false; }
}
/** A Custom GPT's callback, e.g. https://chatgpt.com/aip/g-abc123/oauth/callback. */
export const customGptRedirect = (uri: unknown): uri is string =>
  allowedRedirect(uri) && /^\/aip\/[A-Za-z0-9_-]{1,100}\/oauth\/callback$/.test(new URL(uri).pathname);

/** Lifetimes in seconds. Access tokens never outlive the Supabase JWT they carry. */
export const CODE_LIFETIME = 120;
export const REQUEST_LIFETIME = 15 * 60;
export const CONFIRMATION_LIFETIME = 10 * 60;
/** Mike re-approves the connection at least this often. */
export const GRANT_LIFETIME = 90 * 24 * 60 * 60;

export class IntegrationDisabled extends Error {
  constructor() { super("The ChatGPT connection is not configured on this website."); }
}

export type Keys = { seal: Buffer; mac: Buffer };
let cache: { secret: string; keys: Keys } | null = null;

export function integrationKeys(): Keys {
  const secret = process.env.DM_CHATGPT_SECRET?.trim() ?? "";
  // At least 32 characters of a random value (e.g. `openssl rand -base64 48`).
  if (secret.length < 32 || new Set(secret).size < 10) throw new IntegrationDisabled();
  if (cache?.secret !== secret) {
    const derive = (info: string) => Buffer.from(hkdfSync("sha256", secret, "dm-chatgpt-v1", info, 32));
    cache = { secret, keys: { seal: derive("seal"), mac: derive("mac") } };
  }
  return cache.keys;
}

export function integrationConfigured(): boolean {
  try { integrationKeys(); return true; } catch { return false; }
}

export const originOf = (request: Request) => new URL(request.url).origin;
/** The URLs a token may be presented to. Both endpoints expose the same tools. */
export const resourcesFor = (origin: string) => [`${origin}${MCP_PATH}`, `${origin}${ACTIONS_PATH}`];
