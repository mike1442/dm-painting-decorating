These are real workflow tests against the existing Supabase project `kqjbgvjgsvbjflumorjr`. They do not mock sign-in or persistence. They are outside the anonymous suite's test directory and cannot run through `npm run test:e2e`.

Prerequisites:

- Mike must activate and confirm his Supabase Auth account for `mike@dmpaintingdecorating.co.uk` and choose his own password privately. An absent or unconfirmed account is a blocker; this suite does not generate credentials.
- The application must use that existing project's URL and public publishable/anon key. Never provide a service-role key.
- For GitHub Actions, add Mike's privately supplied password as the repository Actions secret `E2E_ADMIN_PASSWORD`. The separate live verification job checks this prerequisite before launching any browser; a missing secret is reported as blocked. Never paste it in a PR, workflow input, command line, issue or test output.
- For a local run, inject `E2E_ADMIN_PASSWORD` through your password manager or a private shell prompt; do not put its literal value in shell history. Install the lockfile dependencies with Node 24 and install Chromium using Playwright.
- Use a local production build connected to the existing Supabase project, or the exact PR #6 preview origin `https://dm-painting-decorating-git-fix-production-admin-mike-b7b4.vercel.app`. Production URLs and other Vercel projects are refused. Do not change preview or production protection settings to run these tests.
- A protected preview may additionally need a short-lived, correctly scoped `E2E_VERCEL_TRUSTED_OIDC_TOKEN` injected privately. It is attached only to requests for the exact approved preview origin; redirects never forward it. A connection authorised only for another Vercel account cannot grant access to Mike's preview.

For a local build, provide the public Supabase configuration through the existing environment mechanism and run `npm run build`. With the private password already injected, run:

```sh
E2E_RUN_LIVE=1 E2E_BASE_URL=http://localhost:3000 \
  ./node_modules/.bin/playwright test --config playwright.live.config.ts
```

For the approved preview, change only `E2E_BASE_URL` to that exact origin. The configuration exits with an explicit error before launching a browser if opt-in, the private password or the approved target is missing. A passing anonymous suite is not a substitute for this run.

For loopback targets the config starts the built application automatically on port 3000. An existing server may be reused locally; CI always starts its own server. Preview targets use the deployed application and never start a local server.

The suite runs serially on desktop Chromium and Pixel 7. Each project independently verifies:

- Real UI sign-in; HttpOnly, Secure, SameSite cookies; reload persistence; refreshing a session after removing its expired access cookie; logout; and rejection of replayed logged-out cookies.
- Clearly labelled `TEST-`/`isTest: true` drafts, including Bill Gates's 20m² wall with two painters at 3 × £250 and £180 materials, totalling £1,680 before VAT. Customer details have no real delivery address. Nothing is issued, emailed or sent to a customer.
- UI edits, VAT calculation, marking the test invoice paid, and successful cloud API responses.
- Independent login in a second browser with the other viewport; quotes, invoices and linked diary bookings appearing and saving across the two browsers.
- UI conversion of an accepted test quotation into another draft test invoice without consuming issued invoice numbers or adding bank details.
- Actual invoice and quote views in separate unauthenticated browser contexts; no admin cookies, other customer documents or private notes; blocked admin APIs; unguessable tokens; old links failing after replacement; revoked links returning 404.
- Mobile and desktop document/editor/diary layouts without horizontal overflow, and deletion through the UI.

Stop other edits during a live run. API fixture writes preserve all current unrelated records and settings and use the latest revision. Conflicting saves fail instead of overwriting newer data. Cleanup removes only record IDs created by this run; it never restores an old complete snapshot. Remaining conversions are deleted and independent Supabase sessions are revoked. If connectivity or authentication fails during cleanup, identify the remaining `TEST <run id>` drafts in the admin before another run. Permanent number reservations may remain for these unique `TEST-` identifiers, as designed; normal issued quote/invoice counters are unchanged.

Traces, screenshots and video are disabled because they can contain passwords, session cookies and private customer URLs. Do not enable debug logging, HAR/network recording, trace collection, or upload browser state for this suite. Retain only the pass/fail stage summary. Do not upload `test-results/live` or generic live-job test artifacts: Playwright may still generate automatic error-context DOM snapshots on failure, which can contain existing customer names or generated customer links. Delete local live test output after checking a failure privately.

These tests do not verify public enquiry email delivery or photo attachments; those require their own live Resend/form checks. A deployment is not ready to merge until both the complete authenticated suite and the enquiry workflow pass against the reviewed code.
