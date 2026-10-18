"use client";
import { useSyncExternalStore } from "react";
import { getAdminState, subscribeAdminState } from "./cloud-store.ts";
import type { AdminState } from "./cloud-store.ts";

export * from "./cloud-store.ts";

/** Null on the server; cloud data is loaded once the client subscribes. */
export function useAdminState(): AdminState | null {
  return useSyncExternalStore(subscribeAdminState, getAdminState, () => null);
}
