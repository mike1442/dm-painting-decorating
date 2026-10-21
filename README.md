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

Mike creates invoices by asking his ordinary ChatGPT, through ChatGPT's existing Supabase connection. ChatGPT runs one SQL statement that calls a narrow database entrypoint (`supabase/chatgpt-invoices.sql`), which uses the admin's own numbering, templates and customer links, checks the link and returns the genuine customer link. See [docs/chatgpt-invoices.md](docs/chatgpt-invoices.md) for setup, the instructions to give ChatGPT and the security model.

Mike prepares quotations from ChatGPT on his phone with **Quick quote**: ChatGPT replies with a link that fills in Admin → Quick quote, and Mike checks it and saves a draft. Nothing is sent to the customer. See [docs/chatgpt-quotes.md](docs/chatgpt-quotes.md).

The earlier Custom GPT and Developer-mode connection ([docs/chatgpt.md](docs/chatgpt.md)) is abandoned; do not set it up.

