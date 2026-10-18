# Isolated admin workflow

`npm run test:e2e:isolated` runs the complete authenticated suite in `tests/live` — unchanged — on desktop and mobile Chromium without any real credential and without reaching the hosted Supabase project. It is the first job of the `Live admin verification` workflow and must pass before any live run starts.

`run.mjs`:

1. Creates a fresh `dm_isolated_workflow` database on a loopback PostgreSQL server and applies `auth-schema.sql`, then the real `supabase/base-schema.sql` and `supabase/production-admin.sql`.
2. Seeds a confirmed Mike account (enrolled by the real trigger) and stand-in business records through the real `dm_save_data`: non-test quotes, an invoice with a payment, a linked booking, Mike's own Settings test invoice, and the leftovers of an interrupted automated run.
3. Starts `supabase-emulator.mjs` with a throwaway CA and certificate for the application's pinned hostname. It serves GoTrue's password/refresh-token/user/logout endpoints — including hosted Supabase's 403 `bad_jwt` / `session_not_found` responses, refresh-token rotation and its 10-second reuse interval — and PostgREST's RPC endpoint. Every request runs under the real `anon` or `authenticated` role, grants, RLS and security-definer functions.
4. Builds the application against that hostname, generates a random password and publishable key, and runs `playwright.live.config.ts`.
5. Inspects the database directly afterwards. It fails unless every Auth session was revoked, every automated `TEST <run id>` record (including the stale ones) was removed, and every other record, business setting, number sequence and backup timestamp is exactly as seeded.

Requirements: Node 24, `openssl`, `psql`, a disposable PostgreSQL 15+ server, Chromium for Playwright, and `fdctgtncawolrapwwevm.supabase.co` resolving to `127.0.0.1` (for example via `/etc/hosts`). The runner refuses to start unless the hostname reaches the emulator (checked by a response marker) and the database URL is a loopback address.

```sh
echo "127.0.0.1 fdctgtncawolrapwwevm.supabase.co" | sudo tee -a /etc/hosts
ISOLATED_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres npm run test:e2e:isolated
```

Extra arguments go to Playwright, e.g. `-- --project live-mobile-chromium`. `ISOLATED_SKIP_BUILD=1` reuses a build already made by this runner. Remove the hosts entry afterwards on a workstation.

This verifies application, UI, session and database behaviour end to end. It does not verify the hosted project's actual configuration, Vercel deployment protection or email delivery; the live jobs remain the release gate for those.
