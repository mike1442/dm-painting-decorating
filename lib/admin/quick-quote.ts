import { customerFrom } from "./chatgpt.ts";
import { parseAmount } from "./money.ts";
import { textList } from "./normalise.ts";
import type { QuoteInput } from "./operations.ts";
import type { AdminData, Customer } from "./types.ts";

// Admin → Quick quote: the phone handoff from ChatGPT. ChatGPT answers "quote
// John Smith £1,250 for the lounge" with a link that only fills in this form.
// Opening the link changes nothing; Mike checks the details behind the admin
// sign-in and saves a draft through the ordinary cloud store. No customer link
// is created and nothing is sent.

export const QUICK_QUOTE_PATH = "/admin/quick-quote";
export const MAX_QUICK_QUOTE_PRICE = 1_000_000;

type Param = string | string[] | undefined;
export type QuickQuoteParams = Partial<Record<"for" | "title" | "total" | "add" | "address" | "phone" | "email" | "test", Param>>;

/** What the form starts with. `fromLink` is false when Mike opens Quick quote himself. */
export type QuickQuoteStart = {
  customer: Customer;
  title: string;
  total: string;
  lines: string[];
  test: boolean;
  fromLink: boolean;
};

const first = (value: Param) => ((Array.isArray(value) ? value[0] : value) ?? "").trim();

