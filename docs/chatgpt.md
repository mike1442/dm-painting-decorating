# ChatGPT secretary

Mike can run D&M's quotes, invoices and diary by talking to his own ChatGPT, on his iPhone or a computer. For example:

> Create an invoice for John Smith for £850 decorating labour.

ChatGPT saves a real invoice in D&M admin with the next invoice number, D&M's bank details and payment terms. It reads the saved invoice back from D&M's records to check it, opens the customer link to check that works too, and replies with the number, the amount and the link. There are no forms to fill in.

The connection is private to Mike. ChatGPT only gets access after Mike signs in with his D&M admin password and approves it on a D&M page. It uses the existing admin backend and the same quote and invoice templates; there is no second admin system or database.

There are two ways to connect, using the same tools, sign-in and records:

| | Works on | Set up in |
| --- | --- | --- |
| **D&M Admin GPT** (a Custom GPT with Actions) — recommended | iPhone app, Android app and chatgpt.com | chatgpt.com on a computer, once |
| D&M Admin app (Developer mode, MCP) | chatgpt.com on a computer | chatgpt.com, once |

## 1. One-time website setting

Whoever manages the Vercel project does this once. It is already done for `www.dmpaintingdecorating.co.uk`: the production discovery check (`node scripts/verify-oauth-discovery.mjs`) completes registration and shows the approval page, which only happens when the setting is present and valid. Until it is done, ChatGPT registration, approval, token handling, the GPT's actions and MCP requests presenting credentials answer "not configured". The public OAuth discovery documents and anonymous MCP authentication challenge remain available so ChatGPT can discover the settings automatically.

1. Generate a long random value with `openssl rand -base64 48`, or a 64-character password from a password manager. The value must contain at least 32 characters and at least 10 distinct characters; a repeated character or a placeholder is rejected. Keep the generated value private and enter it directly in Vercel; never put it in chat, logs or GitHub.
2. In Vercel → project `dm-painting-decorating` → Settings → Environment Variables, add `DM_CHATGPT_SECRET` with that value for **Production**. Mark it **Sensitive**.
3. Redeploy production, for example by merging this change.

Keep the value secret and never put it in chat, code or GitHub. Changing it later disconnects ChatGPT straight away and changes the GPT's client secret; Mike then signs in again (and pastes the new client secret into his GPT). No other variable, Supabase setting or service-role key is involved.

## 2. Mike makes his D&M Admin GPT (about ten minutes, once, on a computer)

This needs a ChatGPT account that can create GPTs (Plus, Pro, Business or Enterprise). ChatGPT's iPhone app cannot create or edit GPTs, so do this once at [chatgpt.com](https://chatgpt.com) on a computer. OpenAI sometimes renames these menus; the values to paste stay the same.

Keep two browser tabs open: ChatGPT, and D&M admin → **Settings** (the gear) → **ChatGPT**, which shows every value below with a **Copy** button.

1. In ChatGPT, click **GPTs** in the left sidebar (or **Explore GPTs**), then **+ Create**, then the **Configure** tab.
2. **Name:** `D&M Admin`. **Description:** `My D&M quotes, invoices and diary`.
3. **Instructions:** copy **Instructions** from D&M Settings → ChatGPT and paste it in. (It is also at the end of this section.)
4. Scroll down to **Actions** and click **Create new action**.
5. Click **Import from URL**, paste `https://www.dmpaintingdecorating.co.uk/api/chatgpt/openapi.json` and click **Import**. A list of about 19 actions (create_quote, create_invoice, …) appears.
6. Click **Authentication** (the field above the schema), choose **OAuth**, and paste from D&M Settings → ChatGPT:
   - **Client ID:** `dm-custom-gpt`
   - **Client Secret:** the **Client secret** (use its Copy button; it is hidden on screen)
   - **Authorization URL:** `https://www.dmpaintingdecorating.co.uk/oauth/authorize`
   - **Token URL:** `https://www.dmpaintingdecorating.co.uk/api/oauth/token`
   - **Scope:** `dm:read dm:write dm:delete`
   - **Token Exchange Method:** **Default (POST request)**

   Click **Save**. ChatGPT now shows a **Callback URL**. Nothing needs to be done with it: D&M accepts ChatGPT's own callback addresses automatically.
