"use client";
import { useState } from "react";
import { browserSupabase } from "@/lib/supabase/client";

type Mode = "sign-in" | "reset" | "reset-sent";

function authMessage(error: { message?: string; status?: number; code?: string }): string {
  if (error.status === 429 || error.code === "over_request_rate_limit") return "Too many attempts. Wait a few minutes and try again.";
  if (error.code === "invalid_credentials" || /invalid login/i.test(error.message ?? "")) return "That email or password isn't right.";
  if (error.code === "email_not_confirmed") return "That email address hasn't been confirmed yet.";
  if (!error.status) return "Couldn't reach the sign-in service. Check your connection and try again.";
  return error.message || "Sign-in failed. Try again.";
}

export function LoginPanel({ configured, next, notice, signedInAs }: {
  configured: boolean;
  next: string;
  notice: string;
  signedInAs: string;
}) {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!configured) {
    return (
      <p className="adm-inline-error">
        The admin isn&apos;t connected to its sign-in service yet, so nobody can sign in. This is a configuration step for the
        site administrator.
      </p>
    );
  }
  const supabase = browserSupabase()!;

  if (signedInAs) {
    return (
      <div className="adm-stack">
        {notice && <p className="adm-inline-error">{notice}</p>}
        <p className="adm-muted">
          You&apos;re signed in as <strong>{signedInAs}</strong>, which doesn&apos;t have access to the D&amp;M admin.
        </p>
        <button
          type="button"
          className="adm-btn"
          onClick={async () => {
            await supabase.auth.signOut({ scope: "local" });
            window.location.assign("/admin/login");
          }}
        >
          Sign out and use another account
        </button>
      </div>
    );
  }

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) {
      setError(authMessage(signInError));
      setBusy(false);
      return;
    }
    const { data: member, error: memberError } = await supabase.rpc("dm_admin_is_member");
    if (memberError || member !== true) {
      await supabase.auth.signOut({ scope: "local" });
      setError(memberError ? "We couldn't confirm your access. Try again in a moment." : "That account isn't set up for the D&M admin.");
      setBusy(false);
      return;
    }
    // A full page load lets the server see the new session.
    window.location.assign(next);
  };

  const requestReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const redirectTo = `${window.location.origin}/admin/auth/confirm?next=${encodeURIComponent("/admin/password")}`;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    setBusy(false);
    if (resetError && (resetError.status === 429 || !resetError.status)) {
      setError(authMessage(resetError));
      return;
    }
    // Same answer whether or not the address has an account.
    setMode("reset-sent");
  };

  if (mode === "reset-sent") {
    return (
      <div className="adm-stack">
        <p className="adm-inline-ok">If that email belongs to an admin account, a link to set a new password is on its way.</p>
        <p className="adm-muted adm-small">Open the link on this device and in this browser. It expires after a short time.</p>
        <button type="button" className="adm-btn adm-btn-ghost" onClick={() => setMode("sign-in")}>
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form className="adm-stack" onSubmit={mode === "sign-in" ? signIn : requestReset}>
      {notice && <p className={notice === "You've signed out." ? "adm-inline-ok" : "adm-inline-error"}>{notice}</p>}
      {mode === "reset" && <p className="adm-muted">Enter your email and we&apos;ll send a link to set a new password.</p>}
      <label className="adm-field">
        <span className="adm-field-label">Email</span>
        <input className="adm-input" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} />
      </label>
      {mode === "sign-in" && (
        <label className="adm-field">
          <span className="adm-field-label">Password</span>
          <input
            className="adm-input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </label>
      )}
      {error && (
        <p className="adm-inline-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="adm-btn adm-btn-wide" disabled={busy}>
        {busy ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Send reset link"}
      </button>
      <button type="button" className="adm-link-button" onClick={() => (setMode(mode === "sign-in" ? "reset" : "sign-in"), setError(""))}>
        {mode === "sign-in" ? "Forgotten your password?" : "Back to sign in"}
      </button>
    </form>
  );
}
