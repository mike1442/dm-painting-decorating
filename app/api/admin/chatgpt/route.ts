import { ACTIONS_PATH, ALL_SCOPES, AUTHORIZE_PATH, CUSTOM_GPT_CLIENT_ID, MCP_PATH, TOKEN_PATH, integrationConfigured } from "@/lib/chatgpt/config";
import { clientSecret } from "@/lib/chatgpt/oauth";
import { BackendError, supabaseRequest } from "@/lib/server/supabase";
import { failure, json, readBody, requireAdmin } from "@/lib/server/http";
export const dynamic = "force-dynamic";

/** Connection details for Settings → ChatGPT. Only Mike's signed-in admin can read them. */
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const origin = new URL(request.url).origin;
    const configured = integrationConfigured();
    return json({
      configured,
      connectorUrl: `${origin}${MCP_PATH}`,
      customGpt: configured ? {
        openApiUrl: `${origin}${ACTIONS_PATH}/openapi.json`,
        authorizationUrl: `${origin}${AUTHORIZE_PATH}`,
        tokenUrl: `${origin}${TOKEN_PATH}`,
        clientId: CUSTOM_GPT_CLIENT_ID,
        clientSecret: clientSecret(CUSTOM_GPT_CLIENT_ID),
        scope: ALL_SCOPES.join(" "),
      } : null,
    });
  } catch (error) { return failure(error); }
}

/**
 * Ends every other Supabase session, including each ChatGPT connection, while
 * keeping this browser signed in. ChatGPT must then be reconnected and approved.
 */
export async function POST(request: Request) {
  try {
    const token = await requireAdmin(request);
    const body = await readBody(request, 1000);
    if (body?.action !== "disconnect") throw new BackendError(400, "shape");
    await supabaseRequest("/auth/v1/logout?scope=others", { token, method: "POST" });
    return json({ ok: true });
  } catch (error) { return failure(error); }
}
