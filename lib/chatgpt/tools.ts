import { createHash } from "node:crypto";
import { customerFrom, linesFrom } from "../admin/chatgpt.ts";
import { addDays, daysBetween, formatDayLabel, formatLongDate, formatShortDate, isIsoDate, isWeekend } from "../admin/dates.ts";
import { formatDocNumber, newBooking, newId } from "../admin/factories.ts";
import { depositPence, documentTotals, formatPence, invoiceTotals, lineTotalPence, parseAmount, toPence } from "../admin/money.ts";
import { MAX_LINES, normaliseDeposit, normaliseVat, obj, textList } from "../admin/normalise.ts";
import {
  bookingFieldsFromQuote, bookingsOn, createInvoice, createQuote, deleteBooking, deleteInvoice, deleteQuote, saveBooking, updateInvoice, updateQuote,
  type Clock, type QuoteInput,
} from "../admin/operations.ts";
import { invoiceState, quoteState } from "../admin/status.ts";
import type { Address, AdminData, Booking, BusinessSettings, Customer, Invoice, IsoDate, LineItem, PaymentMethod, Quote, VatSetting } from "../admin/types.ts";
import { CONFIRMATION_LIFETIME, type Scope } from "./config.ts";
import { AuthRequired, changeRecords, createShare, readRecords, revokeShare, ToolError } from "./records.ts";
import { mac, sameSecret } from "./seal.ts";

// The operations ChatGPT can perform for Mike. Each is a thin layer over the
// admin's existing pure operations, numbering, templates and customer links,
// so a quote made by ChatGPT is exactly the quote the admin would have made.
//
// Safety rules applied throughout:
// - Creates use stable IDs and duplicate checks, so a retried call returns the
//   document it already made instead of a second one.
// - Every save goes through the database revision lock; nothing outside the
//   requested change is touched.
// - Deletions, revocations and replacing a link a customer may already hold
//   need a confirmation code that only a preview of that exact action returns.

export type ToolContext = { token: string; origin: string; grant: string; now: Date };
export type ToolOutput = { message: string; data: Record<string, unknown> };
type Raw = Record<string, unknown>;
export type Tool = {
  name: string;
  title: string;
  /** At most 300 characters: the Custom GPT operation description. */
  summary: string;
  description: string;
  scope: Scope;
  kind: "read" | "write" | "delete";
  inputSchema: Record<string, unknown>;
  run: (args: Raw, context: ToolContext) => Promise<ToolOutput>;
};

/* Helpers ---------------------------------------------------------------- */

/** Today's date in the UK, whatever the server's time zone. */
export function londonToday(now = new Date()): IsoDate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
const clockFor = (context: ToolContext): Clock => ({ today: londonToday(context.now), now: context.now.toISOString() });
const money = formatPence;
const pounds = (pence: number) => pence / 100;

function str(args: Raw, key: string, max = 4000): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" && typeof value !== "number") throw new ToolError(`${key} must be text.`);
  return String(value).trim().slice(0, max);
}
function required(args: Raw, key: string, max = 4000): string {
  const value = str(args, key, max);
  if (!value) throw new ToolError(`${key} is required.`);
  return value;
}
function num(args: Raw, key: string): number | undefined {
  if (args[key] === undefined || args[key] === null || args[key] === "") return undefined;
  const value = parseAmount(args[key]);
  if (value === null) throw new ToolError(`${key} must be a number.`);
  return value;
}
const flag = (args: Raw, key: string) => args[key] === true || args[key] === "true";
function day(args: Raw, key: string): IsoDate | undefined {
  const value = str(args, key, 20);
  if (!value) return undefined;
  if (!isIsoDate(value)) throw new ToolError(`${key} must be a date written YYYY-MM-DD, e.g. 2026-10-20.`);
  return value;
}
function choice<T extends string>(args: Raw, key: string, options: readonly T[]): T | undefined {
  const value = str(args, key, 40);
  if (!value) return undefined;
  if (!options.includes(value as T)) throw new ToolError(`${key} must be one of: ${options.join(", ")}.`);
  return value as T;
}
function wholeDays(args: Raw, key: string, min: number, max: number): number | undefined {
  const value = num(args, key);
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < min || value > max) throw new ToolError(`${key} must be a whole number from ${min} to ${max}.`);
  return value;
}

/** Priced lines, refused rather than silently rewritten when an amount is impossible. */
function lines(value: unknown, key: string): Omit<LineItem, "id">[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ToolError(`${key} must be a list of items.`);
  if (value.length > MAX_LINES) throw new ToolError(`${key} can have at most ${MAX_LINES} items.`);
  const parsed = linesFrom(value);
  for (const line of parsed) {
    if (!line.description.trim()) throw new ToolError(`Every item in ${key} needs a description.`);
    if (!(line.quantity > 0) || line.quantity > 1_000_000) throw new ToolError(`"${line.description}" needs a quantity greater than 0.`);
    if (!(line.unitPrice >= 0) || line.unitPrice > 10_000_000) throw new ToolError(`"${line.description}" has an invalid price. Prices are in pounds and cannot be negative.`);
  }
  return parsed;
}
const asLines = (items: Omit<LineItem, "id">[]): LineItem[] => items.map((item, index) => ({ ...item, id: `line-${index}` }));
const subtotalOf = (works: Omit<LineItem, "id">[], materials: Omit<LineItem, "id">[]) =>
  documentTotals({ works: asLines(works), materials: asLines(materials), vat: { enabled: false, rate: 0 } }).subtotalPence;

function checkSubtotal(expected: number | undefined, subtotalPence: number) {
  if (expected !== undefined && toPence(expected) !== subtotalPence) {
    throw new ToolError(`The items add up to ${money(subtotalPence)} before VAT, but Mike's figures came to ${money(toPence(expected))}. Nothing was saved. Check the quantities and prices with Mike.`);
  }
}

function vatFrom(value: unknown, settings: BusinessSettings, fallback?: VatSetting): VatSetting | undefined {
  if (value === undefined || value === null) return undefined;
  const base = fallback ?? { enabled: settings.vatRegistered, rate: settings.defaultVatRate };
  if (typeof value === "boolean") return { ...base, enabled: value };
  return normaliseVat(value, base);
}

function patchCustomer(current: Customer, value: unknown): Customer {
  const raw = obj(value);
  const parsed = customerFrom(raw);
  return {
    name: "name" in raw ? parsed.name : current.name,
    email: "email" in raw ? parsed.email : current.email,
    phone: "phone" in raw ? parsed.phone : current.phone,
    address: "address" in raw ? parsed.address : current.address,
  };
}

const normal = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
/** A stable record ID for a create request, so a retried call finds its earlier result. */
function stableId(kind: "quote" | "invoice" | "booking", parts: unknown): string {
  return `cg${kind[0]}-${createHash("sha256").update(JSON.stringify([kind, parts])).digest("base64url").slice(0, 32)}`;
}
const lineKey = (items: Omit<LineItem, "id">[]) => items.map(line => [normal(line.description), line.quantity, normal(line.unit), toPence(line.unitPrice)]);

const DUPLICATE_WINDOW_MS = 30 * 60_000;
function recentTwin<T extends Quote | Invoice>(records: T[], customer: string, subtotal: number, now: string): T | undefined {
  return records.find(record => normal(record.customer.name) === normal(customer)
    && documentTotals(record).subtotalPence === subtotal
    && Date.parse(now) - Date.parse(record.createdAt) < DUPLICATE_WINDOW_MS
    && (record.kind === "invoice" || record.source === "chatgpt"));
}

