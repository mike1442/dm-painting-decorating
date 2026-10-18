import { createPublicKey, verify as verifySignature } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const repository = "mike1442/dm-painting-decorating";
const branch = "fix/production-admin";
const workflowPath = ".github/workflows/live-admin-checks.yml";
const previewOrigin = "https://dm-painting-decorating-git-fix-production-admin-mike-b7b4.vercel.app";
const issuer = "https://token.actions.githubusercontent.com";
const audience = "https://github.com/mike1442";
const vercelContext = "Vercel – dm-painting-decorating";
const root = fileURLToPath(new URL("../", import.meta.url));
const projects = ["live-desktop-chromium", "live-mobile-chromium"];
const shaPattern = /^[a-f0-9]{40}$/;

class VerificationError extends Error {}
const stop = message => { throw new VerificationError(message); };

async function readBounded(response, maximumBytes) {
  if (!response.body) stop("BLOCKED: A verification endpoint returned an empty response.");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) stop("BLOCKED: A verification response exceeded its permitted size.");
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    try { await reader.cancel(); } catch { /* Never report response/error content. */ }
    reader.releaseLock();
  }
}

async function fetchJson(url, options, label, timeoutMs = 15_000) {
  let response;
  try {
    response = await fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, 15_000))) });
    if (!response.ok) stop(`BLOCKED: ${label} returned HTTP ${response.status}.`);
    return JSON.parse(await readBounded(response, 1_000_000));
  } catch (error) {
    if (error instanceof VerificationError) throw error;
    stop(`BLOCKED: ${label} was unavailable, malformed or timed out.`);
  } finally {
    try { await response?.body?.cancel(); } catch { /* Already consumed or locked. */ }
  }
}

async function configuration() {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REPOSITORY !== repository) stop("BLOCKED: This runner is restricted to the authorised repository's GitHub Actions workflow.");
  if (process.env.RUNNER_DEBUG === "1" || process.env.DEBUG || process.env.PWDEBUG || process.env.ACTIONS_STEP_DEBUG === "true" || process.env.ACTIONS_RUNNER_DEBUG === "true") stop("BLOCKED: Disable debug logging before private preview verification.");
  if (process.env.E2E_BASE_URL && process.env.E2E_BASE_URL !== previewOrigin) stop("BLOCKED: Only the exact reviewed PR preview origin is allowed; production and other URLs are refused.");
  if (!process.env.E2E_ADMIN_PASSWORD || process.env.E2E_ADMIN_PASSWORD.length < 8 || process.env.E2E_ADMIN_PASSWORD.length > 200) stop("BLOCKED: The private administrator test credential is missing or invalid.");
  const head = process.env.E2E_EXPECTED_HEAD_SHA;
  if (!head || !shaPattern.test(head) || !shaPattern.test(process.env.GITHUB_SHA || "")) stop("BLOCKED: The reviewed commit identity is unavailable.");
  if (!process.env.GITHUB_TOKEN || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN || !process.env.ACTIONS_ID_TOKEN_REQUEST_URL) stop("BLOCKED: GitHub status-read and short-lived OIDC permissions are required.");
  let event;
  try { event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8")); }
  catch { stop("BLOCKED: The trusted GitHub event metadata could not be verified."); }
  const eventName = process.env.GITHUB_EVENT_NAME;
  const ref = process.env.GITHUB_REF;
  if (eventName === "pull_request") {
    if (ref !== "refs/pull/6/merge" || event.number !== 6 || event.pull_request?.head?.ref !== branch
      || event.pull_request.head.repo?.full_name !== repository || event.pull_request.head.sha !== head
      || event.pull_request.base?.ref !== "main") stop("BLOCKED: Only the reviewed same-repository PR #6 branch may run this verification.");
  } else if (eventName !== "workflow_dispatch" || ref !== `refs/heads/${branch}` || process.env.GITHUB_SHA !== head) {
    stop("BLOCKED: A manual run must use the reviewed PR #6 branch.");
  }
  const workflowRef = `${repository}/${workflowPath}@${ref}`;
  if (process.env.GITHUB_WORKFLOW_REF !== workflowRef || process.env.GITHUB_WORKFLOW !== "Live admin verification"
    || !shaPattern.test(process.env.GITHUB_WORKFLOW_SHA || "")) stop("BLOCKED: The trusted workflow identity did not match this runner.");
  let oidcUrl;
  try { oidcUrl = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL); }
  catch { stop("BLOCKED: The GitHub OIDC request endpoint is invalid."); }
  // GitHub has served the token from both ".../jobs/<id>/idtoken" and
  // ".../idtoken/<plan>/<job>"; require an idtoken segment, not a fixed suffix.
  // Only the names of failed conditions are reported, never the URL.
  const endpointProblems = Object.entries({
    scheme: oidcUrl.protocol === "https:",
    host: oidcUrl.hostname.endsWith(".actions.githubusercontent.com"),
    path: oidcUrl.pathname.split("/").some(segment => segment.toLowerCase() === "idtoken"),
    authority: !oidcUrl.port && !oidcUrl.username && !oidcUrl.password && !oidcUrl.hash,
  }).filter(([, ok]) => !ok).map(([name]) => name);
  if (endpointProblems.length) stop(`BLOCKED: The OIDC request endpoint must be the HTTPS endpoint supplied by GitHub Actions (failed: ${endpointProblems.join(", ")}).`);
  oidcUrl.searchParams.set("audience", audience);
  return { head, eventName, ref, workflowRef, oidcUrl };
}

