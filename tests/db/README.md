# Isolated database checks

The `Database security checks` workflow starts disposable PostgreSQL 17 and runs:

```sh
psql -X --set=ON_ERROR_STOP=1 --file=tests/db/bootstrap.sql
psql -X --set=ON_ERROR_STOP=1 --file=supabase/production-admin.sql
psql -X --set=ON_ERROR_STOP=1 --file=tests/db/security.sql
```

Use only a new, empty test database. Bootstrap creates test roles, minimal Supabase Auth tables/functions, the four existing application tables, and historical fixture records. It deliberately gives the old tables permissive grants and policies so the checks prove that the upgrade removes those access paths.

The checks exercise real PostgreSQL permissions, RLS, triggers, transactions and RPCs. They cover administrator authorisation, current account/session revocation, existing records, revision conflicts, permanent number reservations, linked bookings, document isolation, hashed customer tokens and link revocation. Bill Gates fixtures are unissued test documents in the disposable database; no email or payment is sent.

Auth tables/functions are stubs. Passing these checks does not verify the Supabase HTTP gateway, actual sign-in, cookies, Vercel deployment or customer browser rendering. Those still require the authenticated preview checks in `docs/production-admin.md`. Never point this bootstrap at the connected Supabase project.
