"use client";
import Link from "next/link";
import { useState } from "react";
import { browserSupabase } from "@/lib/supabase/client";

const MIN_LENGTH = 10;

export function PasswordForm({ email }: { email: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (password.length < MIN_LENGTH) return setError(`Use at least ${MIN_LENGTH} characters.`);
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    const { error: updateError } = await browserSupabase()!.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(
        updateError.code === "same_password"
          ? "Choose a password you haven't used here before."
          : updateError.code === "weak_password"
            ? "That password is too easy to guess. Try a longer one."
            : updateError.message || "The password couldn't be changed. Try again.",
      );
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <div className="adm-stack">
        <p className="adm-inline-ok">Your password has been changed.</p>
        <Link className="adm-btn adm-btn-wide" href="/admin">
          Continue to the admin
        </Link>
      </div>
    );
  }

  return (
    <form className="adm-stack" onSubmit={submit}>
      <p className="adm-muted">
        For <strong>{email}</strong>
      </p>
      <input type="email" autoComplete="username" value={email} readOnly hidden />
      <label className="adm-field">
        <span className="adm-field-label">New password</span>
        <input className="adm-input" type="password" autoComplete="new-password" required minLength={MIN_LENGTH} value={password} onChange={e => setPassword(e.target.value)} />
      </label>
      <label className="adm-field">
        <span className="adm-field-label">Repeat new password</span>
        <input className="adm-input" type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} />
      </label>
      {error && (
        <p className="adm-inline-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="adm-btn adm-btn-wide" disabled={busy}>
        {busy ? "Saving…" : "Save new password"}
      </button>
      <Link className="adm-link-button" href="/admin/settings">
        Cancel
      </Link>
    </form>
  );
}
