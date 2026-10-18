import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:https";
import pg from "pg";

// ISOLATED BROWSER WORKFLOW ONLY. A loopback stand-in for the hosted Supabase
// gateway: GoTrue's password/refresh/user/logout endpoints and PostgREST's RPC
// and table endpoints, backed by a disposable PostgreSQL database running the
// real supabase/*.sql migrations. Requests run under the real anon/authenticated
// roles, grants, RLS and security-definer functions. It never contacts the
// hosted project, and every response carries ISOLATED_MARKER so a runner can
// prove it is not talking to the real project.

export const SUPABASE_HOST = "fdctgtncawolrapwwevm.supabase.co";
export const ISOLATED_MARKER = "x-dm-isolated-supabase";
const ADMIN_EMAIL = "mike@dmpaintingdecorating.co.uk";
// Hosted GoTrue's refresh-token reuse interval: concurrent refreshes with the
// same token receive the current session instead of revoking it.
const REUSE_INTERVAL_MS = 10_000;
const MAX_BODY_BYTES = 12_000_000;

const now = () => Math.floor(Date.now() / 1000);
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");

/** PostgREST's documented SQLSTATE to HTTP status mapping, for the codes used here. */
function restStatus(code, anonymous) {
  if (code === "42501") return anonymous ? 401 : 403;
  if (code === "23503" || code === "23505") return 409;
  if (code === "42883" || code === "42P01") return 404;
  if (code === "P0001") return 400;
  if (/^(08|53)/.test(code)) return 503;
  if (/^(0L|0P|28)/.test(code)) return 403;
  if (/^54/.test(code)) return 413;
  if (/^(09|25|2D|38|39|3B|40|55|57|58|F0|HV|P0|XX)/.test(code)) return 500;
  return 400;
}

