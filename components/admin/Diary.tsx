"use client";
import Link from "./AdminLink";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AddressFields, DateField, Segmented, SelectField, TextArea, TextField } from "./fields";
import { Icon } from "./Icon";
import { Loading, PageHead, Sheet } from "./ui";
import {
  addDays,
  addMonths,
  formatDayLabel,
  formatLongDate,
  formatMonth,
  formatRange,
  formatShortDate,
  formatWeekday,
  isIsoDate,
  isWeekend,
  monthGrid,
  sameMonth,
  weekDays,
} from "@/lib/admin/dates";
import { newBooking } from "@/lib/admin/factories";
import { bookingFieldsFromQuote, bookingsOn, deleteBooking, saveBooking } from "@/lib/admin/operations";
import { clock, commit, getAdminData, useAdminState } from "@/lib/admin/store";
import type { AdminData, Booking, BookingStatus } from "@/lib/admin/types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dayClass(list: Booking[]) {
  if (!list.length) return "is-free";
  return list.every(b => b.status === "provisional") ? "is-provisional" : "is-booked";
}

function BookingCard({ booking, data, onOpen }: { booking: Booking; data: AdminData; onOpen: () => void }) {
  const quote = booking.quoteId ? data.quotes.find(q => q.id === booking.quoteId) : undefined;
  const invoice = booking.invoiceId ? data.invoices.find(i => i.id === booking.invoiceId) : undefined;
  const place = [booking.address.line1, booking.address.town, booking.address.postcode].filter(Boolean).join(", ");
  return (
    <button type="button" className={`adm-booking adm-booking-${booking.status}`} onClick={onOpen}>
      <span className="adm-booking-top">
        <strong>{booking.job || "Booking"}</strong>
        {booking.status === "provisional" && <span className="adm-chip adm-chip-provisional">Provisional</span>}
      </span>
      {booking.customerName && <span>{booking.customerName}</span>}
      {place && <span className="adm-muted">{place}</span>}
      <span className="adm-booking-meta">
        <span>{formatRange(booking.start, booking.end)}</span>
        {quote && <span>Quote {quote.number}</span>}
        {invoice && <span>Invoice {invoice.number}</span>}
      </span>
    </button>
  );
}

