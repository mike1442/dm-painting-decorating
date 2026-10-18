# D&M admin

Three mobile-friendly sections: Quotes, Invoices and Diary. Business settings, import and backup are behind the settings icon. `/admin` opens Quotes; `/login` signs in Mike's confirmed Supabase Auth account.

Records are saved to the existing Supabase project, shared across devices, and protected by RLS and an admin membership check. The header reports cloud save status. Concurrent-device conflicts cannot silently replace newer data; export pending edits before reloading a conflict.

Quotes and invoices retain the existing document templates. Works, materials, optional VAT, payments and balances calculate in whole pence. Numbers are allocated centrally when saved. Accepted quotes convert to independent invoices; bookings link to quotes and invoices. The invoice editor supports recording payments and marking the remaining balance paid.

Create a customer link in the editor or preview after saving. Customers can view and print that document without an admin account. Replacing or revoking a link disables the previous one. Tokens are random, stored only as hashes, and never grant access to other records. Private notes are excluded. Keep test documents marked as tests and never issue them to real customers.

Original `dm-admin:v1` browser records remain untouched. Use Settings → Storage on the original browser to review and import missing records. Cloud records with matching IDs are preserved; business settings require an explicit import choice. Export a backup before importing. Recovery copies protect failed edits but do not replace permanent database storage.

Mike can also create and manage all of this by talking to ChatGPT; see [ChatGPT secretary](chatgpt.md).

See [Production operations](production-admin.md) for required configuration, Mike's account setup, migration, verification and release gates.

## Source and checks

- `lib/admin/operations.ts`: document, payment and booking operations.
- `lib/admin/money.ts`: integer-pence arithmetic.
- `lib/admin/cloud-store.ts`: cloud persistence, revision conflicts and safe imports.
- `lib/server/`: Supabase REST transport, session authorization and API error handling.
- `app/api/admin/`: independently authenticated storage and sharing endpoints.
- `app/d/[token]/`: separate public customer document renderer.
- `lib/chatgpt/`: Mike's private ChatGPT connection (OAuth, MCP and tools over the same operations).
- `supabase/`: database migration and security verification.

Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` and `npm run test:e2e`. The CI workflow also audits runtime dependencies. Live login, cross-device persistence and public/revoked customer links must be verified on the intended deployment before production release.
