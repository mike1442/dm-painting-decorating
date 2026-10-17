import type { IsoDate } from "./types.ts";

// Calendar dates are handled as "YYYY-MM-DD" strings and calculated in UTC,
// so clock changes and time zones can never shift a booking by a day.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  return date.getUTCFullYear() === +match[1] && date.getUTCMonth() === +match[2] - 1 && date.getUTCDate() === +match[3];
}

function toUtc(iso: IsoDate): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function fromUtc(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

/** Today's date on this device. */
export function todayIso(now: Date = new Date()): IsoDate {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return fromUtc(new Date(toUtc(iso).getTime() + days * DAY_MS));
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / DAY_MS);
}

/** Monday of the week containing the date (UK weeks start on Monday). */
export function startOfWeek(iso: IsoDate): IsoDate {
  const weekday = (toUtc(iso).getUTCDay() + 6) % 7;
  return addDays(iso, -weekday);
}

export function weekDays(iso: IsoDate): IsoDate[] {
  const monday = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function firstOfMonth(iso: IsoDate): IsoDate {
  return iso.slice(0, 8) + "01";
}

export function addMonths(iso: IsoDate, months: number): IsoDate {
  const date = toUtc(firstOfMonth(iso));
  date.setUTCMonth(date.getUTCMonth() + months);
  return fromUtc(date);
}

/** Whole weeks (Monday to Sunday) covering the month that contains the date. */
export function monthGrid(iso: IsoDate): IsoDate[] {
  const first = firstOfMonth(iso);
  const last = addDays(addMonths(first, 1), -1);
  const start = startOfWeek(first);
  const weeks = Math.ceil((daysBetween(start, last) + 1) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
}

export function sameMonth(a: IsoDate, b: IsoDate): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

export function isWeekend(iso: IsoDate): boolean {
  const day = toUtc(iso).getUTCDay();
  return day === 0 || day === 6;
}

function format(iso: IsoDate, options: Intl.DateTimeFormatOptions): string {
  if (!isIsoDate(iso)) return "";
  return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(toUtc(iso));
}

/** "17 October 2026" */
export const formatLongDate = (iso: IsoDate) => format(iso, { day: "numeric", month: "long", year: "numeric" });
/** "17 Oct 2026" */
export const formatShortDate = (iso: IsoDate) => format(iso, { day: "numeric", month: "short", year: "numeric" });
/** "Sat 17 Oct" */
export const formatDayLabel = (iso: IsoDate) => format(iso, { weekday: "short", day: "numeric", month: "short" });
/** "Saturday" */
export const formatWeekday = (iso: IsoDate) => format(iso, { weekday: "long" });
/** "October 2026" */
export const formatMonth = (iso: IsoDate) => format(iso, { month: "long", year: "numeric" });

export function formatRange(start: IsoDate, end: IsoDate): string {
  if (start === end) return formatDayLabel(start);
  return `${formatDayLabel(start)} – ${formatDayLabel(end)}`;
}
