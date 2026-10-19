import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ACCESS_COOKIE, adminSecurityHeaders, sameOrigin } from "../admin/auth";
import { PhotoError } from "./photo-error";
import { BackendError, verifyAdmin } from "./supabase";
export function json(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: adminSecurityHeaders }); }
export async function requireAdmin(request?: Request) {
  if (request && !sameOrigin(request)) throw new BackendError(403, "origin");
  const token = (await cookies()).get(ACCESS_COOKIE)?.value ?? "";
  if (!await verifyAdmin(token)) throw new BackendError(401, "auth");
  return token;
}
export function failure(error: unknown) {
  if (error instanceof BackendError) {
    if (error.code === "40001" || error.code === "stale" || error.status === 409) return json({ error: "Another device changed these records. Export your edits and reload before saving." }, 409);
    if (error.status === 401 || error.status === 403 || error.code === "42501") return json({ error: "Please sign in as the administrator." }, error.status === 403 ? 403 : 401);
    if (error.code === "configuration") return json({ error: error.message }, 503);
    if (error.status === 429) return json({ error: "The service is busy. Wait a moment and retry. Your unsaved changes have been kept." }, 429);
    if (error.status < 500) return json({ error: "The records could not be saved. Check the document values and try again." }, 400);
  }
  return json({ error: "The service is temporarily unavailable. Your unsaved changes have been kept." }, 503);
}
export async function readBody(request: Request, limit = 3_000_000) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new BackendError(400, "content-type");
  const content = await request.text();
  if (content.length > limit) throw new BackendError(413, "size");
  try { return JSON.parse(content); } catch { throw new BackendError(400, "json"); }
}
/** Photo library answers: Mike sees what went wrong with his photo, never internal details. */
export function photoFailure(error: unknown) {
  if (error instanceof PhotoError) return json({ error: error.message }, error.status);
  if (error instanceof BackendError) {
    // The migration (supabase/site-photos.sql) has not been applied to this project yet.
    if (["PGRST202", "42883", "NoSuchBucket"].includes(error.code)) return json({ error: "Photo storage has not been switched on yet. The rest of the admin works as normal.", setup: true }, 503);
    if (error.code === "P0002" || (error.status === 404 && error.code !== "configuration")) return json({ error: "This photo no longer exists. Reload the page." }, 404);
    if (error.status === 413) return json({ error: "This photo is too large. Please choose a smaller photo." }, 413);
    if (error.status === 400 || error.status === 409 || error.status === 415 || error.status === 422) return json({ error: "The photo could not be saved. Check its details and try again." }, 400);
  }
  return failure(error);
}