7. Leave **Privacy policy** empty. Click **Create** (top right), choose **Only me**, and **Save**. Never share this GPT: it can see and change Mike's records.
8. Test it on the computer: open the GPT and type `Show my diary for next week`. ChatGPT shows **Sign in to www.dmpaintingdecorating.co.uk**: click it. A D&M page opens, **Connect ChatGPT to D&M admin**. Enter your D&M admin password (the one for `/login`, not your ChatGPT password) and click **Allow**. You are returned to ChatGPT, which shows your diary.

Instructions for the GPT (identical to Settings → ChatGPT):

```
You are Mike's secretary for D&M Painting & Decorating. These tools read and change his real quotes, invoices and diary in D&M admin.
Use only prices, quantities and customer details Mike gives; never estimate or invent a price. If he has not said who the customer is, ask before creating anything. Prices are in pounds before VAT; leave VAT to the business setting unless Mike says otherwise.
When creating or repricing a quote or invoice, pass expectedSubtotal (the sum of Mike's figures before VAT). If it does not match, nothing is saved: check the figures with Mike.
Every quote or invoice that is created or changed comes back as "document", read back from D&M's records: id, number, customer, amount, status and customerLink. Tell Mike the number, amount and customer link exactly as given there. Only say it is saved when document.verified is true; never make up or guess a number or link. If the status is "unverified" or customerLinkStatus is "failed", tell Mike plainly.
Customer links are shown only when they are made. To give Mike the link for an existing quote or invoice, find it with list_invoices or list_quotes, then call create_customer_link; any earlier link stops working. When he says he has sent a document, mark it sent (update_quote or update_invoice) so its link is protected from replacement.
"Mark INV-0012 as paid" means record_payment with payRemainingBalance; for part payments give the amount. For the diary use list_bookings, with period next-week or this-week when Mike names a week, and check_availability to find free days.
Retrying a create with the same details never makes a duplicate. Set allowDuplicate only when Mike explicitly asks for a second copy.
Deleting, revoking a link, or replacing a link a customer may already hold first returns a confirmation code. Tell Mike exactly what will happen and wait for his explicit yes before calling again with the code. Never confirm on his behalf.
Dates are YYYY-MM-DD in UK time; get_business_settings gives today's date. Write in British English.
```

## 3. Using it on iPhone

1. Install the **ChatGPT** app from the App Store and sign in with the same ChatGPT account.
2. Tap the menu (two lines, top left) → **GPTs**, and open **D&M Admin**. Tip: on chatgpt.com choose **Keep in sidebar** on the GPT, so it is always one tap away on the phone.
3. Type or say what you need, for example `Create an invoice for John Smith for £850 decorating labour`.
4. The first time on the phone, ChatGPT may ask you to **Sign in** again: tap it, enter your D&M admin password on the D&M page, and tap **Allow**.
5. Before any change (creating, updating, recording a payment or making a link), ChatGPT asks to **Confirm** the action. Tap **Confirm**. Reading your diary, quotes or invoices needs no confirmation (you can choose **Always allow**).
6. ChatGPT replies with the number, the amount and the customer link. Tap and hold the link to copy or share it with the customer.

Until Mike has done this once on his own iPhone, the iPhone route counts as unverified: the automated checks cover the GPT's schema, sign-in and every action, but cannot sign in to Mike's own ChatGPT account.

### Things to ask

