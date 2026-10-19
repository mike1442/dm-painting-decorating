import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:https";
import pg from "pg";

// ISOLATED BROWSER WORKFLOW ONLY. A loopback stand-in for the hosted Supabase
// gateway: GoTrue's password/refresh/user/logout endpoints, PostgREST's RPC
// and table endpoints and Storage's upload/move/delete/public-download
// endpoints, backed by a disposable PostgreSQL database running the real
// supabase/*.sql migrations. Requests run under the real anon/authenticated
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

/**
 * Storage keeps file bytes outside the database; here they live in a table only
 * the emulator itself (the database owner) can reach. Object rows are written in
 * storage.objects under the caller's role, so the real policies decide access.
 */
export const STORAGE_BYTES_SQL = `create schema if not exists isolated_storage;
create table if not exists isolated_storage.object_bytes (bucket_id text not null, name text not null, content bytea not null, primary key (bucket_id, name));
revoke all on schema isolated_storage from public;`;

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

export async function startEmulator({ databaseUrl, port, tls, publishableKey, adminPassword, accessLifetime = 3600, latencyMs = 0, stallEveryRead = 0, stallBurst = 1 }) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
  const secret = randomBytes(32);
  /** refresh token -> { sessionId, revokedAt, child } */
  const refreshTokens = new Map();
  const stats = { requests: 0, peakInFlight: 0, userChecks: 0, signIns: 0, refreshes: 0, logouts: 0, rpcCalls: 0, storageCalls: 0, publicDownloads: 0, stalled: 0 };
  await pool.query(STORAGE_BYTES_SQL);
  let reads = 0;
  let inFlight = 0;
  /** Further stalls owed to the same read (path and credential), e.g. its retry. */
  const owed = new Map();

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

  /** Hosted Storage answers errors with HTTP 400 and the real status in the body. */
  const storageError = (statusCode, error, message, code) => [400, { statusCode: String(statusCode), error, message, ...(code ? { code } : {}) }];

  /** Run work in one transaction as the caller's role; `owner` work runs afterwards as the database owner. */
  async function asCaller(request, work, owner = async () => {}) {
    let role = "anon";
    let claims = { role: "anon", iss: "supabase" };
    const jwt = bearer(request);
    if (jwt) {
      const result = verify(jwt);
      if (result.error) return storageError(403, "Unauthorized", result.error === "expired" ? "jwt expired" : "invalid signature", "InvalidJWT");
      ({ claims } = result);
      role = claims.role;
    }
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${role === "authenticated" ? "authenticated" : "anon"}`);
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      const result = await work(client, claims);
      await client.query("reset role");
      if (result[0] === 200) await owner(client, result);
      await client.query(result[0] === 200 ? "commit" : "rollback");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      if (error?.code === "42501") return storageError(403, "Unauthorized", "new row violates row-level security policy", "AccessDenied");
      if (error?.code === "23505") return storageError(409, "Duplicate", "The resource already exists", "Duplicate");
      throw error;
    } finally {
      client.release();
    }
  }

  async function storage(request, url, body, raw) {
    stats.storageCalls += 1;
    const path = url.pathname;
    const bucketOf = async id => (await pool.query("select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = $1", [id])).rows[0];
    const missingBucket = () => storageError(404, "Bucket not found", "Bucket not found", "NoSuchBucket");
    if (path === "/storage/v1/object/move" && request.method === "POST") {
      const { bucketId, sourceKey, destinationKey } = body ?? {};
      if (!(await bucketOf(bucketId))) return missingBucket();
      return asCaller(request, async client => {
        const { rowCount } = await client.query("update storage.objects set name = $3, updated_at = now() where bucket_id = $1 and name = $2", [bucketId, sourceKey, destinationKey]);
        return rowCount ? [200, { message: "Successfully moved" }] : storageError(404, "not_found", "Object not found", "NoSuchKey");
      }, client => client.query("update isolated_storage.object_bytes set name = $3 where bucket_id = $1 and name = $2", [bucketId, sourceKey, destinationKey]));
    }
    const bucketPath = /^\/storage\/v1\/object\/([a-z0-9_-]+)$/.exec(path);
    if (bucketPath && request.method === "DELETE") {
      if (!(await bucketOf(bucketPath[1]))) return missingBucket();
      const names = Array.isArray(body?.prefixes) ? body.prefixes.map(String) : [];
      // Files the caller may not see are silently skipped, as on hosted Storage.
      return asCaller(request, async client => {
        const { rows } = await client.query("delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning bucket_id, name", [bucketPath[1], names]);
        return [200, rows];
      }, (client, [, rows]) => client.query("delete from isolated_storage.object_bytes where bucket_id = $1 and name = any($2::text[])", [bucketPath[1], rows.map(row => row.name)]));
    }
    const objectPath = /^\/storage\/v1\/object\/([a-z0-9_-]+)\/(.+)$/.exec(path);
    if (objectPath && ["POST", "PUT"].includes(request.method)) {
      const [, bucketId, encoded] = objectPath;
      const name = encoded.split("/").map(decodeURIComponent).join("/");
      const bucket = await bucketOf(bucketId);
      if (!bucket) return missingBucket();
      const mimetype = String(request.headers["content-type"] ?? "application/octet-stream").split(";")[0].trim();
      if (bucket.allowed_mime_types?.length && !bucket.allowed_mime_types.includes(mimetype)) return storageError(415, "invalid_mime_type", `mime type ${mimetype} is not supported`, "InvalidMimeType");
      if (bucket.file_size_limit && raw.length > Number(bucket.file_size_limit)) return storageError(413, "Payload too large", "The object exceeded the maximum allowed size", "EntityTooLarge");
      const metadata = { mimetype, size: raw.length, cacheControl: String(request.headers["cache-control"] ?? "no-cache") };
      const upsert = request.method === "PUT" || request.headers["x-upsert"] === "true";
      return asCaller(request, async (client, claims) => {
        const { rows } = await client.query(
          `insert into storage.objects(bucket_id, name, owner, metadata) values ($1, $2, $3, $4)${upsert ? " on conflict (bucket_id, name) do update set metadata = excluded.metadata, owner = excluded.owner, updated_at = now()" : ""} returning id`,
          [bucketId, name, claims.sub ?? null, metadata],
        );
        return [200, { Key: `${bucketId}/${name}`, Id: rows[0].id }];
      }, client => client.query("insert into isolated_storage.object_bytes(bucket_id, name, content) values ($1, $2, $3) on conflict (bucket_id, name) do update set content = excluded.content", [bucketId, name, raw]));
    }
    return [404, { statusCode: "404", error: "not_found", message: "Not found" }];
  }

  /** Public bucket downloads need no key or session, exactly like hosted public URLs. */
  async function publicDownload(url) {
    stats.publicDownloads += 1;
    const match = /^\/storage\/v1\/object\/public\/([a-z0-9_-]+)\/(.+)$/.exec(url.pathname);
    if (!match) return storageError(404, "not_found", "Object not found");
    const name = match[2].split("/").map(decodeURIComponent).join("/");
    const bucket = (await pool.query("select public from storage.buckets where id = $1", [match[1]])).rows[0];
    if (!bucket?.public) return storageError(404, "Bucket not found", "Bucket not found", "NoSuchBucket");
    const { rows } = await pool.query(
      "select o.metadata, b.content from storage.objects o join isolated_storage.object_bytes b on b.bucket_id = o.bucket_id and b.name = o.name where o.bucket_id = $1 and o.name = $2",
      [match[1], name],
    );
    if (!rows[0]) return storageError(404, "not_found", "Object not found", "NoSuchKey");
    return [200, rows[0].content, { "Content-Type": rows[0].metadata?.mimetype ?? "application/octet-stream", "Cache-Control": rows[0].metadata?.cacheControl ?? "no-cache" }];
  }

  async function route(request, url, body, raw) {
    if (url.pathname.startsWith("/storage/v1/object/public/") && ["GET", "HEAD"].includes(request.method)) return publicDownload(url);
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
    if (path.startsWith("/storage/v1/")) return storage(request, url, body, raw);
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
      let headers = {};
      stats.requests += 1;
      stats.peakInFlight = Math.max(stats.peakInFlight, ++inFlight);
      try {
        const url = new URL(request.url, `https://${SUPABASE_HOST}`);
        const raw = Buffer.concat(chunks);
        // File uploads carry their bytes; every other request body is JSON.
        const upload = /^\/storage\/v1\/object\/(?!move$|public\/)[a-z0-9_-]+\/.+/.test(url.pathname) && ["POST", "PUT"].includes(request.method);
        let body;
        if (!upload) {
          const text = raw.toString("utf8");
          try { body = text ? JSON.parse(text) : undefined; }
          catch { [status, payload] = [400, { code: "PGRST102", message: "Empty or invalid json" }]; }
        }
        // Optional network round-trip delay, to exercise behaviour under hosted-service latency.
        if (latencyMs) await new Promise(resolve => setTimeout(resolve, latencyMs));
        // Optionally leave every Nth read unanswered, like a stalled hosted connection.
        // Public photo downloads are browser image loads, not the Auth/database reads this simulates.
        const read = (request.method === "GET" && !url.pathname.startsWith("/storage/")) || /\/rpc\/(dm_admin_is_member|dm_get_data|dm_get_shared_document|dm_list_photos)$/.test(url.pathname);
        const same = `${url.pathname} ${request.headers.authorization ?? ""}`;
        if (read && owed.get(same) > 0) {
          owed.set(same, owed.get(same) - 1);
          stats.stalled += 1;
          inFlight -= 1;
          return;
        }
        if (stallEveryRead && read && ++reads % stallEveryRead === 0) {
          if (stallBurst > 1) owed.set(same, stallBurst - 1);
          stats.stalled += 1;
          inFlight -= 1;
          return;
        }
        if (status === undefined) [status, payload, headers = {}] = await route(request, url, body, raw);
      } catch {
        [status, payload] = [500, { message: "Isolated emulator failure" }];
      }
      inFlight -= 1;
      if (Buffer.isBuffer(payload)) {
        response.writeHead(status, { [ISOLATED_MARKER]: "1", "Content-Length": payload.length, ...headers });
        response.end(request.method === "HEAD" ? undefined : payload);
        return;
      }
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
