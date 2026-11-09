"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/documents/BrandLogo";
import "../admin/admin.css";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const recoveryToken = params.get("type") === "recovery" ? params.get("access_token") : null;
    const recoveryError = params.get("error_description") || params.get("error");
    // Recovery credentials must not remain in browser history or be copied with the URL.
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    if (recoveryToken) setToken(recoveryToken);
    else setError(recoveryError || "This reset link is missing or has expired. Please request a new one.");
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") || "");
    if (password.length < 12) { setError("Use at least 12 characters."); return; }
    if (password !== data.get("confirm")) { setError("The passwords don't match."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not reset the password.");
      setToken(""); setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reset the password.");
    } finally { setBusy(false); }
  }

  return <main className="adm" style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 20 }}>
    <section className="adm-card" style={{ width: "100%", maxWidth: 400, padding: 28 }}>
      <div style={{ width: 180 }}><BrandLogo tone="ink" /></div>
      <h1>Reset admin password</h1>
      {done ? <><p role="status">Your password has been changed. You can now sign in.</p><Link href="/login">Return to admin sign in</Link></> :
        <><p>Choose a new password of at least 12 characters.</p>
          {token && <form onSubmit={submit} style={{ display: "grid", gap: 18 }}>
            <label>New password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={200} required className="adm-input" style={{ width: "100%" }} /></label>
            <label>Confirm password<input name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={200} required className="adm-input" style={{ width: "100%" }} /></label>
            <button className="adm-btn" disabled={busy}>{busy ? "Saving…" : "Change password"}</button>
          </form>}
          {error && <p role="alert">{error}</p>}
          <p><Link href="/login">Back to sign in</Link></p>
        </>}
    </section>
  </main>;
}
