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

---

# Implementation status (PR #3)

Everything in the contract above is implemented in code and tested against a local Supabase stack (same Auth, PostgREST and Postgres versions as the hosted project) with a replica of the tables described above. **Nothing has been applied to the hosted project.** The hosted project still needs the steps in "Configuration still needed" before the admin can be used.

| Contract item | Where | Status |
| --- | --- | --- |
| 1. Pinned `@supabase/supabase-js` 2.117.2 and `@supabase/ssr` 0.12.7, lockfile committed | `package.json`, `package-lock.json`, `lib/supabase/` | Done |
| 2. Login, logout, password reset; `/admin/**` protected server-side, fail closed, members only | `middleware.ts`, `lib/admin/auth.ts`, `lib/admin/session.ts`, `app/admin/login`, `app/admin/password`, `app/admin/auth/confirm` | Done |
| 3. Store reads and writes `admin_documents` / `admin_settings`; loading, saving, error and conflict handling; never claims saved before the server confirms | `lib/admin/sync.ts`, `lib/admin/supabase-repository.ts`, `lib/admin/store.ts`, `lib/admin/remote.ts` | Done |
| 4. Atomic, unique numbering via a restricted RPC | `dm_admin_allocate_number` in the migration, plus a unique index | Done; needs the migration applied |
| 5. Reviewable import of browser-only data, with backups; never overwrites silently | `lib/admin/importer.ts`, `lib/admin/legacy.ts`, `components/admin/ImportReview.tsx` | Done |
| 6. Diary, quote→invoice, links and payments across devices; public pages and PDFs unchanged | Same data model; `components/documents/` untouched | Done |
| 7. Tests | See "Tests" below | Done locally; hosted checks listed in the release gate |

## How the app uses the tables

