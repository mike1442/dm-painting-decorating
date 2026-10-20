# D&M Painting & Decorating

Premium, preparation-led Next.js website. Built with Next.js App Router and TypeScript.

## Start

```bash
npm ci
npm run dev
```

## Deploy

Use the existing Vercel project and Supabase project. Configure the public API URL/key from `.env.example`; no service-role key is needed. See [production operations](docs/production-admin.md) for the account, migration and release checks.

## Before launch

- Replace placeholder stock photographs with genuine D&M project photography.
- Replace `hello@example.com` in `app/page.tsx` with Mike's verified business contact address.
- Confirm service areas, contact details, and business claims.
- Remove `robots: { index: false, follow: false }` from `app/layout.tsx` only when content and contact details are verified.
- Add privacy policy and any legally required business information.

Logo: `public/dm-logo.svg`, a clean animated vector recreation of the approved concept.

## Admin

`/admin` holds private Quotes, Invoices and Diary tools. Records use authenticated Supabase storage, with safe imports for existing browser records, revision conflict protection and revocable customer links. See [docs/admin.md](docs/admin.md).

## ChatGPT

Mike can run quotes, invoices and the diary by talking to his own ChatGPT, including in ChatGPT's iPhone app, through a private, OAuth-protected connection on the same backend: a Custom GPT with Actions (`/api/chatgpt/openapi.json`, recommended) or the Developer-mode app (`/api/mcp`). Every saved quote or invoice is read back and its customer link opened before ChatGPT reports it. Switch it on by adding `DM_CHATGPT_SECRET` in Vercel. See [docs/chatgpt.md](docs/chatgpt.md) for setup, Mike's connection steps and the security model.

