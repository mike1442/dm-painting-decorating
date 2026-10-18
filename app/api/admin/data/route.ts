import { normaliseAdminData } from "@/lib/admin/normalise";
import { validFinancialRecords } from "@/lib/admin/validation";
import { adminRpc, BackendError } from "@/lib/server/supabase";
import { failure, json, readBody, requireAdmin } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const result = await adminRpc(await requireAdmin(), "dm_get_data");
    return json({ ...result, data: normaliseAdminData(result.data, new Date().toISOString()) });
  } catch (error) { return failure(error); }
}
export async function PUT(request: Request) {
  try {
    const token = await requireAdmin(request);
    const body = await readBody(request);
    if (!Number.isSafeInteger(body?.revision) || body.revision < 0 || !body.data || ![body.data.quotes, body.data.invoices, body.data.bookings].every(Array.isArray) || !body.data.settings || body.data.quotes.length + body.data.invoices.length + body.data.bookings.length > 10000) throw new BackendError(400, "shape");
    const data = normaliseAdminData(body.data, new Date().toISOString());
    if (!validFinancialRecords(data)) throw new BackendError(400, "amount");
    // Give stale browsers a deterministic conflict response before attempting a
    // write. The database revision lock remains the authoritative race guard.
    const current = await adminRpc(token, "dm_get_data");
    if (!Number.isSafeInteger(current?.revision)) throw new BackendError(503, "response");
    if (current.revision !== body.revision) throw new BackendError(409, "stale");
    const result = await adminRpc(token, "dm_save_data", { p_data: data, p_revision: body.revision });
    return json({ ...result, data: normaliseAdminData(result.data, new Date().toISOString()) });
  } catch (error) { return failure(error); }
}
