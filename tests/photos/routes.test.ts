import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { type TestContext } from "node:test";
import sharp from "sharp";
import { isWebp } from "../../lib/server/photo-processing.ts";

// Only framework adapters and project path resolution are substituted. The real
// routes, photo processing, Supabase transport and failure mapping run intact
// against an in-memory stand-in for Supabase's Auth, RPC and Storage endpoints.
const response = new URL("../support/next-response.ts", import.meta.url).href;
const headers = new URL("../support/next-headers.ts", import.meta.url).href;
const httpUrl = new URL("../../lib/server/http.ts", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, resolution, nextResolve) {
    if (specifier === "next/server") return { url: response, shortCircuit: true };
    if (specifier === "next/headers") return { url: headers, shortCircuit: true };
    if (specifier.startsWith("@/")) return { url: new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
    if (resolution.parentURL === httpUrl && ["../admin/auth", "./photo-error", "./supabase"].includes(specifier)) {
      return { url: new URL(`${specifier}.ts`, httpUrl).href, shortCircuit: true };
    }
    return nextResolve(specifier, resolution);
  },
});
const collection = await import("../../app/api/admin/photos/route.ts");
const single = await import("../../app/api/admin/photos/[id]/route.ts");
const { requestCookies } = await import("../support/next-headers.ts");
hooks.deregister();

const ORIGIN = "https://admin.example.test";
const PROJECT = "https://fdctgtncawolrapwwevm.supabase.co";
const PUBLIC = `${PROJECT}/storage/v1/object/public/site-photos`;
const PHOTO_ID = "0b6f1c2e-6a49-4a5e-9d0b-6c1f4f0a7e11";

type Call = { method: string; path: string; headers: Headers; body: Buffer };
type StoredPhoto = { [key: string]: unknown; id: string; fileName: string };

/** Supabase as the routes see it: Mike's session, the photo RPCs and the Storage API. */
function fakeSupabase(context: TestContext) {
  const calls: Call[] = [];
  const files = new Map<string, Buffer>();
  const reserved = new Set<string>();
  let records: StoredPhoto[] = [];
  const failures = new Map<string, () => Response>();
  context.mock.method(globalThis, "fetch", async (input: unknown, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const body = init.body instanceof Uint8Array ? Buffer.from(init.body) : Buffer.from(typeof init.body === "string" ? init.body : "");
    const call = { method, path: url.pathname, headers: new Headers(init.headers), body };
    calls.push(call);
    const json = () => JSON.parse(body.toString("utf8"));
    const failure = failures.get(`${method} ${url.pathname}`);
    if (failure) return failure();
    if (url.pathname === "/auth/v1/user") return Response.json({ email: "mike@dmpaintingdecorating.co.uk", email_confirmed_at: "2026-10-18" });
    if (url.pathname === "/rest/v1/rpc/dm_admin_is_member") return Response.json(true);
    if (url.pathname === "/rest/v1/rpc/dm_list_photos") return Response.json(records);
    if (url.pathname === "/rest/v1/rpc/dm_reserve_photo_name") {
      const base = json().p_base;
      let name = base;
      for (let n = 2; reserved.has(name); n += 1) name = `${base}-${n}`;
      reserved.add(name);
      return Response.json(name);
    }
    if (url.pathname === "/rest/v1/rpc/dm_add_photo") {
      const photo = { id: PHOTO_ID, createdAt: "2026-10-19T09:00:00Z", updatedAt: "2026-10-19T09:00:00Z", ...json().p_photo };
      records = [photo, ...records];
      return Response.json(photo);
    }
    if (url.pathname === "/rest/v1/rpc/dm_update_photo") {
      const change = json();
      const photo = records.find(record => record.id === change.p_id)!;
      Object.assign(photo, { title: change.p_title, altText: change.p_alt_text, category: change.p_category, fileName: change.p_file_name ?? photo.fileName });
      return Response.json(photo);
    }
    if (url.pathname === "/rest/v1/rpc/dm_delete_photo") {
      records = records.filter(record => record.id !== json().p_id);
      return new Response(null, { status: 204 });
    }
    if (url.pathname.startsWith("/storage/v1/object/site-photos/") && method === "POST") {
      files.set(url.pathname.slice("/storage/v1/object/site-photos/".length), body);
      return Response.json({ Key: url.pathname.slice("/storage/v1/object/".length) });
    }
    if (url.pathname === "/storage/v1/object/site-photos" && method === "DELETE") {
      const removed = json().prefixes.filter((name: string) => files.delete(name));
      return Response.json(removed.map((name: string) => ({ name })));
    }
    if (url.pathname === "/storage/v1/object/move" && method === "POST") {
      const { sourceKey, destinationKey } = json();
      if (!files.has(sourceKey)) return Response.json({ statusCode: "404", error: "not_found", message: "Object not found" }, { status: 400 });
      files.set(destinationKey, files.get(sourceKey)!);
      files.delete(sourceKey);
      return Response.json({ message: "Successfully moved" });
    }
    return Response.json({ message: "unexpected" }, { status: 599 });
  });
  return {
    calls, files, failures,
    get records() { return records; },
    storageCalls: () => calls.filter(call => call.path.startsWith("/storage/")),
  };
}