export async function startEmulator({ databaseUrl, port, tls, publishableKey, adminPassword, accessLifetime = 3600, latencyMs = 0, stallEveryRead = 0 }) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
  const secret = randomBytes(32);
  /** refresh token -> { sessionId, revokedAt, child } */
  const refreshTokens = new Map();
  const stats = { requests: 0, peakInFlight: 0, userChecks: 0, signIns: 0, refreshes: 0, logouts: 0, rpcCalls: 0, stalled: 0 };
  let reads = 0;
  let inFlight = 0;

  const sign = claims => {
    const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}`;
    return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
  };
  const verify = token => {
    const parts = typeof token === "string" ? token.split(".") : [];
    if (parts.length !== 3) return { error: "invalid" };
    const expected = createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
    const given = Buffer.from(parts[2], "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { error: "invalid" };
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return Number.isSafeInteger(claims.exp) && claims.exp > now() ? { claims } : { error: "expired" };
  };
  const bearer = request => /^Bearer (\S+)$/.exec(request.headers.authorization ?? "")?.[1];

  async function admin() {
    const { rows } = await pool.query("select id, email, email_confirmed_at from auth.users where lower(email) = $1 and deleted_at is null", [ADMIN_EMAIL]);
    return rows[0] ?? null;
  }
  const userBody = user => ({
    id: user.id, aud: "authenticated", role: "authenticated", email: user.email,
    email_confirmed_at: user.email_confirmed_at?.toISOString() ?? null, app_metadata: { provider: "email" }, user_metadata: {},
  });

  async function issue(user, sessionId) {
    const iat = now();
    const refreshToken = randomBytes(12).toString("hex");
    refreshTokens.set(refreshToken, { sessionId, revokedAt: null, child: null });
    return {
      access_token: sign({
        aud: "authenticated", exp: iat + accessLifetime, iat, iss: `https://${SUPABASE_HOST}/auth/v1`, sub: user.id,
        email: user.email, role: "authenticated", aal: "aal1", session_id: sessionId, is_anonymous: false,
      }),
      token_type: "bearer", expires_in: accessLifetime, expires_at: iat + accessLifetime,
      refresh_token: refreshToken, user: userBody(user),
    };
  }

  const authError = (status, code, msg) => [status, { code: status, error_code: code, msg }];

  /** GoTrue requires a valid JWT whose session still exists. */
  async function authenticated(request) {
    const result = verify(bearer(request));
    if (result.error) return { failure: authError(403, "bad_jwt", `invalid JWT: ${result.error === "expired" ? "token is expired" : "unable to verify signature"}`) };
    const { rows } = await pool.query("select u.id, u.email, u.email_confirmed_at from auth.sessions s join auth.users u on u.id = s.user_id where s.id = $1 and u.id = $2", [result.claims.session_id, result.claims.sub]);
    if (!rows[0]) return { failure: authError(403, "session_not_found", "Session from session_id claim in JWT does not exist") };
    return { claims: result.claims, user: rows[0] };
  }

  async function token(url, body) {
    if (url.searchParams.get("grant_type") === "password") {
      const user = await admin();
      const supplied = Buffer.from(String(body?.password ?? ""));
      const expected = Buffer.from(adminPassword);
      const matches = supplied.length === expected.length && timingSafeEqual(supplied, expected);
      if (!user || String(body?.email ?? "").toLowerCase() !== ADMIN_EMAIL || !matches) return authError(400, "invalid_credentials", "Invalid login credentials");
      if (!user.email_confirmed_at) return authError(400, "email_not_confirmed", "Email not confirmed");
      const sessionId = randomUUID();
      await pool.query("insert into auth.sessions(id, user_id) values ($1, $2)", [sessionId, user.id]);
      stats.signIns += 1;
      return [200, await issue(user, sessionId)];
    }
    if (url.searchParams.get("grant_type") === "refresh_token") {
      const record = refreshTokens.get(String(body?.refresh_token ?? ""));
      const session = record && (await pool.query("select s.id, u.id as user_id, u.email, u.email_confirmed_at from auth.sessions s join auth.users u on u.id = s.user_id where s.id = $1", [record.sessionId])).rows[0];
      if (!record || !session) return authError(400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
      const user = { id: session.user_id, email: session.email, email_confirmed_at: session.email_confirmed_at };
      if (record.revokedAt !== null) {
        if (Date.now() - record.revokedAt > REUSE_INTERVAL_MS) {
          // Hosted GoTrue treats late reuse of a rotated token as theft and ends the session.
          await pool.query("delete from auth.sessions where id = $1", [record.sessionId]);
          return authError(400, "refresh_token_already_used", "Invalid Refresh Token: Already Used");
        }
        let current = record;
        while (current.child && refreshTokens.get(current.child)?.revokedAt !== null) current = refreshTokens.get(current.child);
        const activeToken = current.child;
        const issued = await issue(user, record.sessionId);
        refreshTokens.delete(issued.refresh_token);
        stats.refreshes += 1;
        return [200, { ...issued, refresh_token: activeToken }];
      }
      const issued = await issue(user, record.sessionId);
      record.revokedAt = Date.now();
      record.child = issued.refresh_token;
      stats.refreshes += 1;
      return [200, issued];
    }
    return authError(400, "validation_failed", "Unsupported grant type");
  }

  async function rest(request, url, body) {
    let role = "anon";
    let claims = { role: "anon", iss: "supabase" };
    const jwt = bearer(request);
    if (jwt) {
      const result = verify(jwt);
      if (result.error) return [401, result.error === "expired" ? { code: "PGRST303", message: "JWT expired" } : { code: "PGRST301", message: "No suitable key or wrong key type" }];
      if (!["anon", "authenticated"].includes(result.claims.role)) return [401, { code: "PGRST301", message: "Unexpected role" }];
      ({ claims } = result);
      role = claims.role;
    }
    const rpc = /^\/rest\/v1\/rpc\/([a-z_][a-z0-9_]*)$/.exec(url.pathname);
    const table = /^\/rest\/v1\/([a-z_][a-z0-9_]*)$/.exec(url.pathname);
    let sql;
    let returnsVoid = false;
    if (rpc && request.method === "POST") {
      const { rows } = await pool.query(
        "select p.proname, p.proargnames, array(select format_type(t, null) from unnest(p.proargtypes) t) as argtypes, format_type(p.prorettype, null) as rettype from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1",
        [rpc[1]],
      );
      const names = rows[0]?.proargnames ?? [];
      const supplied = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body).sort() : null;
      if (rows.length !== 1 || !supplied || JSON.stringify([...names].sort()) !== JSON.stringify(supplied)) {
        return [404, { code: "PGRST202", message: `Could not find the function public.${rpc[1]} in the schema cache` }];
      }
      const args = names.map((name, index) => rows[0].argtypes[index] === "jsonb"
        ? `${pg.escapeIdentifier(name)} => ($1::jsonb -> ${pg.escapeLiteral(name)})`
        : `${pg.escapeIdentifier(name)} => (($1::jsonb ->> ${pg.escapeLiteral(name)})::${rows[0].argtypes[index]})`);
      returnsVoid = rows[0].rettype === "void";
      sql = `select to_jsonb(public.${pg.escapeIdentifier(rows[0].proname)}(${args.join(", ")})) as result`;
    } else if (table && request.method === "GET") {
      sql = `select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) as result from (select * from public.${pg.escapeIdentifier(table[1])} limit 0) t`;
    } else {
      return [404, { code: "PGRST125", message: "Invalid path specified in request URL" }];
    }
    stats.rpcCalls += 1;
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${role}`);
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      const { rows } = await client.query(sql, sql.includes("$1") ? [JSON.stringify(body ?? {})] : []);
      await client.query("commit");
      return returnsVoid ? [204, undefined] : [200, rows[0].result];
    } catch (error) {
      await client.query("rollback").catch(() => {});
      const code = typeof error?.code === "string" ? error.code : "XX000";
      return [restStatus(code, role === "anon"), { code, details: error?.detail ?? null, hint: error?.hint ?? null, message: error?.message ?? "error" }];
    } finally {
      client.release();
    }
  }

  async function route(request, url, body) {
    if (request.headers.apikey !== publishableKey) return [401, { message: "Invalid API key" }];
    const path = url.pathname;
    if (path === "/auth/v1/health" && request.method === "GET") return [200, { name: "dm-isolated-supabase" }];
    if (path === "/auth/v1/token" && request.method === "POST") return token(url, body);
    if (path === "/auth/v1/user" && request.method === "GET") {
      stats.userChecks += 1;
      const result = await authenticated(request);
      return result.failure ?? [200, userBody(result.user)];
    }
    if (path === "/auth/v1/logout" && request.method === "POST") {
      const result = await authenticated(request);
      if (result.failure) return result.failure;
      const scope = url.searchParams.get("scope") ?? "global";
      if (scope === "local") await pool.query("delete from auth.sessions where id = $1", [result.claims.session_id]);
      else if (scope === "others") await pool.query("delete from auth.sessions where user_id = $1 and id <> $2", [result.user.id, result.claims.session_id]);
      else await pool.query("delete from auth.sessions where user_id = $1", [result.user.id]);
      stats.logouts += 1;
      return [204, undefined];
    }
    if (path.startsWith("/rest/v1/")) return rest(request, url, body);
    return [404, { message: "Not found" }];
  }

  const server = createServer(tls, (request, response) => {
    const chunks = [];
    let size = 0;
    request.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) request.destroy();
      else chunks.push(chunk);
    });
    request.on("end", async () => {
      let status;
      let payload;
      stats.requests += 1;
      stats.peakInFlight = Math.max(stats.peakInFlight, ++inFlight);
      try {
        const url = new URL(request.url, `https://${SUPABASE_HOST}`);
        const text = Buffer.concat(chunks).toString("utf8");
        let body;
        try { body = text ? JSON.parse(text) : undefined; }
        catch { [status, payload] = [400, { code: "PGRST102", message: "Empty or invalid json" }]; }
        // Optional network round-trip delay, to exercise behaviour under hosted-service latency.
        if (latencyMs) await new Promise(resolve => setTimeout(resolve, latencyMs));
        // Optionally leave every Nth read unanswered, like a stalled hosted connection.
        const read = request.method === "GET" || /\/rpc\/(dm_admin_is_member|dm_get_data|dm_get_shared_document)$/.test(url.pathname);
        if (stallEveryRead && read && ++reads % stallEveryRead === 0) {
          stats.stalled += 1;
          inFlight -= 1;
          return;
        }
        if (status === undefined) [status, payload] = await route(request, url, body);
      } catch {
        [status, payload] = [500, { message: "Isolated emulator failure" }];
      }
      inFlight -= 1;
      response.writeHead(status, { [ISOLATED_MARKER]: "1", ...(payload === undefined ? {} : { "Content-Type": "application/json" }) });
      response.end(payload === undefined ? undefined : JSON.stringify(payload));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    stats,
    async close() {
      await new Promise(resolve => server.close(resolve));
      await pool.end();
    },
  };
}