- "Create an invoice for John Smith for £850 decorating labour."
- "Create a quote for Sarah Jones, 4 Mill Lane, Lymm, WA13 9SD: a three-day painting job, £1,500 labour and £200 materials." (If you leave out the customer, ChatGPT asks who it is for.)
- "Show my diary for next week." / "When can I fit in a three-day job?" / "Book Sarah's job for Monday to Wednesday, linked to Q-0041."
- "Mark invoice INV-0012 as paid." / "John paid a £200 deposit by bank transfer today."
- "Find John's invoice and give me the customer link."
- "Change Q-0041: add £60 for the ceiling and send me the new total." / "Mark Q-0041 as sent." / "Sarah accepted Q-0041 — invoice it, due in 7 days."
- "Who owes me money?" / "Show my quotes for Lymm this month."
- "Add a job note to Monday's booking: first coat done, second coat tomorrow."
- "Stop John's link working." / "Delete the test quote."

ChatGPT only uses prices you give it; it never invents prices. It also passes your figures to D&M as a check total, so a quote whose items do not add up to what you said is not saved. VAT follows the setting in D&M admin unless you say otherwise.

### What ChatGPT gives back

Every quote or invoice that ChatGPT creates or changes comes back in the same form, read back from D&M's records after saving: its id, **number** (always the one D&M's database issued), customer, **amount** (including any VAT), status (draft, sent, accepted, part-paid, paid, overdue…) and **customer link**, with `verified: true` once the saved record matched the request. If the read-back does not match (for example, the same document was changed on another device at that moment), ChatGPT is told it is **unverified** and must not report it as done; check it in D&M admin.

Customer links are opened by D&M, the same way a customer opens them, before ChatGPT is given them. Links are stored only as fingerprints, so an existing link cannot be shown again: asking for "the link" makes a new one, and the earlier one stops working. For a document already marked sent or paid, ChatGPT asks you first, because the customer may hold the old link.

### Confirmations

Deleting a quote, invoice or booking, revoking a customer link, and replacing a link for a document already marked sent all happen in two steps. First ChatGPT tells you exactly what will happen; D&M changes nothing yet. Only when you say yes does ChatGPT repeat the request with a one-time confirmation code. That code works only for that action, on that unchanged record, from your connection, for 10 minutes. ChatGPT also shows its own **Confirm** prompt for these actions.

### Disconnecting

- In ChatGPT: open the GPT's editor → the action → remove it, or delete the GPT. (For the Developer-mode app: Settings → Apps → D&M Admin → disconnect.)
- In D&M admin: Settings → ChatGPT → **Disconnect ChatGPT**. This ends ChatGPT's session at once, and signs out every other device except the browser you are using.
- Changing `DM_CHATGPT_SECRET` in Vercel also disconnects ChatGPT.

Mike approves the connection again at least every 90 days.

## Alternative on a computer: the D&M Admin app (Developer mode)

This uses the MCP server at `/api/mcp` with the same tools and sign-in. It has not been reliably available in ChatGPT's mobile apps, so use the GPT above on the iPhone. It needs **Developer mode** for apps (Plus, Pro, Business or Enterprise).

