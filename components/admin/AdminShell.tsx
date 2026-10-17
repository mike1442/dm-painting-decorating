"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { AdminUserContext } from "./account";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import { Empty } from "./ui";
import { BrandLogo } from "@/components/documents/BrandLogo";
import type { AdminUser } from "@/lib/admin/session";
import { reloadAdminData, resolveConflict, retrySaving, startAdminStore, useSyncStatus } from "@/lib/admin/store";
import type { Persistence } from "@/lib/admin/store";

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

const syncLabels: Record<Persistence, string> = {
  saved: "Saved",
  saving: "Saving…",
  offline: "Offline",
  failed: "Not saved",
  conflict: "Check changes",
  "signed-out": "Signed out",
};

function SyncPill({ persistence, loading }: { persistence: Persistence; loading: boolean }) {
  const label = loading ? "Loading…" : syncLabels[persistence];
  const icon: IconName = loading || persistence === "saving" ? "device" : persistence === "saved" ? "check" : "alert";
  return (
    <Link href="/admin/settings#storage" className={`adm-device-pill is-${loading ? "saving" : persistence}`} title="Saved online for all your devices">
      <Icon name={icon} size={15} />
      <span aria-live="polite">{label}</span>
    </Link>
  );
}

function SyncAlerts({ pathname }: { pathname: string }) {
  const sync = useSyncStatus();
  if (!sync.conflicts.length && !(sync.message && sync.persistence !== "conflict")) return null;
  // Sticky so a decision is never hidden while scrolled down an editor.
  return (
    <div className="adm-alerts adm-chrome">
      {sync.conflicts.map(conflict => (
        <div className="adm-alert adm-conflict adm-chrome" role="alert" key={conflict.key}>
          <Icon name="alert" size={18} />
          <span>
            <strong>{conflict.label}</strong>{" "}
            {conflict.reason === "changed"
              ? "was changed on another device while it was being edited here."
              : "was deleted on another device while it was being edited here."}
          </span>
          <span className="adm-conflict-actions">
            <button type="button" className="adm-btn adm-btn-small" onClick={() => resolveConflict(conflict.key, "mine")}>
              {conflict.reason === "changed" ? "Keep this version" : "Keep it"}
            </button>
            <button type="button" className="adm-btn adm-btn-ghost adm-btn-small" onClick={() => resolveConflict(conflict.key, "theirs")}>
              {conflict.reason === "changed" ? "Use the other version" : "Delete it here too"}
            </button>
          </span>
        </div>
      ))}
      {sync.message && sync.persistence !== "conflict" && (
        <div className="adm-alert adm-chrome" role="alert">
          <Icon name="alert" size={18} />
          <span>{sync.message}</span>
          {sync.persistence === "signed-out" && <a href={`/admin/login?next=${encodeURIComponent(pathname)}`}>Sign in</a>}
          {sync.persistence === "failed" && (
            <button type="button" onClick={retrySaving}>
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function AdminShell({ user, children }: { user: AdminUser; children: React.ReactNode }) {
  const pathname = usePathname() ?? "/admin";
  const sync = useSyncStatus();
  useEffect(() => startAdminStore(user), [user]);
  // Editors and previews have their own bottom bar, like a pushed screen in an app.
  const detail = /^\/admin\/(quotes|invoices)\/[^/]+/.test(pathname);
  return (
    <AdminUserContext.Provider value={user}>
      <div className={"adm" + (detail ? " adm-is-detail" : "")}>
        <header className="adm-top adm-chrome">
          <Link href="/admin" className="adm-top-brand" aria-label="D&M admin home">
            <BrandLogo tone="light" />
            <span>Admin</span>
          </Link>
          <SectionLinks pathname={pathname} className="adm-top-nav" />
          <div className="adm-top-end">
            <SyncPill persistence={sync.persistence} loading={sync.phase === "loading"} />
            <Link
              href="/admin/settings"
              className={"adm-icon-btn" + (pathname.startsWith("/admin/settings") ? " is-active" : "")}
              aria-label="Settings, backup and account"
            >
              <Icon name="settings" />
            </Link>
          </div>
        </header>
        <SyncAlerts pathname={pathname} />
        <main className="adm-main">
          {sync.phase === "error" ? (
            <Empty icon="alert" title="Couldn't load your records">
              <p>{sync.loadError}</p>
              <button type="button" className="adm-btn" onClick={reloadAdminData}>
                Try again
              </button>
            </Empty>
          ) : (
            children
          )}
        </main>
        <SectionLinks pathname={pathname} className="adm-tabs adm-chrome" />
      </div>
    </AdminUserContext.Provider>
  );
}
