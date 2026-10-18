// Real, opt-in Auth diagnostics. Credentials, response bodies and session tokens
// stay in memory; only fixed stage/status summaries enter the Actions log.
const expectedOrigin = "https://fdctgtncawolrapwwevm.supabase.co";
const adminEmail = "mike@dmpaintingdecorating.co.uk";
const publicCodes = new Set(["invalid_credentials", "email_not_confirmed", "over_request_rate_limit", "over_email_send_rate_limit", "user_banned", "session_not_found", "bad_jwt", "email_provider_disabled"]);

function configuration() {
  let url;
  try { url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || ""); } catch { return null; }
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (process.env.E2E_RUN_LIVE !== "1" || url.origin !== expectedOrigin || url.pathname !== "/" || url.search || url.hash || url.username || url.password
    || typeof key !== "string" || !/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(key)
    || typeof password !== "string" || password.length < 8 || password.length > 200) return null;
  return { key, password };
}

class PreflightFailure extends Error {}

async function main() {
  const config = configuration();
  if (!config) {
    console.error("BLOCKED: Real Auth preflight requires explicit opt-in, the approved Supabase project, a public key and the private website password. No credentials were sent.");
    process.exitCode = 1;
    return;
  }

  const request = (path, { token, body } = {}) => fetch(expectedOrigin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { apikey: config.key, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  let accessToken = "";
  let passed = false;
  try {
    const login = await request("/auth/v1/token?grant_type=password", { body: { email: adminEmail, password: config.password } });
    const session = await login.json().catch(() => null);
    if (!login.ok) {
      const suppliedCode = session?.error_code || session?.code;
      const code = publicCodes.has(suppliedCode) ? suppliedCode : "unexpected_auth_error";
      throw new PreflightFailure(`FAIL: Direct Supabase login returned HTTP ${login.status} (${code}). Browser tests have not started.`);
    }
    accessToken = typeof session?.access_token === "string" ? session.access_token : "";
    if (!accessToken) throw new PreflightFailure("FAIL: Supabase login returned no usable test session.");
    const identityResponse = await request("/auth/v1/user", { token: accessToken });
    const identity = await identityResponse.json().catch(() => null);
    if (!identityResponse.ok || identity?.email?.toLowerCase() !== adminEmail || !identity.email_confirmed_at) {
      throw new PreflightFailure("FAIL: The real Auth session did not verify Mike's confirmed identity.");
    }
    const membership = await request("/rest/v1/rpc/dm_admin_is_member", { token: accessToken, body: {} });
    if (!membership.ok || await membership.json().catch(() => null) !== true) {
      throw new PreflightFailure("FAIL: Direct login succeeded, but the live session was not authorised by the admin RPC.");
    }
    passed = true;
  } catch (error) {
    console.error(error instanceof PreflightFailure ? error.message : "FAIL: The direct Auth preflight could not complete. No transport or response details are logged.");
  } finally {
    if (accessToken) {
      try {
        const logout = await request("/auth/v1/logout?scope=local", { token: accessToken, body: {} });
        if (!logout.ok) throw new Error("logout");
        const replay = await request("/rest/v1/rpc/dm_admin_is_member", { token: accessToken, body: {} });
        const denied = [401, 403].includes(replay.status) || replay.ok && await replay.json().catch(() => null) === false;
        if (!denied) throw new Error("revocation");
      } catch {
        passed = false;
        console.error("FAIL: Revocation of the preflight's own test session could not be confirmed. Stop before another live run.");
      }
      accessToken = "";
    }
  }
  if (passed) console.log("PASS: Direct Supabase login, confirmed admin membership and revocation of the test session. Browser workflow verification is still required.");
  else process.exitCode = 1;
}

await main().catch(() => {
  console.error("FAIL: Auth preflight could not finish. No credential or response details are reported.");
  process.exitCode = 1;
});
