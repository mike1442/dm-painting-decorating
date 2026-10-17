# Production admin operations

The admin uses the existing Supabase project `kqjbgvjgsvbjflumorjr`. It never needs a service-role key. Runtime configuration is `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (or the legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Only a publishable/anon key is accepted.

## Administrator access

Create Mike's account in the existing project's Authentication → Users screen with the exact email `mike@dmpaintingdecorating.co.uk`. Mike must choose the password privately. Confirm the email using the account setup flow or the authenticated Supabase project administrator's user-creation screen. Never commit passwords or send them in chat.

The database migration enrols only this confirmed account. Requests verify the current user with Supabase Auth and then check membership. Cookies are HttpOnly, Secure in production, SameSite=Lax and host-only. Every modifying endpoint checks the exact browser Origin. All private responses disable caching. Logout clears cookies and revokes the current Supabase session.

## Saving and imports

Supabase is the source of truth. The header shows whether edits have reached cloud storage. New document numbers become final when the cloud save succeeds. Concurrent device edits use a revision check; a stale device cannot overwrite newer records. Export pending edits before reloading a conflict.

Old `dm-admin:v1` browser records are never deleted. Open Settings → Storage on the original device, review the import counts and add missing records. Existing cloud records with the same IDs are kept. Business settings are imported only by explicit choice. Download a backup before importing. Optional recovery snapshots stay in the tab's session storage and can be reviewed separately; this is not the main database.

Customer links must be created after a successful save. Each replacement revokes the earlier link. Copy the link immediately; its raw token is not recoverable from the database. Revoke customer access from the editor or preview. Anyone holding the link can read that single document. Customer pages contain no admin navigation, internal notes or unrelated records.

## Verification and release gate

Run `npm ci`, `npm run lint`, `npm test`, `npm run typecheck`, `npm run build` and `npm run test:e2e`. The GitHub Actions workflow repeats these checks, performs a production dependency audit and exercises anonymous boundaries in desktop and mobile Chromium. The initial dependency resolution publishes its lockfile as a workflow artifact; commit that lock before release.

Anonymous boundary tests do not verify the authenticated product. Before merging/releasing, use the real admin account in a protected preview to verify:

1. Login, refresh after token expiry, logout and rejection of a revoked session.
2. Create/edit/delete a quote and invoice; reload and verify on another device.
3. Mark a quote accepted, convert it, link a diary booking and verify all records survive reload.
4. Record a partial payment and mark the remaining balance paid; check optional VAT.
5. Import a backup safely and check original browser records remain intact.
6. Create the Bill Gates draft test fixture from `lib/admin/fixtures.ts`: two painters at 3 × £250 plus £180 materials = £1,680 before optional VAT. Keep `isTest: true`; never mark this as issued or send it to a real customer.
7. Open its customer link in a fresh browser context with no admin cookies; check the test banner, prices, no private notes and no admin access. Alter the token, replace it and revoke it; old links must fail.
8. Repeat the working flows at a mobile viewport, including document printing.

The existing Vercel project is `prj_h5DgOMKZ3o6C0ukKRpZ5lNbG5Ovi`. Verify its Git source is `mike1442/dm-painting-decorating`; previous deployments refer to an older owner. Keep preview protection while testing. After all security/functional checks pass, ensure the intended production customer-serving domain permits anonymous document access. Application auth continues to protect `/admin` and `/api/admin` independently of Vercel protection. Deploy/promote only the reviewed commit, then repeat the production smoke checks. Do not claim production is ready until this gate passes.
