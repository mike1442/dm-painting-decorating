import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SUPABASE_HOST } from "./supabase-emulator.mjs";

// Shared by the isolated runners (run.mjs, chatgpt-invoices.mjs). Test-only.

/** The real migrations, in the order they were applied to the hosted project. */
export const MIGRATIONS = ["supabase/base-schema.sql", "supabase/production-admin.sql", "supabase/chatgpt-invoices.sql"];

export function fail(message) {
  console.error(`ISOLATED: ${message}`);
  process.exit(1);
}

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("close", code => resolve(code ?? 1));
  });
}

export async function certificates(directory) {
  const file = name => join(directory, name);
  const quiet = { stdio: "ignore" };
  const steps = [
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=D&M isolated test CA", "-keyout", file("ca.key"), "-out", file("ca.pem")],
    ["req", "-newkey", "rsa:2048", "-nodes", "-subj", `/CN=${SUPABASE_HOST}`, "-keyout", file("server.key"), "-out", file("server.csr")],
    ["x509", "-req", "-in", file("server.csr"), "-CA", file("ca.pem"), "-CAkey", file("ca.key"), "-CAcreateserial", "-days", "2", "-extfile", file("san.cnf"), "-out", file("server.pem")],
  ];
  await writeFile(file("san.cnf"), `subjectAltName=DNS:${SUPABASE_HOST}\nextendedKeyUsage=serverAuth\n`);
  for (const args of steps) if (await run("openssl", args, quiet) !== 0) fail("openssl could not create the disposable TLS certificate.");
  // Keep any CA bundle the environment already relies on (for example a proxy CA).
  const existing = process.env.NODE_EXTRA_CA_CERTS ? await readFile(process.env.NODE_EXTRA_CA_CERTS, "utf8").catch(() => "") : "";
  await writeFile(file("bundle.pem"), `${existing}\n${await readFile(file("ca.pem"), "utf8")}`);
  return { key: await readFile(file("server.key")), cert: await readFile(file("server.pem")), ca: await readFile(file("ca.pem")), bundle: file("bundle.pem") };
}

/** Runs `work` in one transaction as the given admin, with a live Auth session like a signed-in browser's. */
export async function asAdmin(client, userId, work) {
  const session = randomUUID();
  await client.query("insert into auth.sessions(id, user_id) values ($1, $2)", [session, userId]);
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated", session_id: session })]);
    const result = await work();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.query("delete from auth.sessions where id = $1", [session]);
  }
}
