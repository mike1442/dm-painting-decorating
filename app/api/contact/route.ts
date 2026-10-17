import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);

export async function POST(req: NextRequest) {
  try {
    if (!process.env.RESEND_API_KEY || !process.env.DM_CONTACT_FROM_EMAIL) {
      return NextResponse.json({ error: "The contact form is not yet connected. Please email info@dmpaintingdecorating.co.uk directly." }, { status: 503 });
    }
    const length = Number(req.headers.get("content-length") || 0);
    if (length > 19 * 1024 * 1024) return NextResponse.json({ error: "Photos are too large. Please reduce their size." }, { status: 413 });
    const fd = await req.formData();
    const get = (key: string) => String(fd.get(key) || "").trim();
    if (get("website")) return NextResponse.json({ ok: true });
    const name = get("name"), email = get("email"), phone = get("phone"), location = get("location"), projectType = get("projectType"), message = get("message");
    if (!name || name.length > 120 || !emailPattern.test(email) || email.length > 180 || !phone || phone.length > 40 || !location || location.length > 120 || !message || message.length > 5000 || get("consent") !== "on") {
      return NextResponse.json({ error: "Please check the required fields and try again." }, { status: 400 });
    }
    const photos = fd.getAll("photos").filter((x): x is File => x instanceof File);
    if (photos.length > 6 || photos.some(f => !allowed.has(f.type) || f.size > 5 * 1024 * 1024) || photos.reduce((n, f) => n + f.size, 0) > 15 * 1024 * 1024) {
      return NextResponse.json({ error: "Please upload up to 6 supported photos, under 5 MB each and 15 MB in total." }, { status: 400 });
    }
    const attachments = await Promise.all(photos.map(async f => ({ filename: f.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "photo", content: Buffer.from(await f.arrayBuffer()).toString("base64") })));
    const fields = [["Name", name], ["Email", email], ["Phone", phone], ["Area / postcode", location], ["Project type", projectType || "Not specified"], ["Description", message], ["Photos attached", String(photos.length)]];
    const text = fields.map(([label, value]) => label + ": " + value).join("\n\n");
    const rows = fields.map(([label, value]) => `<tr><th style="text-align:left;vertical-align:top;padding:14px 16px;border-bottom:1px solid #e5e7eb;color:#475569;width:150px;font-size:13px">${escapeHtml(label)}</th><td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:15px;white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(value)}</td></tr>`).join("");
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif"><div style="max-width:680px;margin:30px auto;background:#fff;border-radius:12px;overflow:hidden"><div style="background:#17283a;color:#fff;padding:28px 30px"><div style="font-size:13px;letter-spacing:2px;font-weight:bold">D&amp;M PAINTING &amp; DECORATING</div><h1 style="font-size:26px;margin:15px 0 5px">New website enquiry</h1><p style="margin:0;color:#cbd5e1">A customer has requested a decorating quote.</p></div><div style="padding:20px 16px"><table role="presentation" style="width:100%;border-collapse:collapse">${rows}</table><p style="font-size:13px;color:#64748b;padding:12px 16px">Reply to this email to contact the customer. Any uploaded photos are attached to this message.</p></div></div></body></html>`;
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.DM_CONTACT_FROM_EMAIL, to: ["info@dmpaintingdecorating.co.uk"], reply_to: email, subject: "D&M decorating enquiry — " + location.replace(/[\r\n]/g, " ").slice(0, 80), html, text, attachments })
    });
    if (!result.ok) {
      console.error("D&M contact email failed", result.status);
      return NextResponse.json({ error: "We couldn't send your enquiry. Please email info@dmpaintingdecorating.co.uk directly." }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("D&M contact error", e);
    return NextResponse.json({ error: "We couldn't send your enquiry. Please email us directly." }, { status: 500 });
  }
}
