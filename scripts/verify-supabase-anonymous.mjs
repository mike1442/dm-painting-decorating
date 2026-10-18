import { randomBytes } from "node:crypto";

// This verifier has no admin credentials, cookies, valid document IDs, or valid
// write payloads. It checks the real REST boundary of the authorised project.
const expectedOrigin = "https://fdctgtncawolrapwwevm.supabase.co";
const requestTimeoutMs = 15_000;

function configuration() {
  let url;
  try { url = new URL(process.env.SUPABASE_SECURITY_URL || expectedOrigin); }
  catch { return null; }
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (url.origin !== expectedOrigin || url.pathname !== "/" || url.search || url.hash || url.username || url.password
    || typeof key !== "string" || !/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(key)) return null;
  return { origin: url.origin, key };
}

const checks = [
  ...["admin_documents", "admin_settings", "admin_members", "admin_sequences"].map(table => ({
    label: `table ${table}`,
    // Even an accidental access grant cannot return customer rows to this probe.
    path: `/rest/v1/${table}?select=*&limit=0`,
  })),
  { label: "RPC dm_admin_is_member", path: "/rest/v1/rpc/dm_admin_is_member", body: {} },
  { label: "RPC dm_get_data", path: "/rest/v1/rpc/dm_get_data", body: {} },
  // Reviewed signatures in supabase/production-admin.sql. These intentionally
  // invalid inputs cannot modify data even if an execute grant regresses:
  // save rejects null data/negative revision before its first write; SQL NULL
  // cannot equal a document ID in either share routine.
  { label: "RPC dm_save_data", path: "/rest/v1/rpc/dm_save_data", body: { p_data: null, p_revision: -1 } },
  { label: "RPC dm_create_share", path: "/rest/v1/rpc/dm_create_share", body: { p_id: null } },
  { label: "RPC dm_revoke_share", path: "/rest/v1/rpc/dm_revoke_share", body: { p_id: null } },
  {
    label: "RPC dm_get_shared_document unknown token",
    path: "/rest/v1/rpc/dm_get_shared_document",
    // No customer token is obtained or supplied, and the value is never logged.
    body: { p_token: randomBytes(32).toString("hex") },
    publicNull: true,
  },
];

async function hasNullBody(response) {
  if (!response.body) return false;
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      // Reject an unexpected document response without reading/storing its data.
      if (length > 32) return false;
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8").trim() === "null";
  } finally {
    try { await reader.cancel(); } catch { /* No response or error body is logged. */ }
  }
}

async function verify(check, config) {
  let response;
  try {
    response = await fetch(`${config.origin}${check.path}`, {
      method: check.body === undefined ? "GET" : "POST",
      headers: {
        apikey: config.key,
        Accept: "application/json",
        ...(check.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(check.body === undefined ? {} : { body: JSON.stringify(check.body) }),
      // Refuse redirects so the public API key is never forwarded elsewhere.
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    const passed = check.publicNull
      ? response.status === 200 && await hasNullBody(response)
      : [401, 403].includes(response.status);
    console.log(`${passed ? "PASS" : "FAIL"} ${check.label}: HTTP ${response.status}${check.publicNull ? passed ? " (null)" : " (expected null)" : " (expected 401/403)"}`);
    return passed;
  } catch {
    // Fetch errors may contain URLs, headers or response data. Never print them.
    console.error(`FAIL ${check.label}: HTTP unavailable or verification timed out.`);
    return false;
  } finally {
    try { await response?.body?.cancel(); } catch { /* Already consumed or cancelled. */ }
  }
}

async function main() {
  const config = configuration();
  if (!config) {
    console.error("BLOCKED: Anonymous verification requires the approved Supabase origin and a public publishable key. No request was made.");
    process.exitCode = 1;
    return;
  }
  let passed = 0;
  for (const check of checks) if (await verify(check, config)) passed += 1;
  console.log(`Anonymous REST boundary checks: ${passed}/${checks.length} passed. Admin authentication and customer workflows were not tested.`);
  if (passed !== checks.length) process.exitCode = 1;
}

await main().catch(() => {
  console.error("FAIL: Anonymous REST verification could not finish. No response data is reported.");
  process.exitCode = 1;
});
