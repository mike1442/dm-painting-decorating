import assert from "node:assert/strict";
import { test } from "node:test";
import { handleContactRequest } from "../../lib/server/contact.ts";
import { MAX_CONTACT_PHOTO_BYTES, MAX_CONTACT_REQUEST_BYTES } from "../../lib/contact.ts";

const requestId = "f52009e8-4919-4ca5-9294-06d253531e53";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGm0AAAAASUVORK5CYII=", "base64");
function form() {
  const fd = new FormData();
  for (const [key, value] of Object.entries({ name: "TEST ONLY <script>alert(1)</script>", email: "test@example.com", phone: "00000000000", location: "TEST ONLY", projectType: "One room", message: "Verification only — please ignore. Not a real job.", consent: "on", requestId })) fd.set(key, value);
  return fd;
}
const request = (fd: FormData, headers?: HeadersInit) => new Request("https://example.com/api/contact", { method: "POST", body: fd, headers });
const noSend = (async () => { assert.fail("Invalid enquiries must never reach the email provider"); }) as typeof fetch;
const config = { apiKey: "test-key", from: "Website <enquiries@example.com>", fetcher: noSend };

test("contact service reports missing configuration without claiming delivery", async () => {
  const response = await handleContactRequest(request(form()), { ...config, apiKey: "" });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not yet connected/);
});

test("valid enquiry preserves actual attachment bytes and escapes customer content", async () => {
  const fd = form();
  fd.append("photos", new File([png], "wall<script>.png", { type: "image/png" }));
  let calls = 0;
  const response = await handleContactRequest(request(fd), { ...config, fetcher: (async (url, init) => {
    calls++;
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(new Headers(init?.headers).get("Idempotency-Key"), `website-enquiry/${requestId}`);
    assert.ok(init?.signal, "Provider requests must have a timeout");
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.to, ["info@dmpaintingdecorating.co.uk"]);
    assert.equal(body.from, config.from);
    assert.equal(body.reply_to, "test@example.com");
    assert.equal(body.attachments[0].filename, "wall_script_.png");
    assert.deepEqual(Buffer.from(body.attachments[0].content, "base64"), png);
    assert.match(body.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(body.html, /<script>/);
    assert.match(body.text, /Photos attached: 1/);
    return Response.json({ id: "test-provider-id" });
  }) as typeof fetch });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls, 1);
});

test("contact honeypot does not send a notification", async () => {
  const fd = form(); fd.set("website", "spam.example");
  assert.equal((await handleContactRequest(request(fd), config)).status, 200);
});

test("invalid contact fields and missing consent are rejected before sending", async () => {
  for (const [key, value] of [["name", ""], ["email", "bad\r\nBcc: victim@example.com"], ["consent", ""], ["projectType", "x".repeat(121)], ["message", "x".repeat(5001)], ["requestId", "invalid"]]) {
    const fd = form(); fd.set(key, value);
    assert.equal((await handleContactRequest(request(fd), config)).status, 400, key);
  }
});

test("fake images, empty files and unsupported file types never become attachments", async () => {
  for (const photo of [new File(["<script>bad</script>"], "fake.png", { type: "image/png" }), new File([], "empty.jpg", { type: "image/jpeg" }), new File([png], "wall.exe", { type: "application/octet-stream" })]) {
    const fd = form(); fd.append("photos", photo);
    assert.equal((await handleContactRequest(request(fd), config)).status, 400);
  }
  const fd = form(); fd.append("photos", "not a file");
  assert.equal((await handleContactRequest(request(fd), config)).status, 400);
});

test("photo counts and total request size stay below platform limits", async () => {
  const tooMany = form();
  for (let i = 0; i < 7; i++) tooMany.append("photos", new File([png], `wall-${i}.png`, { type: "image/png" }));
  assert.equal((await handleContactRequest(request(tooMany), config)).status, 400);
  const tooLarge = form(); tooLarge.append("photos", new File([Buffer.alloc(MAX_CONTACT_PHOTO_BYTES + 1)], "wall.png", { type: "image/png" }));
  assert.equal((await handleContactRequest(request(tooLarge), config)).status, 400);
  assert.equal((await handleContactRequest(request(form(), { "content-length": String(MAX_CONTACT_REQUEST_BYTES + 1) }), config)).status, 413);
});

test("malformed request bodies receive a useful client error", async () => {
  assert.equal((await handleContactRequest(new Request("https://example.com/api/contact", { method: "POST", body: "invalid body" }), config)).status, 400);
});

test("provider errors and timeouts never produce a successful enquiry response", async () => {
  for (const fetcher of [(async () => Response.json({ error: "unverified sender" }, { status: 403 })), (async () => { throw new DOMException("Timeout", "TimeoutError"); })]) {
    const response = await handleContactRequest(request(form()), { ...config, fetcher: fetcher as typeof fetch });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /email info@dmpaintingdecorating.co.uk directly/);
  }
});

test("retrying the same submission keeps the provider idempotency key", async () => {
  const keys: string[] = [];
  const fetcher = (async (_url, init) => { keys.push(new Headers(init?.headers).get("Idempotency-Key") || ""); return Response.json({ id: "same-email" }); }) as typeof fetch;
  await handleContactRequest(request(form()), { ...config, fetcher });
  await handleContactRequest(request(form()), { ...config, fetcher });
  assert.deepEqual(keys, [`website-enquiry/${requestId}`, `website-enquiry/${requestId}`]);
});
