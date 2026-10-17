"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { Card, Sheet } from "./ui";
import { backupFileName, createBackup, parseBackup } from "@/lib/admin/backup";
import type { ParsedBackup } from "@/lib/admin/backup";
import { formatShortDate } from "@/lib/admin/dates";
import { clock, commit, flush, importMissingRecords, readBrowserImport, readRecoveryImports, useAdminState } from "@/lib/admin/store";
import type { AdminData } from "@/lib/admin/types";

function backupFile(data: AdminData, now: string) {
  return new File([JSON.stringify(createBackup(data, now), null, 2)], backupFileName(now), { type: "application/json" });
}

export function BackupPanel({ data }: { data: AdminData }) {
  const input = useRef<HTMLInputElement>(null);
  const state = useAdminState();
  const [pending, setPending] = useState<ParsedBackup | null>(null);
  const [legacy, setLegacy] = useState<ParsedBackup | null>(null);
  const [recoveries, setRecoveries] = useState<ParsedBackup[]>([]);
  const [recoveryIndex, setRecoveryIndex] = useState(0);
  const recovery = recoveries[recoveryIndex] ?? null;
  const [importSettings, setImportSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setLegacy(readBrowserImport("legacy"));
    setRecoveries(readRecoveryImports());
    try { setCanShare(!!navigator.canShare?.({ files: [backupFile(data, clock().now)] })); }
    catch { setCanShare(false); }
    // Recheck sharing support and recoveries when the record set changes.
  }, [data]);

  const exported = (now: string) => {
    commit(d => ({ ...d, meta: { ...d.meta, lastBackupAt: now } }));
    setError("");
  };
  const download = () => {
    const { now } = clock();
    const url = URL.createObjectURL(backupFile(data, now));
    const link = document.createElement("a");
    link.href = url;
    link.download = backupFileName(now);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    exported(now);
    setMessage("Backup downloaded, including any edits still waiting to save. Keep this file private.");
  };
  const share = async () => {
    const { now } = clock();
    try {
      await navigator.share({ files: [backupFile(data, now)], title: "D&M admin backup" });
      exported(now);
      setMessage("Backup shared.");
    } catch { setMessage("Sharing was cancelled. You can download the backup instead."); }
  };
  const review = (backup: ParsedBackup | null) => {
    setImportSettings(false);
    setPending(backup);
    setError("");
    setMessage("");
  };
  const choose = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setError("This file is too large. Choose a D&M backup smaller than 8 MB.");
      return;
    }
    try { review(parseBackup(await file.text(), clock().now)); }
    catch { setError("The selected file could not be read. Your current records have not changed."); }
    if (input.current) input.current.value = "";
  };
  const apply = async () => {
    if (!pending?.ok || busy) return;
    setBusy(true);
    setError("");
    const incoming = pending.data;
    // The merge happens against the latest in-memory cloud version; no current
    // record can be removed or replaced by an older browser or backup copy.
    commit(current => importMissingRecords(current, incoming, importSettings));
    const saved = await flush();
    setBusy(false);
    setPending(null);
    if (saved) setMessage("Missing records imported and saved to cloud storage. Existing cloud records were kept. The source backup is unchanged.");
    else setError("The import has not reached cloud storage. Your imported records are kept in this page; retry saving or export a backup.");
  };

  const records = data.quotes.length + data.invoices.length + data.bookings.length;
  const added = pending?.ok ? {
    quotes: pending.data.quotes.filter(record => !data.quotes.some(existing => existing.id === record.id)).length,
    invoices: pending.data.invoices.filter(record => !data.invoices.some(existing => existing.id === record.id)).length,
    bookings: pending.data.bookings.filter(record => !data.bookings.some(existing => existing.id === record.id)).length,
  } : null;
  const blocked = state?.persistence === "conflict";

  return (
    <Card title="Cloud storage and backups" id="storage">
      <div className="adm-storage">
        <p>Your quotes, invoices, diary and business settings are saved securely in Supabase and synchronise across your signed-in devices. Export a private backup whenever you need an extra copy.</p>
        <dl className="adm-facts">
          <div><dt>Last exported backup</dt><dd>{data.meta.lastBackupAt ? formatShortDate(data.meta.lastBackupAt.slice(0, 10)) : "Never"}</dd></div>
          <div><dt>Records</dt><dd>{records}</dd></div>
        </dl>
        <div className="adm-actions">
          <button type="button" className="adm-btn" onClick={download}><Icon name="download" size={18} /> Export backup</button>
          {canShare && <button type="button" className="adm-btn adm-btn-ghost" onClick={share}><Icon name="upload" size={18} /> Share backup</button>}
          <button type="button" className="adm-btn adm-btn-ghost" disabled={blocked} onClick={() => input.current?.click()}><Icon name="upload" size={18} /> Import backup</button>
        </div>
        <input ref={input} type="file" accept="application/json,.json" hidden onChange={e => { void choose(e.target.files?.[0]); }} />
        {legacy && <div className="adm-stack">
          <p>Records from the original browser admin are still on this device. Review them before importing; the original copy will be kept.</p>
          <button type="button" className="adm-btn adm-btn-ghost" disabled={blocked} onClick={() => review(legacy)}>Review original browser records</button>
        </div>}
        {recovery && <div className="adm-stack">
          <p>An earlier visit left unsaved edits in this tab. Review or export them before closing this tab.</p>
          {recoveries.length > 1 && <label className="adm-field"><span className="adm-field-label">Recovered visit</span><select className="adm-input adm-select" value={recoveryIndex} onChange={event => setRecoveryIndex(Number(event.target.value))}>{recoveries.map((item, index) => <option key={index} value={index}>{item.ok && item.exportedAt ? new Date(item.exportedAt).toLocaleString("en-GB") : "Unreadable recovery"}{index === 0 ? " (latest)" : ""}</option>)}</select></label>}
          <div className="adm-actions">
            <button type="button" className="adm-btn adm-btn-ghost" disabled={blocked} onClick={() => review(recovery)}>Review recovered edits</button>
            {recovery.ok && <button type="button" className="adm-btn adm-btn-ghost" onClick={() => {
              const url = URL.createObjectURL(backupFile(recovery.data, clock().now));
              const link = document.createElement("a");
              link.href = url;
              link.download = "dm-admin-recovered-edits.json";
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 2000);
            }}>Export recovered edits</button>}
          </div>
        </div>}
        {message && <p className="adm-inline-ok" role="status">{message}</p>}
        {error && <p className="adm-inline-error" role="alert">{error}</p>}
        {blocked && <p className="adm-inline-error">Export your pending edits, then use Reload cloud records above to resolve the conflict before importing.</p>}
        <p className="adm-muted adm-small">Backup files contain customer details. Store them privately. Importing adds missing records and keeps existing cloud records. Original browser records and backup files are never deleted.</p>
      </div>
      <Sheet open={!!pending} onClose={() => { if (!busy) setPending(null); }} title="Review import" actions={pending?.ok ? <button type="button" className="adm-btn" disabled={busy || blocked} onClick={() => { void apply(); }}>{busy ? "Saving import…" : "Import missing records"}</button> : undefined}>
        {pending && !pending.ok && <p className="adm-inline-error">{pending.error}</p>}
        {pending?.ok && added && <div className="adm-stack">
          <p>{pending.exportedAt ? `Backup from ${formatShortDate(pending.exportedAt.slice(0, 10))}. ` : "Original browser records. "}Contains {pending.data.quotes.length} quotes, {pending.data.invoices.length} invoices and {pending.data.bookings.length} bookings.</p>
          <p><strong>Will add {added.quotes} quotes, {added.invoices} invoices and {added.bookings} bookings.</strong> Existing records with the same ID will be kept. Document numbers may be adjusted securely to prevent duplicates.</p>
          <label className="adm-check"><input type="checkbox" checked={importSettings} onChange={e => setImportSettings(e.target.checked)} /> Also use business settings from this backup</label>
          {importSettings && <p className="adm-inline-error">This replaces business contact details, bank details and document defaults. Check the imported settings before sharing any documents.</p>}
        </div>}
      </Sheet>
    </Card>
  );
}
