# Isolated database checks

The `Database security checks` workflow runs two independent disposable PostgreSQL 17 scenarios. The historical-schema upgrade runs:

```sh
psql -X --set=ON_ERROR_STOP=1 --file=tests/db/bootstrap.sql
psql -X --set=ON_ERROR_STOP=1 --file=supabase/production-admin.sql
psql -X --set=ON_ERROR_STOP=1 --file=tests/db/security.sql
```

Use only a new, empty test database. Bootstrap creates test roles, minimal Supabase Auth tables/functions, the four existing application tables, and historical fixture records. It deliberately gives the old tables permissive grants and policies so the checks prove that the upgrade removes those access paths.

The fresh-application scenario starts without any application tables or users and runs:

```sh
psql -X --set=ON_ERROR_STOP=1 --file=tests/db/auth-fixture.sql
psql -X --set=ON_ERROR_STOP=1 --file=supabase/base-schema.sql
psql -X --set=ON_ERROR_STOP=1 --file=supabase/production-admin.sql
psql -X --set=ON_ERROR_STOP=1 --file=tests/db/fresh-schema.sql
```

Both scenarios then apply the photo library:

```sh
psql -X --set=ON_ERROR_STOP=1 --file=tests/db/storage-fixture.sql
psql -X --set=ON_ERROR_STOP=1 --file=supabase/site-photos.sql   # applied twice in CI
psql -X --set=ON_ERROR_STOP=1 --file=tests/db/photos.sql
```

`storage-fixture.sql` stands in for Supabase's `storage.buckets` and `storage.objects` tables, with the API roles' grants and RLS like hosted Storage. `photos.sql` checks the bucket settings (public, WebP only, 5 MB), that only Mike's live admin session can upload, rename or delete `site-photos` files with server-style names (never other names, other buckets, anonymous callers, another account claiming Mike's email, or an expired session), the photo functions' guards and field limits, and that file names are never reused after renaming or deletion. It does not run the Storage HTTP service; the isolated browser workflow covers that.

The fresh scenario verifies that installation creates no accounts or records, later Auth confirmation enrols only Mike, the first cloud read and save work without prior settings, initial document numbers and diary links persist, and customer links resolve and revoke independently of admin access. It also checks source foreign-key deletion semantics and rejects invalid payloads, kinds and sequence values. `auth-fixture.sql` is only a shared disposable-test fixture; deployed SQL uses Supabase's actual Auth schema and never installs these Auth stubs.

The checks exercise real PostgreSQL permissions, RLS, triggers, transactions and RPCs. They cover administrator authorisation, current account/session revocation, existing records, revision conflicts, permanent number reservations, linked bookings, document isolation, hashed customer tokens and link revocation. Bill Gates fixtures are unissued test documents in the disposable database; no email or payment is sent.

Account/session regressions retain the member or session row while marking the current Auth user soft-deleted or setting `auth.sessions.not_after` to the past. They verify that reads, valid saves and share creation fail, then restore the account or set a future expiry and verify access recovers without advancing the data revision. Expiry exactly at the current time is denied too. These cases exercise the same `deleted_at` and `not_after` checks confirmed in the live project's admin guard.

Auth tables/functions are stubs. Passing these checks does not verify the Supabase HTTP gateway, actual sign-in, cookies, Vercel deployment or customer browser rendering. Those still require the authenticated preview checks in `docs/production-admin.md`. Never point this bootstrap at the connected Supabase project.
