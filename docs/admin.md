# D&M admin (`/admin`)

A private, mobile-first tool with three sections: **Quotes**, **Invoices** and **Diary**. Business details, backups and the account live behind the settings icon.

## Signing in and storage

- Only signed-in Supabase Auth users who are listed in `admin_members` can open any `/admin` page. There is no public sign-up.
- Records are saved online in Supabase, so the same quotes, invoices, payments, diary bookings and settings appear on every device where Mike signs in.
- Edits save automatically about a second after typing stops. The status pill in the header shows **Saved**, **Saving…**, **Offline** or **Check changes**. Nothing is shown as saved until the server has confirmed it.
- With no signal, edits wait on the page and save when the connection returns. The browser warns before closing a page with unsaved changes.
- If the same record is changed on two devices at once, the second device is asked which version to keep. Nothing is silently overwritten. Different settings changed on different devices are merged automatically.
- Quote and invoice numbers are handed out by the database, so two devices can never issue the same number.
- **Settings → Export backup** still produces a JSON file in the same format as before. **Import backup**, and the import of records left in a browser by the earlier device-only version, always show a review first: new records are added, records that already exist online are never replaced unless ticked, and numbers already in use are given new ones.

## Workflow

1. **Quote**: start blank, or paste structured JSON from a ChatGPT conversation (_New quote → Paste from ChatGPT_, which also copies the instructions to give ChatGPT). Edit customer, scope, itemised works, materials, VAT, deposit and terms. Totals update as you type.
2. **Preview → Print / Save PDF** gives the customer-ready quotation. Send the PDF.
3. **Create invoice from quote** copies everything into a new invoice. Record deposits and payments; the balance due updates and the invoice shows _Paid in full_ when settled.
4. **Book into diary** pre-fills a booking from the quote or invoice. Month and week views show booked, provisional and available days.

No decorating rates are built in. VAT is off unless turned on per document (or as the default in Settings) and never assumed.

## Structure

- `lib/admin/types.ts`, `operations.ts`, `money.ts`: the data model, pure operations and calculations (unchanged in behaviour).
- `lib/admin/remote.ts`: mapping between records and the `admin_documents` / `admin_settings` rows.
- `lib/admin/sync.ts`: the sync engine (change tracking, versioned saves, conflicts, settings merge, refresh). No React or Supabase imports, so it is unit tested against `tests/admin/fake-repository.ts`.
- `lib/admin/supabase-repository.ts`: the Supabase implementation of `AdminRepository`.
- `lib/admin/store.ts`: React glue. Saves after edits, retries when back online, refreshes when the page regains focus and every 45 seconds while visible.
- `lib/admin/importer.ts`, `legacy.ts`: reviewable import of backups and of old browser-only records.
- `lib/admin/auth.ts`, `session.ts`, `middleware.ts`: access rules, server-side checks and security headers.
- `supabase/migrations/`: SQL the database needs. `supabase/tests/admin_security.sql`: security checks to run in the SQL editor.
- `components/documents/`: the quotation and invoice templates, unchanged.

## Not included yet

| Area | Now | Later |
| --- | --- | --- |
| Customer links | Not offered. Admin previews only work for signed-in admins | Tokenised public links rendering `QuoteDocument` / `InvoiceDocument` |
| Live updates | Other devices' changes appear on focus, on reconnect and every 45 seconds | Supabase Realtime subscription |
| Offline | Unsaved edits are kept on the open page only | Optional on-device outbox |
| ChatGPT | Paste JSON by hand | Authenticated API or Custom GPT action using `quoteInputJsonSchema` |
| Payments | Recorded manually per invoice | Payment tracking, reminders, reconciliation |
| Customers | Stored on each quote and invoice | A separate customer directory, if wanted |

Setup, configuration and the release checklist are in [docs/supabase-integration.md](supabase-integration.md).

## Tests

```bash
npm test                 # unit tests: calculations, sync engine, conflicts, numbering, import, access rules
npx tsc --noEmit
npm run build
npm run test:integration # needs a local Supabase stack, see docs/supabase-integration.md
```
