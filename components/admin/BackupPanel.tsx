"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { Card, Sheet } from "./ui";
import { backupFileName, createBackup, mergeData, parseBackup } from "@/lib/admin/backup";
import type { ParsedBackup } from "@/lib/admin/backup";
import { formatShortDate } from "@/lib/admin/dates";
import { clock, commit, eraseDevice, storedBytes } from "@/lib/admin/store";
import type { AdminData } from "@/lib/admin/types";

function backupFile(data: AdminData, now: string) {
  return new File([JSON.stringify(createBackup(data, now), null, 2)], backupFileName(now), { type: "application/json" });
}

const markBackedUp = (now: string) => commit(d => ({ ...d, meta: { ...d.meta, lastBackupAt: now } }), { immediate: true });

export function BackupPanel({ data }: { data: AdminData }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<ParsedBackup | null>(null);
  const [message, setMessage] = useState("");
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted, () => setPersisted(null));
    try {
      setCanShare(!!navigator.canShare?.({ files: [backupFile(data, clock().now)] }));
    } catch {
      setCanShare(false);
    }
    // Capability checks only need to run once.
  }, []);

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
    markBackedUp(now);
    setMessage("Backup downloaded. Keep it somewhere safe, such as email or cloud storage.");
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
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setPending(parseBackup(await file.text(), clock().now));
    if (input.current) input.current.value = "";
  };
  const apply = (mode: "merge" | "replace") => {
    if (!pending?.ok) return;
    if (mode === "replace" && !window.confirm("Replace everything on this device with the backup? Records not in the backup will be lost.")) return;
    const incoming = pending.data;
    commit(d => (mode === "merge" ? mergeData(d, incoming) : { ...incoming, meta: { ...incoming.meta, lastBackupAt: d.meta.lastBackupAt } }), { immediate: true });
    setPending(null);
    setMessage(mode === "merge" ? "Backup merged with this device." : "This device now matches the backup.");
  };
  const erase = () => {
    const answer = window.prompt('This permanently deletes every quote, invoice, booking and setting on this device. Type ERASE to confirm.');
    if (answer?.trim().toUpperCase() !== "ERASE") return;
    eraseDevice();
    setMessage("All admin data was erased from this device.");
  };
  const keepData = async () => {
    const granted = (await navigator.storage?.persist?.()) ?? false;
    setPersisted(granted);
    setMessage(granted ? "The browser agreed to keep this data unless you clear it yourself." : "The browser didn't agree. Back up regularly.");
  };

  const records = data.quotes.length + data.invoices.length + data.bookings.length;
  const kb = Math.max(1, Math.round(storedBytes() / 1024));

  return (
    <Card title="Device storage and backup" id="storage" tone="warn">
      <div className="adm-storage">
        <p>
          <strong>Everything here is stored only in this browser on this device.</strong> It is not synchronised to other devices
          and is not backed up online. Clearing browsing data, using private browsing, or (on iPhone and iPad) not opening the
          admin in Safari for several days can delete it.
        </p>
        <dl className="adm-facts">
          <div>
            <dt>Last backup</dt>
            <dd className={data.meta.lastBackupAt ? undefined : "adm-warn-text"}>{data.meta.lastBackupAt ? formatShortDate(data.meta.lastBackupAt.slice(0, 10)) : "Never"}</dd>
          </div>
          <div>
            <dt>Records</dt>
            <dd>{records}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{kb} KB</dd>
          </div>
          <div>
            <dt>Browser protection</dt>
            <dd>{persisted === null ? "Unknown" : persisted ? "Kept" : "Not requested"}</dd>
          </div>
        </dl>
        <div className="adm-actions">
          <button type="button" className="adm-btn" onClick={download}>
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
          {persisted === false && (
            <button type="button" className="adm-btn adm-btn-ghost" onClick={keepData}>
              <Icon name="device" size={18} /> Ask browser to keep data
            </button>
          )}
        </div>
        <input ref={input} type="file" accept="application/json,.json" hidden onChange={e => choose(e.target.files?.[0])} />
        {message && (
          <p className="adm-inline-ok" role="status">
            {message}
          </p>
        )}
        <p className="adm-muted adm-small">
          Backups are JSON files containing customer details. Store them privately. To move to another device, export here and
          import there.
        </p>
        <button type="button" className="adm-link-danger" onClick={erase}>
          Erase all admin data from this device
        </button>
      </div>

      <Sheet
        open={!!pending}
        onClose={() => setPending(null)}
        title="Import backup"
        actions={
          pending?.ok ? (
            <>
              <button type="button" className="adm-btn adm-btn-ghost" onClick={() => apply("replace")}>
                Replace everything
              </button>
              <button type="button" className="adm-btn" onClick={() => apply("merge")}>
                Merge with this device
              </button>
            </>
          ) : undefined
        }
      >
        {pending && !pending.ok && <p className="adm-inline-error">{pending.error}</p>}
        {pending?.ok && (
          <div className="adm-stack">
            <p>
              Backup {pending.exportedAt && `from ${formatShortDate(pending.exportedAt.slice(0, 10))} `}containing{" "}
              <strong>
                {pending.data.quotes.length} quotes, {pending.data.invoices.length} invoices and {pending.data.bookings.length} bookings
              </strong>
              .
            </p>
            <p className="adm-muted">
              <strong>Merge</strong> keeps the most recently edited copy of each record and this device&apos;s settings.{" "}
              <strong>Replace</strong> makes this device an exact copy of the backup.
            </p>
          </div>
        )}
      </Sheet>
    </Card>
  );
}
