import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { fetchWithTimeout, supabaseConfig } from "./config";

/** Supabase client for server components, route handlers and server actions. */
export async function serverSupabase(): Promise<SupabaseClient | null> {
  const config = supabaseConfig();
  if (!config) return null;
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    global: { fetch: fetchWithTimeout },
    cookies: {
      getAll: () => store.getAll(),
      setAll: list => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Server components can't set cookies; middleware keeps the session fresh.
        }
      },
    },
  });
}