async function githubRead(path, timeoutMs = 15_000) {
  const url = new URL(path, "https://api.github.com");
  if (url.origin !== "https://api.github.com" || !url.pathname.startsWith(`/repos/${repository}/`)) stop("BLOCKED: Refusing a GitHub credential outside the approved API origin and repository.");
  return fetchJson(url, {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  }, "GitHub read-only preflight", timeoutMs);
}

async function deploymentReady(config, waitMs) {
  const deadline = Date.now() + waitMs;
  do {
    const remaining = () => waitMs ? Math.max(1, deadline - Date.now()) : 15_000;
    const current = await githubRead(`/repos/${repository}/git/ref/heads/${branch}`, remaining());
    if (current.ref !== `refs/heads/${branch}` || current.object?.sha !== config.head) stop("BLOCKED: The PR branch head changed. No further browser project will run against an unreviewed deployment.");
    const combined = await githubRead(`/repos/${repository}/commits/${config.head}/status`, remaining());
    if (combined.sha !== config.head || !Array.isArray(combined.statuses)) stop("BLOCKED: GitHub did not return the reviewed commit's deployment status.");
    const status = combined.statuses.find(item => item.context === vercelContext);
    let target;
    try { target = status?.target_url ? new URL(status.target_url) : null; } catch { target = null; }
    const correctProject = target?.origin === "https://vercel.com" && !target.username && !target.password
      && !target.search && !target.hash && /^\/mike-b7b4\/dm-painting-decorating\/[A-Za-z0-9_-]+$/.test(target.pathname);
    if (status?.state === "success" && correctProject) return;
    if (status && ["failure", "error"].includes(status.state)) stop("BLOCKED: The reviewed Mike-project Vercel deployment reported a failed status.");
    if (!waitMs || Date.now() >= deadline) break;
    await delay(Math.min(3000, Math.max(1, deadline - Date.now())));
  } while (Date.now() < deadline);
  stop("BLOCKED: The reviewed Mike-project Vercel success status was not available within the bounded wait.");
}

