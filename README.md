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

`/admin` holds private Quotes, Invoices and Diary tools. Records are currently stored only in the browser on the device being used, so export backups regularly. See [docs/admin.md](docs/admin.md).
