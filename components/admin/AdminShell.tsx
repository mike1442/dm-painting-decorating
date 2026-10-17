"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import { BrandLogo } from "@/components/documents/BrandLogo";
import { useAdminState } from "@/lib/admin/store";

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
  // Editors and previews have their own bottom bar, like a pushed screen in an app.
  const detail = /^\/admin\/(quotes|invoices)\/[^/]+/.test(pathname);
  return (
    <div className={"adm" + (detail ? " adm-is-detail" : "")}>
      <header className="adm-top adm-chrome">
        <Link href="/admin" className="adm-top-brand" aria-label="D&M admin home">
          <BrandLogo tone="light" />
          <span>Admin</span>
        </Link>
        <SectionLinks pathname={pathname} className="adm-top-nav" />
        <div className="adm-top-end">
          <Link href="/admin/settings#storage" className="adm-device-pill" title="Records are stored only in this browser">
            <Icon name="device" size={15} />
            <span>This device only</span>
          </Link>
          <Link
            href="/admin/settings"
            className={"adm-icon-btn" + (pathname.startsWith("/admin/settings") ? " is-active" : "")}
            aria-label="Business details and backup"
          >
            <Icon name="settings" />
          </Link>
        </div>
      </header>
      {state?.message && (
        <div className="adm-alert adm-chrome" role="alert">
          <Icon name="alert" size={18} />
          <span>{state.message}</span>
          <Link href="/admin/settings#storage">Backup</Link>
        </div>
      )}
      <main className="adm-main">{children}</main>
      <SectionLinks pathname={pathname} className="adm-tabs adm-chrome" />
    </div>
  );
}
