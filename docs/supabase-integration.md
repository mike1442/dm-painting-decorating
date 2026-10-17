# D&M Supabase integration — implementation contract

Project: `kqjbgvjgsvbjflumorjr` (London). Existing PR #2 is merged into main. Preserve the existing admin UI, document templates, public pages, and calculations.

## Current database (already provisioned)

- `public.admin_members(user_id uuid PK -> auth.users)`
- `public.admin_documents(id uuid PK, owner_id uuid, kind quote|invoice|booking, document_number text nullable, payload jsonb, created_at, updated_at)`
- `public.admin_settings(owner_id uuid PK, payload jsonb, updated_at)`
- `public.admin_sequences(owner_id uuid, kind quote|invoice, next_number int)`

All four have RLS enabled; documents/settings restricted to an authenticated `owner_id` who appears in `admin_members`. Anonymous role has no access. **No admin member has been provisioned yet**: create Mike's Supabase Auth user and explicitly insert his user UUID into `admin_members` after verifying identity. Never auto-promote new signups, use user_metadata for permissions, or expose a service-role key to browser.

## Code integration tasks

1. Install pinned `@supabase/supabase-js` and `@supabase/ssr` versions, commit lockfile; configure client with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
2. Add real login and logout using Supabase Auth; protect `/admin/**` server-side and fail closed when env/auth is absent. Replace `lib/admin/auth.ts` device-only allowance. Restrict to `admin_members`; do not rely on hiding navigation or noindex.
3. Adapt `lib/admin/store.ts` to fetch/save existing `AdminData` from `admin_documents` and `admin_settings`. Preserve `lib/admin/types.ts` and pure `operations.ts`; store each quote/invoice/booking as a JSONB payload and map `id`, `kind`, `number`, `createdAt`, `updatedAt`. Ensure edits/deletes persist; implement loading/error/conflict handling, never claim saved before server confirmation.
4. Number allocation must be atomic across devices. Add a restricted RPC or equivalent server-side transaction to increment `admin_sequences` for an authenticated, authorised member; keep uniqueness. Do not simply increment local settings.
5. Handle migration of existing browser-only data with a **reviewable import** and backup. Never overwrite remote records silently. Maintain export and import compatibility.
6. Make diary, quote→invoice, links and payments work across sessions/devices. Keep all public pages and document PDFs visually unchanged.
7. Tests: unauthenticated access blocked; non-member blocked; RLS cross-user denied; CRUD, duplicate numbering, multi-device updates, import and backups. Run typecheck, tests, build and preview before merge.

## Configuration

Vercel URL variable `NEXT_PUBLIC_SUPABASE_URL` has been set for development/preview/production. The publishable key has **not** been set successfully yet; configure it securely in Vercel. No service-role key is needed for the client.

## Release gate

Do not merge/deploy as fully live until Mike's Auth account is provisioned, RLS is verified with authenticated/unauthenticated sessions, and real browser E2E tests pass. The current main admin remains device-local until integration is complete.
