# Production admin operations

The admin targets the user-selected existing Supabase project `fdctgtncawolrapwwevm` (`mike1442's Project`). The user explicitly authorised copying the existing setup into this project after the original project's dashboard account was inaccessible. The original project `kqjbgvjgsvbjflumorjr` is retained unchanged during preparation and verification. The project URL and its public publishable key are part of the application (`lib/server/supabase.ts`), so a deployment needs no Supabase environment variables, and variables left for another project are ignored. Publishable keys are public by design; Auth, RLS and the guarded functions protect every record. The server-only `SUPABASE_PUBLISHABLE_KEY` may override the key, for example after a key rotation; it accepts only a publishable/anon key and rejects service-role or secret keys.

## Administrator access

Create Mike's account in the existing project's Authentication → Users screen with the exact email `mike@dmpaintingdecorating.co.uk`. Mike must choose the password privately. Confirm the email using the account setup flow or the authenticated Supabase project administrator's user-creation screen. Never commit passwords or send them in chat.

Create the account in the selected destination's [Authentication → Users](https://supabase.com/dashboard/project/fdctgtncawolrapwwevm/auth/users) screen. It belongs to the organisation named `D@M painting`. The original source belongs to `D&B Painting&Decorating`; application Auth users and dashboard organisation membership are separate. No Auth users or passwords were fabricated or copied. Existing browser records still require the reviewed import flow on their original device.

The database migration enrols only this confirmed account. Requests verify the current user with Supabase Auth and then check membership. Cookies are HttpOnly, Secure in production, SameSite=Lax and host-only. Every modifying endpoint checks the exact browser Origin. All private responses disable caching. Logout clears cookies and revokes the current Supabase session.

## Saving and imports

Supabase is the source of truth. The header shows whether edits have reached cloud storage. New document numbers become final when the cloud save succeeds. Concurrent device edits use a revision check; a stale device cannot overwrite newer records. Export pending edits before reloading a conflict.

Old `dm-admin:v1` browser records are never deleted. Open Settings → Storage on the original device, review the import counts and add missing records. Existing cloud records with the same IDs are kept. Business settings are imported only by explicit choice. Download a backup before importing. Optional recovery snapshots stay in the tab's session storage and can be reviewed separately; this is not the main database.

Customer links must be created after a successful save. Each replacement revokes the earlier link. Copy the link immediately; its raw token is not recoverable from the database. Revoke customer access from the editor or preview. Anyone holding the link can read that single document. Customer pages contain no admin navigation, internal notes or unrelated records.

## Verification and release gate

Run `npm ci`, `npm run lint`, `npm test`, `npm run typecheck`, `npm run build` and `npm run test:e2e`. The GitHub Actions workflow repeats these checks, performs a production dependency audit and exercises anonymous boundaries in desktop and mobile Chromium. Install from the committed lockfile; dependency changes must update it and pass the same checks before release.

Anonymous boundary tests do not verify the authenticated product. The `Live admin verification` workflow does (below): it runs the complete admin workflow with the real admin account against the existing Supabase project, on desktop and mobile. After a release, Mike can repeat the same flows on the live site as a smoke check:

1. Login, refresh after token expiry, logout and rejection of a revoked session.
2. Create/edit/delete a quote and invoice; reload and verify on another device.
3. Mark a quote accepted, convert it, link a diary booking and verify all records survive reload.
4. Record a partial payment and mark the remaining balance paid; check optional VAT.
5. Import a backup safely and check original browser records remain intact.
6. Create the Bill Gates draft test fixture from `lib/admin/fixtures.ts`: two painters at 3 × £250 plus £180 materials = £1,680 before optional VAT. Keep `isTest: true`; never mark this as issued or send it to a real customer.
7. Open its customer link in a fresh browser context with no admin cookies; check the test banner, prices, no private notes and no admin access. Alter the token, replace it and revoke it; old links must fail.
8. Repeat the working flows at a mobile viewport, including document printing.

The existing Vercel project is `prj_FAr18fyWJQrhwDHrwze92Do72Y7C` in team `mike-b7b4` (`team_fcTzRwLKJ4ZpFYM7pPUnob3T`). Its Git source is `mike1442/dm-painting-decorating`, and merges to `main` deploy to production. Deployment protection stays as configured; no check depends on reaching a protected deployment. The production customer-serving domain must allow anonymous access so customer links (`/d/…`) open. Application auth protects `/admin` and `/api/admin` independently of Vercel protection.

## Private live verification credential

The separate `Live admin verification` workflow runs only for PR #6 on `fix/production-admin`, or a manual run of that same branch, and serializes all runs against this database. It fails with a clear blocker until Mike's confirmed account exists and the repository Actions secret `E2E_ADMIN_PASSWORD` is configured. The password must be chosen by Mike and entered privately in GitHub → mike1442/dm-painting-decorating → Settings → Secrets and variables → Actions → New repository secret. Never put its value in chat, source, workflow inputs or command arguments. The workflow exposes the credential only to its credential check, direct Auth preflight and real test steps, not dependency installation or build. Remove the temporary test secret after verification.

Before any live job, the secret-free `isolated-workflow` job runs the complete desktop/mobile suite against a disposable PostgreSQL database with the real migrations behind an emulated Supabase gateway, and then checks in the database that every session was revoked and every test record removed (`tests/isolated/README.md`). The live job directly checks Supabase login, confirmed admin membership and revocation of its own preflight session. This isolates invalid private credentials from browser/application failures without logging passwords, response bodies or tokens. It then starts a loopback production build connected to the existing Supabase project and runs the desktop/mobile suite in `tests/live`, whose worker fixtures remove the run's test records and revoke its sessions even when a step fails or times out. These checks do not prove Resend inbox delivery (see `docs/contact-verification.md`).
