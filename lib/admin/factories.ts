import { SCHEMA_VERSION } from "./types.ts";
import type { AdminData, Address, BankDetails, Booking, BusinessSettings, Customer, IsoDate, LineItem } from "./types.ts";

export function newId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  // randomUUID is missing on plain-http LAN addresses; getRandomValues is not.
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const emptyAddress = (): Address => ({ line1: "", line2: "", town: "", postcode: "" });
export const emptyCustomer = (): Customer => ({ name: "", email: "", phone: "", address: emptyAddress() });
export const emptyBank = (): BankDetails => ({ accountName: "", sortCode: "", accountNumber: "" });

export function newLineItem(fields: Partial<Omit<LineItem, "id">> = {}): LineItem {
  return { id: newId(), description: "", quantity: 1, unit: "", unitPrice: 0, ...fields };
}

export function formatDocNumber(prefix: string, next: number): string {
  return prefix + String(Math.max(1, Math.floor(next))).padStart(4, "0");
}

export function defaultSettings(): BusinessSettings {
  return {
    businessName: "D&M Painting & Decorating",
    address: emptyAddress(),
    phone: "",
    email: "info@dmpaintingdecorating.co.uk",
    website: "www.dmpaintingdecorating.co.uk",
    vatNumber: "",
    companyNumber: "",
    vatRegistered: false,
    defaultVatRate: 20,
    bank: emptyBank(),
    paymentTermsDays: 14,
    quoteValidityDays: 30,
    quotePrefix: "Q-",
    nextQuoteNumber: 1,
    invoicePrefix: "INV-",
    nextInvoiceNumber: 1,
    defaultQuoteIntro:
      "Thank you for inviting us to quote. Below is a summary of the work we discussed, followed by an itemised breakdown of costs.",
    defaultTerms: [
      "This quotation is valid until the date shown above.",
      "Prices are based on the scope of works described. Any additional work will be agreed with you before it begins.",
      "If preparation uncovers hidden defects, such as failing plaster or decayed timber, we will discuss the options with you before continuing.",
      "Please let us know about access, parking or timing requirements before work begins.",
    ],
    defaultPaymentNote: "Please use the invoice number as your payment reference. Thank you for choosing D&M.",
  };
}

export function emptyData(nowIso: string): AdminData {
  return {
    schemaVersion: SCHEMA_VERSION,
    quotes: [],
    invoices: [],
    bookings: [],
    settings: defaultSettings(),
    meta: { createdAt: nowIso, lastBackupAt: null },
  };
}

export function newBooking(start: IsoDate, nowIso: string, fields: Partial<Booking> = {}): Booking {
  return {
    kind: "booking",
    id: newId(),
    job: "",
    customerName: "",
    phone: "",
    address: emptyAddress(),
    start,
    end: start,
    status: "confirmed",
    notes: "",
    quoteId: null,
    invoiceId: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    ...fields,
  };
}