1. Open [chatgpt.com](https://chatgpt.com) → your name → **Settings** → **Apps** (called **Apps & Connectors** on some accounts) → **Advanced settings**, and turn on **Developer mode**.
2. Back in **Apps**, choose **Create app** (or **Add**):
   - **Name:** `D&M Admin`
   - **MCP server URL:** `https://www.dmpaintingdecorating.co.uk/api/mcp`
   - **Authentication:** `OAuth`
   - Tick **I trust this application**, then **Create**.
3. A D&M page opens: **Connect ChatGPT to D&M admin**. Check it lists what ChatGPT may do, enter your D&M admin password and press **Allow**. Untick the delete permission if you would rather delete things yourself in the admin.
4. ChatGPT shows D&M Admin as connected.

To use it, start a chat, press **+**, choose **D&M Admin** (under **More** or **Developer mode** on some accounts), and ask. ChatGPT asks you to approve the first change in each chat. The address is also in D&M admin → **Settings** → **ChatGPT** under "On a computer instead", with a copy button.

## How it works

| Part | Where |
| --- | --- |
| MCP server (Streamable HTTP, stateless) | `app/api/mcp/route.ts` → `lib/chatgpt/mcp.ts` |
| Tools over the existing admin operations | `lib/chatgpt/tools.ts` |
| Storage path (same RPCs as the admin) | `lib/chatgpt/records.ts` |
| OAuth 2.1 server, consent page | `lib/chatgpt/oauth.ts`, `lib/chatgpt/consent-page.ts`, `app/oauth/authorize`, `app/api/oauth/*`, `app/.well-known/*` |
| Token sealing | `lib/chatgpt/seal.ts`, `lib/chatgpt/config.ts` |
| Custom GPT Actions (OpenAPI, the iPhone route) | `app/api/chatgpt/openapi.json`, `app/api/chatgpt/actions/[tool]` → `lib/chatgpt/mcp.ts` |
| Settings → ChatGPT | `components/admin/ChatGptPanel.tsx`, `app/api/admin/chatgpt/route.ts` |

### Records

Every tool reads with `dm_get_data`, applies the same pure operation the admin's own screens use (`lib/admin/operations.ts`), and saves with `dm_save_data` under its revision lock. It then creates and revokes links with `dm_create_share` and `dm_revoke_share`. The database allocates the canonical quote and invoice numbers, as it does for the browser. Customer links are the existing `/d/<token>` pages with the existing quote and invoice templates (`components/documents/QuoteDocument.tsx`, `InvoiceDocument.tsx`), the same templates as the admin preview. Quotes made through ChatGPT are marked "From ChatGPT" in the admin.

After every create, update, payment or booking, the tool reads the records back with a fresh `dm_get_data` and compares the record with what it asked to save: customer, title, every priced line, VAT, deposit, dates, status, payments and links. Only the database-issued number, the invoice's synced quote reference and `updatedAt` may differ. A match is answered with the same `document` summary for every quote and invoice (id, number, customer, amount, status, customer link, `verified: true`); a mismatch is answered as `unverified`, with no customer link, and ChatGPT is told not to report it as done. After a deletion the record must be absent when read back.

A new customer link is opened before ChatGPT receives it, through the same anonymous `dm_get_shared_document` call the customer's page makes, and must show the same document number, type and total. Otherwise the answer reports `customerLinkStatus: "failed"` and no link.

A save only changes what was asked. If another device saved first, the revision check refuses the write, and the tool re-reads and reapplies its change (up to three times). Records outside the change are never rewritten. The admin browser picks up ChatGPT's changes on its next refresh, as it does for another device.

### Retries and duplicates

- A created quote, invoice or booking gets a stable ID derived from the request (customer, job, items and date). If ChatGPT repeats the call, for example after a dropped connection, D&M returns the existing document instead of a second one. The same applies when the save went through but its answer was lost.
- A reworded repeat (same customer and subtotal within 30 minutes) is held back as a possible duplicate. ChatGPT must ask Mike and pass `allowDuplicate` for a genuine second copy.
- Invoicing the same quote twice returns its existing invoice unless Mike asks for another.
- A repeated payment with the same date, amount, method and label is not recorded twice. Payments larger than the balance are refused.
- Updates set values, so repeating one is harmless. Deletions of something already gone report success.
- If a write had no answer and later attempts meet newer saves from another device, ChatGPT is told the change may or may not have been saved and to check first, never that nothing was saved.

Raw customer-link tokens are stored only as hashes, so a link cannot be looked up again. A repeated create returns the existing document and leaves its link working, because Mike may already have sent it. When a new link is needed, `create_customer_link` makes a replacement, and the earlier link stops working. For a document marked sent, it asks Mike to confirm first. ChatGPT is told to mark a document sent when Mike says he has sent it.

### Authority and permissions

- **Sign-in:** the consent page checks Mike's password with Supabase Auth (the same check as `/login`), then requires the confirmed admin account and membership (`verifyAdmin`). Any other result revokes the new session. The page has no scripts, cannot be framed, checks the browser's origin, and can only continue to ChatGPT's own hosts (its `form-action` lists `chatgpt.com`, `chat.openai.com` and `platform.openai.com`, because a GPT's older `chat.openai.com` callback redirects to `chatgpt.com` and browsers check every redirect of the form).
- **Custom GPT client:** the fixed client `dm-custom-gpt` with a secret derived from `DM_CHATGPT_SECRET` (shown only to Mike in Settings → ChatGPT). Its codes can only return to a GPT callback (`/aip/<gpt id>/oauth/callback` on ChatGPT's hosts). The token endpoint accepts the GPT builder's "Default (POST request)" (form or JSON body) and "Basic authorization header" methods.
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
| `create_customer_link` | write | Fresh link, checked to open the document (confirmation needed if the document is marked sent or paid) |
| `revoke_customer_link` | delete | Stop links working (confirmation needed) |
| `check_availability` | read | Free and booked days; earliest runs of free working days |
| `list_bookings` | read | Diary bookings for a period (`next-week`, `this-month`, …) or a date range |
| `create_booking` | write | Book a job, optionally from a quote or invoice; refuses clashes unless agreed |
| `update_booking` | write | Move, change status or details, add a dated job note |
| `delete_quote`, `delete_invoice`, `delete_booking` | delete | Permanent deletion (confirmation needed) |
| `get_business_settings` | read | Today's UK date, VAT default, terms and numbering |

## Verification

- `node scripts/verify-oauth-discovery.mjs` checks the current production HTTP responses without signing in or reading customer records. Set `BASE_URL` to check another deployment. It requires the anonymous MCP POST challenge, public metadata, same-origin OAuth endpoints, advertised S256/public-client/authorization-code support, stateless registration (HTTP 201), and the PKCE consent form (HTTP 200). A GET with `Accept: text/event-stream` may return the same HTTP 401 challenge or HTTP 405 with `Allow: POST` when no SSE stream is offered, as permitted by the [MCP Streamable HTTP specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#listening-for-messages-from-the-server). The PR's route tests additionally require its new GET discovery challenge.
- `npm test` includes `tests/chatgpt/`:
  - OAuth: discovery, the registration allowlist, consent, PKCE, client secrets, single-use codes, refresh, revocation, and token binding and tampering.
  - MCP: protocol behaviour.
  - The Custom GPT route (`custom-gpt.test.ts`): the OpenAPI document against the GPT builder's limits; sign-in through a `chat.openai.com` callback with both token exchange methods; Mike's five example requests as actions; repeats; expired access tokens, refresh, ended sessions, wrong secrets and the 90-day re-approval.
  - Tools against an in-memory Supabase stand-in, including the anonymous customer-link reader. These cover Mike's £518, £850 and £1,700 examples, read-back verification and unverified saves, links that fail to open, database-issued numbering, retries, conflicting and lost saves, incorrect totals, preservation of existing records, confirmations, payments and the diary.
- `tests/live/custom-gpt.spec.ts` is the same for the Custom GPT, on desktop and phone viewports: it imports the OpenAPI document, reads the client secret from Settings → ChatGPT as Mike would, approves on the D&M page with a `chat.openai.com` callback (intercepted; nothing reaches ChatGPT) and checks that the page may continue to `chatgpt.com`, runs Mike's requests as TEST documents, opens the returned link as a customer, then deletes the documents and revokes the connection.
- `tests/live/chatgpt-connection.spec.ts` is the end-to-end test for the Developer-mode app. The official MCP SDK client stands in for ChatGPT and performs the same discovery, registration, PKCE and token steps to ChatGPT's real redirect address. Mike approves in a fresh desktop or phone browser. ChatGPT creates the Paul Finn quote (as a TEST document, so no real number is used), a repeat creates no duplicate, and an anonymous browser opens the customer link and sees £518.00. The test then revokes the link and deletes the quote, each after confirmation. Finally it refreshes and revokes the connection and checks that the endpoint refuses it.
- The secret-free `isolated-workflow` job runs that test and the existing admin workflow. It uses a production build against the real migrations in PostgreSQL behind the Supabase emulator. Afterwards it checks the database: every session revoked, every TEST record removed, everything else unchanged. Locally: `ISOLATED_DATABASE_URL=… npm run test:e2e:isolated` (see `tests/isolated/README.md`).
- The `real-supabase` job runs the same suite against the hosted project when the private `E2E_ADMIN_PASSWORD` secret is configured.
- `tests/e2e/anonymous-boundaries.spec.ts` checks the deployed boundaries without credentials:
  - The MCP endpoint refuses anonymous calls with the OAuth challenge.
  - Only ChatGPT redirects can register.
  - The consent page cannot be framed.

The automated suite cannot sign in to Mike's real ChatGPT account, and its phone checks use Chromium with a phone screen, not Safari on an iPhone. After deployment, the one manual check is to make the GPT as in section 2, then on the iPhone ask for a test quote ("make a test quote for Test Customer, £10 labour") and delete it afterwards. Until that has worked, do not treat the iPhone route as verified.

## Troubleshooting

- **"The ChatGPT connection is not configured"**: this generic response catches both secret-configuration and key-derivation errors; it does not by itself prove the secret is missing or invalid. `DM_CHATGPT_SECRET` needs at least 32 characters and at least 10 distinct characters. Check that the variable belongs to the project serving the domain, is enabled for Production, and that the domain points to a deployment created after the change. Verify only its presence and validation result; never print its value. A fresh discovery probe that completes public registration with HTTP 201 and PKCE consent with HTTP 200 proves that the serving deployment can read, validate and use its runtime secret to seal and verify OAuth state. An older failed workflow records the deployment's earlier state; rerun the production check after redeploying before changing the setting again.
- **"Couldn't discover OAuth settings"**: the public addresses `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/api/mcp` must each return HTTP 200 JSON on `https://www.dmpaintingdecorating.co.uk`. The authorization-server issuer must be `https://www.dmpaintingdecorating.co.uk`, matching the protected-resource document's `authorization_servers`. `/api/mcp` answers an anonymous POST with HTTP 401 and a `WWW-Authenticate` header pointing to its resource metadata, even when its runtime secret is missing or invalid. The updated route also returns this challenge for GET; a deployment without SSE support may instead return HTTP 405 with `Allow: POST`. If metadata returns HTTP 503, investigate that response before interpreting absent PKCE or grant fields. A 503 from registration, approval, token handling or an MCP request presenting credentials requires checking runtime configuration and key derivation.
- **The GPT says "Error talking to www.dmpaintingdecorating.co.uk" or keeps asking to sign in**: check in the GPT editor that the action's Authentication is OAuth with exactly the values in Settings → ChatGPT (with `www`), and that the client secret was copied with the Copy button. If you pressed Disconnect in Settings, or `DM_CHATGPT_SECRET` changed, sign in again; after a secret change also paste the new client secret into the GPT.
- **After Allow, the browser shows an error instead of returning to ChatGPT**: the deployment predates the `form-action` fix for `chat.openai.com` callbacks. Deploy this change, then sign in again.
- **The GPT's import says the schema is invalid**: import from `https://www.dmpaintingdecorating.co.uk/api/chatgpt/openapi.json` (with `www`) after this change is deployed; it answers HTTP 503 only if `DM_CHATGPT_SECRET` is missing.
- **The Developer-mode app cannot connect or keeps asking to sign in**: use the exact address `https://www.dmpaintingdecorating.co.uk/api/mcp` (with `www`). If you pressed Disconnect in Settings or the secret changed, reconnect the app in ChatGPT.
- **"That password was not accepted"**: use the D&M admin password (the one for `/login`), not the ChatGPT password.
- **A customer link stopped working**: a newer link replaced it, or access was revoked. Ask ChatGPT for a new link.