function BookingSheet({ booking, data, onClose }: { booking: Booking | null; data: AdminData; onClose: () => void }) {
  const [draft, setDraft] = useState<Booking | null>(booking);
  useEffect(() => setDraft(booking), [booking]);
  const exists = !!draft && data.bookings.some(b => b.id === draft.id);
  const set = (change: Partial<Booking>) => setDraft(d => (d ? { ...d, ...change } : d));
  const canSave = !!draft && !!(draft.job.trim() || draft.customerName.trim());

  const save = () => {
    if (!draft || !canSave) return;
    commit(d => saveBooking(d, draft, clock().now), { immediate: true });
    onClose();
  };
  const remove = () => {
    if (!draft || !window.confirm("Remove this booking from the diary?")) return;
    commit(d => deleteBooking(d, draft.id), { immediate: true });
    onClose();
  };
  const quoteOptions: [string, string][] = [["", "Not linked"], ...data.quotes.map(q => [q.id, `${q.number} · ${q.title || q.customer.name || "Untitled"}`] as [string, string])];
  const invoiceOptions: [string, string][] = [["", "Not linked"], ...data.invoices.map(i => [i.id, `${i.number} · ${i.title || i.customer.name || "Untitled"}`] as [string, string])];

  return (
    <Sheet
      open={!!booking}
      onClose={onClose}
      title={exists ? "Edit booking" : "New booking"}
      actions={
        <>
          {exists && (
            <button type="button" className="adm-btn adm-btn-danger" onClick={remove}>
              <Icon name="trash" size={18} /> Remove
            </button>
          )}
          <button type="button" className="adm-btn adm-btn-wide" onClick={save} disabled={!canSave}>
            {exists ? "Save changes" : "Add to diary"}
          </button>
        </>
      }
    >
      {draft && (
        <div className="adm-stack">
          <TextArea label="Job description" value={draft.job} onChange={job => set({ job })} rows={2} placeholder="e.g. Hallway, stairs and landing" />
          <div className="adm-grid">
            <DateField label="First day" value={draft.start} onChange={start => set({ start, end: draft.end < start ? start : draft.end })} />
            <DateField label="Last day" value={draft.end} onChange={end => set({ end: end < draft.start ? draft.start : end })} />
          </div>
          <Segmented<BookingStatus>
            label="Booking status"
            value={draft.status}
            options={[
              ["confirmed", "Confirmed"],
              ["provisional", "Provisional"],
            ]}
            onChange={status => set({ status })}
          />
          <div className="adm-grid">
            <TextField label="Customer" value={draft.customerName} onChange={customerName => set({ customerName })} autoComplete="off" />
            <TextField label="Phone" type="tel" value={draft.phone} onChange={phone => set({ phone })} autoComplete="off" />
          </div>
          <AddressFields value={draft.address} onChange={address => set({ address })} />
          <TextArea label="Notes" value={draft.notes} onChange={notes => set({ notes })} rows={3} placeholder="Access, parking, colours, keys…" />
          <div className="adm-grid">
            <SelectField label="Linked quote" value={draft.quoteId ?? ""} options={quoteOptions} onChange={v => set({ quoteId: v || null })} />
            <SelectField label="Linked invoice" value={draft.invoiceId ?? ""} options={invoiceOptions} onChange={v => set({ invoiceId: v || null })} />
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function Diary() {
  const router = useRouter();
  const params = useSearchParams();
  const state = useAdminState();
  const [view, setView] = useState<"month" | "week">("month");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Booking | null>(null);
  const ready = !!state;
  const consumedQuery = useRef<string | null>(null);

  // Links from quotes, invoices and booking chips: ?fromQuote=, ?fromInvoice=, ?date=
  // Each URL is applied once. Saves, background refreshes and focus events must
  // not reset the calendar or replace a booking that is being filled in.
  useEffect(() => {
    const data = getAdminData();
    const query = params.toString();
    if (!ready || !data || consumedQuery.current === query) return;
    consumedQuery.current = query;
    const { today, now } = clock();
    const date = params.get("date");
    const quote = data.quotes.find(q => q.id === params.get("fromQuote"));
    const invoice = data.invoices.find(i => i.id === params.get("fromInvoice"));
    if (isIsoDate(date)) setSelected(date);
    if (quote) setEditing(newBooking(today, now, bookingFieldsFromQuote(quote)));
    if (invoice) {
      setEditing(
        newBooking(today, now, {
          job: invoice.title,
          customerName: invoice.customer.name,
          phone: invoice.customer.phone,
          address: { ...invoice.customer.address },
          quoteId: invoice.quoteId,
          invoiceId: invoice.id,
        }),
      );
    }
    // Once consumed, linked-document parameters are removed from the URL.
    if (quote || invoice) router.replace(isIsoDate(date) ? `/admin/diary?date=${date}` : "/admin/diary", { scroll: false });
  }, [ready, params, router]);

  if (!state) return <Loading />;
  const { data } = state;
  const today = clock().today;
  const focus = selected ?? today;
  const days = view === "month" ? monthGrid(focus) : weekDays(focus);
  const title = view === "month" ? formatMonth(focus) : `${formatShortDate(days[0])} – ${formatShortDate(days[6])}`;
  const move = (by: number) => setSelected(view === "month" ? addMonths(focus, by) : addDays(focus, by * 7));
  const open = (day: string) => setEditing(newBooking(day, clock().now));
  const selectedList = bookingsOn(data.bookings, focus);
  const upcoming = data.bookings.filter(b => b.end >= today).length;

  return (
    <div className="adm-page adm-diary">
      <PageHead
        title="Diary"
        subtitle={upcoming === 1 ? "1 upcoming booking" : `${upcoming} upcoming bookings`}
        action={
          <button type="button" className="adm-btn" onClick={() => open(focus)}>
            <Icon name="plus" size={18} /> Add booking
          </button>
        }
      />

      <div className="adm-cal-bar">
        <Segmented
          label="Calendar view"
          value={view}
          options={[
            ["month", "Month"],
            ["week", "Week"],
          ]}
          onChange={setView}
        />
        <div className="adm-cal-nav">
          <button type="button" className="adm-icon-btn" onClick={() => move(-1)} aria-label={view === "month" ? "Previous month" : "Previous week"}>
            <Icon name="back" />
          </button>
          <h2 aria-live="polite">{title}</h2>
          <button type="button" className="adm-icon-btn" onClick={() => move(1)} aria-label={view === "month" ? "Next month" : "Next week"}>
            <Icon name="next" />
          </button>
        </div>
        <button type="button" className="adm-btn adm-btn-ghost adm-btn-small" onClick={() => setSelected(today)} disabled={focus === today}>
          Today
        </button>
      </div>

      <div className="adm-legend" aria-hidden="true">
        <span className="is-booked">Booked</span>
        <span className="is-provisional">Provisional</span>
        <span className="is-free">Available</span>
      </div>

      {view === "month" ? (
        <div className="adm-cal">
          <div className="adm-cal-head">
            {WEEKDAYS.map(d => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="adm-cal-grid">
            {days.map(day => {
              const list = bookingsOn(data.bookings, day);
              const classes = ["adm-day", dayClass(list)];
              if (!sameMonth(day, focus)) classes.push("is-out");
              if (day === today) classes.push("is-today");
              if (day === focus) classes.push("is-selected");
              if (isWeekend(day)) classes.push("is-weekend");
              return (
                <button
                  type="button"
                  key={day}
                  className={classes.join(" ")}
                  onClick={() => setSelected(day)}
                  aria-pressed={day === focus}
                  aria-label={`${formatLongDate(day)}: ${list.length ? `${list.length} booking${list.length > 1 ? "s" : ""}` : "available"}`}
                >
                  <span className="adm-day-num">{Number(day.slice(8))}</span>
                  {list.slice(0, 2).map(b => (
                    <span key={b.id} className={`adm-day-job adm-day-job-${b.status}${b.start === day ? " is-start" : ""}${b.end === day ? " is-end" : ""}`}>
                      {b.job || b.customerName || "Booking"}
                    </span>
                  ))}
                  {list.length > 2 && <span className="adm-day-more">+{list.length - 2}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <ol className="adm-week">
          {days.map(day => {
            const list = bookingsOn(data.bookings, day);
            return (
              <li key={day} className={["adm-week-day", dayClass(list), day === today ? "is-today" : "", day === focus ? "is-selected" : ""].join(" ")}>
                <button type="button" className="adm-week-date" onClick={() => setSelected(day)} aria-pressed={day === focus}>
                  <span>{formatWeekday(day).slice(0, 3)}</span>
                  <strong>{Number(day.slice(8))}</strong>
                </button>
                <div className="adm-week-body">
                  {list.map(b => (
                    <BookingCard key={b.id} booking={b} data={data} onOpen={() => setEditing(b)} />
                  ))}
                  {!list.length && (
                    <button type="button" className="adm-free" onClick={() => open(day)}>
                      <span>Available</span>
                      <Icon name="plus" size={16} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {view === "month" && (
        <section className="adm-day-panel" aria-label={formatLongDate(focus)}>
          <div className="adm-day-panel-head">
            <h2>{formatDayLabel(focus)}</h2>
            <button type="button" className="adm-btn adm-btn-ghost adm-btn-small" onClick={() => open(focus)}>
              <Icon name="plus" size={16} /> Add
            </button>
          </div>
          {selectedList.length ? (
            selectedList.map(b => <BookingCard key={b.id} booking={b} data={data} onOpen={() => setEditing(b)} />)
          ) : (
            <button type="button" className="adm-free adm-free-large" onClick={() => open(focus)}>
              <span>Available. Nothing booked.</span>
              <Icon name="plus" size={16} />
            </button>
          )}
        </section>
      )}

      {data.quotes.length === 0 && data.bookings.length === 0 && (
        <p className="adm-muted adm-small adm-pad">
          Tip: open a quote and choose <Link href="/admin/quotes">Book into diary</Link> to fill in the customer and address for you.
        </p>
      )}

      <BookingSheet booking={editing} data={data} onClose={() => setEditing(null)} />
    </div>
  );
}

