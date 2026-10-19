# Photos

Admin → **Photos** is a simple photo library for the website. Mike can add photos from his phone or computer, copy a photo's web address in one tap, and rename, recategorise or delete photos.

## Using it (for Mike)

1. Open **Photos** (bottom bar on a phone, top bar on a computer) and tap **Add photos**. On a phone you can take a new photo or choose existing ones; you can pick several at once.
2. Give each photo a short **title**, for example “Hallway repaint in Stockton Heath”. The title becomes the photo's file name, which helps Google.
3. Optionally add a **description for Google**: say what the photo shows, for example “Freshly painted hallway with white woodwork”. Google and screen readers use it.
4. Choose a **category** and tap **Upload**.
5. Tap **Copy URL** under a photo to copy its web address, then paste it wherever the website needs the photo.

Tap the pencil (or the photo) to change its title, description or category, copy the thumbnail address, or delete it. Changing the title keeps the same web address, so pages already using the photo keep working. Only switch on **Also change the web address** if the photo is not on the website yet: the old address stops working.

JPEG, PNG, WebP and HEIC photos are accepted. HEIC (the iPhone format) works from Safari on an iPhone or Mac; other browsers ask for a JPG copy instead.

## What happens to each photo

- The photo is turned the right way up using the camera's orientation.
- All camera metadata is removed, **including the GPS location** of the house where it was taken.
- It is converted to real WebP (never just renamed): a main image at most 1600 px wide (and at most 4800 px tall) and a thumbnail at most 480 px wide. The aspect ratio is kept and small photos are never enlarged.
- The file name is a search-friendly version of the title, such as `hallway-repaint-in-stockton-heath.webp`. A repeated title gets `-2`, `-3` and so on.
- Both files are stored in Supabase Storage. The address is permanent, public and HTTPS, and can be cached by browsers for a year:

  ```
  https://fdctgtncawolrapwwevm.supabase.co/storage/v1/object/public/site-photos/hallway-repaint-in-stockton-heath.webp
  https://fdctgtncawolrapwwevm.supabase.co/storage/v1/object/public/site-photos/thumbs/hallway-repaint-in-stockton-heath.webp
  ```

Use the main address for a photo on a page, and the thumbnail for small previews, for example `<img src="…/thumbs/name.webp" srcset="…/thumbs/name.webp 480w, …/name.webp 1600w" sizes="(min-width: 900px) 50vw, 100vw" alt="description" width="1600" height="1200" loading="lazy">`.

File names are never reused, even after a photo is deleted or its address changes, so a cached copy can never show a different picture. Deleting a photo removes its files from Storage straight away; copies that a visitor's browser (or the Storage CDN, depending on the Supabase plan) already cached can take a while to expire.

## How it works

| Part | Where |
| --- | --- |
| Page and uploader | `app/admin/photos/page.tsx`, `components/admin/PhotoLibrary.tsx` |
| Browser preparation (large photos, HEIC) | `lib/admin/photo-prepare.ts` |
| Shared rules (titles, file names, limits, categories) | `lib/photos.ts` |
| Conversion to WebP | `lib/server/photo-processing.ts` (`sharp`) |
| Storage and metadata calls | `lib/server/photos.ts` |
| API | `app/api/admin/photos/route.ts` (list, upload), `app/api/admin/photos/[id]/route.ts` (change, delete) |
| Bucket, policies, metadata table and functions | `supabase/site-photos.sql` |

Photo files live only in the public `site-photos` bucket. The database holds only metadata (title, description, category, file name, dimensions and sizes) in `public.admin_photos`, and the permanent list of used file names in `private.dm_photo_names`.

Uploads are converted on the server, not in the browser, because iPhone Safari cannot create WebP files itself and because the server must prove the result is WebP. Vercel refuses request bodies over 4.5 MB, so the browser first redraws any photo over 4 MB (and every HEIC photo, which the server's image library cannot decode) as a high-quality JPEG at most 2400 px wide. The browser applies the camera orientation while drawing, and the server's conversion does the rest either way.

## Security

- **No service-role key.** Every Storage and database call uses Mike's own signed-in session, exactly like quotes and invoices. The application holds only the public publishable key; there is no secret key to leak to a browser.
- **Only Mike can write.** Storage policies on `storage.objects` allow reading the bucket's list, uploading, moving and deleting only when `private.dm_is_admin()` is true: Mike's confirmed account, his admin membership and a live, unrevoked Auth session. Anonymous visitors and other accounts (even one claiming Mike's email in its token) are refused. The admin API routes also check the session and the exact browser origin.
- **Only safe files.** Uploaded bytes are identified by their signature, never their name or declared type; only JPEG, PNG, WebP and HEIC/HEIF reach the decoder, so SVG, HTML and other active content are refused. Images over 100 megapixels are refused. Each output is decoded again to check that it really is WebP within the size limits before anything is stored.
- **Only safe names.** File names are generated by the server from the title (`a-z`, `0-9` and hyphens). The policies also refuse any object name that is not `name.webp` or `thumbs/name.webp`.
- **Limits enforced twice.** The bucket itself accepts only `image/webp` files up to 5 MB. The API accepts one photo of at most 4 MB per request; titles are at most 120 characters, descriptions 250, categories come from a fixed list. The database checks the same limits again.
- **No orphans.** If recording a photo fails, its uploaded files are removed again. Deleting removes the public files before the record, so a failure never leaves an unlisted photo online.

## One-off setup (before first use)

Until `supabase/site-photos.sql` is applied, the Photos page says photo storage has not been switched on; the rest of the admin is unaffected. To switch it on:

1. Run the database checks (`.github/workflows/database-checks.yml`), which apply the migration twice to disposable PostgreSQL databases and verify every policy.
2. Apply `supabase/site-photos.sql` once to the existing project `fdctgtncawolrapwwevm`, after `production-admin.sql`, with the authenticated Supabase migration tool (or the SQL editor), using a descriptive name such as `dm_site_photos`. It creates the `site-photos` bucket, its policies, the metadata table and the photo functions. Applying it again is harmless.
3. Record the migration version Supabase returns in `supabase/README.md`, and re-run the security advisors.
4. On the deployed site, upload a test photo titled “TEST photo”, open its copied address in a private browser window on a phone, then delete it.

No environment variables are needed. `sharp` is a regular dependency and runs in Vercel's Node.js functions.

## Checks

- `npm test` covers conversion (orientation, size limits, aspect ratios, transparency, metadata removal, genuine WebP, refused file types), file names, the API routes against a stand-in Supabase (session, origin, Storage headers, clean-up after failures, renaming and deleting) and the "not set up yet" state.
- `tests/db/photos.sql` checks the bucket settings and every policy and function in real PostgreSQL for Mike, anonymous visitors, another account and an expired session.
- `tests/live/photos.spec.ts` runs in the isolated workflow (and any live run) on desktop and mobile Chromium: uploading a sideways phone photo, a transparent PNG and a photo over 4 MB, one-tap copying, anonymous loading of real WebP from the copied URL in a web page, renaming, a new address and deletion. The isolated runner then checks that no test photo or stray file remains and that an existing photo was untouched.
- `tests/e2e/anonymous-boundaries.spec.ts` checks that `/admin/photos` and every photo API refuse anonymous visitors.
