import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../scripts/verify-supabase-login.mjs", import.meta.url));
const origin = "https://fdctgtncawolrapwwevm.supabase.co";
const fakePassword = "TEST-only-password-DO-NOT-USE-49";
const fakeAccessToken = "TEST-only-access-token-DO-NOT-USE-83";
const fakeRefreshToken = "TEST-only-refresh-token-DO-NOT-USE-26";
const fakePublicKey = "sb_publishable_TEST_ONLY_NOT_A_REAL_KEY";
const loginPath = "/auth/v1/token?grant_type=password";
const membershipPath = "/rest/v1/rpc/dm_admin_is_member";
const logoutPath = "/auth/v1/logout?scope=local";

type Scenario = "invalid-password" | "untrusted-error" | "success" | "wrong-identity" | "unconfirmed-identity" | "membership-denied" | "logout-failed" | "session-still-active" | "transport-failed";
type RequestRecord = {
  origin: string;
  path: string;
  method: string;
  redirect: string;
  bounded: boolean;
  publicKeyMatches: boolean;
  authorization: "none" | "own-test-session" | "unexpected";
  correctLoginBody: boolean;
  emptyBody: boolean;
};

/** No fallback to the real fetch exists, including for unexpected requests. */
const networkMock = `
import { appendFileSync } from "node:fs";
const password = ${JSON.stringify(fakePassword)};
const accessToken = ${JSON.stringify(fakeAccessToken)};
const refreshToken = ${JSON.stringify(fakeRefreshToken)};
const publicKey = ${JSON.stringify(fakePublicKey)};
const scenario = process.env.TEST_PREFLIGHT_SCENARIO;
let revoked = false;
let membershipReads = 0;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const headers = new Headers(init.headers);
  const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
  const authorization = headers.get("authorization");
  appendFileSync(process.env.TEST_PREFLIGHT_REQUEST_LOG, JSON.stringify({
    origin: url.origin,
    path: url.pathname + url.search,
    method: init.method || "GET",
    redirect: init.redirect,
    bounded: init.signal instanceof AbortSignal,
    publicKeyMatches: headers.get("apikey") === publicKey,
    authorization: authorization === null ? "none" : authorization === "Bearer " + accessToken ? "own-test-session" : "unexpected",
    correctLoginBody: body?.email === "mike@dmpaintingdecorating.co.uk" && body?.password === password && Object.keys(body).length === 2,
    emptyBody: body !== null && Object.keys(body).length === 0,
  }) + "\\n");
  if (url.origin !== ${JSON.stringify(origin)}) return Response.json({ error: "unexpected destination" }, { status: 403 });
  if (url.pathname === "/auth/v1/token" && url.search === "?grant_type=password") {
    if (scenario === "transport-failed") throw new Error(password + " " + accessToken);
    if (scenario === "invalid-password") return Response.json({ code: "invalid_credentials", message: password + " " + accessToken }, { status: 400 });
    if (scenario === "untrusted-error") return Response.json({ error_code: password + "\\n" + accessToken, message: refreshToken }, { status: 400 });
    return Response.json({ access_token: accessToken, refresh_token: refreshToken });
  }
  if (url.pathname === "/auth/v1/user") return Response.json({
    email: scenario === "wrong-identity" ? "another-customer@example.test" : "mike@dmpaintingdecorating.co.uk",
    email_confirmed_at: scenario === "unconfirmed-identity" ? null : "2026-10-18T00:00:00Z",
  });
  if (url.pathname === "/auth/v1/logout" && url.search === "?scope=local") {
    if (scenario === "logout-failed") return Response.json({ message: password + " " + accessToken }, { status: 503 });
    revoked = true;
    return new Response(null, { status: 204 });
  }
  if (url.pathname === "/rest/v1/rpc/dm_admin_is_member") {
    membershipReads += 1;
    if (scenario === "membership-denied" && membershipReads === 1) return Response.json(false);
    return Response.json(scenario === "session-still-active" || !revoked);
  }
  return Response.json({ message: "unexpected mocked request" }, { status: 404 });
};
`;

