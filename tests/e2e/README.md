Run `npm install`, `npm run build`, `npx playwright install chromium`, then `npm run test:e2e` using Node 24. The suite starts the production build locally. Set `E2E_BASE_URL` to check an existing deployment instead.

These tests run in fresh desktop and mobile browser contexts. They check login layout, protection of all admin sections and APIs, invalid customer links, privacy headers, and rejection of off-origin sign-in requests. They also check that the ChatGPT connection refuses anonymous calls, forged tokens and non-ChatGPT redirect addresses, and that its consent page cannot be framed. The local server gets a throwaway `DM_CHATGPT_SECRET`; against a deployment without one, the checks confirm the connection stays off. They need no Supabase credentials and cannot create or issue an invoice.

A passing result covers anonymous access boundaries. Successful admin sign-in, database persistence across devices, live customer-link viewing and revocation still require separate verification against the configured Supabase project with an authorised admin account.

`billGatesTestInvoice` in `lib/admin/fixtures.ts` provides the requested £1,680 example as a draft with `isTest: true`, no payment details and a `TEST-` number. Calling it does not save, share or issue anything. The unit tests verify the arithmetic and preservation of the test marker through backup/import normalization.
