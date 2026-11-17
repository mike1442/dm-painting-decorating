"use client";
import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

// Customer document links carry their access token in the path, and the admin
// and sign-in pages are private, so none of these are reported to Vercel.
const PRIVATE = /^\/(?:d|admin|login|reset-password|oauth)(?:\/|$)/;

export function isPrivatePath(url: string): boolean {
  try { return PRIVATE.test(new URL(url, "https://localhost").pathname); } catch { return true; }
}

function analyticsEvent(event: BeforeSendEvent) { return isPrivatePath(event.url) ? null : event; }
function speedEvent<T extends { url: string }>(event: T) { return isPrivatePath(event.url) ? null : event; }

export default function VercelInsights() {
  return <><Analytics beforeSend={analyticsEvent} /><SpeedInsights beforeSend={speedEvent} /></>;
}