async function runPreflight(scenario: Scenario, overrides: Record<string, string> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "dm-preflight-unit-"));
  try {
    const preload = join(directory, "mock-network.mjs");
    const requestLog = join(directory, "requests.jsonl");
    await Promise.all([writeFile(preload, networkMock), writeFile(requestLog, "")]);
    // Deliberately start from a literal environment. Parent Actions secrets,
    // proxy credentials, NODE_OPTIONS and live account configuration stay out.
    const env: NodeJS.ProcessEnv = {
      E2E_RUN_LIVE: "1",
      NEXT_PUBLIC_SUPABASE_URL: origin,
      SUPABASE_PUBLISHABLE_KEY: fakePublicKey,
      E2E_ADMIN_PASSWORD: fakePassword,
      ...overrides,
      TEST_PREFLIGHT_SCENARIO: scenario,
      TEST_PREFLIGHT_REQUEST_LOG: requestLog,
      NODE_ENV: "test",
    };
    const stdoutPath = join(directory, "stdout.txt");
    const stderrPath = join(directory, "stderr.txt");
    const stdoutHandle = await open(stdoutPath, "w");
    let status: { code: number | null; signal: NodeJS.Signals | null };
    try {
      const stderrHandle = await open(stderrPath, "w");
      try {
        // Regular files also capture Node's synchronous console writes in
        // managed runners where child pipe writes may not reach the parent.
        status = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
          const child = spawn(process.execPath, ["--import", preload, script], {
            cwd: directory,
            env,
            shell: false,
            stdio: ["ignore", stdoutHandle.fd, stderrHandle.fd],
            timeout: 10_000,
          });
          child.once("error", reject);
          child.once("close", (code, signal) => resolve({ code, signal }));
        });
      } finally {
        await stderrHandle.close();
      }
    } finally {
      await stdoutHandle.close();
    }
    const [stdout, stderr] = await Promise.all([readFile(stdoutPath, "utf8"), readFile(stderrPath, "utf8")]);
    const result = { ...status, stdout, stderr };
    const requests = (await readFile(requestLog, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as RequestRecord);
    assert.equal(result.signal, null, "The isolated preflight must finish without a timeout or signal");
    for (const secret of [fakePassword, fakeAccessToken, fakeRefreshToken]) {
      assert.equal((result.stdout + result.stderr).includes(secret), false, "Passwords and session credentials must never enter diagnostic output");
    }
    for (const request of requests) {
      assert.equal(request.origin, origin, "Every request must remain on the approved Supabase origin");
      assert.equal(request.redirect, "error", "Auth credentials must never follow a redirect");
      assert.equal(request.bounded, true, "Every network request needs an abort deadline");
      assert.equal(request.publicKeyMatches, true, "Only the configured public key may accompany requests");
      assert.equal(request.authorization, request.path === loginPath ? "none" : "own-test-session", "Only this preflight's newly issued session may be used");
      assert.equal(request.method, request.path === "/auth/v1/user" ? "GET" : "POST");
      if (request.path === loginPath) assert.equal(request.correctLoginBody, true, "Login must use Mike and the privately supplied website password");
      else if (request.method === "POST") assert.equal(request.emptyBody, true, "RPC and local logout must not receive other account data");
    }
    return { ...result, requests };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("real Auth preflight refuses unsafe or absent configuration before sending credentials", async context => {
  const invalidConfigurations: { name: string; env: Record<string, string> }[] = [
    { name: "missing opt-in", env: { E2E_RUN_LIVE: "" } },
    { name: "wrong project", env: { NEXT_PUBLIC_SUPABASE_URL: "https://another-project.supabase.co" } },
    { name: "URL credentials", env: { NEXT_PUBLIC_SUPABASE_URL: "https://user:password@fdctgtncawolrapwwevm.supabase.co" } },
    { name: "unexpected URL path", env: { NEXT_PUBLIC_SUPABASE_URL: `${origin}/auth` } },
    { name: "unexpected URL query", env: { NEXT_PUBLIC_SUPABASE_URL: `${origin}/?next=elsewhere` } },
    { name: "privileged key", env: { SUPABASE_PUBLISHABLE_KEY: "sb_secret_TEST_ONLY_FORBIDDEN" } },
    { name: "missing password", env: { E2E_ADMIN_PASSWORD: "" } },
    { name: "invalid password length", env: { E2E_ADMIN_PASSWORD: "x".repeat(201) } },
  ];
  for (const invalid of invalidConfigurations) {
    await context.test(invalid.name, async () => {
      const result = await runPreflight("success", invalid.env);
      assert.equal(result.code, 1);
      assert.deepEqual(result.requests, [], "Configuration failures must make zero network requests");
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /^BLOCKED: Real Auth preflight requires explicit opt-in,/);
    });
  }
});

