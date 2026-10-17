"use client";
import { createContext, useContext } from "react";
import type { AdminUser } from "@/lib/admin/session";
import { saveNow, stopAdminStore } from "@/lib/admin/store";
import { browserSupabase } from "@/lib/supabase/client";

export const AdminUserContext = createContext<AdminUser | null>(null);

export function useAdminUser(): AdminUser | null {
  return useContext(AdminUserContext);
}

/** Saves what it can, then signs this device out (other devices stay signed in). */
export async function signOutOfAdmin() {
  const saved = await saveNow().catch(() => false);
  if (!saved && !window.confirm("Some changes haven't been saved yet. Sign out anyway and lose them?")) return;
  stopAdminStore();
  await browserSupabase()?.auth.signOut({ scope: "local" });
  window.location.assign("/admin/login?signed-out=1");
}
