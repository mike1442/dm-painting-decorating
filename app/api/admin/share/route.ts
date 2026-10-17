import { adminRpc, BackendError } from "@/lib/server/supabase";
import { failure, json, readBody, requireAdmin } from "@/lib/server/http";
export async function POST(request: Request) {
  try {
    const token = await requireAdmin(request);
    const body = await readBody(request, 1000);
    if (typeof body?.id !== "string" || !/^[\w-]{6,64}$/.test(body.id) || !["create", "revoke"].includes(body.action)) throw new BackendError(400, "shape");
    if (body.action === "revoke") { await adminRpc(token, "dm_revoke_share", { p_id: body.id }); return json({}); }
    const secret = await adminRpc(token, "dm_create_share", { p_id: body.id });
    if (typeof secret !== "string" || !/^[a-f0-9]{64}$/.test(secret)) throw new BackendError(503, "share");
    return json({ url: `${new URL(request.url).origin}/d/${secret}` });
  } catch (error) { return failure(error); }
}
