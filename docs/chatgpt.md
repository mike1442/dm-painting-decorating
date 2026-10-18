# ChatGPT secretary

Mike can run D&M's quotes, invoices and diary by talking to his own ChatGPT. For example:

> Create a quote for Paul Finn, 6 Falkstone Close, Gorse Covert, WA3 6SU. Living room, 25 m² walls, two days, £400 labour, £118 materials.

ChatGPT saves a real quote in D&M admin with the next quote number, D&M's standard introduction and terms, and a total of £518.00. It replies with the quote number and a secure customer link to the printable quote. There are no forms to fill in.

The connection is private to Mike. ChatGPT only gets access after Mike signs in with his D&M admin password and approves it on a D&M page. It uses the existing admin backend; there is no second admin system or database.

## 1. One-time website setting

Whoever manages the Vercel project does this once. Until it is done, registration, sign-in and MCP access answer "not configured". The public OAuth discovery documents remain available so ChatGPT can discover the settings automatically.

1. Generate a long random value with `openssl rand -base64 48`, or a 64-character password from a password manager. The value must contain at least 32 characters and at least 10 distinct characters; a repeated character or a placeholder is rejected. Keep the generated value private and enter it directly in Vercel; never put it in chat, logs or GitHub.
2. In Vercel → project `dm-painting-decorating` → Settings → Environment Variables, add `DM_CHATGPT_SECRET` with that value for **Production**. Mark it **Sensitive**.
3. Redeploy production, for example by merging this change.

Keep the value secret and never put it in chat, code or GitHub. Changing it later disconnects ChatGPT straight away; Mike then reconnects as below. No other variable, Supabase setting or service-role key is involved.

## 2. Mike connects ChatGPT (about two minutes, once)

This needs a ChatGPT plan with **Developer mode** for apps (Plus, Pro, Business or Enterprise) and is set up on the ChatGPT **website**. OpenAI sometimes renames these menus; the address and the D&M sign-in step stay the same.

