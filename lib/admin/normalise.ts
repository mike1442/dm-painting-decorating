import { isIsoDate } from "./dates.ts";
import { defaultSettings, emptyData, newId } from "./factories.ts";
import { parseAmount } from "./money.ts";
import { SCHEMA_VERSION } from "./types.ts";
import type {
  AdminData,
  Address,
  BankDetails,
  Booking,
  BusinessSettings,
  Customer,
  DepositSetting,
  Invoice,
  LineItem,
  Payment,
  PaymentMethod,
  Quote,
  VatSetting,
} from "./types.ts";

// Everything read from storage, a backup file or pasted JSON is untrusted:
// coerce it into a valid shape (or drop it) before the app ever sees it.

type Raw = Record<string, unknown>;

export const MAX_TEXT = 4000;
export const MAX_LINES = 200;

export const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const text = (v: unknown, max = MAX_TEXT): string =>
  typeof v === "string" ? v.slice(0, max) : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
export const amount = (v: unknown, fallback = 0): number => parseAmount(v) ?? fallback;
const flag = (v: unknown, fallback = false): boolean => (typeof v === "boolean" ? v : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback;
const id = (v: unknown): string => (typeof v === "string" && /^[\w-]{6,64}$/.test(v) ? v : newId());
const day = (v: unknown, fallback: string): string => (isIsoDate(v) ? v : fallback);
const stamp = (v: unknown, fallback: string): string =>
  typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : fallback;
const linkId = (v: unknown): string | null => (typeof v === "string" && v ? v.slice(0, 64) : null);

export const textList = (v: unknown, maxItems = 60): string[] => {
  const items = typeof v === "string" ? v.split(/\r?\n/) : list(v);
  return items
    .map(item => text(item, 1000).replace(/^\s*(?:[-•*]|\d+[.)])\s+/, "").trim())
    .filter(Boolean)
    .slice(0, maxItems);
};

export function normaliseAddress(v: unknown): Address {
  const a = obj(v);
  return { line1: text(a.line1, 200), line2: text(a.line2, 200), town: text(a.town, 120), postcode: text(a.postcode, 20) };
}

export function normaliseCustomer(v: unknown): Customer {
  const c = obj(v);
  return { name: text(c.name, 200), email: text(c.email, 200), phone: text(c.phone, 60), address: normaliseAddress(c.address) };
}

export function normaliseLine(v: unknown): LineItem {
  const l = obj(v);
  return {
    id: id(l.id),
    description: text(l.description, 1000),
    quantity: amount(l.quantity, 1),
    unit: text(l.unit, 30),
    unitPrice: amount(l.unitPrice),
  };
}

export const normaliseLines = (v: unknown): LineItem[] => list(v).slice(0, MAX_LINES).map(normaliseLine);

export function normaliseVat(v: unknown, fallback: VatSetting): VatSetting {
  const raw = obj(v);
  const rate = amount(raw.rate, fallback.rate);
  return { enabled: flag(raw.enabled, fallback.enabled), rate: rate >= 0 && rate <= 100 ? rate : fallback.rate };
}

export function normaliseDeposit(v: unknown): DepositSetting {
  const d = obj(v);
  const value = Math.max(0, amount(d.value));
  if (d.type === "percent") return { type: "percent", value: Math.min(value, 100) };
  if (d.type === "fixed") return { type: "fixed", value };
  return { type: "none", value: 0 };
}

function normaliseBank(v: unknown): BankDetails {
  const b = obj(v);
  return { accountName: text(b.accountName, 120), sortCode: text(b.sortCode, 20), accountNumber: text(b.accountNumber, 30) };
}

const paymentMethods: readonly PaymentMethod[] = ["bank-transfer", "cash", "card", "cheque", "other"];

function normalisePayment(v: unknown, today: string): Payment {
  const p = obj(v);
  return {
    id: id(p.id),
    date: day(p.date, today),
    amount: amount(p.amount),
    method: oneOf(p.method, paymentMethods, "bank-transfer"),
    label: text(p.label, 200),
  };
}

const share = () => ({ token: null, status: "not-available" as const });

export function normaliseQuote(v: unknown, settings: BusinessSettings, now: string): Quote {
  const q = obj(v);
  const today = now.slice(0, 10);
  return {
    kind: "quote",
    ...(flag(q.isTest) ? { isTest: true } : {}),
    id: id(q.id),
    number: text(q.number, 40),
    status: oneOf(q.status, ["draft", "sent", "accepted", "declined"] as const, "draft"),
    title: text(q.title, 300),
    customer: normaliseCustomer(q.customer),
    issueDate: day(q.issueDate, today),
    validUntil: day(q.validUntil, today),
    intro: text(q.intro),
    scope: textList(q.scope),
    works: normaliseLines(q.works),
    materials: normaliseLines(q.materials),
    materialsNote: text(q.materialsNote),
    vat: normaliseVat(q.vat, { enabled: false, rate: settings.defaultVatRate }),
    deposit: normaliseDeposit(q.deposit),
    terms: textList(q.terms),
    internalNotes: text(q.internalNotes),
    share: share(),
    source: oneOf(q.source, ["manual", "chatgpt", "import"] as const, "manual"),
    createdAt: stamp(q.createdAt, now),
    updatedAt: stamp(q.updatedAt, now),
  };
}

