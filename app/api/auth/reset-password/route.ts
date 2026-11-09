import { sameOrigin } from "@/lib/admin/auth";
import { BackendError, supabaseRequest, verifyAdmin } from "@/lib/server/supabase";
import { failure, json, readBody } from "@/lib/server/http";

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
    const body = await readBody(request, 6000);
    if (typeof body?.accessToken !== "string" || body.accessToken.length < 20 || body.accessToken.length > 4000 ||
        typeof body?.password !== "string" || body.password.length < 12 || body.password.length > 200) {
      return json({ error: "Use a new password of at least 12 characters." }, 400);
    }
    if (!(await verifyAdmin(body.accessToken))) {
      return json({ error: "This recovery link is invalid, expired or not authorised." }, 403);
    }
    await supabaseRequest("/auth/v1/user", {
      token: body.accessToken, method: "PUT", body: { password: body.password }, retryable: false,
    });
    return json({ ok: true });
  } catch (error) {
    if (error instanceof BackendError && error.status < 500) {
      return json({ error: error.status === 429 ? "Too many requests. Try again later." : "Could not update the password. Request a new reset link." }, error.status === 429 ? 429 : 400);
    }
    return failure(error);
  }
}
