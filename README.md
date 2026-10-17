# D&M Painting & Decorating

Premium, preparation-led Next.js website. Built with Next.js App Router and TypeScript.

## Start

```bash
npm install
npm run dev
```

## Deploy

Import this GitHub repository into Vercel and use the Next.js preset. No environment variables are needed for the initial static site.

## Before launch

- Replace placeholder stock photographs with genuine D&M project photography.
- Replace `hello@example.com` in `app/page.tsx` with Mike's verified business contact address.
- Confirm service areas, contact details, and business claims.
- Remove `robots: { index: false, follow: false }` from `app/layout.tsx` only when content and contact details are verified.
- Add privacy policy and any legally required business information.

Logo: `public/dm-logo.svg`, a clean animated vector recreation of the approved concept.

## Admin

`/admin` holds private Quotes, Invoices and Diary tools for signed-in D&M admins, saved online in Supabase. See [docs/admin.md](docs/admin.md) and [docs/supabase-integration.md](docs/supabase-integration.md).