- `admin_documents`: one row per quote, invoice or booking. `payload` is the whole record as JSON (the same shape as `lib/admin/types.ts` and the JSON backups). `id` is the record's UUID, `kind` is `quote`/`invoice`/`booking`, `document_number` mirrors the quote/invoice number (null for bookings), and `created_at` keeps the record's creation time.
- `admin_settings`: one row per owner. `payload` is `{ "schemaVersion": 1, "settings": { …business settings… }, "meta": { "lastBackupAt": … } }`.
- `admin_sequences`: changed only through `dm_admin_allocate_number`.
- `updated_at` is the version. Every save is `update … where id = $1 and updated_at = <version this device last saw>`. If another device saved in between, nothing is updated and the app asks which version to keep.
- Customers and payments are stored on each quote and invoice (as in PR #2), so they move with those records.

## Configuration still needed (for ChatGPT)

### 1. Apply the SQL

Run the whole of [`supabase/migrations/20261017170000_dm_admin_sync.sql`](../supabase/migrations/20261017170000_dm_admin_sync.sql) once in the SQL editor. It is idempotent (safe to re-run) and drops no tables or data. It adds:

- `dm_admin_is_member()`, used by the sign-in gate.
- `dm_admin_allocate_number(kind, min)` and `dm_admin_sequence_state()`, for atomic numbering.
- A trigger that makes `updated_at` server-owned. It also keeps `owner_id`, `kind` and `created_at` unchanged on update.
- A unique index on `(owner_id, kind, document_number)`.
- Reference RLS policies (member and owner only).
- Revoked anonymous access, and no direct writes to `admin_members` or `admin_sequences` from the app.

It works whether `kind` is `text` or an enum.

Then run [`supabase/tests/admin_security.sql`](../supabase/tests/admin_security.sql). It runs in a transaction that is rolled back, so it leaves nothing behind. It must end with `ALL D&M ADMIN SECURITY CHECKS PASSED`; any `FAIL:` line names the problem. It also fails if any policy on these tables allows every row (`using (true)`) or applies to `anon`/`public`. If that happens, drop the older policy, because Postgres combines permissive policies with OR.

To review the result:

```sql
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename like 'admin_%'
order by tablename, policyname;
```

### 2. Supabase Auth settings

- **Authentication → Sign In / Providers → Email:** turn off **Allow new users to sign up**. The app has no sign-up, and membership is never automatic. Keep email/password enabled.
- **Minimum password length:** 10 or more. Enable leaked-password protection if the plan allows it.
- **Authentication → URL Configuration:**
  - Site URL: `https://www.dmpaintingdecorating.co.uk`
  - Redirect URLs:
    - `https://www.dmpaintingdecorating.co.uk/admin/auth/confirm`
    - `https://dmpaintingdecorating.co.uk/admin/auth/confirm` (if the bare domain is used)
    - For Vercel previews: `https://*-paulthetiler-9580s-projects.vercel.app/admin/auth/confirm`
- **Emails (password reset):** Supabase's built-in email service only delivers to the project's team members and is heavily rate-limited. For Mike to receive reset emails, configure **Authentication → Emails → SMTP** with the site's existing Resend account (host `smtp.resend.com`, port 465, user `resend`, password = a Resend API key, sender e.g. `admin@dmpaintingdecorating.co.uk` on the verified domain). The default "Reset password" template works as it is.

### 3. Provision Mike (after verifying his identity)

1. **Authentication → Users → Add user → Create new user:** Mike's email, a strong temporary password, **Auto Confirm User** ticked.
2. Copy his user UUID and grant membership explicitly:

   ```sql
   insert into public.admin_members (user_id)
   values ('<MIKE_USER_UUID>')
   on conflict do nothing;

   -- check
   select u.email, m.user_id is not null as is_admin
   from auth.users u left join public.admin_members m on m.user_id = u.id
   order by u.created_at;
   ```

3. Give Mike the temporary password through a separate channel. He can change it in **Settings → Account → Change password** after signing in.

Never grant membership from `user_metadata`, a trigger on sign-up, or any client code.

### 4. Vercel environment variables

| Variable | Value | Environments |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://kqjbgvjgsvbjflumorjr.supabase.co` | Already set |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The project's **publishable** key (`sb_publishable_…`, Project Settings → API Keys) | Production, Preview and Development |

- Both are public by design: security comes from Auth and RLS. The app refuses to start the admin if a `sb_secret_…` or `service_role` key is put here. Never add a secret/service-role key to Vercel for this app; it is not needed.
- `NEXT_PUBLIC_*` values are built into the JavaScript, so **redeploy after setting them**.
- Without them the public site works normally and `/admin` stays closed ("not connected to its sign-in service").

## Tests

| Suite | Command | Covers |
| --- | --- | --- |
| Unit (no network) | `npm test` | Calculations; sync engine CRUD; never "saved" before confirmed; offline retry; lost replies; conflicts (keep mine / use theirs / deleted elsewhere); multi-device refresh; duplicate numbers; concurrent numbering; settings merge; import planning; access rules |
| Database | `supabase/tests/admin_security.sql` | Anonymous denied; signed-in non-member denied; members isolated from each other; versioned updates; owner can't be changed; unique numbers; atomic, never-backwards numbering; no blanket policies |
| Integration | `npm run test:integration` with `SUPABASE_TEST_URL`, `SUPABASE_TEST_PUBLISHABLE_KEY` and `SUPABASE_TEST_SECRET_KEY` for a **local** stack (`supabase start`) | The real Supabase client against real RLS: anonymous, non-member and cross-member denial; CRUD; versions; two-device conflict; concurrent numbering; signed-out detection. It creates and deletes its own users, so never point it at production |

Also run locally against Supabase CLI 2.121 (Postgres 17, Auth, PostgREST, Mailpit), a replica of the documented tables plus this migration, and a production build:

- **Browser end-to-end:** two browser contexts (phone 390px, desktop 1440px). 40 checks:
  - sign-in refused for a wrong password and for a non-member;
  - reviewed import of real PR #2 browser data;
  - server numbering continuing after the import;
  - phone ↔ desktop updates;
  - conflicts resolved both ways;
  - duplicate-number refusal;
  - quote → invoice → payment;
  - diary booking;
  - offline edit saved on reconnect;
  - preview/PDF;
  - export;
  - sign-out;
  - password reset by email.
- **PR #2 workflow regression:** 59 checks on calculations, VAT, deposits, editing, preview/PDF, conversion, diary, ChatGPT import and backup, signed in against the database.
- **Concurrency:** 60 simultaneous allocations from separate database connections gave 60 unique, gap-free numbers.

## Release gate (unchanged, now concrete)

Do not merge or treat as live until all of these are true:

1. The migration is applied and `admin_security.sql` passes on the hosted project.
2. Auth settings are configured: sign-ups off, redirect URLs, SMTP for resets.
3. Mike's account is created and added to `admin_members`.
4. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is set in Vercel and a preview is redeployed.
5. On that preview, signed out, `/admin` redirects to sign-in and `/api/admin/x` returns 401. A non-member account is refused.
6. Mike signs in on his phone and his computer: a quote created on one appears on the other, and the PDF matches PR #2.
7. If Mike used the device-only admin on production, he imports those records from that same browser (Settings → Records saved only in this browser → Review and import) after this is deployed to the same domain.
