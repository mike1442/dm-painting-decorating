# Explicitly authorised database move

The user chose the existing `mike1442's Project` as the D&M backend after confirming that it is a different database from the original. This is a copy into a user-created destination, not an organisation ownership transfer or a newly provisioned backend.

| | Original, retained | Selected destination |
| --- | --- | --- |
| Project reference | `kqjbgvjgsvbjflumorjr` | `fdctgtncawolrapwwevm` |
| Organisation | `D&B Painting&Decorating` | `D@M painting` |
| Region | `eu-west-2` | `eu-west-1` |
| Initial application state | Hardened schema; no cloud documents/settings/sequences/members/Auth users | No application tables, migrations, edge functions or Auth users |

1. Recheck the source's counts, including private number reservations and shares. If records appeared, stop and prepare a record-preserving import before switching the application; do not silently omit them.
2. Verify the exact destination through its authorised account. Run both PostgreSQL CI scenarios, then apply `supabase/base-schema.sql` followed by `supabase/production-admin.sql`. The base script refuses any existing application table. Never apply the disposable Auth test fixtures to Supabase.
3. Record the actual migration versions. Verify default-deny tables, guarded functions, unknown customer-token denial, and matching empty-source counts. Do not create Auth users, passwords or real invoices as migration fixtures.
4. Create and confirm Mike's application Auth account privately in the destination. Membership is granted only to confirmed `mike@dmpaintingdecorating.co.uk`. Dashboard accounts are separate from application accounts.
5. Configure only the reviewed preview for the destination URL and public key. A branch-specific Preview override for `fix/production-admin` avoids changing production or other branches. The old project's key must not be used with the new URL. No service-role key is accepted.
6. Run the real login/session/logout, cross-browser quote/invoice/diary, test invoice and unauthenticated customer-link checks. Original browser-only records remain on their original device and use the reviewed Settings import flow; never clear them during the move.
7. Confirm actual enquiry/photo delivery with the configured sender, then complete the release gate in `docs/production-admin.md`. Production configuration and deployment stay unchanged until verification passes. PR #6 remains draft until the complete workflow is verified.

The original project is retained throughout. There is no automatic cleanup that deletes its schema, records or account. A source backup or a source file is not a substitute for verifying the destination and real application flow.
