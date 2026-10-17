"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithTimeout, supabaseConfig } from "./config";

let client: SupabaseClient | null = null;

/** The browser's Supabase client. Its session lives in cookies the server can read. */
export function browserSupabase(): SupabaseClient | null {
  if (client) return client;
  const config = supabaseConfig();
  if (!config) return null;
  client = createBrowserClient(config.url, config.key, { global: { fetch: fetchWithTimeout } });
  return client;
}
