"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import { BrandLogo } from "@/components/documents/BrandLogo";
import { flush, readBrowserImport, readRecoveryImports, refreshAdminData, useAdminState } from "@/lib/admin/store";
import { Loading } from "./ui";

const sections: { href: string; label: string; icon: IconName }[] = [
  { href: "/admin/quotes", label: "Quotes", icon: "quote" },
  { href: "/admin/invoices", label: "Invoices", icon: "invoice" },
  { href: "/admin/diary", label: "Diary", icon: "diary" },
];

function SectionLinks({ pathname, className }: { pathname: string; className: string }) {
  return (
    <nav className={className} aria-label="Admin sections">
      {sections.map(section => {
        const active = pathname.startsWith(section.href);
        return (
          <Link key={section.href} href={section.href} className={active ? "is-active" : undefined} aria-current={active ? "page" : undefined}>
            <Icon name={section.icon} size={22} />
            <span>{section.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/admin";
  const state = useAdminState();
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [browserRecords, setBrowserRecords] = useState(false);
  useEffect(() => {
    if (!state?.ready) return;
    const sources = [readBrowserImport("legacy"), ...readRecoveryImports()];
    setBrowserRecords(sources.some(source => source?.ok && (
      source.data.quotes.some(record => !state.data.quotes.some(existing => existing.id === record.id))
      || source.data.invoices.some(record => !state.data.invoices.some(existing => existing.id === record.id))
      || source.data.bookings.some(record => !state.data.bookings.some(existing => existing.id === record.id))
    )));
  }, [state?.ready, state?.data]);
  const logout = async () => {
    setLogoutBusy(true);
    setLogoutError("");
    const saved = await flush();
    if (state?.ready && !saved && !window.confirm("Your latest edits have not been saved. Export a backup before leaving. Sign out anyway?")) {
      setLogoutBusy(false);
      return;
    }
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error("Logout failed");
      window.location.assign("/login");
    } catch {
      setLogoutBusy(false);
      setLogoutError("Could not sign out. Check your connection and try again.");
    }
  };
  const reload = () => {
    if (state?.persistence === "conflict" && !window.confirm("Reload cloud records and discard the pending edits shown here? Export a backup first if you need to keep them.")) return;
    void refreshAdminData({ discardPending: state?.persistence === "conflict" });
  };
  const status = !state?.ready ? "Connecting…" : state.persistence === "saved" ? "Saved to cloud" : state.persistence === "saving" ? "Saving…" : state.persistence === "conflict" ? "Resolve conflict" : "Not saved";
  // Editors and previews have their own bottom bar, like a pushed screen in an app.
  const detail = /^\/admin\/(quotes|invoices)\/[^/]+/.test(pathname);
  return (
    <div className={"adm" + (detail ? " adm-is-detail" : "")}>
      <header className="adm-top adm-chrome">
        <Link href="/admin/quotes" className="adm-top-brand" aria-label="D&M admin quotes">
          <BrandLogo tone="light" />
        </Link>
        <SectionLinks pathname={pathname} className="adm-top-nav" />
        <div className="adm-top-end">
          <Link href="/admin/settings#storage" className="adm-device-pill" title={status} aria-label={status}>
            <Icon name={state?.persistence === "saved" ? "check" : state?.persistence === "saving" ? "device" : "alert"} size={15} />
            <span role="status" aria-live="polite">{status}</span>
          </Link>
          <Link
            href="/admin/settings"
            className={"adm-icon-btn" + (pathname.startsWith("/admin/settings") ? " is-active" : "")}
            aria-label="Business details and backup"
          >
            <Icon name="settings" />
          </Link>
          <button type="button" className="adm-icon-btn" onClick={() => { void logout(); }} disabled={logoutBusy} title="Sign out" aria-label={logoutBusy ? "Signing out" : "Sign out"}><svg className="adm-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5H4v14h5M10 12h10M16 8l4 4-4 4" /></svg></button>
        </div>
      </header>
      {state?.message && (
        <div className="adm-alert adm-chrome" style={{ flexWrap: "wrap" }} role="alert">
          <Icon name="alert" size={18} />
          <span>{state.message}</span>
          <Link href="/admin/settings#storage">Backup</Link>
          {state.persistence === "failed" && <button type="button" className="adm-btn adm-btn-small adm-btn-ghost" onClick={() => { void flush(); }}>Retry save</button>}
          <button type="button" className="adm-btn adm-btn-small adm-btn-ghost" onClick={reload}>{state.persistence === "conflict" ? "Reload cloud records" : "Retry connection"}</button>
        </div>
      )}
      {logoutError && <p className="adm-alert" role="alert">{logoutError}</p>}
      {browserRecords && <div className="adm-alert adm-chrome" role="status"><Icon name="upload" size={18} /><span>Browser records are ready to review and import.</span><Link href="/admin/settings#storage">Review</Link></div>}
      <main className="adm-main">{state?.ready ? children : state?.persistence === "unavailable" ? <div className="adm-stack"><h1>Connect to your records</h1><p>Your records will appear when cloud storage is available.</p><button type="button" className="adm-btn" onClick={() => { void refreshAdminData(); }}>Retry connection</button></div> : <Loading />}</main>
      <SectionLinks pathname={pathname} className="adm-tabs adm-chrome" />
    </div>
  );
}

