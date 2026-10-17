# D&M admin (`/admin`)

A private, mobile-first tool with three sections: **Quotes**, **Invoices** and **Diary**. Business details and backups live behind the settings icon.

## Important: records are stored on this device only

There is no database yet. Everything is saved in the browser's `localStorage` on the device being used:

- Not synchronised between phone, tablet and computer.
- Not backed up online. Clearing browsing data, private browsing or Safari's storage clean-up (iPhone/iPad, after several days without a visit) can delete it.
- Use **Settings → Export backup** regularly. A backup is a JSON file containing customer details, so store it privately. **Import backup** can merge it into another device or replace that device's data.

## Workflow

1. **Quote**: start blank, or paste structured JSON from a ChatGPT conversation (_New quote → Paste from ChatGPT_, which also copies the instructions to give ChatGPT). Edit customer, scope, itemised works, materials, VAT, deposit and terms. Totals update as you type.
2. **Preview → Print / Save PDF** gives the customer-ready quotation. Send the PDF.
3. **Create invoice from quote** copies everything into a new invoice. Record deposits and payments; the balance due updates and the invoice shows _Paid in full_ when settled.
4. **Book into diary** pre-fills a booking from the quote or invoice. Month and week views show booked, provisional and available days.

No decorating rates are built in. VAT is off unless turned on per document (or as the default in Settings) and never assumed.

## What is temporary

| Area | Now | Needs a backend (e.g. Supabase) |
| --- | --- | --- |
| Storage | `localStorage`, one device | Shared database with backups |
| Sign-in | None. The pages hold no customer data; each browser only sees its own records | Real authentication in `lib/admin/auth.ts` |
| Customer links | Not offered. Previews only work on the device that made them | Permanent tokenised links (see below) |
| ChatGPT | Paste JSON by hand | Authenticated API or Custom GPT action using `quoteInputJsonSchema` |
| Payments | Recorded manually per invoice | Payment tracking, reminders, reconciliation |
| Numbering | Counts up per device | Allocated centrally so numbers never clash |

## Structure

- `lib/admin/types.ts`: the data model (quotes, invoices, bookings, settings). Money is pounds excluding VAT; calculations run in whole pence (`money.ts`).
- `lib/admin/operations.ts`: pure create/convert/link/delete operations, unit tested. Links live on the child record (`invoice.quoteId`, `booking.quoteId`, `booking.invoiceId`), ready to become foreign keys.
- `lib/admin/normalise.ts`: validates anything read from storage, backups or pasted JSON.
- `lib/admin/chatgpt.ts`: input format, JSON Schema and parser for ChatGPT-produced quotes.
- `lib/admin/store.ts`: the temporary `localStorage` store. Replace this module when a backend is connected.
- `components/documents/`: the quotation and invoice templates. They are plain, hook-free components so a future public customer-link page can render them on the server.

## Security

- `middleware.ts` runs only for `/admin` and `/api/admin`. It adds `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`, and refuses every `/api/admin/*` request with 401 until real authentication exists.
- Admin pages also carry `noindex` metadata and no canonical link. They are not linked from the public site or listed in the sitemap.
- `/admin` is deliberately left out of `robots.txt`: a robots block would stop crawlers from seeing the `noindex` header and would advertise the path.
- There are no passwords or fake log-ins. Opening `/admin` on another device shows an empty app.

## Future customer links

`Quote.share` and `Invoice.share` are reserved (`token: null`). When a backend exists: store documents server-side, issue long random tokens, serve them from a separate public route (e.g. `/q/[token]`) that renders `QuoteDocument` / `InvoiceDocument` with `noindex`, and let customers accept quotes there. Until then the admin never shows a URL as something to send to a customer.

## Tests

```bash
npm test        # unit tests for calculations, dates, conversion, ChatGPT parsing and backups
npx tsc --noEmit
npm run build
```
