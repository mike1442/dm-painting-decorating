"use client";
import { useEffect, useState } from "react";
import { Sheet } from "./ui";
import { formatShortDate } from "@/lib/admin/dates";
import { applyImport, planImport } from "@/lib/admin/importer";
import type { ImportItem, ImportPlan } from "@/lib/admin/importer";
import { errorMessage } from "@/lib/admin/repository";
import { allocateNumber, commit, saveNow, useAdminState, useSyncStatus } from "@/lib/admin/store";
import type { AdminData } from "@/lib/admin/types";

export type ImportSource = { name: string; data: AdminData };
export type ImportResult = { imported: number; renumbered: { from: string; to: string }[]; saved: boolean };

function describe(item: ImportItem): string {
  const r = item.record;
  if (r.kind === "booking") return [r.customerName, r.start && formatShortDate(r.start)].filter(Boolean).join(" · ");
  return [r.title, r.customer.name].filter(Boolean).join(" · ");
}

const groups: { status: ImportItem["status"]; title: string; hint: string }[] = [
  { status: "new", title: "New records", hint: "Not online yet." },
  { status: "number-clash", title: "Numbers already used online", hint: "Imported with the next free number so nothing is duplicated." },
  { status: "different", title: "Different from the online copy", hint: "Left as they are online unless you tick them. Ticking replaces the online copy." },
];

/** Lets the person see exactly what an import will add or replace before anything is saved. */
export function ImportReview({ source, onClose, onDone }: {
  source: ImportSource | null;
  onClose: () => void;
  onDone: (result: ImportResult) => void;
}) {
  const state = useAdminState();
  const sync = useSyncStatus();
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [withSettings, setWithSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Freeze the plan when the review opens so it doesn't shift while being read.
  useEffect(() => {
    if (!source || !state) {
      setPlan(null);
      return;
    }
    const next = planImport(state.data, source.data, { onlineSettingsSaved: sync.settingsSaved });
    setPlan(next);
    setSelected(new Set(next.items.filter(i => i.selected).map(i => i.key)));
    setWithSettings(next.importSettings);
    setError("");
    // Only when a new source is opened.
  }, [source]);

  const toggle = (key: string) =>
    setSelected(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const run = async () => {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      const numbers = new Map<string, number>();
      for (const item of plan.items) {
        if (item.status !== "number-clash" || !selected.has(item.key) || item.kind === "booking") continue;
        numbers.set(item.key, await allocateNumber(item.kind, plan.floors[item.kind]));
      }
      let result = { imported: 0, renumbered: [] as { from: string; to: string }[] };
      commit(
        d => {
          const applied = applyImport(d, plan, { selected, importSettings: withSettings, numbers });
          result = { imported: applied.imported, renumbered: applied.renumbered };
          return applied.data;
        },
        { immediate: true },
      );
      const saved = await saveNow();
      onDone({ ...result, saved });
    } catch (e) {
      setError(`Nothing was imported. ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const count = plan ? plan.items.filter(i => selected.has(i.key) && i.status !== "identical").length : 0;
  const identical = plan?.items.filter(i => i.status === "identical").length ?? 0;

  return (
    <Sheet
      open={!!source}
      onClose={busy ? () => undefined : onClose}
      title="Review import"
      actions={
        <>
          <button type="button" className="adm-btn adm-btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="adm-btn adm-btn-wide" onClick={run} disabled={busy || (!count && !withSettings)}>
            {busy ? "Importing…" : count ? `Import ${count} record${count === 1 ? "" : "s"}` : "Import settings"}
          </button>
        </>
      }
    >
      {plan && source && (
        <div className="adm-stack adm-import">
          <p className="adm-muted">
            From <strong>{source.name}</strong>. Nothing is saved until you choose Import, and nothing already online is
            replaced unless you tick it.
          </p>
          {groups.map(group => {
            const items = plan.items.filter(i => i.status === group.status);
            if (!items.length) return null;
            return (
              <section key={group.status} className="adm-import-group">
                <h3>
                  {group.title} <span>{items.length}</span>
                </h3>
                <p className="adm-muted adm-small">{group.hint}</p>
                {items.map(item => (
                  <label key={item.key} className="adm-import-item">
                    <input type="checkbox" checked={selected.has(item.key)} onChange={() => toggle(item.key)} />
                    <span>
                      <strong>{item.label}</strong>
                      <small>
                        {describe(item) || "No details"}
                        {item.newer === "incoming" && " · edited more recently here"}
                        {item.newer === "online" && " · the online copy is newer"}
                      </small>
                    </span>
                  </label>
                ))}
              </section>
            );
          })}
          {identical > 0 && <p className="adm-muted adm-small">{identical} record{identical === 1 ? " is" : "s are"} already online and identical.</p>}
          {plan.settingsDiffer && (
            <label className="adm-import-item">
              <input type="checkbox" checked={withSettings} onChange={e => setWithSettings(e.target.checked)} />
              <span>
                <strong>Use the business settings from {source.name}</strong>
                <small>{sync.settingsSaved ? "Replaces the settings saved online." : "No settings have been saved online yet."}</small>
              </span>
            </label>
          )}
          {!plan.items.length && !plan.settingsDiffer && <p>There is nothing to import.</p>}
          {error && <p className="adm-inline-error">{error}</p>}
        </div>
      )}
    </Sheet>
  );
}
