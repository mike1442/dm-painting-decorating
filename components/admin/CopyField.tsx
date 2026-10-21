"use client";
import { useState } from "react";
import { Field } from "./fields";
import { Icon } from "./Icon";
import "./ShareControls.css";

/** A read-only value with a Copy button, e.g. instructions to paste into ChatGPT. */
export function CopyField({ label, value, secret = false, multiline = false }: { label: string; value: string; secret?: boolean; multiline?: boolean }) {
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
