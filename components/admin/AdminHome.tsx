"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { Loading } from "./ui";
import { formatRange } from "@/lib/admin/dates";
import { formatPence, invoiceTotals } from "@/lib/admin/money";
import { bookingsOn } from "@/lib/admin/operations";
import { readLegacyRecords } from "@/lib/admin/legacy";
import { clock, useAdminState } from "@/lib/admin/store";

export function AdminHome() {
  const state = useAdminState();
  const [legacy, setLegacy] = useState(false);
  useEffect(() => {
    const records = readLegacyRecords();
    setLegacy(!!records && !records.importedAt);
  }, []);
  if (!state) return <Loading />;
  const { quotes, invoices, bookings, meta } = state.data;
  const today = clock().today;
  const openQuotes = quotes.filter(q => q.status === "draft" || q.status === "sent").length;
  const owed = invoices.filter(i => i.status === "sent").reduce((sum, i) => sum + Math.max(invoiceTotals(i).balancePence, 0), 0);
  const todays = bookingsOn(bookings, today);
  const next = bookings.filter(b => b.start > today).sort((a, b) => a.start.localeCompare(b.start))[0];

  return (
    <div className="adm-page adm-home">
      <div className="adm-home-hello">
        <p className="adm-overline">D&amp;M Painting &amp; Decorating</p>
        <h1>What are we working on?</h1>
      </div>

      <div className="adm-tiles">
        <Link href="/admin/quotes" className="adm-tile">
          <span className="adm-tile-icon">
            <Icon name="quote" size={26} />
          </span>
          <strong>Quotes</strong>
          <span>{quotes.length ? `${openQuotes} open of ${quotes.length}` : "Create your first quotation"}</span>
        </Link>
        <Link href="/admin/invoices" className="adm-tile">
          <span className="adm-tile-icon">
            <Icon name="invoice" size={26} />
          </span>
          <strong>Invoices</strong>
          <span>{owed ? `${formatPence(owed)} outstanding` : invoices.length ? `${invoices.length} saved` : "Convert a quote in one tap"}</span>
        </Link>
        <Link href="/admin/diary" className="adm-tile">
          <span className="adm-tile-icon">
            <Icon name="diary" size={26} />
          </span>
          <strong>Diary</strong>
          <span>
            {todays.length
              ? `Today: ${todays.map(b => b.job || b.customerName).join(", ")}`
              : next
                ? `Next: ${next.job || next.customerName}, ${formatRange(next.start, next.end)}`
                : "Nothing booked yet"}
          </span>
        </Link>
      </div>

      {legacy && (
        <Link href="/admin/settings#browser-records" className="adm-storage-strip is-warn">
          <Icon name="alert" size={20} />
          <span>
            <strong>Records found in this browser.</strong> Review and import them so they&apos;re saved online.
          </span>
          <Icon name="next" size={18} />
        </Link>
      )}
      <Link href="/admin/settings#storage" className="adm-storage-strip">
        <Icon name="check" size={20} />
        <span>
          <strong>Saved online.</strong> The same records on your phone and computer.{" "}
          {meta.lastBackupAt ? "Export a backup now and then." : "You haven't exported a backup yet."}
        </span>
        <Icon name="next" size={18} />
      </Link>
    </div>
  );
}
