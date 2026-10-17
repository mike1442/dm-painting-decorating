"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { ImportReview } from "./ImportReview";
import type { ImportResult, ImportSource } from "./ImportReview";
import { Card } from "./ui";
import { backupFileName, createBackup, parseBackup } from "@/lib/admin/backup";
import { formatShortDate } from "@/lib/admin/dates";
import { countRecords } from "@/lib/admin/importer";
import { markLegacyImported, readLegacyRecords, removeLegacyRecords } from "@/lib/admin/legacy";
import type { LegacyRecords } from "@/lib/admin/legacy";
import { clock, commit, useSyncStatus } from "@/lib/admin/store";
import type { AdminData } from "@/lib/admin/types";

function backupFile(data: AdminData, now: string) {
  return new File([JSON.stringify(createBackup(data, now), null, 2)], backupFileName(now), { type: "application/json" });
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const markBackedUp = (now: string) => commit(d => ({ ...d, meta: { ...d.meta, lastBackupAt: now } }), { immediate: true });

const syncText = { saved: "All saved", saving: "Saving…", offline: "Offline", failed: "Not saved", conflict: "Needs attention", "signed-out": "Signed out" };

function summary(result: ImportResult): string {
  const parts = [`Imported ${plural(result.imported, "record")}.`];
  if (result.renumbered.length) parts.push(`Renumbered: ${result.renumbered.map(r => `${r.from} → ${r.to}`).join(", ")}.`);
  parts.push(result.saved ? "Everything is saved online." : "Saving is still in progress; keep this page open until it says Saved.");
  return parts.join(" ");
}

export function BackupPanel({ data }: { data: AdminData }) {
  const input = useRef<HTMLInputElement>(null);
  const sync = useSyncStatus();
  const [source, setSource] = useState<ImportSource | null>(null);
  const [fromBrowser, setFromBrowser] = useState(false);
  const [legacy, setLegacy] = useState<LegacyRecords | null>(null);
  const [message, setMessage] = useState("");
  const [fileError, setFileError] = useState("");
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setLegacy(readLegacyRecords());
    try {
      setCanShare(!!navigator.canShare?.({ files: [backupFile(data, clock().now)] }));
    } catch {
      setCanShare(false);
    }
    // Capability and legacy checks only need to run once.
  }, []);

  const exportBackup = () => {
    const { now } = clock();
    download(backupFile(data, now));
    markBackedUp(now);
    setMessage("Backup downloaded. Keep it somewhere private, such as your email or cloud storage.");
  };
  const share = async () => {
    const { now } = clock();
    try {
      await navigator.share({ files: [backupFile(data, now)], title: "D&M admin backup" });
      markBackedUp(now);
      setMessage("Backup shared.");
    } catch {
      setMessage("Sharing was cancelled. You can download the backup instead.");
    }
  };
  const chooseFile = async (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    const parsed = parseBackup(await file.text(), clock().now);
    if (!parsed.ok) {
      setFileError(parsed.error);
      return;
    }
    setFileError("");
    setFromBrowser(false);
    setSource({ name: `the backup ${file.name}`, data: parsed.data });
  };
  const reviewBrowserRecords = () => {
    if (!legacy) return;
    setFromBrowser(true);
    setSource({ name: "this browser's old storage", data: legacy.data });
  };
  const finished = (result: ImportResult) => {
    setSource(null);
    setMessage(summary(result));
    if (fromBrowser) {
      markLegacyImported(clock().now);
      setLegacy(readLegacyRecords());
    }
  };
  const removeBrowserCopy = () => {
    if (!window.confirm("Remove the old copy of these records from this browser? Records already saved online are not affected.")) return;
    removeLegacyRecords();
    setLegacy(null);
    setMessage("The old browser copy was removed.");
  };

  const records = countRecords(data);
  const legacyCount = legacy ? countRecords(legacy.data) : 0;

  return (
    <Card title="Storage and backup" id="storage">
      <div className="adm-storage">
        <p>
          <strong>Records are saved online in D&amp;M&apos;s private database,</strong> so they are the same on your phone and
          computer once you sign in. Only signed-in D&amp;M admins can see them. Exporting a backup now and then is still worth
          doing.
        </p>
        <dl className="adm-facts">
          <div>
            <dt>Status</dt>
            <dd className={sync.persistence === "saved" ? undefined : "adm-warn-text"}>{syncText[sync.persistence]}</dd>
          </div>
          <div>
            <dt>Records</dt>
            <dd>{records}</dd>
          </div>
          <div>
            <dt>Last saved</dt>
            <dd>{sync.lastSavedAt ? new Date(sync.lastSavedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "No changes yet"}</dd>
          </div>
          <div>
            <dt>Last backup</dt>
            <dd className={data.meta.lastBackupAt ? undefined : "adm-warn-text"}>
              {data.meta.lastBackupAt ? formatShortDate(data.meta.lastBackupAt.slice(0, 10)) : "Never"}
            </dd>
          </div>
        </dl>
        <div className="adm-actions">
          <button type="button" className="adm-btn" onClick={exportBackup}>
            <Icon name="download" size={18} /> Export backup
          </button>
          {canShare && (
            <button type="button" className="adm-btn adm-btn-ghost" onClick={share}>
              <Icon name="upload" size={18} /> Share backup
            </button>
          )}
          <button type="button" className="adm-btn adm-btn-ghost" onClick={() => input.current?.click()}>
            <Icon name="upload" size={18} /> Import backup
          </button>
        </div>
        <input ref={input} type="file" accept="application/json,.json" hidden onChange={e => chooseFile(e.target.files?.[0])} />
        {fileError && <p className="adm-inline-error">{fileError}</p>}
        {message && (
          <p className="adm-inline-ok" role="status">
            {message}
          </p>
        )}
        <p className="adm-muted adm-small">
          Backup files contain customer details, so store them privately. Importing always shows what will change first.
        </p>
      </div>

      {legacy && (
        <div className="adm-legacy" id="browser-records">
          <h3>Records saved only in this browser</h3>
          {legacyCount > 0 ? (
            <p>
              This browser still holds {plural(legacy.data.quotes.length, "quote")}, {plural(legacy.data.invoices.length, "invoice")} and{" "}
              {plural(legacy.data.bookings.length, "booking")} from before online saving was switched on.
              {legacy.importedAt ? ` They were imported on ${formatShortDate(legacy.importedAt.slice(0, 10))}.` : ""}
            </p>
          ) : (
            <p>This browser still holds business settings from before online saving was switched on.</p>
          )}
          <div className="adm-actions">
            <button type="button" className={legacy.importedAt ? "adm-btn adm-btn-ghost" : "adm-btn"} onClick={reviewBrowserRecords}>
              {legacy.importedAt ? "Review again" : "Review and import"}
            </button>
            <button type="button" className="adm-btn adm-btn-ghost" onClick={() => download(backupFile(legacy.data, clock().now))}>
              <Icon name="download" size={18} /> Download a copy
            </button>
            {legacy.importedAt && (
              <button type="button" className="adm-btn adm-btn-ghost" onClick={removeBrowserCopy}>
                Remove the browser copy
              </button>
            )}
          </div>
        </div>
      )}

      <ImportReview source={source} onClose={() => setSource(null)} onDone={finished} />
    </Card>
  );
}
