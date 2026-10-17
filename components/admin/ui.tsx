"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import type { Persistence } from "@/lib/admin/store";
import { stateLabels } from "@/lib/admin/status";
import type { InvoiceState, QuoteState } from "@/lib/admin/status";

export function PageHead({ title, subtitle, back, action }: {
  title: string;
  subtitle?: React.ReactNode;
  back?: { href: string; label: string };
  action?: React.ReactNode;
}) {
  return (
    <div className="adm-page-head">
      <div>
        {back && (
          <Link className="adm-back" href={back.href}>
            <Icon name="back" size={18} /> {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {subtitle && <div className="adm-page-sub">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function Card({ title, aside, children, id, tone }: {
  title?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
  tone?: "quiet" | "warn";
}) {
  return (
    <section className={"adm-card" + (tone ? ` adm-card-${tone}` : "")} id={id}>
      {(title || aside) && (
        <div className="adm-card-head">
          {title && <h2>{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function StateChip({ state }: { state: QuoteState | InvoiceState }) {
  return <span className={`adm-chip adm-chip-${state}`}>{stateLabels[state]}</span>;
}

const saveLabels: Record<Persistence, string> = {
  saved: "Saved",
  saving: "Saving…",
  offline: "Offline, will retry",
  failed: "Not saved",
  conflict: "Needs attention",
  "signed-out": "Signed out",
};

export function SaveStatus({ persistence }: { persistence: Persistence }) {
  return (
    <span className={`adm-save adm-save-${persistence}`} role="status" aria-live="polite">
      <Icon name={persistence === "saved" ? "check" : persistence === "saving" ? "device" : "alert"} size={14} />
      {saveLabels[persistence]}
    </span>
  );
}

export function Loading() {
  return (
    <div className="adm-loading" aria-busy="true">
      <span />
      <span />
      <span />
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: React.ReactNode }) {
  return (
    <div className="adm-empty">
      <span className="adm-empty-icon">
        <Icon name={icon} size={26} />
      </span>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

/** Shown when a link points at a record that doesn't exist (or no longer exists). */
export function NotFound({ kind, href }: { kind: string; href: string }) {
  return (
    <Empty icon="alert" title={`This ${kind} couldn't be found`}>
      <p>It may have been deleted, possibly on another device. Check the list for the latest records.</p>
      <Link className="adm-btn" href={href}>
        Back to {kind}s
      </Link>
    </Empty>
  );
}

export function Sheet({ open, onClose, title, children, actions }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // The native close event also fires after we close the dialog ourselves;
  // only report closes the user started (Escape) while it should be open.
  const shouldBeOpen = useRef(open);
  useEffect(() => {
    shouldBeOpen.current = open;
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="adm-sheet"
      aria-label={title}
      onClose={() => shouldBeOpen.current && onClose()}
      onClick={e => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="adm-sheet-inner">
          <div className="adm-sheet-head">
            <h2>{title}</h2>
            <button type="button" className="adm-icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          </div>
          <div className="adm-sheet-body">{children}</div>
          {actions && <div className="adm-sheet-actions">{actions}</div>}
        </div>
      )}
    </dialog>
  );
}

/** Reserved space for permanent customer links, which need a secure backend first. */
export function CustomerLinkNotice({ kind }: { kind: "quotation" | "invoice" }) {
  return (
    <Card title="Customer link" tone="quiet" aside={<span className="adm-chip adm-chip-muted">Not available yet</span>}>
      <p className="adm-muted">
        Links that customers can open aren&apos;t switched on yet. Admin pages, including previews, only work for signed-in
        D&amp;M admins, so never send their address to a customer. To send this {kind}, use <strong>Preview</strong> then{" "}
        <strong>Print / Save as PDF</strong>.
      </p>
    </Card>
  );
}