let signingKeys;
async function freshOidc(config) {
  const result = await fetchJson(config.oidcUrl, {
    headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`, Accept: "application/json" },
  }, "GitHub OIDC issuance");
  const token = result?.value;
  if (typeof token !== "string" || token.length > 20_000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) stop("BLOCKED: GitHub returned an invalid OIDC credential.");
  const [encodedHeader, encodedPayload, signature] = token.split(".");
  let header, claims;
  try {
    header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch { stop("BLOCKED: The GitHub OIDC credential could not be validated."); }
  const now = Math.floor(Date.now() / 1000);
  const times = [claims?.exp, claims?.iat, claims?.nbf].every(Number.isSafeInteger);
  // Report only which named checks failed (plus the lifetime), never claim values.
  const claimProblems = Object.entries({
    header: header?.alg === "RS256" && typeof header.kid === "string" && header.kid.length <= 200,
    iss: claims?.iss === issuer, aud: claims?.aud === audience,
    repository: claims?.repository === repository && claims?.repository_owner === "mike1442",
    // The subject is derived from claims checked exactly here (repository, ref,
    // workflow, commit, run), its format varies with GitHub's subject templates
    // and immutable-ID formats, and the Preview trusted-source rule does not use
    // it. Require only that it is present; on failure describe its shape alone.
    [`sub (${typeof claims?.sub}, ${String(claims?.sub ?? "").length} chars)`]: typeof claims?.sub === "string" && claims.sub.length > 0 && claims.sub.length <= 2000,
    ref: claims?.ref === config.ref, event_name: claims?.event_name === config.eventName,
    workflow: claims?.workflow === "Live admin verification" && claims?.workflow_ref === config.workflowRef && claims?.workflow_sha === process.env.GITHUB_WORKFLOW_SHA,
    sha: claims?.sha === process.env.GITHUB_SHA,
    run: String(claims?.run_id) === process.env.GITHUB_RUN_ID && String(claims?.run_attempt) === process.env.GITHUB_RUN_ATTEMPT,
    times: times && claims.iat <= now + 30 && claims.iat >= now - 60 && claims.nbf <= now + 30 && claims.exp > claims.iat,
    [`lifetime ${times ? claims.exp - now : "?"}s`]: times && claims.exp > now + 240 && claims.exp <= now + 600,
  }).filter(([, ok]) => !ok).map(([name]) => name);
  if (claimProblems.length) stop(`BLOCKED: The GitHub OIDC identity, workflow or short-lived expiry did not match the authorised preview run (failed: ${claimProblems.join(", ")}).`);
  signingKeys ??= await fetchJson(`${issuer}/.well-known/jwks`, { headers: { Accept: "application/json" } }, "GitHub OIDC signing keys");
  const jwk = signingKeys?.keys?.find(key => key.kid === header.kid && key.kty === "RSA" && (!key.use || key.use === "sig") && (!key.alg || key.alg === "RS256"));
  let verified = false;
  try {
    if (jwk) verified = verifySignature("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedPayload}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(signature, "base64url"));
  } catch { /* No token, claims or key material is reported. */ }
  if (!verified) stop("BLOCKED: The GitHub OIDC signature could not be verified using the pinned issuer.");
  // GitHub consumes this workflow command without displaying its value. Mask
  // the freshly issued credential before any third-party browser code runs.
  process.stdout.write(`::add-mask::${token}\n`);
  return { token, expiresAt: claims.exp * 1000 };
}

async function previewPerimeter(token) {
  let response;
  try {
    response = await fetch(`${previewOrigin}/login`, {
      headers: { "x-vercel-trusted-oidc-idp-token": token, Accept: "text/html" },
      redirect: "manual", signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 200) stop(`BLOCKED: Preview perimeter access returned HTTP ${response.status}. The intended GitHub OIDC trusted-source rule must be verified; no administrator sign-in was attempted.`);
    const html = await readBounded(response, 1_000_000);
    if (!response.headers.get("content-type")?.includes("text/html") || !html.includes("Admin sign in") || !html.includes('name="password"') || !html.includes('name="email"')) {
      stop("BLOCKED: The preview returned a protection or unexpected page. No administrator sign-in was attempted.");
    }
  } catch (error) {
    if (error instanceof VerificationError) throw error;
    stop("BLOCKED: The protected preview preflight was unavailable or timed out. No administrator sign-in was attempted.");
  } finally {
    try { await response?.body?.cancel(); } catch { /* Already consumed. */ }
  }
}

function runProject(project, token, deadline) {
  // Do not pass the GitHub API, OIDC-issuance, runtime, cache or artifact tokens
  // into the browser process. Only the application password and fresh OIDC
  // credential are needed; neither is placed in command arguments or files.
  const allowed = new Set(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TZ", "CI", "GITHUB_ACTIONS", "TERM", "FORCE_COLOR", "PLAYWRIGHT_BROWSERS_PATH", "NODE_EXTRA_CA_CERTS", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => allowed.has(name)));
  Object.assign(env, { CI: "true", E2E_RUN_LIVE: "1", E2E_BASE_URL: previewOrigin, E2E_ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD, E2E_VERCEL_TRUSTED_OIDC_TOKEN: token, E2E_LIVE_DEADLINE: String(deadline) });
  return new Promise(resolve => {
    const child = spawn(process.execPath, [join(root, "node_modules/@playwright/test/cli.js"), "test", "--config", join(root, "playwright.live.config.ts"), "--project", project], { cwd: root, env, stdio: "inherit" });
    child.once("error", () => resolve(false));
    child.once("close", code => resolve(code === 0));
  });
}

async function main() {
  const config = await configuration();
  await deploymentReady(config, 60_000);
  for (const project of projects) {
    await deploymentReady(config, 0);
    const identity = await freshOidc(config);
    await previewPerimeter(identity.token);
    // Keep at least 90 seconds after the last step may start for the worker's
    // record/session cleanup. Steps that could outlive the identity are not
    // started (see the deadline fixture); a global timeout would skip cleanup.
    const deadline = Math.floor(identity.expiresAt - 90_000);
    if (deadline - Date.now() < 120_000) stop("BLOCKED: The fresh preview identity has insufficient lifetime for a browser project and its cleanup. No administrator sign-in was attempted.");
    console.log(`Verified reviewed deployment and protected-page access; starting ${project}.`);
    const passed = await runProject(project, identity.token, deadline);
    await deploymentReady(config, 0);
    if (!passed) stop(`FAIL: ${project} did not pass the real protected-preview workflow. Review the private failure summary before retrying.`);
  }
  console.log("Protected-preview desktop and mobile workflows passed for the reviewed PR head.");
}

await main().catch(error => {
  console.error(error instanceof VerificationError ? error.message : "BLOCKED: Private preview verification could not finish. Credentials and response data are not reported.");
  process.exitCode = 1;
});