export function normaliseInvoice(v: unknown, settings: BusinessSettings, now: string): Invoice {
  const i = obj(v);
  const today = now.slice(0, 10);
  return {
    kind: "invoice",
    ...(flag(i.isTest) ? { isTest: true } : {}),
    id: id(i.id),
    number: text(i.number, 40),
    status: oneOf(i.status, ["draft", "sent"] as const, "draft"),
    title: text(i.title, 300),
    customer: normaliseCustomer(i.customer),
    issueDate: day(i.issueDate, today),
    dueDate: day(i.dueDate, today),
    quoteId: linkId(i.quoteId),
    quoteNumber: text(i.quoteNumber, 40),
    scope: textList(i.scope),
    works: normaliseLines(i.works),
    materials: normaliseLines(i.materials),
    materialsNote: text(i.materialsNote),
    vat: normaliseVat(i.vat, { enabled: false, rate: settings.defaultVatRate }),
    payments: list(i.payments).slice(0, 100).map(p => normalisePayment(p, today)),
    bank: normaliseBank(i.bank),
    paymentNote: text(i.paymentNote),
    internalNotes: text(i.internalNotes),
    share: share(),
    createdAt: stamp(i.createdAt, now),
    updatedAt: stamp(i.updatedAt, now),
  };
}

export function normaliseBooking(v: unknown, now: string): Booking {
  const b = obj(v);
  const start = day(b.start, now.slice(0, 10));
  const end = day(b.end, start);
  return {
    kind: "booking",
    id: id(b.id),
    job: text(b.job, 300),
    customerName: text(b.customerName, 200),
    phone: text(b.phone, 60),
    address: normaliseAddress(b.address),
    start,
    end: end < start ? start : end,
    status: oneOf(b.status, ["confirmed", "provisional"] as const, "confirmed"),
    notes: text(b.notes),
    quoteId: linkId(b.quoteId),
    invoiceId: linkId(b.invoiceId),
    createdAt: stamp(b.createdAt, now),
    updatedAt: stamp(b.updatedAt, now),
  };
}

export function normaliseSettings(v: unknown): BusinessSettings {
  const s = obj(v);
  const d = defaultSettings();
  const whole = (value: unknown, fallback: number, min: number, max: number) => {
    const n = Math.round(amount(value, fallback));
    return n >= min && n <= max ? n : fallback;
  };
  const rate = amount(s.defaultVatRate, d.defaultVatRate);
  return {
    businessName: text(s.businessName, 200) || d.businessName,
    address: normaliseAddress(s.address),
    phone: "phone" in s ? text(s.phone, 60) : d.phone,
    email: "email" in s ? text(s.email, 200) : d.email,
    website: "website" in s ? text(s.website, 200) : d.website,
    vatNumber: text(s.vatNumber, 40),
    companyNumber: text(s.companyNumber, 40),
    vatRegistered: flag(s.vatRegistered, d.vatRegistered),
    defaultVatRate: rate >= 0 && rate <= 100 ? rate : d.defaultVatRate,
    bank: normaliseBank(s.bank),
    paymentTermsDays: whole(s.paymentTermsDays, d.paymentTermsDays, 0, 365),
    quoteValidityDays: whole(s.quoteValidityDays, d.quoteValidityDays, 1, 365),
    quotePrefix: "quotePrefix" in s ? text(s.quotePrefix, 12) : d.quotePrefix,
    nextQuoteNumber: whole(s.nextQuoteNumber, d.nextQuoteNumber, 1, 999_999),
    invoicePrefix: "invoicePrefix" in s ? text(s.invoicePrefix, 12) : d.invoicePrefix,
    nextInvoiceNumber: whole(s.nextInvoiceNumber, d.nextInvoiceNumber, 1, 999_999),
    defaultQuoteIntro: "defaultQuoteIntro" in s ? text(s.defaultQuoteIntro) : d.defaultQuoteIntro,
    defaultTerms: "defaultTerms" in s ? textList(s.defaultTerms) : d.defaultTerms,
    defaultPaymentNote: "defaultPaymentNote" in s ? text(s.defaultPaymentNote) : d.defaultPaymentNote,
  };
}

const uniqueById = <T extends { id: string }>(items: T[]): T[] => {
  const seen = new Set<string>();
  return items.filter(item => (seen.has(item.id) ? false : (seen.add(item.id), true)));
};

export function normaliseAdminData(v: unknown, now: string): AdminData {
  const raw = obj(v);
  const base = emptyData(now);
  const settings = normaliseSettings(raw.settings);
  const meta = obj(raw.meta);
  const records = (v: unknown) => list(v).filter(item => item && typeof item === "object" && !Array.isArray(item));
  return {
    schemaVersion: SCHEMA_VERSION,
    settings,
    quotes: uniqueById(records(raw.quotes).map(q => normaliseQuote(q, settings, now))),
    invoices: uniqueById(records(raw.invoices).map(i => normaliseInvoice(i, settings, now))),
    bookings: uniqueById(records(raw.bookings).map(b => normaliseBooking(b, now))),
    meta: {
      createdAt: stamp(meta.createdAt, base.meta.createdAt),
      lastBackupAt: typeof meta.lastBackupAt === "string" ? stamp(meta.lastBackupAt, now) : null,
    },
  };
}

