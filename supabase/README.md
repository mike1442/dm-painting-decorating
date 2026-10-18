# Supabase database setup and authorised move

The active application destination is the user's existing **fdctgtncawolrapwwevm** project (`mike1442's Project`) in `eu-west-1`, organisation `D@M painting`. The user explicitly selected this destination and authorised copying the previous setup into it. This work creates no Supabase project. The original **kqjbgvjgsvbjflumorjr** project in London, organisation `D&B Painting&Decorating`, remains intact during the move and verification.

Destination inspection found PostgreSQL 17, the required real Supabase Auth columns/roles, and no application tables, migrations, edge functions or Auth users. Install only the reviewed application schema below. Keep preview configuration separate from production until the full workflow passes. See [the move checklist](../docs/backend-move.md).

Original source migration history inspected:

| Version | Name |
| --- | --- |
| `20261017160110` | `dm_admin_initial_secure_storage` |
| `20261017170243` | `dm_admin_sync_rpc_and_security` |
| `20261017170251` | `dm_admin_documents_uuid_default` |

The original migration SQL was not available locally. These versions are recorded as observed history, not recreated migration files. Initial security advisors flagged three existing authenticated-callable public `SECURITY DEFINER` functions: `dm_admin_allocate_number`, `dm_admin_is_member`, and `dm_admin_sequence_state`.

## Applying the reviewed upgrade

`production-admin.sql` is migration **source** for the existing schema. The Supabase CLI was unavailable in the authoring environment, so no CLI-generated migration filename is claimed. Run the database checks against the source, review the SQL, and then apply it to the existing project with the authenticated Supabase `apply_migration` tool using a descriptive name such as `dm_admin_production_persistence_and_sharing`. Record the actual tool-returned migration version and rerun security advisors and API checks after application. The presence of this source file does not mean it has been applied remotely.

The upgrade is transactional and keeps existing payload IDs through a separate `external_id` column. Existing unique document numbers are preserved; collisions receive a database-allocated number. Number reservations survive document deletion. A revision check and owner-row lock prevent a stale browser from overwriting newer device changes. Legacy browser records are imported through the application's review/import flow; the SQL does not read or erase browser storage.

The application calls `dm_admin_is_member`, `dm_get_data`, `dm_save_data`, `dm_create_share`, and `dm_revoke_share` as the signed-in user. Direct table access is revoked. Public RPC wrappers run as the caller; guarded implementations live in the unexposed `private` schema. Every admin operation requires the exact current confirmed Mike email, membership, and a live matching Auth session. The enrolment trigger allows Mike's confirmed account to be provisioned after this migration without opening admin access to other users.

Customer access uses only `dm_get_shared_document`. Each share has a cryptographically random 32-byte token; only its SHA-256 hash is stored. Creating a new link rotates and invalidates the previous link. Revocation and document deletion invalidate links immediately. The resolver projects the current document and public business fields from explicit allowlists, so subsequent payment updates appear without exposing admin records, notes, IDs, defaults, or other customers. Test invoices omit bank details.

## Auth and deployment configuration

Mike must have a confirmed Supabase Auth account at `mike@dmpaintingdecorating.co.uk`; no account or password is fabricated by this migration. The initial audit found no account for Mike. Provision or invite the user through Supabase Auth, configure the production site URL and permitted redirects, and complete email verification/password setup. Passwords and service-role keys must never be committed or put in browser configuration.

Configure the reviewed preview in the existing Vercel project with `NEXT_PUBLIC_SUPABASE_URL=https://fdctgtncawolrapwwevm.supabase.co` and the destination's public API key. Key selection prefers `SUPABASE_PUBLISHABLE_KEY`, then `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, then the legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Do not reuse the old project's key. No service-role key is required or accepted. Configure the Auth provider's email delivery before relying on invitations or password recovery. Production rollout must wait for database checks, application checks, a successful build, and real authenticated functional verification.

## Preparing an explicitly authorized existing destination

`base-schema.sql` reconstructs only the four application tables from read-only source metadata. It references the selected existing Supabase project's real `auth.users`, reproduces the source defaults/checks/unique document numbers/`ON DELETE CASCADE` foreign keys, enables RLS, and revokes direct browser access before committing. It creates no project, backend, Auth schema, role, Auth account, customer record, or sample invoice. It deliberately stops without changing anything if any of the four application tables already exist; inspect that destination rather than treating an existing database as empty.

For a separately authorized, verified existing destination with no application tables, the reviewed application order is **base-schema.sql**, then **production-admin.sql**. These are source files, not fabricated CLI migration-history entries. The existing-source upgrade skips the base script entirely. Run both PostgreSQL CI scenarios before applying either script to a destination. Each script is transactional; do not add an automatic down migration that drops tables after customer records exist.

The original project's schema and records must remain intact. The source audit reported zero documents, settings, sequences, admin memberships and Auth users, so there were no cloud business records to copy at that time. Recheck counts before applying the destination setup; the source may receive later records. Browser-only records are separate and continue to use the existing reviewed import flow. Each schema application must record the actual migration version returned by Supabase and verify the destination afterwards. Source files alone do not prove remote application or a successful deployment.

## Applied upgrade evidence

The reviewed upgrade was applied to the original source project as migration `20261017233851_dm_admin_production_persistence_and_sharing`. Post-application queries confirmed anonymous direct-document access and the private owner reader are denied and an invalid share token returns no document. The selected destination requires its own base-schema and canonical migration applications and verification. Record their actual migration versions in PR #6. Mike's actual PR-linked Vercel project is documented in `docs/production-admin.md`.
