"use client";
import { useEffect, useState, type FormEvent } from "react";
import { BrandLogo } from "@/components/documents/BrandLogo";
import { ADMIN_EMAIL } from "@/lib/admin/auth";
import { adminReturnPath } from "@/lib/admin/return-path";
export function LoginForm() {
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("signout") === "local") {
      setNotice("You are signed out on this device. The server could not confirm session revocation. Sign in and sign out again when the connection returns.");
    }
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Sign-in failed.");
      window.location.assign(adminReturnPath(new URLSearchParams(window.location.search).get("next"), window.location.origin));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not connect. Please try again."); setBusy(false); }
  }
  return <main className="adm" style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 20 }}>
    <section className="adm-card" style={{ width: "100%", maxWidth: 400, padding: 28 }}>
      <div style={{ width: 180 }}><BrandLogo tone="ink" /></div><h1>Admin sign in</h1><p>Quotes, invoices and diary.</p>
      {notice && <p role="status">{notice}</p>}
      <form onSubmit={submit} style={{ display: "grid", gap: 18 }}>
        <label>Email<input name="email" type="email" autoComplete="username" defaultValue={ADMIN_EMAIL} required className="adm-input" style={{ width: "100%" }} /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" minLength={8} maxLength={200} required className="adm-input" style={{ width: "100%" }} /></label>
        {error && <p role="alert">{error}</p>}
        <button className="adm-btn" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </section>
  </main>;
}