test("direct invalid credentials report the fixed Auth diagnosis without creating or testing another session", async () => {
  const result = await runPreflight("invalid-password");
  assert.equal(result.code, 1);
  assert.deepEqual(result.requests.map(request => request.path), [loginPath]);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "FAIL: Direct Supabase login returned HTTP 400 (invalid_credentials). Browser tests have not started.\n");
});

test("untrusted provider error codes and transport errors never enter diagnostic output", async context => {
  for (const scenario of ["untrusted-error", "transport-failed"] as const) {
    await context.test(scenario, async () => {
      const result = await runPreflight(scenario);
      assert.equal(result.code, 1);
      assert.deepEqual(result.requests.map(request => request.path), [loginPath]);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, scenario === "untrusted-error"
        ? "FAIL: Direct Supabase login returned HTTP 400 (unexpected_auth_error). Browser tests have not started.\n"
        : "FAIL: The direct Auth preflight could not complete. No transport or response details are logged.\n");
    });
  }
});

test("confirmed Mike and live membership pass only after the preflight's own local session is revoked", async () => {
  const result = await runPreflight("success");
  assert.equal(result.code, 0);
  assert.deepEqual(result.requests.map(request => request.path), [loginPath, "/auth/v1/user", membershipPath, logoutPath, membershipPath]);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "PASS: Direct Supabase login, confirmed admin membership and revocation of the test session. Browser workflow verification is still required.\n");
});

test("a wrong or unconfirmed identity fails but still revokes only its newly created session", async context => {
  for (const scenario of ["wrong-identity", "unconfirmed-identity"] as const) {
    await context.test(scenario, async () => {
      const result = await runPreflight(scenario);
      assert.equal(result.code, 1);
      assert.deepEqual(result.requests.map(request => request.path), [loginPath, "/auth/v1/user", logoutPath, membershipPath]);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "FAIL: The real Auth session did not verify Mike's confirmed identity.\n");
    });
  }
});

test("a confirmed identity without live admin membership is denied and its test session is cleaned up", async () => {
  const result = await runPreflight("membership-denied");
  assert.equal(result.code, 1);
  assert.deepEqual(result.requests.map(request => request.path), [loginPath, "/auth/v1/user", membershipPath, logoutPath, membershipPath]);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "FAIL: Direct login succeeded, but the live session was not authorised by the admin RPC.\n");
});

test("failed logout or a still-authorised replay prevents a successful preflight", async context => {
  for (const scenario of ["logout-failed", "session-still-active"] as const) {
    await context.test(scenario, async () => {
      const result = await runPreflight(scenario);
      assert.equal(result.code, 1);
      assert.deepEqual(result.requests.map(request => request.path), [loginPath, "/auth/v1/user", membershipPath, logoutPath, ...(scenario === "session-still-active" ? [membershipPath] : [])]);
      assert.equal(result.stdout, "", "An unconfirmed revocation must never be reported as PASS");
      assert.equal(result.stderr, "FAIL: Revocation of the preflight's own test session could not be confirmed. Stop before another live run.\n");
    });
  }
});
