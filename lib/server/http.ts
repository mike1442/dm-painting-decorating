import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ACCESS_COOKIE, adminSecurityHeaders, sameOrigin } from "../admin/auth";
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
