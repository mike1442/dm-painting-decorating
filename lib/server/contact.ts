import { randomUUID } from "node:crypto";
import { CONTACT_PHOTO_TYPES, MAX_CONTACT_PHOTO_BYTES, MAX_CONTACT_REQUEST_BYTES } from "../contact.ts";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
const failure = (error: string, status: number) => Response.json({ error }, { status });

function imageFormat(bytes: Buffer) {
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { contentType: "image/jpeg", extension: "jpg" };
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { contentType: "image/png", extension: "png" };
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return { contentType: "image/webp", extension: "webp" };
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") {
    const brand = bytes.toString("ascii", 8, 12);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis"].includes(brand)) return { contentType: "image/heic", extension: "heic" };
    if (["mif1", "msf1"].includes(brand)) return { contentType: "image/heif", extension: "heif" };
  }
  return null;
}

type ContactConfig = { apiKey?: string; from?: string; fetcher?: typeof fetch };

export async function handleContactRequest(req: Request, config: ContactConfig = {}) {
  const apiKey = config.apiKey ?? process.env.RESEND_API_KEY;
  const from = config.from ?? process.env.DM_CONTACT_FROM_EMAIL;
  if (!apiKey || !from) return failure("The contact form is not yet connected. Please email info@dmpaintingdecorating.co.uk directly.", 503);
  if (Number(req.headers.get("content-length") || 0) > MAX_CONTACT_REQUEST_BYTES) return failure("Photos are too large to send. Please choose smaller photos or email them directly.", 413);
  let fd: FormData;
  try { fd = await req.formData(); }
  catch { return failure("Please check your enquiry and try again.", 400); }
  const get = (key: string) => { const value = fd.get(key); return typeof value === "string" ? value.trim() : ""; };
  if (get("website")) return Response.json({ ok: true });
  const name = get("name"), email = get("email"), phone = get("phone"), location = get("location"), projectType = get("projectType"), message = get("message");
  if (!name || name.length > 120 || !emailPattern.test(email) || email.length > 180 || !phone || phone.length > 40 || !location || location.length > 120 || projectType.length > 120 || !message || message.length > 5000 || get("consent") !== "on") {
    return failure("Please check the required fields and try again.", 400);
  }
  const requestId = get("requestId") || randomUUID();
  if (!uuidPattern.test(requestId)) return failure("Please reload the form and try again.", 400);
  const parts = fd.getAll("photos");
  if (parts.some(part => !(part instanceof File))) return failure("Please choose supported photo files.", 400);
  const photos = parts as File[];
  if (photos.length > 6 || photos.some(f => !CONTACT_PHOTO_TYPES.includes(f.type) || !f.size) || photos.reduce((n, f) => n + f.size, 0) > MAX_CONTACT_PHOTO_BYTES) {
    return failure("Please choose up to 6 supported photos, under 4 MB in total after resizing, or email your photos directly.", 400);
  }
  const attachments: { filename: string; content: string; content_type: string }[] = [];
  for (const photo of photos) {
    const bytes = Buffer.from(await photo.arrayBuffer());
    const format = imageFormat(bytes);
    if (!format) return failure("A photo could not be recognised. Please use JPG, PNG, WEBP or HEIC photos.", 400);
    // Never let the untrusted filename select an active attachment type.
    const basename = photo.name.replace(/\.[^.]*$/, "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 90) || "photo";
    attachments.push({ filename: `${basename}.${format.extension}`, content: bytes.toString("base64"), content_type: format.contentType });
  }
  const fields = [["Name", name], ["Email", email], ["Phone", phone], ["Area / postcode", location], ["Project type", projectType || "Not specified"], ["Description", message], ["Photos attached", String(photos.length)]];
  const text = fields.map(([label, value]) => label + ": " + value).join("\n\n");
  const rows = fields.map(([label, value]) => `<tr><th style="text-align:left;vertical-align:top;padding:14px 16px;border-bottom:1px solid #e5e7eb;color:#475569;width:150px;font-size:13px">${escapeHtml(label)}</th><td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:15px;white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(value)}</td></tr>`).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>New D&amp;M website enquiry</title></head><body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif"><div style="max-width:680px;margin:30px auto;background:#fff;border-radius:12px;overflow:hidden"><div style="background:#17283a;color:#fff;padding:28px 30px"><div style="font-size:13px;letter-spacing:2px;font-weight:bold">D&amp;M PAINTING &amp; DECORATING</div><h1 style="font-size:26px;margin:15px 0 5px">New website enquiry</h1><p style="margin:0;color:#cbd5e1">A customer has requested a decorating quote.</p></div><div style="padding:20px 16px"><table role="presentation" style="width:100%;border-collapse:collapse">${rows}</table><p style="font-size:13px;color:#64748b;padding:12px 16px">Reply to this email to contact the customer. Any uploaded photos are attached to this message.</p></div></div></body></html>`;
  try {
    const result = await (config.fetcher ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `website-enquiry/${requestId}` },
      body: JSON.stringify({ from, to: ["info@dmpaintingdecorating.co.uk"], reply_to: email, subject: "D&M decorating enquiry — " + location.replace(/[\r\n]/g, " ").slice(0, 80), html, text, attachments }),
    });
    if (!result.ok) {
      console.error("D&M contact email failed", result.status);
      return failure("We couldn't send your enquiry. Please try again or email info@dmpaintingdecorating.co.uk directly.", 502);
    }
    return Response.json({ ok: true });
  } catch {
    console.error("D&M contact email request failed");
    return failure("We couldn't confirm your enquiry was sent. Please try again or email info@dmpaintingdecorating.co.uk directly.", 502);
  }
}