function find<T extends { id: string; number: string }>(records: T[], reference: string, label: string): T {
  const value = reference.trim();
  const byId = records.find(record => record.id === value);
  if (byId) return byId;
  const byNumber = records.filter(record => record.number.toLowerCase() === value.toLowerCase());
  if (byNumber.length === 1) return byNumber[0];
  if (/^\d+$/.test(value)) {
    const byDigits = records.filter(record => Number(/(\d+)$/.exec(record.number)?.[1] ?? NaN) === Number(value));
    if (byDigits.length === 1) return byDigits[0];
  }
  throw new ToolError(`No ${label} matches "${value}". Use list_${label}s to search by customer, job or postcode.`);
}
function findDocument(data: AdminData, reference: string): Quote | Invoice {
  const matches: (Quote | Invoice)[] = [];
  for (const [records, label] of [[data.quotes, "quote"], [data.invoices, "invoice"]] as const) {
    try { matches.push(find<Quote | Invoice>(records, reference, label)); } catch {}
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new ToolError(`"${reference}" matches both a quote and an invoice. Give the full number, e.g. ${matches.map(doc => doc.number).join(" or ")}.`);
  throw new ToolError(`No quote or invoice matches "${reference}". Use list_quotes or list_invoices to find it.`);
}

const addressLine = (address: Address) => [address.line1, address.line2, address.town, address.postcode].map(part => part.trim()).filter(Boolean).join(", ");
const adminUrl = (context: ToolContext, record: Quote | Invoice | Booking) =>
  record.kind === "booking" ? `${context.origin}/admin/diary?date=${record.start}` : `${context.origin}/admin/${record.kind}s/${record.id}`;
const lineOut = (line: LineItem) => ({ description: line.description, quantity: line.quantity, unit: line.unit, unitPrice: line.unitPrice, total: money(lineTotalPence(line)) });
const vatText = (vat: VatSetting) => vat.enabled ? `VAT at ${vat.rate}%` : "no VAT";

function quoteSummary(quote: Quote, context: ToolContext) {
  const totals = documentTotals(quote);
  return {
    id: quote.id, number: quote.number, status: quoteState(quote, londonToday(context.now)), title: quote.title,
    customer: quote.customer.name, address: addressLine(quote.customer.address), issueDate: quote.issueDate, validUntil: quote.validUntil,
    subtotal: money(totals.subtotalPence), vat: vatText(quote.vat), total: money(totals.totalPence),
    ...(quote.isTest ? { testDocument: true } : {}), adminUrl: adminUrl(context, quote),
  };
}
function quoteDetail(quote: Quote, data: AdminData, context: ToolContext) {
  const totals = documentTotals(quote);
  const deposit = depositPence(totals.totalPence, quote.deposit);
  return {
    ...quoteSummary(quote, context),
    customer: { ...quote.customer, address: addressLine(quote.customer.address) },
    intro: quote.intro, scope: quote.scope, works: quote.works.map(lineOut), materials: quote.materials.map(lineOut), materialsNote: quote.materialsNote,
    worksTotal: money(totals.worksPence), materialsTotal: money(totals.materialsPence), vatAmount: money(totals.vatPence),
    deposit: deposit ? { ...quote.deposit, amount: money(deposit) } : null, terms: quote.terms, internalNotes: quote.internalNotes, source: quote.source,
    invoices: data.invoices.filter(invoice => invoice.quoteId === quote.id).map(invoice => ({ id: invoice.id, number: invoice.number })),
    bookings: data.bookings.filter(booking => booking.quoteId === quote.id).map(booking => ({ id: booking.id, start: booking.start, end: booking.end, job: booking.job })),
    createdAt: quote.createdAt, updatedAt: quote.updatedAt,
  };
}
function invoiceSummary(invoice: Invoice, context: ToolContext) {
  const totals = invoiceTotals(invoice);
  return {
    id: invoice.id, number: invoice.number, status: invoiceState(invoice, londonToday(context.now)), title: invoice.title,
    customer: invoice.customer.name, address: addressLine(invoice.customer.address), issueDate: invoice.issueDate, dueDate: invoice.dueDate,
    total: money(totals.totalPence), paid: money(totals.paidPence), balance: money(totals.balancePence), vat: vatText(invoice.vat),
    quoteNumber: invoice.quoteNumber || null, ...(invoice.isTest ? { testDocument: true } : {}), adminUrl: adminUrl(context, invoice),
  };
}
function invoiceDetail(invoice: Invoice, data: AdminData, context: ToolContext) {
  const totals = invoiceTotals(invoice);
  return {
    ...invoiceSummary(invoice, context),
    customer: { ...invoice.customer, address: addressLine(invoice.customer.address) },
    scope: invoice.scope, works: invoice.works.map(lineOut), materials: invoice.materials.map(lineOut), materialsNote: invoice.materialsNote,
    subtotal: money(totals.subtotalPence), vatAmount: money(totals.vatPence),
    payments: invoice.payments.map(payment => ({ date: payment.date, amount: money(toPence(payment.amount)), method: payment.method, label: payment.label })),
    paymentNote: invoice.paymentNote, internalNotes: invoice.internalNotes,
    bookings: data.bookings.filter(booking => booking.invoiceId === invoice.id).map(booking => ({ id: booking.id, start: booking.start, end: booking.end, job: booking.job })),
    createdAt: invoice.createdAt, updatedAt: invoice.updatedAt,
  };
}
function bookingOut(booking: Booking, data: AdminData, context: ToolContext) {
  return {
    id: booking.id, job: booking.job, customer: booking.customerName, phone: booking.phone, address: addressLine(booking.address),
    start: booking.start, end: booking.end, days: daysBetween(booking.start, booking.end) + 1, status: booking.status, notes: booking.notes,
    quote: data.quotes.find(quote => quote.id === booking.quoteId)?.number ?? null,
    invoice: data.invoices.find(invoice => invoice.id === booking.invoiceId)?.number ?? null,
    adminUrl: adminUrl(context, booking),
  };
}
const dateRange = (start: IsoDate, end: IsoDate) => start === end ? formatDayLabel(start) : `${formatDayLabel(start)} – ${formatDayLabel(end)}`;

function search(query: string | undefined, ...fields: string[]) {
  const q = query ? normal(query) : "";
  return !q || fields.some(field => normal(field).includes(q));
}
const limitOf = (args: Raw) => wholeDays(args, "limit", 1, 100) ?? 20;

/* Customer links and confirmations ---------------------------------------- */

async function newLink(context: ToolContext, id: string): Promise<{ customerLink: string } | { linkError: string }> {
  try { return { customerLink: await createShare(context.token, id, context.origin) }; }
  catch (error) {
    if (error instanceof AuthRequired) throw error;
    return { linkError: "The customer link could not be created just now. The document is saved; call create_customer_link to try again." };
  }
}
const linkSentence = (link: { customerLink: string } | { linkError: string }) =>
  "customerLink" in link ? ` Customer link: ${link.customerLink} (anyone with this link can view and print it; any earlier link for this document has stopped working).` : ` ${link.linkError}`;
const REPEAT_LINK = " Its customer link was given when it was first created and is left working; links cannot be shown again. Only if Mike needs a new one, call create_customer_link (the earlier link then stops working).";
/** A link the customer may already hold is replaced only with confirmation. */
const customerMayHoldLink = (doc: Quote | Invoice) => doc.status !== "draft" || (doc.kind === "invoice" && doc.payments.length > 0);

type Target = { id: string; updatedAt: string };
function confirmationCode(context: ToolContext, action: string, target: Target): string {
  const expires = Math.floor(context.now.getTime() / 1000) + CONFIRMATION_LIFETIME;
  return `${expires.toString(36)}.${mac("confirm", context.grant, action, target.id, target.updatedAt, String(expires)).slice(0, 24)}`;
}
function confirmed(context: ToolContext, action: string, target: Target, code: unknown): boolean {
  const match = typeof code === "string" ? /^([0-9a-z]{1,10})\.([A-Za-z0-9_-]{24})$/.exec(code.trim()) : null;
  if (!match) return false;
  const expires = parseInt(match[1], 36);
  if (!(expires > context.now.getTime() / 1000)) return false;
  return sameSecret(match[2], mac("confirm", context.grant, action, target.id, target.updatedAt, String(expires)).slice(0, 24));
}
function confirmationNeeded(context: ToolContext, tool: string, action: string, target: Target, consequence: string, supplied: unknown, details: Record<string, unknown>): ToolOutput {
  const code = confirmationCode(context, action, target);
  const stale = supplied !== undefined && supplied !== null && supplied !== "" ? "That confirmation code is not valid for this record any more (it expired or the record changed). " : "";
  return {
    message: `${stale}Nothing has been changed yet. ${consequence} Ask Mike to confirm in the chat. Only after he clearly says yes, call ${tool} again with confirmationCode "${code}" (valid for ${CONFIRMATION_LIFETIME / 60} minutes). Never confirm on his behalf.`,
    data: { status: "confirmation_required", action, confirmationCode: code, expiresInMinutes: CONFIRMATION_LIFETIME / 60, ...details },
  };
}
/** The record must be unchanged since Mike confirmed. */
function stillAsConfirmed<T extends Target>(record: T | undefined, updatedAt: string): T | undefined {
  if (record && record.updatedAt !== updatedAt) throw new ToolError("The record changed after Mike confirmed. Nothing was changed; ask him to confirm again.");
  return record;
}

/* Schemas ---------------------------------------------------------------- */

const text = (description: string) => ({ type: "string", description });
const date = (description: string) => ({ type: "string", format: "date", description });
const number = (description: string) => ({ type: "number", description });
const integer = (description: string, minimum: number, maximum: number) => ({ type: "integer", minimum, maximum, description });
const boolean = (description: string) => ({ type: "boolean", description });
const strings = (description: string) => ({ type: "array", items: { type: "string" }, description });
const oneOf = (values: readonly string[], description: string) => ({ type: "string", enum: values, description });
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

const customerSchema = {
  type: "object",
  description: "The customer as Mike gave them.",
  properties: {
    name: text("Customer's name, e.g. Paul Finn."),
    address: text("Postal address on one line, ending with the postcode, e.g. \"6 Falkstone Close, Gorse Covert, Warrington, WA3 6SU\"."),
    email: text("Only if Mike gave it."),
    phone: text("Only if Mike gave it."),
  },
  required: ["name"],
  additionalProperties: false,
};
const lineSchema = object({
  description: text("What the item is, e.g. \"Living room walls (25 m²): preparation and two coats\"."),
  quantity: number("How many units, e.g. 2 for two days. Use 1 for a fixed price."),
  unit: text("Optional unit, e.g. day, room, m², litre."),
  unitPrice: number("Price per unit in pounds, excluding VAT, exactly as Mike gave it."),
}, ["description", "quantity", "unitPrice"]);
const linesSchema = (description: string) => ({ type: "array", items: lineSchema, description });
const vatSchema = object({ enabled: boolean("Charge VAT on this document."), rate: number("VAT rate in percent, normally 20.") });
const depositSchema = object({ type: oneOf(["none", "percent", "fixed"], "How the deposit is set."), value: number("Percent, or pounds for a fixed deposit.") }, ["type"]);
const expectedSubtotal = number("The sum of all prices Mike gave, in pounds before VAT. Nothing is saved if the items add up to a different amount.");
const confirmation = text("Only after Mike has explicitly said yes: the code returned by the previous call of this tool.");
const documentRef = text("Quote or invoice number (e.g. Q-0041 or INV-0012) or its id.");

/* Tools ------------------------------------------------------------------ */

const quotesIn = (data: AdminData) => [...data.quotes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
const invoicesIn = (data: AdminData) => [...data.invoices].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

const listQuotes: Tool = {
  name: "list_quotes", title: "List quotes", kind: "read", scope: "dm:read",
  summary: "List or search Mike's quotes by customer, job, postcode or number, newest first, with status and totals.",
  description: "List or search quotes, most recently changed first. Returns number, status (draft, sent, accepted, declined or expired), customer, job title and totals. Use it to find a quote before reading, changing or invoicing it.",
  inputSchema: object({
    search: text("Words to match in the customer name, job title, address, postcode or number."),
    status: oneOf(["draft", "sent", "accepted", "declined", "expired"], "Only quotes in this state."),
    limit: integer("Maximum results (default 20).", 1, 100),
  }),
  async run(args, context) {
    const { data } = await readRecords(context.token);
    const status = choice(args, "status", ["draft", "sent", "accepted", "declined", "expired"] as const);
    const query = str(args, "search", 200);
    const all = quotesIn(data).filter(quote => search(query, quote.number, quote.title, quote.customer.name, addressLine(quote.customer.address))
      && (!status || quoteState(quote, londonToday(context.now)) === status));
    const quotes = all.slice(0, limitOf(args)).map(quote => quoteSummary(quote, context));
    return { message: all.length ? `Found ${all.length} quote${all.length === 1 ? "" : "s"}${all.length > quotes.length ? `; showing ${quotes.length}` : ""}.` : "No quotes match.", data: { total: all.length, quotes } };
  },
};

const getQuote: Tool = {
  name: "get_quote", title: "Read a quote", kind: "read", scope: "dm:read",
  summary: "Read one quote in full: customer, scope, every priced line, VAT, deposit, totals, notes, linked invoices and bookings.",
  description: "Read one quote in full, including customer details, scope, every priced line, VAT, deposit, totals, private notes and linked invoices and diary bookings.",
  inputSchema: object({ quote: text("Quote number (e.g. Q-0041) or id.") }, ["quote"]),
  async run(args, context) {
    const { data } = await readRecords(context.token);
    const quote = find(data.quotes, required(args, "quote", 80), "quote");
    const detail = quoteDetail(quote, data, context);
    return { message: `Quote ${quote.number} for ${quote.customer.name || "an unnamed customer"}: ${quote.title || "untitled"}, ${detail.total} (${detail.status}).`, data: { quote: detail } };
  },
};

const createQuoteTool: Tool = {
  name: "create_quote", title: "Create a quote", kind: "write", scope: "dm:write",
  summary: "Create and save a real D&M quotation from Mike's figures and return its number, total and secure customer link. Never invent prices.",
  description: [
    "Create and save a D&M quotation in the admin, with the next quote number, the standard introduction and terms, and (by default) a secure customer link to the printable quote.",
    "Use only the prices and quantities Mike gives; never estimate or invent a price. Prices are in pounds before VAT; VAT follows the business setting unless Mike says otherwise.",
    "Always pass expectedSubtotal (the sum of Mike's figures). Example: \"Living room, 25 m² walls, two days, £400 labour, £118 materials\" → works [{description: \"Living room walls (25 m²): preparation and painting\", quantity: 2, unit: \"day\", unitPrice: 200}], materials [{description: \"Paint and materials\", quantity: 1, unitPrice: 118}], expectedSubtotal 518.",
    "Calling again with the same details returns the same quote instead of a duplicate. Set allowDuplicate only when Mike explicitly wants a second copy.",
    "Reply to Mike with the quote number, total and customer link exactly as returned.",
  ].join(" "),
  inputSchema: object({
    customer: customerSchema,
    title: text("Short job title, e.g. \"Living room redecoration\"."),
    works: linesSchema("Priced labour and work items."),
    materials: linesSchema("Priced materials, if Mike gave them separately."),
    scope: strings("Optional short bullet points describing the work."),
    intro: text("Optional opening paragraph. Leave out to use D&M's standard introduction."),
    materialsNote: text("Optional note under the materials."),
    validForDays: integer("Days the quote stays valid. Leave out for the business default.", 1, 365),
    vat: vatSchema,
    deposit: depositSchema,
    internalNotes: text("Private notes for Mike; never shown to the customer."),
    expectedSubtotal,
    createCustomerLink: boolean("Create the customer link (default true)."),
    allowDuplicate: boolean("Only when Mike explicitly wants another quote with the same details."),
    testDocument: boolean("Only when Mike asks for a test: marked TEST, no quote number used, never for a real customer."),
  }, ["customer", "title", "works", "expectedSubtotal"]),
  async run(args, context) {
    const clock = clockFor(context);
    const customer = customerFrom(args.customer);
    if (!customer.name.trim()) throw new ToolError("customer.name is required.");
    const title = required(args, "title", 300);
    const works = lines(args.works, "works");
    const materials = lines(args.materials, "materials");
    if (!works.length && !materials.length) throw new ToolError("Add at least one priced item from Mike.");
    const subtotal = subtotalOf(works, materials);
    checkSubtotal(num(args, "expectedSubtotal"), subtotal);
    const isTest = flag(args, "testDocument");
    const input: QuoteInput = {
      source: "chatgpt", customer, title, works, materials, scope: textList(args.scope), materialsNote: str(args, "materialsNote") ?? "",
      ...(isTest ? { isTest: true } : {}),
    };
    const intro = str(args, "intro");
    if (intro) input.intro = intro;
    const validFor = wholeDays(args, "validForDays", 1, 365);
    if (validFor) input.validForDays = validFor;
    if (args.deposit !== undefined) input.deposit = normaliseDeposit(args.deposit);
    const notes = str(args, "internalNotes");
    if (notes) input.internalNotes = notes;
    const allowDuplicate = flag(args, "allowDuplicate");
    const id = allowDuplicate ? newId() : stableId("quote", [clock.today, normal(customer.name), normal(addressLine(customer.address)), normal(title), lineKey(works), lineKey(materials), args.vat ?? null, input.deposit ?? null, isTest]);

    // Set once this call has sent its write: finding the quote afterwards means the answer was lost, not a repeat.
    let sent = false;
    const { result, records } = await changeRecords<"already-created" | "created" | Quote>(context.token, data => {
      if (data.quotes.some(quote => quote.id === id)) return { result: sent ? "created" : "already-created" };
      const twin = allowDuplicate ? undefined : recentTwin(data.quotes, customer.name, subtotal, clock.now);
      if (twin) return { result: twin };
      const vat = vatFrom(args.vat, data.settings);
      sent = true;
      return { data: createQuote(data, clock, { ...input, ...(vat ? { vat } : {}), id }).data, result: "created" as const };
    });
    if (typeof result === "object") {
      const minutes = Math.max(1, Math.round((context.now.getTime() - Date.parse(result.createdAt)) / 60_000));
      return {
        message: `Not created: quote ${result.number} for ${result.customer.name} with the same ${money(subtotal)} subtotal was made ${minutes} minute${minutes === 1 ? "" : "s"} ago. If that is the one Mike meant, use it. Only if he explicitly wants a second copy, call create_quote again with allowDuplicate: true.`,
        data: { status: "possible_duplicate", existingQuote: quoteSummary(result, context) },
      };
    }
    const quote = records.quotes.find(record => record.id === id);
    if (!quote) throw new ToolError("The quote could not be confirmed as saved. Call list_quotes to check before trying again.");
    const summary = quoteSummary(quote, context);
    // A repeat never replaces the link: Mike may already have sent the first one.
    const link = args.createCustomerLink === false || result === "already-created" ? null : await newLink(context, quote.id);
    const warnings = [
      ...(quote.isTest ? ["This is a TEST quote: do not send it to a real customer."] : []),
      ...([...quote.works, ...quote.materials].some(line => line.unitPrice === 0) ? ["At least one item has no price."] : []),
    ];
    const opening = result === "created" ? `Created quote ${quote.number}` : `Quote ${quote.number} was already created by an earlier identical request (no duplicate made)`;
    return {
      message: `${opening} for ${quote.customer.name}: ${quote.title}. Total ${summary.total} (${summary.vat}).${link ? linkSentence(link) : result === "already-created" ? REPEAT_LINK : ""} In D&M admin: ${summary.adminUrl}.${warnings.length ? ` ${warnings.join(" ")}` : ""}`,
      data: { status: result === "created" ? "created" : "already_created", quote: quoteDetail(quote, records, context), ...(link ?? {}), ...(warnings.length ? { warnings } : {}) },
    };
  },
};

const quoteStatuses = ["draft", "sent", "accepted", "declined"] as const;
const updateQuoteTool: Tool = {
  name: "update_quote", title: "Update a quote", kind: "write", scope: "dm:write",
  summary: "Change a saved quote: customer, title, scope, priced lines (replaces the list), VAT, deposit, validity, notes or status (draft/sent/accepted/declined).",
  description: "Change a saved quote. Only the fields given change. works or materials replace that whole list, so include every item that should remain. Status can be draft, sent, accepted or declined. Pass expectedSubtotal whenever prices change. A customer link already issued shows the updated quote straight away.",
  inputSchema: object({
    quote: text("Quote number (e.g. Q-0041) or id."),
    customer: { ...customerSchema, required: [], description: "Only the customer details that change." },
    title: text("New job title."), intro: text("New introduction."), scope: strings("Replacement scope bullet points."),
    works: linesSchema("Replacement list of priced work items."), materials: linesSchema("Replacement list of priced materials."),
    materialsNote: text("New materials note."), validUntil: date("New expiry date, YYYY-MM-DD."), vat: vatSchema, deposit: depositSchema,
    terms: strings("Replacement terms."), internalNotes: text("Replacement private notes."), status: oneOf(quoteStatuses, "New status."),
    expectedSubtotal,
  }, ["quote"]),
  async run(args, context) {
    const clock = clockFor(context);
    const reference = required(args, "quote", 80);
    const works = args.works === undefined ? undefined : lines(args.works, "works");
    const materials = args.materials === undefined ? undefined : lines(args.materials, "materials");
    const status = choice(args, "status", quoteStatuses);
    const validUntil = day(args, "validUntil");
    const changes = ["customer", "title", "intro", "scope", "works", "materials", "materialsNote", "validUntil", "vat", "deposit", "terms", "internalNotes", "status"].filter(key => args[key] !== undefined);
    if (!changes.length) throw new ToolError("Say what to change on the quote.");
    let id = "";
    const { records } = await changeRecords(context.token, data => {
      const quote = find(data.quotes, reference, "quote");
      id = quote.id;
      const next = updateQuote(data, quote.id, current => ({
        ...current,
        ...(args.customer !== undefined ? { customer: patchCustomer(current.customer, args.customer) } : {}),
        ...(args.title !== undefined ? { title: required(args, "title", 300) } : {}),
        ...(args.intro !== undefined ? { intro: str(args, "intro") ?? "" } : {}),
        ...(args.scope !== undefined ? { scope: textList(args.scope) } : {}),
        ...(works ? { works: asLines(works).map(line => ({ ...line, id: newId() })) } : {}),
        ...(materials ? { materials: asLines(materials).map(line => ({ ...line, id: newId() })) } : {}),
        ...(args.materialsNote !== undefined ? { materialsNote: str(args, "materialsNote") ?? "" } : {}),
        ...(validUntil ? { validUntil } : {}),
        ...(args.vat !== undefined ? { vat: vatFrom(args.vat, data.settings, current.vat)! } : {}),
        ...(args.deposit !== undefined ? { deposit: normaliseDeposit(args.deposit) } : {}),
        ...(args.terms !== undefined ? { terms: textList(args.terms) } : {}),
        ...(args.internalNotes !== undefined ? { internalNotes: str(args, "internalNotes") ?? "" } : {}),
        ...(status ? { status } : {}),
      }), clock.now);
      checkSubtotal(num(args, "expectedSubtotal"), documentTotals(next.quotes.find(record => record.id === quote.id)!).subtotalPence);
      return { data: next, result: null };
    });
    const quote = records.quotes.find(record => record.id === id)!;
    const summary = quoteSummary(quote, context);
    return { message: `Updated quote ${quote.number} (${changes.join(", ")}). Total now ${summary.total} (${summary.vat}); status ${summary.status}.`, data: { status: "updated", quote: quoteDetail(quote, records, context) } };
  },
};

const invoiceStates = ["draft", "sent", "part-paid", "paid", "overdue"] as const;
const listInvoices: Tool = {
  name: "list_invoices", title: "List invoices", kind: "read", scope: "dm:read",
  summary: "List or search invoices by customer, job, postcode or number, with status (draft/sent/part-paid/paid/overdue), totals and balance.",
  description: "List or search invoices, most recently changed first, with status (draft, sent, part-paid, paid or overdue), total, amount paid and balance due. Use status \"overdue\" to see who owes money.",
  inputSchema: object({ search: text("Words to match in the customer, job, address, postcode or number."), status: oneOf(invoiceStates, "Only invoices in this state."), limit: integer("Maximum results (default 20).", 1, 100) }),
  async run(args, context) {
    const { data } = await readRecords(context.token);
    const status = choice(args, "status", invoiceStates);
    const query = str(args, "search", 200);
    const all = invoicesIn(data).filter(invoice => search(query, invoice.number, invoice.title, invoice.customer.name, addressLine(invoice.customer.address), invoice.quoteNumber)
      && (!status || invoiceState(invoice, londonToday(context.now)) === status));
    const invoices = all.slice(0, limitOf(args)).map(invoice => invoiceSummary(invoice, context));
    const owed = all.filter(invoice => !invoice.isTest).reduce((sum, invoice) => sum + Math.max(0, invoiceTotals(invoice).balancePence), 0);
    return { message: all.length ? `Found ${all.length} invoice${all.length === 1 ? "" : "s"}, ${money(owed)} outstanding in total${all.length > invoices.length ? `; showing ${invoices.length}` : ""}.` : "No invoices match.", data: { total: all.length, outstanding: money(owed), invoices } };
  },
};

const getInvoice: Tool = {
  name: "get_invoice", title: "Read an invoice", kind: "read", scope: "dm:read",
  summary: "Read one invoice in full: customer, priced lines, VAT, payments received, balance due, due date and notes.",
  description: "Read one invoice in full, including priced lines, VAT, every payment received, the balance due, due date, linked quote and diary bookings.",
  inputSchema: object({ invoice: text("Invoice number (e.g. INV-0012) or id.") }, ["invoice"]),
  async run(args, context) {
    const { data } = await readRecords(context.token);
    const invoice = find(data.invoices, required(args, "invoice", 80), "invoice");
    const detail = invoiceDetail(invoice, data, context);
    return { message: `Invoice ${invoice.number} for ${invoice.customer.name || "an unnamed customer"}: total ${detail.total}, paid ${detail.paid}, balance ${detail.balance} (${detail.status}, due ${formatLongDate(invoice.dueDate)}).`, data: { invoice: detail } };
  },
};

function invoiceFields(args: Raw, settings: BusinessSettings, current: Invoice, clock: Clock, works?: Omit<LineItem, "id">[], materials?: Omit<LineItem, "id">[]): Invoice {
  const dueIn = wholeDays(args, "dueInDays", 0, 365);
  const dueDate = day(args, "dueDate");
  return {
    ...current,
    ...(args.customer !== undefined ? { customer: patchCustomer(current.customer, args.customer) } : {}),
    ...(args.title !== undefined ? { title: required(args, "title", 300) } : {}),
    ...(args.scope !== undefined ? { scope: textList(args.scope) } : {}),
    ...(works ? { works: asLines(works).map(line => ({ ...line, id: newId() })) } : {}),
    ...(materials ? { materials: asLines(materials).map(line => ({ ...line, id: newId() })) } : {}),
    ...(args.materialsNote !== undefined ? { materialsNote: str(args, "materialsNote") ?? "" } : {}),
    ...(args.vat !== undefined ? { vat: vatFrom(args.vat, settings, current.vat)! } : {}),
    ...(dueIn !== undefined ? { dueDate: addDays(current.issueDate || clock.today, dueIn) } : {}),
    ...(dueDate ? { dueDate } : {}),
    ...(args.paymentNote !== undefined && !current.isTest ? { paymentNote: str(args, "paymentNote") ?? "" } : {}),
    ...(args.internalNotes !== undefined ? { internalNotes: str(args, "internalNotes") ?? "" } : {}),
    ...(args.status !== undefined ? { status: choice(args, "status", ["draft", "sent"] as const)! } : {}),
  };
}

const createInvoiceTool: Tool = {
  name: "create_invoice", title: "Create an invoice", kind: "write", scope: "dm:write",
  summary: "Create and save an invoice, either from an accepted quote or from Mike's figures, and return its number, total and secure customer link.",
  description: [
    "Create and save a D&M invoice with the next invoice number, the business's bank details and payment terms, and (by default) a secure customer link.",
    "Give fromQuote to invoice a quote: everything is copied and the quote is marked accepted; any other fields given override the copy (e.g. a deposit invoice with different lines).",
    "Otherwise give customer, title and works from Mike's figures, never invented prices, with expectedSubtotal.",
    "Calling again for the same quote or with the same details returns the existing invoice instead of a duplicate. Set allowDuplicate only when Mike explicitly wants another invoice, e.g. a second stage payment.",
  ].join(" "),
  inputSchema: object({
    fromQuote: text("Quote number (e.g. Q-0041) or id to invoice."),
    customer: customerSchema, title: text("Job title."),
    works: linesSchema("Priced work items."), materials: linesSchema("Priced materials."), scope: strings("Optional description points."),
    materialsNote: text("Optional note under the materials."), vat: vatSchema,
    dueInDays: integer("Days until payment is due. Leave out for the business default.", 0, 365),
    paymentNote: text("Optional note about paying."), internalNotes: text("Private notes for Mike."),
    expectedSubtotal, createCustomerLink: boolean("Create the customer link (default true)."),
    allowDuplicate: boolean("Only when Mike explicitly wants another invoice with the same details or for the same quote."),
    testDocument: boolean("Only when Mike asks for a test invoice (not from a quote)."),
  }),
  async run(args, context) {
    const clock = clockFor(context);
    const fromQuote = str(args, "fromQuote", 80);
    const works = args.works === undefined ? undefined : lines(args.works, "works");
    const materials = args.materials === undefined ? undefined : lines(args.materials, "materials");
    const allowDuplicate = flag(args, "allowDuplicate");
    const randomId = newId();
    let customer: Customer | null = null;
    if (!fromQuote) {
      customer = customerFrom(args.customer);
      if (!customer.name.trim()) throw new ToolError("Give fromQuote, or the customer's name with the priced items.");
      required(args, "title", 300);
      if (!works?.length && !materials?.length) throw new ToolError("Add at least one priced item from Mike.");
      checkSubtotal(num(args, "expectedSubtotal"), subtotalOf(works ?? [], materials ?? []));
    }
    const isTest = !fromQuote && flag(args, "testDocument");
    let id = "";
    let quoteNumber = "";
    let sent = false;
    const { result, records } = await changeRecords<"already-created" | "created" | Invoice>(context.token, data => {
      let twin: Invoice | undefined;
      let created: ReturnType<typeof createInvoice>;
      if (fromQuote) {
        const quote = find(data.quotes, fromQuote, "quote");
        quoteNumber = quote.number;
        id = allowDuplicate ? randomId : stableId("invoice", ["quote", quote.id]);
        if (data.invoices.some(invoice => invoice.id === id)) return { result: sent ? "created" : "already-created" };
        twin = allowDuplicate ? undefined : data.invoices.find(invoice => invoice.quoteId === quote.id);
        if (twin) return { result: twin };
        created = createInvoice(data, clock, quote.id, { id });
      } else {
        id = allowDuplicate ? randomId : stableId("invoice", [clock.today, normal(customer!.name), normal(addressLine(customer!.address)), normal(str(args, "title") ?? ""), lineKey(works ?? []), lineKey(materials ?? []), args.vat ?? null, isTest]);
        if (data.invoices.some(invoice => invoice.id === id)) return { result: sent ? "created" : "already-created" };
        twin = allowDuplicate ? undefined : recentTwin(data.invoices, customer!.name, subtotalOf(works ?? [], materials ?? []), clock.now);
        if (twin) return { result: twin };
        created = createInvoice(data, clock, undefined, { id, isTest });
      }
      // A new invoice starts with one blank line; from Mike's figures it holds exactly his items.
      const next = updateInvoice(created.data, id, invoice => invoiceFields(args, data.settings, invoice, clock, fromQuote ? works : works ?? [], fromQuote ? materials : materials ?? []), clock.now);
      if (fromQuote) checkSubtotal(num(args, "expectedSubtotal"), documentTotals(next.invoices.find(invoice => invoice.id === id)!).subtotalPence);
      sent = true;
      return { data: next, result: "created" as const };
    });
    if (typeof result === "object") {
      return {
        message: fromQuote
          ? `Not created: quote ${quoteNumber} already has invoice ${result.number}. If that is the one Mike meant, use it. Only if he explicitly wants another invoice for this quote, call create_invoice again with allowDuplicate: true.`
          : `Not created: invoice ${result.number} for ${result.customer.name} with the same subtotal was made in the last 30 minutes. Only if Mike explicitly wants a second copy, call create_invoice again with allowDuplicate: true.`,
        data: { status: "possible_duplicate", existingInvoice: invoiceSummary(result, context) },
      };
    }
    const invoice = records.invoices.find(record => record.id === id);
    if (!invoice) throw new ToolError("The invoice could not be confirmed as saved. Call list_invoices to check before trying again.");
    const summary = invoiceSummary(invoice, context);
    const link = args.createCustomerLink === false || result === "already-created" ? null : await newLink(context, invoice.id);
    const opening = result === "created" ? `Created invoice ${invoice.number}` : `Invoice ${invoice.number} was already created by an earlier identical request (no duplicate made)`;
    return {
      message: `${opening} for ${invoice.customer.name}: ${invoice.title}. Total ${summary.total} (${summary.vat}), due ${formatLongDate(invoice.dueDate)}.${invoice.quoteNumber ? ` From quote ${invoice.quoteNumber}, now marked accepted.` : ""}${link ? linkSentence(link) : result === "already-created" ? REPEAT_LINK : ""} In D&M admin: ${summary.adminUrl}.${invoice.isTest ? " This is a TEST invoice: no payment is due." : ""}`,
      data: { status: result === "created" ? "created" : "already_created", invoice: invoiceDetail(invoice, records, context), ...(link ?? {}) },
    };
  },
};

const updateInvoiceTool: Tool = {
  name: "update_invoice", title: "Update an invoice", kind: "write", scope: "dm:write",
  summary: "Change a saved invoice: customer, title, priced lines (replaces the list), VAT, due date, payment note, private notes or status (draft/sent).",
  description: "Change a saved invoice. Only the fields given change. works or materials replace that whole list, so include every item that should remain; pass expectedSubtotal whenever prices change. Status can be draft or sent; use record_payment for money received. A customer link already issued shows the change straight away.",
  inputSchema: object({
    invoice: text("Invoice number (e.g. INV-0012) or id."),
    customer: { ...customerSchema, required: [], description: "Only the customer details that change." },
    title: text("New job title."), scope: strings("Replacement description points."),
    works: linesSchema("Replacement list of priced work items."), materials: linesSchema("Replacement list of priced materials."),
    materialsNote: text("New materials note."), vat: vatSchema, dueDate: date("New due date, YYYY-MM-DD."),
    dueInDays: integer("Due this many days after the issue date.", 0, 365), paymentNote: text("New payment note."),
    internalNotes: text("Replacement private notes."), status: oneOf(["draft", "sent"], "draft, or sent once Mike has sent it."), expectedSubtotal,
  }, ["invoice"]),
  async run(args, context) {
    const clock = clockFor(context);
    const reference = required(args, "invoice", 80);
    const works = args.works === undefined ? undefined : lines(args.works, "works");
    const materials = args.materials === undefined ? undefined : lines(args.materials, "materials");
    const changes = ["customer", "title", "scope", "works", "materials", "materialsNote", "vat", "dueDate", "dueInDays", "paymentNote", "internalNotes", "status"].filter(key => args[key] !== undefined);
    if (!changes.length) throw new ToolError("Say what to change on the invoice.");
    let id = "";
    const { records } = await changeRecords(context.token, data => {
      const invoice = find(data.invoices, reference, "invoice");
      id = invoice.id;
      const next = updateInvoice(data, invoice.id, current => invoiceFields(args, data.settings, current, clock, works, materials), clock.now);
      checkSubtotal(num(args, "expectedSubtotal"), documentTotals(next.invoices.find(record => record.id === id)!).subtotalPence);
      return { data: next, result: null };
    });
    const invoice = records.invoices.find(record => record.id === id)!;
    const summary = invoiceSummary(invoice, context);
    return { message: `Updated invoice ${invoice.number} (${changes.join(", ")}). Total ${summary.total}, balance ${summary.balance}, due ${formatLongDate(invoice.dueDate)}; status ${summary.status}.`, data: { status: "updated", invoice: invoiceDetail(invoice, records, context) } };
  },
};

const paymentMethods: readonly PaymentMethod[] = ["bank-transfer", "cash", "card", "cheque", "other"];
const recordPayment: Tool = {
  name: "record_payment", title: "Record a payment", kind: "write", scope: "dm:write",
  summary: "Record money received against an invoice (or mark the remaining balance paid) and return the new balance.",
  description: "Record money received against an invoice, or set payRemainingBalance to mark it fully paid. Refuses amounts larger than the balance. Repeating the same payment (same date, amount, method and label) is recognised and not recorded twice unless allowDuplicate is set because Mike says it really was paid twice.",
  inputSchema: object({
    invoice: text("Invoice number (e.g. INV-0012) or id."),
    amount: number("Amount received in pounds."), payRemainingBalance: boolean("Record the whole remaining balance as paid."),
    date: date("Date received, YYYY-MM-DD (default today)."), method: oneOf(paymentMethods, "How it was paid (default bank-transfer)."),
    label: text("Optional label, e.g. Deposit."), allowDuplicate: boolean("Only when Mike confirms an identical second payment."),
  }, ["invoice"]),
  async run(args, context) {
    const clock = clockFor(context);
    const reference = required(args, "invoice", 80);
    const paid = day(args, "date") ?? clock.today;
    const method = choice(args, "method", paymentMethods) ?? "bank-transfer";
    const label = str(args, "label", 200) ?? "";
    const remaining = flag(args, "payRemainingBalance");
    const amount = num(args, "amount");
    if (!remaining && !(amount !== undefined && amount > 0)) throw new ToolError("Give the amount received, or set payRemainingBalance.");
    const paymentId = newId();
    let id = "";
    const { result, records } = await changeRecords(context.token, data => {
      const invoice = find(data.invoices, reference, "invoice");
      id = invoice.id;
      if (invoice.payments.some(payment => payment.id === paymentId)) return { result: "recorded" as const };
      const balance = invoiceTotals(invoice).balancePence;
      if (remaining && balance <= 0) return { result: "already-paid" as const };
      const pence = remaining ? balance : toPence(amount!);
      if (!flag(args, "allowDuplicate") && invoice.payments.some(payment => payment.date === paid && toPence(payment.amount) === pence && payment.method === method && payment.label === label)) {
        return { result: "duplicate" as const };
      }
      if (pence > balance) throw new ToolError(`${money(pence)} is more than the ${money(balance)} still owed on ${invoice.number}. Nothing was recorded.`);
      return {
        data: updateInvoice(data, invoice.id, current => ({ ...current, payments: [...current.payments, { id: paymentId, date: paid, amount: pounds(pence), method, label }] }), clock.now),
        result: "recorded" as const,
      };
    });
    const invoice = records.invoices.find(record => record.id === id)!;
    const summary = invoiceSummary(invoice, context);
    const messages = {
      recorded: `Recorded the payment against ${invoice.number}. Paid ${summary.paid} of ${summary.total}; balance ${summary.balance} (${summary.status}).`,
      "already-paid": `${invoice.number} is already fully paid; nothing was recorded.`,
      duplicate: `An identical payment (${paid}, ${method}) is already recorded on ${invoice.number}, so it was not added again. Balance ${summary.balance}. Only if Mike says it was really paid twice, call again with allowDuplicate: true.`,
    };
    return { message: messages[result], data: { status: result.replace("-", "_"), invoice: invoiceSummary(invoice, context) } };
  },
};

/* Diary ------------------------------------------------------------------ */

function lastWorkingDay(start: IsoDate, days: number, weekends: boolean): IsoDate {
  let end = start;
  for (let counted = 1; counted < days;) {
    end = addDays(end, 1);
    if (weekends || !isWeekend(end)) counted += 1;
  }
  return end;
}
const clashesWith = (bookings: Booking[], start: IsoDate, end: IsoDate, except?: string) =>
  bookings.filter(booking => booking.id !== except && booking.start <= end && booking.end >= start);
const clashText = (clashes: Booking[]) => clashes.map(booking => `${booking.job || "a job"}${booking.customerName ? ` for ${booking.customerName}` : ""} (${dateRange(booking.start, booking.end)}, ${booking.status})`).join("; ");

const listBookings: Tool = {
  name: "list_bookings", title: "Read the diary", kind: "read", scope: "dm:read",
  summary: "Read diary bookings between two dates (default the next 30 days), with job, customer, dates, status, notes and linked quote or invoice.",
  description: "Read diary bookings overlapping a date range (default today to 30 days ahead), with job, customer, first and last day, status (confirmed or provisional), notes and linked quote or invoice. Returns booking ids for update_booking.",
  inputSchema: object({ from: date("First day, YYYY-MM-DD (default today)."), to: date("Last day, YYYY-MM-DD (default 30 days after from)."), search: text("Words to match in the job, customer, address or notes.") }),
  async run(args, context) {
    const from = day(args, "from") ?? londonToday(context.now);
    const to = day(args, "to") ?? addDays(from, 30);
    if (to < from) throw new ToolError("to must not be before from.");
    const { data } = await readRecords(context.token);
    const query = str(args, "search", 200);
    const bookings = data.bookings.filter(booking => booking.start <= to && booking.end >= from && search(query, booking.job, booking.customerName, addressLine(booking.address), booking.notes))
      .sort((a, b) => a.start.localeCompare(b.start) || a.job.localeCompare(b.job));
    return {
      message: bookings.length ? `${bookings.length} booking${bookings.length === 1 ? "" : "s"} between ${formatShortDate(from)} and ${formatShortDate(to)}.` : `Nothing booked between ${formatShortDate(from)} and ${formatShortDate(to)}.`,
      data: { from, to, bookings: bookings.map(booking => bookingOut(booking, data, context)) },
    };
  },
};

const checkAvailability: Tool = {
  name: "check_availability", title: "Check availability", kind: "read", scope: "dm:read",
  summary: "Show which days are free or booked, and find the earliest run of free working days for a job of a given length.",
  description: "Show which days in a range are free or booked (default the next two weeks). Give daysNeeded to find the three earliest runs of that many free working days (Monday to Friday unless includeWeekends), searching up to six months ahead. Provisional bookings count as busy.",
  inputSchema: object({
    from: date("First day, YYYY-MM-DD (default today)."), to: date("Last day to list, YYYY-MM-DD (default 13 days after from, at most 92)."),
    daysNeeded: integer("Working days the job needs.", 1, 60), includeWeekends: boolean("Count Saturdays and Sundays as working days."),
  }),
  async run(args, context) {
    const from = day(args, "from") ?? londonToday(context.now);
    const to = day(args, "to") ?? addDays(from, 13);
    if (to < from || daysBetween(from, to) > 92) throw new ToolError("Choose a range of up to 92 days with to after from.");
    const weekends = flag(args, "includeWeekends");
    const needed = wholeDays(args, "daysNeeded", 1, 60);
    const { data } = await readRecords(context.token);
    const days: { date: IsoDate; day: string; status: string; bookings: { id: string; job: string; customer: string; status: string }[] }[] = [];
    for (let current = from; current <= to; current = addDays(current, 1)) {
      const booked = bookingsOn(data.bookings, current);
      days.push({
        date: current, day: formatDayLabel(current),
        status: booked.length ? (booked.every(booking => booking.status === "provisional") ? "provisional" : "booked") : !weekends && isWeekend(current) ? "weekend" : "free",
        bookings: booked.map(booking => ({ id: booking.id, job: booking.job, customer: booking.customerName, status: booking.status })),
      });
    }
    const windows: { start: IsoDate; end: IsoDate }[] = [];
    if (needed) {
      let run: IsoDate[] = [];
      for (let current = from; current <= addDays(from, 183) && windows.length < 3; current = addDays(current, 1)) {
        if (!weekends && isWeekend(current)) continue;
        if (bookingsOn(data.bookings, current).length) { run = []; continue; }
        run.push(current);
        if (run.length === needed) { windows.push({ start: run[0], end: run[run.length - 1] }); run = []; }
      }
    }
    const free = days.filter(entry => entry.status === "free").map(entry => entry.day);
    return {
      message: needed
        ? windows.length ? `Earliest ${needed}-day openings: ${windows.map(window => dateRange(window.start, window.end)).join("; ")}.` : `No run of ${needed} free working days in the next six months.`
        : free.length ? `Free days: ${free.join(", ")}.` : "No free days in that range.",
      data: { today: londonToday(context.now), from, to, days, ...(needed ? { daysNeeded: needed, openings: windows } : {}) },
    };
  },
};

const bookingStatuses = ["confirmed", "provisional"] as const;
const createBooking: Tool = {
  name: "create_booking", title: "Book a job into the diary", kind: "write", scope: "dm:write",
  summary: "Book a job into the diary for one or more days, optionally linked to a quote or invoice. Refuses clashes unless Mike agrees to double-book.",
  description: "Book a job into the diary. Give start and either end or days (working days; a two-day job starting on Friday ends on Monday). Linking a quote or invoice fills in the job, customer, phone and address. If the dates clash with another booking nothing is saved and the clash is returned; ask Mike, and only if he agrees call again with allowOverlap. Repeating the same booking returns the existing one.",
  inputSchema: object({
    start: date("First day, YYYY-MM-DD."), end: date("Last day, YYYY-MM-DD."), days: integer("Number of working days, instead of end.", 1, 120),
    includeWeekends: boolean("Count weekends when using days."),
    job: text("Job description, e.g. \"Living room redecoration\"."), customerName: text("Customer name."), phone: text("Customer phone."),
    address: text("Job address on one line."), status: oneOf(bookingStatuses, "confirmed (default) or provisional."), notes: text("Notes for the job."),
    quote: text("Quote number or id this booking is for."), invoice: text("Invoice number or id this booking is for."),
    allowOverlap: boolean("Only when Mike agrees to double-book."), allowDuplicate: boolean("Only when Mike wants an identical second booking."),
  }, ["start"]),
  async run(args, context) {
    const clock = clockFor(context);
    const start = day(args, "start")!;
    if (!start) throw new ToolError("start is required.");
    const lengthInDays = wholeDays(args, "days", 1, 120);
    const end = day(args, "end") ?? (lengthInDays ? lastWorkingDay(start, lengthInDays, flag(args, "includeWeekends")) : start);
    if (end < start) throw new ToolError("end must not be before start.");
    if (daysBetween(start, end) > 366) throw new ToolError("A booking can be at most a year long.");
    const status = choice(args, "status", bookingStatuses) ?? "confirmed";
    const randomId = newId();
    let id = "";
    let sent = false;
    const { result, records } = await changeRecords<"already-booked" | "booked" | Booking[]>(context.token, data => {
      const quote = args.quote ? find(data.quotes, required(args, "quote", 80), "quote") : undefined;
      const invoice = args.invoice ? find(data.invoices, required(args, "invoice", 80), "invoice") : undefined;
      const prefill: Partial<Booking> = quote ? bookingFieldsFromQuote(quote)
        : invoice ? { job: invoice.title, customerName: invoice.customer.name, phone: invoice.customer.phone, address: { ...invoice.customer.address }, quoteId: invoice.quoteId } : {};
      const fields: Partial<Booking> = {
        ...prefill,
        ...(args.job !== undefined ? { job: str(args, "job", 300) ?? "" } : {}),
        ...(args.customerName !== undefined ? { customerName: str(args, "customerName", 200) ?? "" } : {}),
        ...(args.phone !== undefined ? { phone: str(args, "phone", 60) ?? "" } : {}),
        ...(args.address !== undefined ? { address: customerFrom({ address: str(args, "address", 600) ?? "" }).address } : {}),
        ...(args.notes !== undefined ? { notes: str(args, "notes") ?? "" } : {}),
        quoteId: quote?.id ?? prefill.quoteId ?? null,
        invoiceId: invoice?.id ?? null,
        status,
      };
      if (!fields.job?.trim()) throw new ToolError("Describe the job, or give the quote or invoice it is for.");
      id = flag(args, "allowDuplicate") ? randomId : stableId("booking", [start, end, normal(fields.job), normal(fields.customerName ?? ""), fields.quoteId, fields.invoiceId]);
      if (data.bookings.some(booking => booking.id === id)) return { result: sent ? "booked" : "already-booked" };
      const clashes = clashesWith(data.bookings, start, end);
      if (clashes.length && !flag(args, "allowOverlap")) return { result: clashes };
      sent = true;
      return { data: saveBooking(data, newBooking(start, clock.now, { ...fields, id, end }), clock.now), result: "booked" as const };
    });
    if (Array.isArray(result)) {
      return {
        message: `Not booked: ${dateRange(start, end)} clashes with ${clashText(result)}. Ask Mike whether to double-book or choose other dates (check_availability can find free days). Only if he agrees, call again with allowOverlap: true.`,
        data: { status: "clash", clashes: result.map(booking => bookingOut(booking, records, context)) },
      };
    }
    const booking = records.bookings.find(record => record.id === id)!;
    return {
      message: `${result === "booked" ? "Booked" : "Already booked (no duplicate made)"}: ${booking.job}${booking.customerName ? ` for ${booking.customerName}` : ""}, ${dateRange(booking.start, booking.end)} (${booking.status}).`,
      data: { status: result === "booked" ? "booked" : "already_booked", booking: bookingOut(booking, records, context) },
    };
  },
};

const updateBooking: Tool = {
  name: "update_booking", title: "Update a booking or job", kind: "write", scope: "dm:write",
  summary: "Move or change a diary booking, change its status, or add a dated job update note.",
  description: "Change a diary booking: move its dates, change the job details or status (confirmed/provisional), link a quote or invoice, replace its notes, or add a dated progress note with addNote (e.g. \"First coat done\"). Moving onto another booking is refused unless allowOverlap. Get the booking id from list_bookings.",
  inputSchema: object({
    booking: text("Booking id from list_bookings."), start: date("New first day."), end: date("New last day."),
    job: text("New job description."), customerName: text("New customer name."), phone: text("New phone."), address: text("New address on one line."),
    status: oneOf(bookingStatuses, "New status."), notes: text("Replacement notes."), addNote: text("A job update to add to the notes with today's date."),
    quote: text("Quote number or id to link, or \"none\" to unlink."), invoice: text("Invoice number or id to link, or \"none\" to unlink."),
    allowOverlap: boolean("Only when Mike agrees to double-book."),
  }, ["booking"]),
  async run(args, context) {
    const clock = clockFor(context);
    const reference = required(args, "booking", 80);
    const changes = ["start", "end", "job", "customerName", "phone", "address", "status", "notes", "addNote", "quote", "invoice"].filter(key => args[key] !== undefined);
    if (!changes.length) throw new ToolError("Say what to change on the booking.");
    const start = day(args, "start");
    const end = day(args, "end");
    const status = choice(args, "status", bookingStatuses);
    const note = str(args, "addNote", 1000);
    const { result, records } = await changeRecords(context.token, data => {
      const booking = data.bookings.find(record => record.id === reference.trim());
      if (!booking) throw new ToolError("No booking has that id. Use list_bookings to find it.");
      const link = (key: "quote" | "invoice") => {
        const value = str(args, key, 80);
        if (value === undefined) return booking[`${key}Id`];
        if (!value || value.toLowerCase() === "none") return null;
        return find<Quote | Invoice>(key === "quote" ? data.quotes : data.invoices, value, key).id;
      };
      const line = note ? `${formatShortDate(clock.today)}: ${note}` : "";
      const notes = args.notes !== undefined ? str(args, "notes") ?? "" : booking.notes;
      const next: Booking = {
        ...booking,
        start: start ?? booking.start,
        // Moving only the first day keeps the booking's length.
        end: end ?? (start ? addDays(start, daysBetween(booking.start, booking.end)) : booking.end),
        ...(args.job !== undefined ? { job: str(args, "job", 300) ?? "" } : {}),
        ...(args.customerName !== undefined ? { customerName: str(args, "customerName", 200) ?? "" } : {}),
        ...(args.phone !== undefined ? { phone: str(args, "phone", 60) ?? "" } : {}),
        ...(args.address !== undefined ? { address: customerFrom({ address: str(args, "address", 600) ?? "" }).address } : {}),
        ...(status ? { status } : {}),
        notes: line && !notes.split("\n").includes(line) ? (notes ? `${notes}\n${line}` : line) : notes,
        quoteId: link("quote"),
        invoiceId: link("invoice"),
      };
      if (next.end < next.start) throw new ToolError("end must not be before start.");
      const clashes = clashesWith(data.bookings, next.start, next.end, booking.id);
      if ((next.start !== booking.start || next.end !== booking.end) && clashes.length && !flag(args, "allowOverlap")) return { result: clashes };
      return { data: saveBooking(data, next, clock.now), result: null };
    });
    if (Array.isArray(result)) {
      return { message: `Not moved: those dates clash with ${clashText(result)}. Ask Mike; only if he agrees, call again with allowOverlap: true.`, data: { status: "clash", clashes: result.map(booking => bookingOut(booking, records, context)) } };
    }
    const booking = records.bookings.find(record => record.id === reference.trim())!;
    return { message: `Updated the booking (${changes.join(", ")}): ${booking.job}, ${dateRange(booking.start, booking.end)} (${booking.status}).`, data: { status: "updated", booking: bookingOut(booking, records, context) } };
  },
};

/* Links ------------------------------------------------------------------ */

const createCustomerLink: Tool = {
  name: "create_customer_link", title: "Create a customer link", kind: "write", scope: "dm:write",
  summary: "Create a fresh secure web link to a quote or invoice for the customer. Any earlier link for that document stops working.",
  description: "Create a fresh secure link where the customer can view and print a quote or invoice (private notes are never shown). Links cannot be looked up again, so this always makes a new one and any earlier link for that document stops working: tell Mike so. If the document is marked sent (or has payments), the customer may hold the old link, so a confirmation code is returned first. When Mike says he has sent a document, mark it sent with update_quote or update_invoice so its link is protected.",
  inputSchema: object({ document: documentRef, confirmationCode: confirmation }, ["document"]),
  async run(args, context) {
    const { data } = await readRecords(context.token);
    const doc = findDocument(data, required(args, "document", 80));
    const label = `${doc.kind} ${doc.number}${doc.customer.name ? ` for ${doc.customer.name}` : ""}`;
    if (customerMayHoldLink(doc) && !confirmed(context, "replace-link", doc, args.confirmationCode)) {
      return confirmationNeeded(context, "create_customer_link", "replace-link", doc, `${label} is marked ${doc.status}, so the customer may already have a link. A new link will stop the old one working.`, args.confirmationCode, { document: doc.number });
    }
    const link = await newLink(context, doc.id);
    if ("linkError" in link) throw new ToolError(link.linkError);
    return { message: `New customer link for ${label}: ${link.customerLink} (any earlier link for this document has stopped working).`, data: { status: "created", document: doc.number, kind: doc.kind, customerLink: link.customerLink } };
  },
};

const revokeCustomerLink: Tool = {
  name: "revoke_customer_link", title: "Revoke customer access", kind: "delete", scope: "dm:delete",
  summary: "Stop every customer link to a quote or invoice from working. Needs Mike's confirmation.",
  description: "Stop every customer link to a quote or invoice from working; the customer then sees \"This document is unavailable\". The first call returns a confirmation code and changes nothing.",
  inputSchema: object({ document: documentRef, confirmationCode: confirmation }, ["document"]),
  async run(args, context) {
    const { data } = await readRecords(context.token);
    const doc = findDocument(data, required(args, "document", 80));
    const label = `${doc.kind} ${doc.number}${doc.customer.name ? ` for ${doc.customer.name}` : ""}`;
    if (!confirmed(context, "revoke-link", doc, args.confirmationCode)) {
      return confirmationNeeded(context, "revoke_customer_link", "revoke-link", doc, `Revoking will stop any customer link to ${label} from working.`, args.confirmationCode, { document: doc.number });
    }
    await revokeShare(context.token, doc.id);
    return { message: `Customer access to ${label} has been revoked. Earlier links now show "This document is unavailable". A new link can be created later with create_customer_link.`, data: { status: "revoked", document: doc.number } };
  },
};

/* Deletions -------------------------------------------------------------- */

const deleteQuoteTool: Tool = {
  name: "delete_quote", title: "Delete a quote", kind: "delete", scope: "dm:delete",
  summary: "Permanently delete a quote. Needs Mike's confirmation; its number is never reused and its customer link stops working.",
  description: "Permanently delete a quote. The first call returns what will happen and a confirmation code, and changes nothing. Its number is never reused, its customer link stops working, and linked invoices and bookings are kept but unlinked.",
  inputSchema: object({ quote: text("Quote number (e.g. Q-0041) or id."), confirmationCode: confirmation }, ["quote"]),
  async run(args, context) {
    const { data } = await readRecords(context.token);
    const quote = find(data.quotes, required(args, "quote", 80), "quote");
    if (!confirmed(context, "delete-quote", quote, args.confirmationCode)) {
      const linked = data.invoices.filter(invoice => invoice.quoteId === quote.id).length + data.bookings.filter(booking => booking.quoteId === quote.id).length;
      return confirmationNeeded(context, "delete_quote", "delete-quote", quote, `Deleting quote ${quote.number} for ${quote.customer.name || "an unnamed customer"} (${quoteSummary(quote, context).total}) cannot be undone; its customer link stops working${linked ? ` and ${linked} linked invoice/booking record${linked === 1 ? "" : "s"} will be unlinked (not deleted)` : ""}.`, args.confirmationCode, { quote: quoteSummary(quote, context) });
    }
    await changeRecords(context.token, current => {
      const target = stillAsConfirmed(current.quotes.find(record => record.id === quote.id), quote.updatedAt);
      return target ? { data: deleteQuote(current, target.id), result: null } : { result: null };
    });
    return { message: `Quote ${quote.number} has been deleted. Its number stays reserved and its customer link no longer works.`, data: { status: "deleted", quote: quote.number } };
  },
};

const deleteInvoiceTool: Tool = {
  name: "delete_invoice", title: "Delete an invoice", kind: "delete", scope: "dm:delete",
  summary: "Permanently delete an invoice. Needs Mike's confirmation; its number is never reused and its customer link stops working.",
  description: "Permanently delete an invoice, including its recorded payments. The first call returns what will happen and a confirmation code, and changes nothing. Its number is never reused, its customer link stops working and linked bookings are kept but unlinked.",
  inputSchema: object({ invoice: text("Invoice number (e.g. INV-0012) or id."), confirmationCode: confirmation }, ["invoice"]),
  async run(args, context) {
    const { data } = await readRecords(context.token);
    const invoice = find(data.invoices, required(args, "invoice", 80), "invoice");
    if (!confirmed(context, "delete-invoice", invoice, args.confirmationCode)) {
      const summary = invoiceSummary(invoice, context);
      return confirmationNeeded(context, "delete_invoice", "delete-invoice", invoice, `Deleting invoice ${invoice.number} for ${invoice.customer.name || "an unnamed customer"} (total ${summary.total}${invoice.payments.length ? `, with ${summary.paid} of payments recorded` : ""}) cannot be undone; its customer link stops working.`, args.confirmationCode, { invoice: summary });
    }
    await changeRecords(context.token, current => {
      const target = stillAsConfirmed(current.invoices.find(record => record.id === invoice.id), invoice.updatedAt);
      return target ? { data: deleteInvoice(current, target.id), result: null } : { result: null };
    });
    return { message: `Invoice ${invoice.number} has been deleted. Its number stays reserved and its customer link no longer works.`, data: { status: "deleted", invoice: invoice.number } };
  },
};

const deleteBookingTool: Tool = {
  name: "delete_booking", title: "Delete a booking", kind: "delete", scope: "dm:delete",
  summary: "Remove a booking from the diary. Needs Mike's confirmation.",
  description: "Remove a booking from the diary. Linked quotes and invoices are not affected. The first call returns what will happen and a confirmation code, and changes nothing.",
  inputSchema: object({ booking: text("Booking id from list_bookings."), confirmationCode: confirmation }, ["booking"]),
  async run(args, context) {
    const { data } = await readRecords(context.token);
    const booking = data.bookings.find(record => record.id === required(args, "booking", 80));
    if (!booking) throw new ToolError("No booking has that id. Use list_bookings to find it.");
    const label = `${booking.job || "the booking"}${booking.customerName ? ` for ${booking.customerName}` : ""} (${dateRange(booking.start, booking.end)})`;
    if (!confirmed(context, "delete-booking", booking, args.confirmationCode)) {
      return confirmationNeeded(context, "delete_booking", "delete-booking", booking, `This removes ${label} from the diary.`, args.confirmationCode, { booking: bookingOut(booking, data, context) });
    }
    await changeRecords(context.token, current => {
      const target = stillAsConfirmed(current.bookings.find(record => record.id === booking.id), booking.updatedAt);
      return target ? { data: deleteBooking(current, target.id), result: null } : { result: null };
    });
    return { message: `Removed ${label} from the diary.`, data: { status: "deleted", booking: booking.id } };
  },
};

const getSettings: Tool = {
  name: "get_business_settings", title: "Business settings", kind: "read", scope: "dm:read",
  summary: "Today's UK date and D&M's settings: VAT default, quote validity, payment terms, numbering and standard terms.",
  description: "Today's date in the UK and D&M's business settings: name and contact details, whether VAT is added to new documents and at what rate, quote validity, payment terms, next quote and invoice numbers, and standard terms.",
  inputSchema: object({}),
  async run(_args, context) {
    const { data } = await readRecords(context.token);
    const s = data.settings;
    return {
      message: `Today is ${formatLongDate(londonToday(context.now))}. New documents ${s.vatRegistered ? `add VAT at ${s.defaultVatRate}%` : "do not add VAT"}; quotes are valid for ${s.quoteValidityDays} days and invoices are due in ${s.paymentTermsDays} days.`,
      data: {
        today: londonToday(context.now), businessName: s.businessName, phone: s.phone, email: s.email, website: s.website, address: addressLine(s.address),
        vatOnNewDocuments: s.vatRegistered, defaultVatRate: s.defaultVatRate, quoteValidityDays: s.quoteValidityDays, paymentTermsDays: s.paymentTermsDays,
        nextQuoteNumber: formatDocNumber(s.quotePrefix, s.nextQuoteNumber), nextInvoiceNumber: formatDocNumber(s.invoicePrefix, s.nextInvoiceNumber),
        defaultQuoteIntro: s.defaultQuoteIntro, defaultTerms: s.defaultTerms,
      },
    };
  },
};

export const tools: Tool[] = [
  createQuoteTool, getQuote, listQuotes, updateQuoteTool,
  createInvoiceTool, getInvoice, listInvoices, updateInvoiceTool, recordPayment,
  createCustomerLink, revokeCustomerLink,
  checkAvailability, listBookings, createBooking, updateBooking,
  deleteQuoteTool, deleteInvoiceTool, deleteBookingTool,
  getSettings,
];

export const toolsFor = (scopes: Scope[]) => tools.filter(tool => scopes.includes(tool.scope));

export const serverInstructions = [
  "You are Mike's secretary for D&M Painting & Decorating. These tools read and change his real quotes, invoices and diary.",
  "Use only prices and quantities Mike gives; never estimate or invent a price. Prices are in pounds before VAT; leave VAT to the business setting unless Mike says otherwise.",
  "When creating or repricing a quote or invoice, pass expectedSubtotal (the sum of Mike's figures). If it does not match, nothing is saved: check the figures with Mike.",
  "After creating a document, tell Mike its number, total and customer link exactly as returned. When he says he has sent it, mark it sent (update_quote or update_invoice) so its link is protected from replacement.",
  "Retrying a create with the same details never makes a duplicate. Set allowDuplicate only when Mike explicitly asks for a second copy.",
  "Deleting, revoking a link, or replacing a link a customer may already hold first returns a confirmation code. Tell Mike exactly what will happen and wait for his explicit yes before calling again with the code. Never confirm on his behalf.",
  "Dates are YYYY-MM-DD in UK time; get_business_settings gives today's date. Write in British English.",
].join("\n");