1. Open [chatgpt.com](https://chatgpt.com) → your name → **Settings** → **Apps** (called **Apps & Connectors** on some accounts) → **Advanced settings**, and turn on **Developer mode**.
2. Back in **Apps**, choose **Create app** (or **Add**):
   - **Name:** `D&M Admin`
   - **MCP server URL:** `https://www.dmpaintingdecorating.co.uk/api/mcp`
   - **Authentication:** `OAuth`
   - Tick **I trust this application**, then **Create**.
3. A D&M page opens: **Connect ChatGPT to D&M admin**. Check it lists what ChatGPT may do, enter your D&M admin password and press **Allow**. Untick the delete permission if you would rather delete things yourself in the admin.
4. ChatGPT shows D&M Admin as connected.

To use it, start a chat, press **+**, choose **D&M Admin** (under **More** or **Developer mode** on some accounts), and ask. ChatGPT asks you to approve the first change in each chat. You can let it remember that approval for the conversation.

The same address appears in D&M admin → **Settings** → **ChatGPT**, with a copy button.

### Things to ask

- "Create a quote for Paul Finn, 6 Falkstone Close, Gorse Covert, WA3 6SU. Living room, 25 m² walls, two days, £400 labour, £118 materials."
- "Change Q-0041: add £60 for the ceiling and send me the new total."
- "Mark Q-0041 as sent." / "Paul accepted Q-0041 — invoice it, due in 7 days."
- "Paul paid a £200 deposit by bank transfer today." / "Mark INV-0012 as paid in cash."
- "Who owes me money?" / "Show my quotes for Lymm this month."
- "When can I fit in a three-day job?" / "Book Paul's living room for Monday and Tuesday, linked to Q-0041."
- "Add a job note to Monday's booking: first coat done, second coat tomorrow."
- "Send me Paul's link again." / "Stop Paul's link working." / "Delete the test quote."

ChatGPT only uses prices you give it; it never invents prices. It also passes your figures to D&M as a check total, so a quote whose items do not add up to what you said is not saved. VAT follows the setting in D&M admin unless you say otherwise.

### Confirmations

Deleting a quote, invoice or booking, revoking a customer link, and replacing a link for a document already marked sent all happen in two steps. First ChatGPT tells you exactly what will happen; D&M changes nothing yet. Only when you say yes does ChatGPT repeat the request with a one-time confirmation code. That code works only for that action, on that unchanged record, from your connection, for 10 minutes. ChatGPT also shows its own approval prompt for these actions.

### Disconnecting

- In ChatGPT: Settings → Apps → D&M Admin → disconnect or delete.
- In D&M admin: Settings → ChatGPT → **Disconnect ChatGPT**. This ends ChatGPT's session at once, and signs out every other device except the browser you are using.
- Changing `DM_CHATGPT_SECRET` in Vercel also disconnects ChatGPT.

Mike approves the connection again at least every 90 days.

## Alternative: a Custom GPT

Use this only if Developer mode is unavailable on Mike's plan. It uses the same tools and sign-in. In D&M admin → Settings → ChatGPT → **Using a Custom GPT instead** are the values to copy.

1. In ChatGPT → **GPTs** → **Create** → **Configure**, name it `D&M Admin` and paste the instructions below. Keep it **Only me**.
2. **Create new action** → **Import from URL**: `https://www.dmpaintingdecorating.co.uk/api/chatgpt/openapi.json`.
3. **Authentication** → **OAuth**: the Client ID (`dm-custom-gpt`) and Client secret from Settings → ChatGPT, Authorization URL `https://www.dmpaintingdecorating.co.uk/oauth/authorize`, Token URL `https://www.dmpaintingdecorating.co.uk/api/oauth/token`, Scope `dm:read dm:write dm:delete`, Token exchange method **Default (POST request)**.
4. Save. The first time you use it, ChatGPT asks you to sign in to D&M and allow it.

Instructions for the GPT:

```
You are Mike's secretary for D&M Painting & Decorating, using the D&M Admin actions.
Use only prices and quantities Mike gives; never estimate prices. Prices are in pounds before VAT.
Always pass expectedSubtotal (the sum of Mike's figures) when creating or repricing a document.
After creating a quote or invoice, give Mike its number, total and customer link exactly as returned.
Only set allowDuplicate when Mike explicitly wants a second copy.
For deletions and link revocations, explain what will happen and wait for Mike's explicit yes before sending the confirmationCode.
Use British English.
```

## How it works

| Part | Where |
| --- | --- |
| MCP server (Streamable HTTP, stateless) | `app/api/mcp/route.ts` → `lib/chatgpt/mcp.ts` |
| Tools over the existing admin operations | `lib/chatgpt/tools.ts` |
| Storage path (same RPCs as the admin) | `lib/chatgpt/records.ts` |
| OAuth 2.1 server, consent page | `lib/chatgpt/oauth.ts`, `lib/chatgpt/consent-page.ts`, `app/oauth/authorize`, `app/api/oauth/*`, `app/.well-known/*` |
| Token sealing | `lib/chatgpt/seal.ts`, `lib/chatgpt/config.ts` |
| Custom GPT alternative | `app/api/chatgpt/*` |
| Settings → ChatGPT | `components/admin/ChatGptPanel.tsx`, `app/api/admin/chatgpt/route.ts` |

### Records

Every tool reads with `dm_get_data`, applies the same pure operation the admin's own screens use (`lib/admin/operations.ts`), and saves with `dm_save_data` under its revision lock. It then creates and revokes links with `dm_create_share` and `dm_revoke_share`. The database allocates the canonical quote and invoice numbers, as it does for the browser. Customer links are the existing `/d/<token>` pages with the existing quote and invoice templates. Quotes made through ChatGPT are marked "From ChatGPT" in the admin.

A save only changes what was asked. If another device saved first, the revision check refuses the write, and the tool re-reads and reapplies its change (up to three times). Records outside the change are never rewritten. The admin browser picks up ChatGPT's changes on its next refresh, as it does for another device.

### Retries and duplicates

- A created quote, invoice or booking gets a stable ID derived from the request (customer, job, items and date). If ChatGPT repeats the call, for example after a dropped connection, D&M returns the existing document instead of a second one. The same applies when the save went through but its answer was lost.
- A reworded repeat (same customer and subtotal within 30 minutes) is held back as a possible duplicate. ChatGPT must ask Mike and pass `allowDuplicate` for a genuine second copy.
- Invoicing the same quote twice returns its existing invoice unless Mike asks for another.
- A repeated payment with the same date, amount, method and label is not recorded twice. Payments larger than the balance are refused.
- Updates set values, so repeating one is harmless. Deletions of something already gone report success.

Raw customer-link tokens are stored only as hashes, so a link cannot be looked up again. A repeated create returns the existing document and leaves its link working, because Mike may already have sent it. When a new link is needed, `create_customer_link` makes a replacement, and the earlier link stops working. For a document marked sent, it asks Mike to confirm first. ChatGPT is told to mark a document sent when Mike says he has sent it.

### Authority and permissions

- **Sign-in:** the consent page checks Mike's password with Supabase Auth (the same check as `/login`), then requires the confirmed admin account and membership (`verifyAdmin`). Any other result revokes the new session. The page has no scripts, cannot be framed, checks the browser's origin, and can only continue to ChatGPT.
- **Dedicated session:** approval opens a separate Supabase session for ChatGPT, so it never shares or rotates the session of Mike's browsers.
- **What ChatGPT holds:** an access token and refresh token sealed with AES-256-GCM under `DM_CHATGPT_SECRET`. They wrap the Supabase session and work only at D&M's ChatGPT endpoints on the same site. ChatGPT never receives Mike's password, a Supabase JWT or refresh token, a service-role key, or direct database access. Access tokens last under an hour; each refresh rotates the Supabase refresh token.
- **Every record operation runs as Mike** through the guarded Supabase functions. These still check his confirmed email, admin membership and a live session, so ending the session ends access at once.
- **Clients:** dynamic registration accepts only `https` redirect addresses on `chatgpt.com`, `chat.openai.com` and `platform.openai.com`. An authorization code can therefore only be delivered to ChatGPT. Public clients must use PKCE (S256). Codes last two minutes; exchanging one rotates the session it carries, so a replayed code is refused by Supabase.
- **Scopes:** `dm:read`, `dm:write` and `dm:delete`. Mike can leave out deletion on the consent page; the delete and revoke tools are then not offered.
- **Revocation:** ChatGPT's disconnect (RFC 7009 `/api/oauth/revoke`), Settings → Disconnect ChatGPT (Supabase `logout?scope=others`), or rotating `DM_CHATGPT_SECRET`.
- **Logs** record tool names, outcomes and timings only, never arguments, customer details or tokens.

Production authentication is unchanged: `/login`, cookies, middleware, the database functions and RLS are untouched. The only database calls are the existing guarded RPCs.

### Tools

| Tool | Permission | What it does |
| --- | --- | --- |
| `create_quote` | write | Save a quote from Mike's figures; return number, total and customer link |
| `get_quote`, `list_quotes` | read | Read one quote in full; search and filter quotes by state |
| `update_quote` | write | Change details, priced lines, VAT, deposit, validity, notes or status |
| `create_invoice` | write | Invoice a quote (marks it accepted) or invoice from Mike's figures; return link |
| `get_invoice`, `list_invoices` | read | Read an invoice with payments and balance; list, including overdue |
| `update_invoice` | write | Change details, lines, VAT, due date, notes or status |
| `record_payment` | write | Record money received, or the remaining balance |
| `create_customer_link` | write | Fresh link (confirmation needed if the document is marked sent) |
| `revoke_customer_link` | delete | Stop links working (confirmation needed) |
| `check_availability` | read | Free and booked days; earliest runs of free working days |
| `list_bookings` | read | Diary bookings in a date range |
| `create_booking` | write | Book a job, optionally from a quote or invoice; refuses clashes unless agreed |
| `update_booking` | write | Move, change status or details, add a dated job note |
| `delete_quote`, `delete_invoice`, `delete_booking` | delete | Permanent deletion (confirmation needed) |
| `get_business_settings` | read | Today's UK date, VAT default, terms and numbering |

## Verification

- `npm test` includes `tests/chatgpt/`:
  - OAuth: discovery, the registration allowlist, consent, PKCE, client secrets, single-use codes, refresh, revocation, and token binding and tampering.
  - MCP: protocol behaviour.
  - The Custom GPT schema.
  - Tools against an in-memory Supabase stand-in. These cover Mike's £518 example, retries, conflicting and lost saves, preservation of existing records, confirmations, payments and the diary.
- `tests/live/chatgpt-connection.spec.ts` is the end-to-end test. The official MCP SDK client stands in for ChatGPT and performs the same discovery, registration, PKCE and token steps to ChatGPT's real redirect address. Mike approves in a fresh desktop or phone browser. ChatGPT creates the Paul Finn quote (as a TEST document, so no real number is used), a repeat creates no duplicate, and an anonymous browser opens the customer link and sees £518.00. The test then revokes the link and deletes the quote, each after confirmation. Finally it refreshes and revokes the connection and checks that the endpoint refuses it.
- The secret-free `isolated-workflow` job runs that test and the existing admin workflow. It uses a production build against the real migrations in PostgreSQL behind the Supabase emulator. Afterwards it checks the database: every session revoked, every TEST record removed, everything else unchanged. Locally: `ISOLATED_DATABASE_URL=… npm run test:e2e:isolated` (see `tests/isolated/README.md`).
- The `real-supabase` job runs the same suite against the hosted project when the private `E2E_ADMIN_PASSWORD` secret is configured.
- `tests/e2e/anonymous-boundaries.spec.ts` checks the deployed boundaries without credentials:
  - The MCP endpoint refuses anonymous calls with the OAuth challenge.
  - Only ChatGPT redirects can register.
  - The consent page cannot be framed.

The automated suite cannot sign in to Mike's real ChatGPT account. After deployment, the one manual check is to connect D&M Admin as in section 2 and ask for a test quote ("make a test quote for…").

## Troubleshooting

- **"The ChatGPT connection is not configured"**: the running Vercel Production deployment does not have a valid `DM_CHATGPT_SECRET`. It needs at least 32 characters and at least 10 distinct characters. Check that the variable belongs to the project serving the domain, is enabled for Production, and that production was redeployed after adding it. Verify only the presence and validity of the variable; never print its value.
- **"Couldn't discover OAuth settings"**: the public addresses `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/api/mcp` must each return HTTP 200 JSON on `https://www.dmpaintingdecorating.co.uk`. The authorization-server issuer must be `https://www.dmpaintingdecorating.co.uk`, matching the protected-resource document's `authorization_servers`. A configured `/api/mcp` answers an anonymous GET or POST with HTTP 401 and a `WWW-Authenticate` header pointing to its resource metadata. A 503 there means runtime configuration still needs fixing even if discovery succeeds.
- **ChatGPT says it cannot connect or keeps asking to sign in**: use the exact address `https://www.dmpaintingdecorating.co.uk/api/mcp` (with `www`). If you pressed Disconnect in Settings or the secret changed, reconnect the app in ChatGPT.
- **"That password was not accepted"**: use the D&M admin password (the one for `/login`), not the ChatGPT password.
- **A customer link stopped working**: a newer link replaced it, or access was revoked. Ask ChatGPT for a new link.

