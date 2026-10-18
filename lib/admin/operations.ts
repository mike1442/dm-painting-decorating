import { addDays } from "./dates.ts";
import { emptyBank, emptyCustomer, formatDocNumber, newId, newLineItem } from "./factories.ts";
import type { AdminData, Booking, Customer, Invoice, IsoDate, IsoDateTime, LineItem, Quote } from "./types.ts";

// Pure operations on the whole data set. The store applies them; tests call
// them directly. A future backend can implement the same operations server-side.

export type Clock = { today: IsoDate; now: IsoDateTime };

/** Fields a quote can be created from, e.g. structured data produced by ChatGPT. */
export type QuoteInput = Partial<
  Pick<Quote, "title" | "intro" | "scope" | "materialsNote" | "terms" | "vat" | "deposit" | "issueDate" | "internalNotes">
> & {
  isTest?: boolean;
  customer?: Customer;
  works?: Omit<LineItem, "id">[];
  materials?: Omit<LineItem, "id">[];
  validForDays?: number;
  source?: Quote["source"];
};

const copyCustomer = (c: Customer): Customer => ({ ...c, address: { ...c.address } });
const copyLines = (items: Omit<LineItem, "id">[]): LineItem[] =>
  items.map(({ description, quantity, unit, unitPrice }) => newLineItem({ description, quantity, unit, unitPrice }));

export function createQuote(data: AdminData, clock: Clock, input: QuoteInput = {}): { data: AdminData; quote: Quote } {
  const { settings } = data;
  const issueDate = input.issueDate ?? clock.today;
  const id = newId();
  const isTest = input.isTest === true;
  const quote: Quote = {
    kind: "quote",
    id,
    number: isTest ? `TEST-${id.replace(/-/g, "")}` : formatDocNumber(settings.quotePrefix, settings.nextQuoteNumber),
    ...(isTest ? { isTest: true } : {}),
    status: "draft",
    title: input.title ?? "",
    customer: input.customer ? copyCustomer(input.customer) : emptyCustomer(),
    issueDate,
    validUntil: addDays(issueDate, input.validForDays ?? settings.quoteValidityDays),
    intro: input.intro ?? settings.defaultQuoteIntro,
    scope: input.scope ? [...input.scope] : [],
    works: input.works ? copyLines(input.works) : [newLineItem()],
    materials: input.materials ? copyLines(input.materials) : [],
    materialsNote: input.materialsNote ?? "",
    vat: input.vat ? { ...input.vat } : { enabled: settings.vatRegistered, rate: settings.defaultVatRate },
    deposit: input.deposit ? { ...input.deposit } : { type: "none", value: 0 },
    terms: input.terms ? [...input.terms] : [...settings.defaultTerms],
    internalNotes: input.internalNotes ?? "",
    share: { token: null, status: "not-available" },
    source: input.source ?? "manual",
    createdAt: clock.now,
    updatedAt: clock.now,
  };
  return {
    quote,
    data: {
      ...data,
      quotes: [quote, ...data.quotes],
      settings: { ...settings, nextQuoteNumber: settings.nextQuoteNumber + (isTest ? 0 : 1) },
    },
  };
}

export function updateQuote(data: AdminData, id: string, change: (quote: Quote) => Quote, now: IsoDateTime): AdminData {
  return { ...data, quotes: data.quotes.map(q => (q.id === id ? { ...change(q), updatedAt: now } : q)) };
}

export function duplicateQuote(data: AdminData, id: string, clock: Clock): { data: AdminData; quote: Quote } | null {
  const source = data.quotes.find(q => q.id === id);
  if (!source) return null;
  return createQuote(data, clock, {
    ...(source.isTest === true ? { isTest: true } : {}),
    title: source.title,
    customer: source.customer,
    intro: source.intro,
    scope: source.scope,
    works: source.works,
    materials: source.materials,
    materialsNote: source.materialsNote,
    vat: source.vat,
    deposit: source.deposit,
    terms: source.terms,
    internalNotes: source.internalNotes,
  });
}

