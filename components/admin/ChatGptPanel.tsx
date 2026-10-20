"use client";
import { useEffect, useState } from "react";
import { Field } from "./fields";
import { Icon } from "./Icon";
import { Card } from "./ui";
import "./ShareControls.css";

type Connection = {
  configured: boolean;
  connectorUrl: string;
  customGpt: { instructions: string; openApiUrl: string; authorizationUrl: string; tokenUrl: string; clientId: string; clientSecret: string; scope: string } | null;
};

function CopyField({ label, value, secret = false, multiline = false }: { label: string; value: string; secret?: boolean; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="adm-share-link">
      <Field label={label}>
        {control => multiline
          ? <textarea {...control} className="adm-input adm-textarea adm-code" rows={6} value={value} readOnly onFocus={event => event.target.select()} />
          : <input {...control} className="adm-input adm-code" type={secret ? "password" : "text"} value={value} readOnly onFocus={event => event.target.select()} />}
      </Field>
      <button type="button" className="adm-btn adm-btn-ghost" onClick={async () => {
        try { await navigator.clipboard.writeText(value); setCopied(true); } catch { setCopied(false); }
      }}>
        <Icon name="copy" size={16} /> {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** Settings → ChatGPT: how Mike connects his own ChatGPT account, and how to cut it off. */
export function ChatGptPanel() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/chatgpt", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error()))
      .then((value: Connection) => setConnection(value))
      .catch(() => { if (!controller.signal.aborted) setMessage("The ChatGPT connection details could not be loaded. Reload the page to try again."); });
    return () => controller.abort();
  }, []);

  async function disconnect() {
    if (!window.confirm("Disconnect ChatGPT now? ChatGPT and every other signed-in device lose access straight away. This browser stays signed in.")) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/chatgpt", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "disconnect" }),
      });
      setMessage(response.ok ? "ChatGPT has been disconnected, and other devices signed out. To use ChatGPT again, reconnect D&M in ChatGPT and approve it." : "ChatGPT could not be disconnected. Please try again.");
    } catch {
      setMessage("ChatGPT could not be disconnected. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  return (
    <Card title="ChatGPT">
      <p className="adm-muted adm-small">
        Let your own ChatGPT create quotes and invoices, return customer links and keep the diary, just by asking.
        ChatGPT only gets access after you sign in and approve it on a D&amp;M page. It never sees your password.
      </p>
      {!connection && !message && <p className="adm-muted adm-small" role="status">Loading…</p>}
      {connection && !connection.configured && (
        <p className="adm-inline-warn" role="alert">The ChatGPT connection is switched off on this website. It needs the DM_CHATGPT_SECRET setting in Vercel (see docs/chatgpt.md).</p>
      )}
      {connection?.configured && (
        <>
          {connection.customGpt && (
            <>
              <p className="adm-small"><strong>Works on iPhone: your own D&amp;M GPT.</strong> Set it up once on a computer at chatgpt.com; then use it in the ChatGPT app.</p>
              <ol className="adm-small">
                <li>In ChatGPT, open GPTs → Create → Configure. Name it “D&amp;M Admin”, keep it “Only me”, and paste the Instructions below.</li>
                <li>Under Actions, choose Create new action → Import from URL, and paste the address below.</li>
                <li>Choose Authentication → OAuth and paste the Client ID, Client secret, Authorization URL, Token URL and Scope below. Token exchange method: Default (POST request). Save, then Create.</li>
                <li>On your iPhone, open the ChatGPT app → GPTs → D&amp;M Admin. The first time, tap Sign in, enter your D&amp;M admin password and tap Allow.</li>
              </ol>
              <CopyField label="Instructions" value={connection.customGpt.instructions} multiline />
              <CopyField label="Import from URL" value={connection.customGpt.openApiUrl} />
              <CopyField label="Client ID" value={connection.customGpt.clientId} />
              <CopyField label="Client secret" value={connection.customGpt.clientSecret} secret />
              <CopyField label="Authorization URL" value={connection.customGpt.authorizationUrl} />
              <CopyField label="Token URL" value={connection.customGpt.tokenUrl} />
              <CopyField label="Scope" value={connection.customGpt.scope} />
            </>
          )}
          <details className="adm-small">
            <summary>On a computer instead: the D&amp;M ChatGPT app (Developer mode)</summary>
            <ol>
              <li>In ChatGPT, open Settings → Apps (or Apps &amp; Connectors) → Advanced settings, and turn on Developer mode.</li>
              <li>Choose Create app. Name it “D&amp;M Admin”, paste the address below, choose OAuth, tick that you trust it, and press Create.</li>
              <li>A D&amp;M page opens: enter your admin password and press Allow.</li>
              <li>In a chat, add D&amp;M Admin from the + menu and ask, for example: “Create a quote for Paul Finn, 6 Falkstone Close, Gorse Covert, WA3 6SU. Living room, 25 m² walls, two days, £400 labour, £118 materials.”</li>
            </ol>
            <CopyField label="ChatGPT app address" value={connection.connectorUrl} />
          </details>
          <div className="adm-actions">
            <button type="button" className="adm-btn adm-btn-ghost" disabled={busy} onClick={() => void disconnect()}>
              {busy ? "Disconnecting…" : "Disconnect ChatGPT"}
            </button>
          </div>
          <p className="adm-muted adm-small">Disconnecting signs out ChatGPT and every other device straight away, but keeps this browser signed in.</p>
        </>
      )}
      {message && <p className="adm-muted adm-small" role="status">{message}</p>}
    </Card>
  );
}