/** "£1,250", "1250", " 1,250.50 " → "1250" / "1250.50". Anything else is kept, shortened, for Mike to correct. */
export function cleanTotal(raw: string): string {
  const amount = parseAmount(raw);
  if (amount === null || amount < 0) return raw.trim().slice(0, 24);
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

/** Pounds before VAT, or null unless it is a positive amount of whole pence within range. */
export function parsePrice(value: string): number | null {
  const amount = parseAmount(value);
  if (amount === null || amount <= 0 || amount > MAX_QUICK_QUOTE_PRICE) return null;
  return Math.round(amount * 100) === Number((amount * 100).toFixed(6)) ? amount : null;
}

export function readQuickQuoteParams(params: QuickQuoteParams): QuickQuoteStart {
  const lines = textList([params.add ?? []].flat().flatMap(value => value.split(/\r?\n|\|/)), 30).map(line => line.slice(0, 300));
  const address = first(params.address).slice(0, 300);
  const customer = customerFrom({
    name: first(params.for).slice(0, 120),
    phone: first(params.phone).slice(0, 40),
    email: first(params.email).slice(0, 120),
    ...(address ? { address } : {}),
  });
  return {
    customer,
    title: first(params.title).slice(0, 120),
    total: cleanTotal(first(params.total)),
    lines,
    test: ["1", "true", "yes"].includes(first(params.test).toLowerCase()),
    fromLink: (["for", "title", "total", "add"] as const).some(key => first(params[key]) !== ""),
  };
}

/**
 * The same ChatGPT link always describes the same draft. Its fingerprint (hashed
 * by the caller) becomes the quote's ID, so opening the link again finds the
 * saved draft instead of making a second one with another quote number.
 */
export function quickQuoteFingerprint(start: QuickQuoteStart): string {
  const { customer, title, total, lines, test } = start;
  return JSON.stringify(["dm-quick-quote:v1", customer.name.toLowerCase(), customer.address.postcode.toLowerCase(), title.toLowerCase(), total, lines.map(line => line.toLowerCase()), test]);
}

/** A record ID in the usual UUID shape from a hex digest of the fingerprint. */
export function quickQuoteId(hexDigest: string): string {
  const hex = hexDigest.toLowerCase().replace(/[^0-9a-f]/g, "").padEnd(32, "0");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** A job title for the quote when ChatGPT gave none: the first line of work, shortened. */
export function defaultTitle(start: Pick<QuickQuoteStart, "title" | "lines">): string {
  if (start.title) return start.title;
  const line = start.lines[0] ?? "";
  return line.length > 80 ? `${line.slice(0, 77).trimEnd()}…` : line;
}

export type QuickQuoteForm = { customer: Customer; title: string; lines: string[]; price: number; test: boolean; fromLink: boolean };

/** The quote exactly as the admin would make it: standard intro, terms, validity and VAT from Settings. */
export function quickQuoteInput(form: QuickQuoteForm, id?: string): QuoteInput {
  const title = form.title.trim();
  return {
    ...(id ? { id } : {}),
    ...(form.test ? { isTest: true } : {}),
    title,
    customer: { ...form.customer, name: form.customer.name.trim(), address: { ...form.customer.address } },
    scope: form.lines.map(line => line.trim()).filter(Boolean),
    works: [{ description: title, quantity: 1, unit: "job", unitPrice: form.price }],
    source: form.fromLink ? "chatgpt" : "manual",
  };
}

export type CustomerMatch = { key: string; customer: Customer; from: string; updatedAt: string };

const normal = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const hasAddress = (customer: Customer) => Object.values(customer.address).some(value => value.trim());

/**
 * Earlier customers whose name matches what was typed, newest first, one per
 * name and postcode. Test documents only match a test quote, so a real
 * quotation never picks up a test customer's details.
 */
export function customerMatches(data: AdminData, name: string, includeTests: boolean, limit = 4): CustomerMatch[] {
  const query = normal(name);
  if (query.length < 2) return [];
  const testQuotes = new Set(data.quotes.filter(q => q.isTest).map(q => q.id));
  const testInvoices = new Set(data.invoices.filter(i => i.isTest).map(i => i.id));
  const candidates: CustomerMatch[] = [
    ...data.quotes.filter(q => includeTests || !q.isTest).map(q => ({ key: "", customer: q.customer, from: `quote ${q.number}`, updatedAt: q.updatedAt })),
    ...data.invoices.filter(i => includeTests || !i.isTest).map(i => ({ key: "", customer: i.customer, from: `invoice ${i.number}`, updatedAt: i.updatedAt })),
    ...data.bookings
      .filter(b => includeTests || !((b.quoteId && testQuotes.has(b.quoteId)) || (b.invoiceId && testInvoices.has(b.invoiceId))))
      .map(b => ({ key: "", customer: { name: b.customerName, email: "", phone: b.phone, address: b.address }, from: "the diary", updatedAt: b.updatedAt })),
  ];
  const seen = new Set<string>();
  const matches: CustomerMatch[] = [];
  for (const candidate of candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const candidateName = normal(candidate.customer.name);
    if (!candidateName || !candidateName.includes(query)) continue;
    const key = `${candidateName}|${normal(candidate.customer.address.postcode)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({ ...candidate, key });
    if (matches.length === limit) break;
  }
  return matches;
}

/** An earlier customer's saved details, keeping anything ChatGPT supplied that the record lacks. */
export function withMatchedCustomer(current: Customer, match: Customer): Customer {
  return {
    name: match.name,
    email: match.email || current.email,
    phone: match.phone || current.phone,
    address: hasAddress(match) ? { ...match.address } : { ...current.address },
  };
}

/** Builds a Quick quote link, for the instructions' example and for tests. */
export function quickQuoteLink(origin: string, values: { for: string; title?: string; total: string; add?: string[]; address?: string; test?: boolean }): string {
  const url = new URL(QUICK_QUOTE_PATH, origin);
  url.searchParams.set("for", values.for);
  if (values.title) url.searchParams.set("title", values.title);
  url.searchParams.set("total", values.total);
  if (values.add?.length) url.searchParams.set("add", values.add.join("|"));
  if (values.address) url.searchParams.set("address", values.address);
  if (values.test) url.searchParams.set("test", "1");
  return url.href;
}

/** Pasted once into ChatGPT's custom instructions (kept short enough for that box). */
export function quickQuoteInstructions(origin: string): string {
  const example = quickQuoteLink(origin, {
    for: "John Smith",
    title: "Lounge and hallway redecoration",
    total: "1250",
    add: ["Prepare and fill walls", "Two coats to walls and ceilings"],
    address: "12 Mill Lane, Lymm, WA13 9SD",
  }).replace(/\+/g, "%20");
  return `D&M quotations: when I ask you to quote a D&M customer, you cannot save anything. Reply with one short line and a link I open to check and save the quote myself:
${origin}${QUICK_QUOTE_PATH}?for=NAME&title=JOB&total=PRICE&add=POINT|POINT
- for: the customer's name. title: a short job title.
- total: my price in pounds before VAT, digits only (e.g. 1250 or 1250.50).
- add: the work to include, short points separated by |.
- Only if I give them: address (one line, e.g. 12 Mill Lane, Lymm, WA13 9SD), phone, email. Add test=1 only if I say it's a test.
URL-encode every value (a space is %20). Use only my price and details; never estimate. If I haven't given the customer or a price, ask.
Never say the quote is saved, created or sent.
Example: ${example}`;
}
