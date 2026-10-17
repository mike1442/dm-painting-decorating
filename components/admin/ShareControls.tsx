"use client";

import { useEffect, useRef, useState } from "react";
import { flush } from "@/lib/admin/store";
import { Icon } from "./Icon";
import "./ShareControls.css";

/** Customer links are held in memory only. The database stores their hashes. */
export function ShareControls({ id }: { id: string }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    setUrl("");
    setMessage("");
    setFailed(false);
    setBusy(false);
    return () => request.current?.abort();
  }, [id]);

  async function change(action: "create" | "revoke") {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setMessage("");
    setFailed(false);

    try {
      if (action === "create" && !(await flush())) {
        throw new Error("Save your changes successfully before creating a customer link.");
      }
      if (controller.signal.aborted) return;
      const response = await fetch("/api/admin/share", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(response.status === 401
          ? "Your session has expired. Sign in again to manage customer links."
          : "The customer link could not be updated. Please try again.");
      }
      if (action === "create") {
        const result: unknown = await response.json();
        const value = typeof result === "object" && result !== null && "url" in result ? result.url : null;
        if (typeof value !== "string") throw new Error("The customer link could not be created. Please try again.");
        const link = new URL(value, window.location.origin);
        if (link.origin !== window.location.origin || !/^\/d\/[a-f0-9]{64}$/.test(link.pathname) || link.search || link.hash) {
          throw new Error("The customer link could not be created. Please try again.");
        }
        setUrl(link.href);
        setMessage("Link created. Copy it below. Any previous link has stopped working.");
      } else {
        setUrl("");
        setMessage("Customer access revoked. Previous links no longer work.");
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "The customer link could not be updated. Please try again.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function copy() {
    setFailed(false);
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Customer link copied.");
    } catch {
      input.current?.focus();
      input.current?.select();
      setMessage("The link is selected. Choose Copy from your browser menu.");
    }
  }

  return (
    <section className="adm-share adm-chrome" aria-label="Customer link" aria-busy={busy}>
      <div className="adm-share-heading">
        <Icon name="link" size={18} />
        <h2>Customer link</h2>
      </div>
      <p className="adm-muted adm-small">
        Anyone with the link can view this document and save a PDF. It gives access to this document only.
        Copy the link before leaving this page, or create a replacement later.
      </p>
      <div className="adm-actions">
        <button type="button" className="adm-btn adm-btn-small" disabled={busy} onClick={() => void change("create")}>
          <Icon name="link" size={16} /> {busy ? "Updating…" : url ? "Replace link" : "Create customer link"}
        </button>
        <button type="button" className="adm-btn adm-btn-ghost adm-btn-small" disabled={busy} onClick={() => void change("revoke")}>
          Revoke customer access
        </button>
      </div>
      {url && (
        <div className="adm-share-link">
          <label className="adm-field">
            <span className="adm-field-label">Customer link</span>
            <input ref={input} className="adm-input" value={url} readOnly onFocus={event => event.target.select()} />
          </label>
          <button type="button" className="adm-btn adm-btn-ghost" onClick={() => void copy()}>
            <Icon name="copy" size={16} /> Copy
          </button>
          <a className="adm-btn adm-btn-ghost" href={url} target="_blank" rel="noopener noreferrer">Open</a>
        </div>
      )}
      {message && <p className={failed ? "adm-inline-warn" : "adm-muted adm-small"} role={failed ? "alert" : "status"}>{message}</p>}
    </section>
  );
}