export function deleteQuote(data: AdminData, id: string): AdminData {
  return {
    ...data,
    quotes: data.quotes.filter(q => q.id !== id),
    invoices: data.invoices.map(inv => (inv.quoteId === id ? { ...inv, quoteId: null } : inv)),
    bookings: data.bookings.map(b => (b.quoteId === id ? { ...b, quoteId: null } : b)),
  };
}

/** Creates an invoice, copying everything from the quote when one is given. */
export function createInvoice(data: AdminData, clock: Clock, fromQuoteId?: string): { data: AdminData; invoice: Invoice } {
  const { settings } = data;
  const quote = fromQuoteId ? data.quotes.find(q => q.id === fromQuoteId) : undefined;
  const id = newId();
  const isTest = quote?.isTest === true;
  const invoice: Invoice = {
    kind: "invoice",
    id,
    number: isTest ? `TEST-${id.replace(/-/g, "")}` : formatDocNumber(settings.invoicePrefix, settings.nextInvoiceNumber),
    ...(isTest ? { isTest: true } : {}),
    status: "draft",
    title: quote?.title ?? "",
    customer: quote ? copyCustomer(quote.customer) : emptyCustomer(),
    issueDate: clock.today,
    dueDate: addDays(clock.today, settings.paymentTermsDays),
    quoteId: quote?.id ?? null,
    quoteNumber: quote?.number ?? "",
    scope: quote ? [...quote.scope] : [],
    works: quote ? copyLines(quote.works) : [newLineItem()],
    materials: quote ? copyLines(quote.materials) : [],
    materialsNote: quote?.materialsNote ?? "",
    vat: quote ? { ...quote.vat } : { enabled: settings.vatRegistered, rate: settings.defaultVatRate },
    payments: [],
    bank: isTest ? emptyBank() : { ...settings.bank },
    paymentNote: isTest ? "" : settings.defaultPaymentNote,
    internalNotes: isTest ? "Test example only. Not issued to a customer. No payment is due." : "",
    share: { token: null, status: "not-available" },
    createdAt: clock.now,
    updatedAt: clock.now,
  };
  const quotes = quote
    ? data.quotes.map(q =>
        q.id === quote.id && (q.status === "draft" || q.status === "sent")
          ? { ...q, status: "accepted" as const, updatedAt: clock.now }
          : q,
      )
    : data.quotes;
  return {
    invoice,
    data: {
      ...data,
      quotes,
      invoices: [invoice, ...data.invoices],
      settings: { ...settings, nextInvoiceNumber: settings.nextInvoiceNumber + (isTest ? 0 : 1) },
    },
  };
}

export function updateInvoice(data: AdminData, id: string, change: (invoice: Invoice) => Invoice, now: IsoDateTime): AdminData {
  return { ...data, invoices: data.invoices.map(inv => (inv.id === id ? { ...change(inv), updatedAt: now } : inv)) };
}

export function deleteInvoice(data: AdminData, id: string): AdminData {
  return {
    ...data,
    invoices: data.invoices.filter(inv => inv.id !== id),
    bookings: data.bookings.map(b => (b.invoiceId === id ? { ...b, invoiceId: null } : b)),
  };
}

/** Booking details pre-filled from a quote, ready to be placed in the diary. */
export function bookingFieldsFromQuote(quote: Quote): Partial<Booking> {
  return {
    job: quote.title,
    customerName: quote.customer.name,
    phone: quote.customer.phone,
    address: { ...quote.customer.address },
    quoteId: quote.id,
    invoiceId: null,
  };
}

export function saveBooking(data: AdminData, booking: Booking, now: IsoDateTime): AdminData {
  const end = booking.end < booking.start ? booking.start : booking.end;
  const saved: Booking = { ...booking, end, updatedAt: now };
  const exists = data.bookings.some(b => b.id === booking.id);
  return {
    ...data,
    bookings: exists ? data.bookings.map(b => (b.id === booking.id ? saved : b)) : [...data.bookings, saved],
  };
}

export function deleteBooking(data: AdminData, id: string): AdminData {
  return { ...data, bookings: data.bookings.filter(b => b.id !== id) };
}

export function bookingsOn(bookings: Booking[], day: IsoDate): Booking[] {
  return bookings
    .filter(b => b.start <= day && day <= b.end)
    .sort((a, b) => a.start.localeCompare(b.start) || a.job.localeCompare(b.job));
}
