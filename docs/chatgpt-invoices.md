# Invoices from Mike's ChatGPT

Mike asks his ordinary ChatGPT to create an invoice, for example:

> Create a D&M invoice for John Smith, 12 Mill Lane, Lymm, WA13 9SD: £850 decorating labour.

ChatGPT uses Mike's existing **Supabase** connection to run one SQL statement on D&M's Supabase project. The D&M database creates the invoice exactly as D&M admin would: the next invoice number, the bank details and payment terms from Settings, and the standard invoice template. It then makes the customer link, opens it the way a customer would, and only then gives ChatGPT the invoice number, the total and the link. ChatGPT replies with them.

There is no Custom GPT, plugin or D&M MCP server, and nothing to install in ChatGPT. The earlier Custom GPT and Developer-mode approaches ([chatgpt.md](chatgpt.md)) are abandoned: do not set them up.

## Can ChatGPT's Supabase connection do this?

Yes, with one small addition to the database. What was checked:

- **What the connection runs as.** The Supabase connection's SQL tool (`execute_sql`) runs as the project's own `postgres` role, "under the context of your developer permissions" ([Supabase MCP docs](https://supabase.com/docs/guides/getting-started/mcp)). Checked on a project: `current_user` and `session_user` are both `postgres`, there are no Supabase Auth claims, and the transaction is read-write. In the connection's read-only mode it runs as a read-only user instead, which cannot create anything.
- **The existing business operations refuse it, correctly.** D&M admin saves through `dm_save_data` and makes links with `dm_create_share`. Both require Mike's signed-in Supabase Auth session: his confirmed email, admin membership and a live session. A SQL connection has no such session, so they answer "Administrator access required". That check stays exactly as it is.
- **Raw SQL would be unsafe.** The connection could write the tables directly, but that would skip the database's number allocation and permanent number reservations, the revision lock that stops one device overwriting another, link hashing and every check. ChatGPT must never do that.

So the change adds one narrow entrypoint, `private.dm_chatgpt_create_invoice`, that only the project's own database administrator can call. It runs the same code as D&M admin for saving, numbering and customer links. The admin's own functions are unchanged apart from taking the owner as a parameter internally.

**Not verified here:** the database change has not yet been applied to D&M's live Supabase project, and this has not been tried from Mike's own ChatGPT account. Nobody but Mike can sign in to his ChatGPT, and the Supabase and Vercel connections available while building this belonged to a different account, with no access to D&M's project or team. Do the one-time setup below, then the test, before relying on it.

## One-time setup

1. **Apply the database change (after the PR is reviewed).** Whoever manages D&M's Supabase project (`fdctgtncawolrapwwevm`, "mike1442's Project", organisation `D@M painting`) applies [`supabase/chatgpt-invoices.sql`](../supabase/chatgpt-invoices.sql) once, after `production-admin.sql`. Use Supabase's `apply_migration` with the name `dm_chatgpt_invoices`, or paste it into the dashboard's SQL editor. Record the version Supabase returns, and check the security advisors afterwards. It is one transaction: it either applies completely or not at all.
2. **D&M admin is set up.** Mike's admin account (`mike@dmpaintingdecorating.co.uk`) is confirmed, and **Settings** has been saved at least once with the bank details and payment terms. Invoices take these from Settings; until they are saved, ChatGPT is told to save them first.
3. **ChatGPT's Supabase connection reaches D&M's project.** In ChatGPT → Settings → Apps (called Connectors on some accounts) → Supabase, the connection must be signed in to the Supabase account that can open "mike1442's Project". It must not be in read-only mode. If the connection can be limited to one project, choose `fdctgtncawolrapwwevm`.
4. **Give ChatGPT the instructions.** Paste the text below into ChatGPT → Settings → Personalisation → **Custom instructions** (the "anything else ChatGPT should know" box). Alternatively, paste it into the instructions of a ChatGPT Project called "D&M", or at the start of a chat. These are ordinary ChatGPT settings, not a Custom GPT.

### Instructions for ChatGPT

```
D&M invoices: when I ask for a D&M invoice, use my Supabase connection, project fdctgtncawolrapwwevm, and run exactly one execute_sql:
select private.dm_chatgpt_create_invoice($dm${...}$dm$::jsonb);
JSON fields: customer {name, address {line1, line2, town, postcode}, email, phone}; title; works and materials: lists of {description, quantity, unit, unitPrice} in pounds before VAT; expectedSubtotal = the sum of my prices before VAT. Optional: vat (true, false or {"enabled": true, "rate": 20}), dueInDays, scope (list of points), materialsNote, paymentNote, internalNotes, testDocument (only if I say test), allowDuplicate (only if I clearly want a second copy).
Use only the prices and details I give; never estimate. If I haven't said who the customer is, ask. Amounts are numbers, not text.
Never change D&M data any other way: no other insert, update, delete or migration.
Reply with the number, total, due date and customerLink exactly as returned. Only say it's created if status is "created" and verified is true. Otherwise tell me the message plainly; never retry with allowDuplicate unless I say so.
To remove a TEST invoice: select private.dm_chatgpt_remove_test_invoice('TEST-...');
```

## Using it

1. Start a normal chat in ChatGPT (on the iPhone app or a computer) and make sure the Supabase connection is switched on for the chat. On some accounts you choose it with **+** → Supabase.
2. Ask for the invoice in your own words, with the customer and the prices. For example:
   - "Create a D&M invoice for John Smith, 12 Mill Lane, Lymm, WA13 9SD: £850 decorating labour."
   - "Invoice Sarah Jones, 4 Mill Lane, Lymm, WA13 9SD: £1,500 labour and £200 materials, plus VAT, due in 7 days."
   - "D&M invoice for Paul Finn, 6 Falkstone Close, Warrington, WA3 6SU: two painters, 3 days each at £250 a day, £180 materials."
3. ChatGPT shows the SQL it will run. If it asks you to **confirm** running it, check the customer and figures, then confirm.
4. ChatGPT replies with the invoice number (for example `INV-0012`), the total, the due date and the customer link, for example `https://www.dmpaintingdecorating.co.uk/d/…`. Send that link to the customer. They can view and print the invoice without signing in.

The invoice appears in D&M admin under **Invoices** as a draft, like one made there. Record payments, mark it sent or edit it there as usual. D&M admin treats ChatGPT like another device. If admin is open somewhere with unsaved edits when ChatGPT saves, admin reports that records changed on another device and does not overwrite the invoice. Export the pending edits before reloading, as with any other device ([admin.md](admin.md)).

ChatGPT only uses the prices you give. It also sends your total as a check (`expectedSubtotal`). If the items do not add up to it, nothing is saved and ChatGPT tells you the difference.

### What ChatGPT runs

ChatGPT runs exactly one statement. For Mike's first example:

```sql
select private.dm_chatgpt_create_invoice($dm${
  "customer": {"name": "John Smith", "address": {"line1": "12 Mill Lane", "line2": "", "town": "Lymm", "postcode": "WA13 9SD"}},
  "title": "Decorating labour",
  "works": [{"description": "Decorating labour", "quantity": 1, "unit": "", "unitPrice": 850}],
  "expectedSubtotal": 850
}$dm$::jsonb);
```

The `$dm$ … $dm$` quotes mean names such as O'Brien need no escaping.

| Field | Required | Meaning |
| --- | --- | --- |
| `customer.name` | yes | Up to 200 characters |
| `customer.address` | no | `line1`, `line2`, `town`, `postcode`; one line of text is refused, so ChatGPT splits it |
| `customer.email`, `customer.phone` | no | Kept in admin only; never shown on the customer's page |
| `title` | yes | Job title, up to 300 characters |
| `works`, `materials` | at least one item | `description`, `quantity` (above 0, up to 3 decimals), optional `unit`, `unitPrice` (pounds before VAT, up to 2 decimals) |
| `expectedSubtotal` | yes | Mike's own sum before VAT; must match the items to the penny |
| `vat` | no | `true`, `false` or `{"enabled": true, "rate": 20}`; otherwise the VAT setting in D&M admin |
| `dueInDays` | no | 0–365; otherwise the payment terms in Settings |
| `scope` | no | List of short points, shown as "Work carried out" |
| `materialsNote`, `paymentNote`, `internalNotes` | no | `internalNotes` stays private to Mike |
| `testDocument` | no | `true` makes a TEST invoice: a `TEST-` number, no bank details, a "Test document" banner |
| `allowDuplicate` | no | `true` only when Mike wants a second invoice with the same details |

Misspelt or unknown fields, prices written as text, negative prices and fractions of a penny are refused, not guessed.

### What comes back

| `status` | Meaning | ChatGPT says |
| --- | --- | --- |
| `created` (`verified: true`) | Saved, read back, and the link opened this invoice for an anonymous visitor | Number, total, due date and `customerLink` |
| `already_created` | The same request was already made today, for example a retry after a lost answer. No duplicate is made | The existing number and total. Links are stored only as fingerprints and cannot be shown again; a new one can be made in D&M admin, and the old one then stops working |
| `possible_duplicate` | An invoice for the same customer and amount was made in the last 30 minutes. Nothing is saved | Asks Mike. Only if he wants a second invoice does it repeat with `allowDuplicate: true` |
| An error | Nothing is saved | The reason, for example "The items add up to £850.00 before VAT, but Mike's figures came to £800.00" |

## Test it once, then remove the test

After the setup, check the whole route with a TEST invoice, which uses no real invoice number and shows no bank details:

1. Ask: "Create a TEST D&M invoice for TEST Customer, 1 Test Street, Testtown, TE1 1ST: £10 labour."
2. ChatGPT should report `status: created`, a number starting `TEST-`, total £10.00 and a customer link.
3. Open the link in a private browser window. It should show the invoice with "Test document · Not issued · No payment required", TEST Customer and £10.00.
4. Repeat the same request. ChatGPT should say it was already created, with no new invoice.
5. Ask: "Remove TEST invoice TEST-…" (the number it gave). ChatGPT runs `select private.dm_chatgpt_remove_test_invoice('TEST-…');`. The link should then show "not found", and the invoice disappears from D&M admin.

Only TEST invoices can be removed this way. Mike deletes real invoices in D&M admin.

## Security

- **Who can call it:** only the project's own database administrator, meaning the `postgres` role or a role that is a member of it. That covers the Supabase connection's SQL tool, the dashboard SQL editor and a direct database login. Execution is revoked from `anon`, `authenticated`, `service_role` and `PUBLIC`. The functions live in the `private` schema, which the Data API does not expose. As a backstop, they also refuse any session that did not log in as the administrator, so a request through the Data API (which logs in as `authenticator`) is refused even if execution were granted by mistake. The website, the customer pages and any signed-in browser cannot reach it.
- **Nothing new is granted to anyone.** A Supabase connection that can call it already has full rights over the database. The entrypoint gives that connection a safe, checked way to create an invoice instead of raw table writes. Protect Mike's ChatGPT and Supabase logins accordingly: use two-factor sign-in, and keep ChatGPT's confirmation for write actions on.
- **Ownership:** invoices are saved only for Mike's account (`mike@dmpaintingdecorating.co.uk`), and only when it is confirmed, enrolled, not banned and not deleted. These are the same conditions the customer-link page applies to the document's owner. Other accounts' records are never read or written.
- **Same business rules:** it locks Mike's records like every admin save and saves through the admin's own save code. That code issues the canonical number, reserves it permanently, keeps imported numbers and raises the revision, so a device with older records cannot overwrite the new invoice. Amounts are kept in whole pence as in `lib/admin/money.ts`. The stored invoice is identical to one made by `createInvoice` in `lib/admin/operations.ts` (checked by the end-to-end test).
- **Customer links:** made by the admin's own link code: 256 random bits, stored only as a SHA-256 hash, and shown through the existing `/d/<token>` page and invoice template. Before answering, the database opens the link as the anonymous role through `dm_get_shared_document`, as the customer's page does. It must show this invoice number, customer, items, VAT and total.
- **All or nothing:** each request is one transaction. Any refused check, failed read-back or failed link check raises an error, and nothing is saved.
- **Retries and duplicates:** the invoice ID is derived from the request (date, customer, title, items, VAT, test flag). An identical retry finds the earlier invoice and never makes a second one, even when two arrive at the same moment. A reworded repeat for the same customer and amount within 30 minutes is held back.

## Troubleshooting

| What ChatGPT reports | Cause and fix |
| --- | --- |
| "You do not have permission to perform this action" (from the Supabase connection) | The connection's Supabase account cannot open D&M's project. Sign the connection in to the account that can |
| "permission denied for schema private" | The connection is in read-only mode, or uses another role. Turn read-only off for the D&M project |
| "function private.dm_chatgpt_create_invoice(jsonb) does not exist" | The database change has not been applied yet (setup step 1) |
| "Mike's confirmed D&M admin account is not set up" | Create and confirm Mike's admin account |
| "D&M business settings have not been saved yet" | Open D&M admin → Settings, check the bank details and payment terms, and save |
| "This Supabase connection is read-only" | Turn off read-only mode for the D&M project |
| "The items add up to … but Mike's figures came to …" | Check the quantities and prices; nothing was saved |
| "Only the D&M Supabase project's own database administrator can use this" | The call came through an application role, not the Supabase connection's SQL tool |

## Checks

- `tests/db/chatgpt-invoices.sql`, run by the **Database security checks** workflow on PostgreSQL 17, in both the upgrade and the fresh-install scenario. It checks:
  - **Callers:** API roles cannot execute it, and an API login with a mistaken grant is refused.
  - **Preconditions:** Mike's account and saved settings are required.
  - **Refusals:** every refused request saves nothing.
  - **Results:** real numbering and reservation; repeats and reworded repeats; VAT, scope and apostrophes; TEST invoices.
  - **Admin path:** a stale browser save is still rejected; removal of TEST invoices only.
  - **Isolation:** other owners' records are untouched.
- `tests/isolated/chatgpt-invoices.mjs` (`npm run test:chatgpt-invoices:isolated`), run by the **Live admin verification** workflow's isolated job. It uses a disposable database with the real migrations and sends the exact SQL above as `postgres`. Each returned link is opened on a production build of the site, through the emulated Supabase gateway. It covers:
  - **TEST invoices:** a TEST invoice and its page, a VAT invoice, and their removal.
  - **Repeats:** identical repeats, including two at the same moment, and a reworded repeat.
  - **Refusals:** a wrong total, a price given as text, a missing customer and a read-only connection.
  - **Access:** the Data API cannot reach it.
  - **A real invoice:** its number, bank details and payment reference, then deletion in the admin.
  - **Cleanup:** afterwards, every earlier record is unchanged and no TEST record, TEST number or link remains.
- The existing database checks and the complete desktop and mobile admin suite also run on top of this migration. The admin's own save and link functions now call the shared code.

These checks do not sign in to Mike's ChatGPT or reach D&M's live project. The test in the previous section does both, once the change is applied.
