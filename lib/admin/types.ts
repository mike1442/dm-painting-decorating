// Shared data model for the D&M admin. These shapes are the contract for
// local storage today, JSON backups, ChatGPT-generated quotes and a future
// Supabase backend, so change them deliberately and bump SCHEMA_VERSION.

export const SCHEMA_VERSION = 1;

/** Calendar date in ISO form, e.g. "2026-10-17". Never includes a time. */
export type IsoDate = string;
/** Full ISO timestamp, e.g. "2026-10-17T09:30:00.000Z". */
export type IsoDateTime = string;

export type Address = {
  line1: string;
  line2: string;
  town: string;
  postcode: string;
};

export type Customer = {
  name: string;
  email: string;
  phone: string;
  address: Address;
};

/** A priced line. Money values are pounds (e.g. 249.5), always excluding VAT. */
export type LineItem = {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
};

/** VAT is opt-in per document and never assumed. */
export type VatSetting = {
  enabled: boolean;
  rate: number;
};

export type DepositSetting =
  | { type: "none"; value: 0 }
  | { type: "percent"; value: number }
  | { type: "fixed"; value: number };

/** Reserved for permanent customer links once a secure backend exists. */
export type ShareState = {
  token: null;
  status: "not-available";
};

export type QuoteStatus = "draft" | "sent" | "accepted" | "declined";

export type Quote = {
  isTest?: boolean;
  kind: "quote";
  id: string;
  number: string;
  status: QuoteStatus;
  title: string;
  customer: Customer;
  issueDate: IsoDate;
  validUntil: IsoDate;
  intro: string;
  scope: string[];
  works: LineItem[];
  materials: LineItem[];
  materialsNote: string;
  vat: VatSetting;
  deposit: DepositSetting;
  terms: string[];
  internalNotes: string;
  share: ShareState;
  source: "manual" | "chatgpt" | "import";
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type PaymentMethod = "bank-transfer" | "cash" | "card" | "cheque" | "other";

/** Money received against an invoice. Ready for future payment tracking. */
export type Payment = {
  id: string;
  date: IsoDate;
  amount: number;
  method: PaymentMethod;
  label: string;
};

export type BankDetails = {
  accountName: string;
  sortCode: string;
  accountNumber: string;
};

export type InvoiceStatus = "draft" | "sent";

/** Links live on the child record: invoice.quoteId, booking.quoteId, booking.invoiceId. */
export type Invoice = {
  isTest?: boolean;
  kind: "invoice";
  id: string;
  number: string;
  status: InvoiceStatus;
  title: string;
  customer: Customer;
  issueDate: IsoDate;
  dueDate: IsoDate;
  quoteId: string | null;
  quoteNumber: string;
  scope: string[];
  works: LineItem[];
  materials: LineItem[];
  materialsNote: string;
  vat: VatSetting;
  payments: Payment[];
  bank: BankDetails;
  paymentNote: string;
  internalNotes: string;
  share: ShareState;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type BookingStatus = "confirmed" | "provisional";

export type Booking = {
  kind: "booking";
  id: string;
  job: string;
  customerName: string;
  phone: string;
  address: Address;
  /** First day of the booking. */
  start: IsoDate;
  /** Last day of the booking, inclusive. */
  end: IsoDate;
  status: BookingStatus;
  notes: string;
  quoteId: string | null;
  invoiceId: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type BusinessSettings = {
  businessName: string;
  address: Address;
  phone: string;
  email: string;
  website: string;
  vatNumber: string;
  companyNumber: string;
  /** Default for new documents only. Off unless the business turns it on. */
  vatRegistered: boolean;
  defaultVatRate: number;
  bank: BankDetails;
  paymentTermsDays: number;
  quoteValidityDays: number;
  quotePrefix: string;
  nextQuoteNumber: number;
  invoicePrefix: string;
  nextInvoiceNumber: number;
  defaultQuoteIntro: string;
  defaultTerms: string[];
  defaultPaymentNote: string;
};

export type AdminData = {
  schemaVersion: number;
  quotes: Quote[];
  invoices: Invoice[];
  bookings: Booking[];
  settings: BusinessSettings;
  meta: {
    createdAt: IsoDateTime;
    lastBackupAt: IsoDateTime | null;
  };
};