function environment(context: TestContext) {
  const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.DM_SUPABASE_PUBLISHABLE_KEY };
  process.env.NEXT_PUBLIC_SUPABASE_URL = PROJECT;
  process.env.DM_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_unit_test";
  context.after(() => {
    for (const [name, value] of [["NEXT_PUBLIC_SUPABASE_URL", saved.url], ["DM_SUPABASE_PUBLISHABLE_KEY", saved.key]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  context.mock.method(console, "warn", () => {});
  requestCookies.set("dm-access", "access-fixture");
}

const sideways = () => sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#7a9" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();

async function upload(photo: Buffer | string, fields: { [key: string]: string } = {}, init: { origin?: string } = {}) {
  const form = new FormData();
  form.set("photo", new File([new Uint8Array(typeof photo === "string" ? Buffer.from(photo) : photo)], "IMG_2034.JPG", { type: "image/jpeg" }));
  for (const [key, value] of Object.entries({ title: "Hallway repaint – Stockton Heath", altText: "Freshly painted hallway", category: "interior", ...fields })) form.set(key, value);
  return collection.POST(new Request(`${ORIGIN}/api/admin/photos`, { method: "POST", body: form, headers: { origin: init.origin ?? ORIGIN, "sec-fetch-site": init.origin ? "cross-site" : "same-origin" } }));
}

const patch = (body: unknown, id = PHOTO_ID) => single.PATCH(
  new Request(`${ORIGIN}/api/admin/photos/${id}`, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json", origin: ORIGIN, "sec-fetch-site": "same-origin" } }),
  { params: Promise.resolve({ id }) },
);
const remove = (id = PHOTO_ID) => single.DELETE(
  new Request(`${ORIGIN}/api/admin/photos/${id}`, { method: "DELETE", headers: { origin: ORIGIN, "sec-fetch-site": "same-origin" } }),
  { params: Promise.resolve({ id }) },
);

test("an upload is converted, stored with Mike's own session and returned with permanent public URLs", async context => {
  environment(context);
  const supabase = fakeSupabase(context);
  const result = await upload(await sideways());
  assert.equal(result.status, 201);
  const { photo } = await result.json();
  assert.equal(photo.url, `${PUBLIC}/hallway-repaint-stockton-heath.webp`);
  assert.equal(photo.thumbUrl, `${PUBLIC}/thumbs/hallway-repaint-stockton-heath.webp`);
  assert.deepEqual([photo.width, photo.height, photo.thumbWidth, photo.thumbHeight], [1600, 2400, 480, 720], "upright, at most 1600 px wide, aspect ratio kept");
  assert.equal(photo.title, "Hallway repaint – Stockton Heath");
  assert.equal(photo.altText, "Freshly painted hallway");
  assert.equal(result.headers.get("cache-control"), "private, no-store, max-age=0");

  const uploads = supabase.storageCalls();
  assert.deepEqual(uploads.map(call => `${call.method} ${call.path}`), [
    "POST /storage/v1/object/site-photos/thumbs/hallway-repaint-stockton-heath.webp",
    "POST /storage/v1/object/site-photos/hallway-repaint-stockton-heath.webp",
  ]);
  for (const call of uploads) {
    assert.equal(call.headers.get("authorization"), "Bearer access-fixture", "Storage checks Mike's own session");
    assert.equal(call.headers.get("apikey"), "sb_publishable_unit_test", "Only the public key is ever sent");
    assert.equal(call.headers.get("content-type"), "image/webp");
    assert.equal(call.headers.get("cache-control"), "max-age=31536000");
    assert.equal(isWebp(call.body), true, "the stored bytes are WebP, not a renamed JPEG");
    assert.equal((await sharp(call.body).metadata()).format, "webp");
  }
  assert.equal(supabase.records[0].bytes, uploads[1].body.length);

  // The same title again gets its own, never-reused name.
  const again = await (await upload(await sideways())).json();
  assert.equal(again.photo.url, `${PUBLIC}/hallway-repaint-stockton-heath-2.webp`);

  const listed = await collection.GET();
  assert.equal(listed.status, 200);
  assert.deepEqual((await listed.json()).photos.map((item: { url: string }) => item.url), [`${PUBLIC}/hallway-repaint-stockton-heath-2.webp`, `${PUBLIC}/hallway-repaint-stockton-heath.webp`]);
});

test("unauthorised, cross-site, unnamed, oversized and non-image uploads store nothing", async context => {
  environment(context);
  const supabase = fakeSupabase(context);
  const cases: [Promise<Response>, number, RegExp][] = [
    [upload(await sideways(), {}, { origin: "https://attacker.example" }), 403, /sign in/],
    [upload(await sideways(), { title: " " }), 400, /short title/],
    [upload(await sideways(), { category: "admin" }), 400, /category/],
    [upload("<svg onload=alert(1)>"), 415, /not a photo we can use/],
    [upload(Buffer.alloc(4_100_000, 1)), 413, /too large/],
  ];
  for (const [pending, status, message] of cases) {
    const result = await pending;
    assert.equal(result.status, status);
    assert.match((await result.json()).error, message);
  }
  const huge = await collection.POST(new Request(`${ORIGIN}/api/admin/photos`, {
    method: "POST", body: "x", headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-length": "9000000", "content-type": "multipart/form-data; boundary=x" },
  }));
  assert.equal(huge.status, 413);
  assert.deepEqual(supabase.storageCalls(), []);
  assert.equal(supabase.calls.some(call => call.path.includes("dm_reserve_photo_name")), false);

  supabase.failures.set("POST /rest/v1/rpc/dm_admin_is_member", () => Response.json(false));
  const signedOut = await upload(await sideways());
  assert.equal(signedOut.status, 401);
  assert.deepEqual(supabase.storageCalls(), []);
});

test("a failed record removes the uploaded files, and Storage refusals are reported plainly", async context => {
  environment(context);
  const supabase = fakeSupabase(context);
  supabase.failures.set("POST /rest/v1/rpc/dm_add_photo", () => Response.json({ code: "XX000" }, { status: 503 }));
  const failed = await upload(await sideways());
  assert.equal(failed.status, 503);
  assert.deepEqual([...supabase.files.keys()], [], "no unlisted public file is left behind");
  const removal = supabase.storageCalls().find(call => call.method === "DELETE")!;
  assert.deepEqual(JSON.parse(removal.body.toString()).prefixes, ["hallway-repaint-stockton-heath.webp", "thumbs/hallway-repaint-stockton-heath.webp"]);

  // Hosted Storage reports an RLS refusal as HTTP 400 with statusCode 403 in the body.
  supabase.failures.delete("POST /rest/v1/rpc/dm_add_photo");
  supabase.failures.set("POST /storage/v1/object/site-photos/thumbs/hallway-repaint-stockton-heath-2.webp",
    () => Response.json({ statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" }, { status: 400 }));
  const refused = await upload(await sideways());
  assert.equal(refused.status, 403);
  assert.match((await refused.json()).error, /sign in/);
  assert.equal(supabase.records.length, 0);
});

test("before the migration is applied, the Photos page explains instead of failing", async context => {
  environment(context);
  const supabase = fakeSupabase(context);
  supabase.failures.set("POST /rest/v1/rpc/dm_list_photos", () => Response.json({ code: "PGRST202", message: "Could not find the function" }, { status: 404 }));
  const listed = await collection.GET();
  assert.equal(listed.status, 503);
  assert.deepEqual(await listed.json(), { error: "Photo storage has not been switched on yet. The rest of the admin works as normal.", setup: true });
  supabase.failures.set("POST /storage/v1/object/site-photos/thumbs/hallway-repaint-stockton-heath.webp", () => Response.json({ statusCode: "404", error: "Bucket not found", code: "NoSuchBucket" }, { status: 400 }));
  assert.equal((await upload(await sideways())).status, 503);
});

test("renaming keeps the web address unless asked; a new address moves both files", async context => {
  environment(context);
  const supabase = fakeSupabase(context);
  await upload(await sideways());
  const kept = await patch({ title: "Victorian hallway, Stockton Heath", altText: "Hallway after repainting", category: "before-after" });
  assert.equal(kept.status, 200);
  const keptPhoto = (await kept.json()).photo;
  assert.equal(keptPhoto.url, `${PUBLIC}/hallway-repaint-stockton-heath.webp`);
  assert.equal(keptPhoto.category, "before-after");
  assert.equal(supabase.calls.some(call => call.path === "/storage/v1/object/move"), false);

  const moved = await (await patch({ title: "Victorian hallway, Stockton Heath", altText: "", category: "interior", renameFile: true })).json();
  assert.equal(moved.photo.url, `${PUBLIC}/victorian-hallway-stockton-heath.webp`);
  assert.equal(moved.photo.thumbUrl, `${PUBLIC}/thumbs/victorian-hallway-stockton-heath.webp`);
  assert.deepEqual([...supabase.files.keys()].sort(), ["thumbs/victorian-hallway-stockton-heath.webp", "victorian-hallway-stockton-heath.webp"]);

  // The same title again changes nothing.
  const moves = supabase.calls.filter(call => call.path === "/storage/v1/object/move").length;
  await patch({ title: "Victorian hallway, Stockton Heath", altText: "", category: "interior", renameFile: true });
  assert.equal(supabase.calls.filter(call => call.path === "/storage/v1/object/move").length, moves);

  // A failed record update puts the files back where the record says they are.
  supabase.failures.set("POST /rest/v1/rpc/dm_update_photo", () => Response.json({ code: "XX000" }, { status: 503 }));
  assert.equal((await patch({ title: "Kitchen", altText: "", category: "interior", renameFile: true })).status, 503);
  assert.deepEqual([...supabase.files.keys()].sort(), ["thumbs/victorian-hallway-stockton-heath.webp", "victorian-hallway-stockton-heath.webp"]);

  assert.equal((await patch({ title: "", category: "interior" })).status, 400);
  assert.equal((await patch({ title: "x" }, "not-a-photo-id")).status, 404);
});

test("deleting removes the public files before the record, and stops if Storage refuses", async context => {
  environment(context);
  const supabase = fakeSupabase(context);
  await upload(await sideways());
  supabase.failures.set("DELETE /storage/v1/object/site-photos", () => Response.json({ statusCode: "500", error: "internal" }, { status: 500 }));
  assert.equal((await remove()).status, 503);
  assert.equal(supabase.records.length, 1, "the record stays while its file is still online");
  supabase.failures.delete("DELETE /storage/v1/object/site-photos");

  const deleted = await remove();
  assert.equal(deleted.status, 200);
  assert.equal(supabase.records.length, 0);
  assert.deepEqual([...supabase.files.keys()], []);
  const order = supabase.calls.map(call => call.path).filter(path => path === "/storage/v1/object/site-photos" || path.endsWith("/dm_delete_photo"));
  assert.deepEqual(order.slice(-2), ["/storage/v1/object/site-photos", "/rest/v1/rpc/dm_delete_photo"]);
  assert.equal((await remove()).status, 200, "deleting twice is harmless");
});
