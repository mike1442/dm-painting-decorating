import { ADMIN_EMAIL, sameOrigin } from "@/lib/admin/auth";
import { BackendError, supabaseRequest } from "@/lib/server/supabase";
import { failure, json, readBody } from "@/lib/server/http";

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
    const body = await readBody(request, 1000);
    if (typeof body?.email !== "string" || body.email.trim().toLowerCase() !== ADMIN_EMAIL) {
      return json({ error: "Enter the registered admin email address." }, 400);
    }
    const redirectTo = new URL("/reset-password", request.url).toString();
    await supabaseRequest(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: "POST", body: { email: ADMIN_EMAIL }, retryable: false,
    });
    return json({ ok: true, message: "If the admin account is available, a password reset email will be sent." });
  } catch (error) {
    if (error instanceof BackendError && error.status === 429) {
      return json({ error: "Too many requests. Please wait before requesting another email." }, 429);
    }
    return failure(error);
  }
}
