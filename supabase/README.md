# Existing Supabase project

Use **kqjbgvjgsvbjflumorjr**, the existing London-region project. Do not create a replacement project. Its existing `public.admin_members`, `admin_documents`, `admin_settings`, and `admin_sequences` tables were inspected; all four had RLS enabled and contained no records at the initial audit.

Remote migration history inspected:

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

Configure the application's existing Vercel project with `NEXT_PUBLIC_SUPABASE_URL=https://kqjbgvjgsvbjflumorjr.supabase.co` and its server-side `SUPABASE_PUBLISHABLE_KEY` (the legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is accepted for compatibility). No service-role key is required. Configure the Auth provider's email delivery before relying on invitations or password recovery. Production rollout must wait for database checks, application checks, a successful build, and real authenticated functional verification.

## Applied upgrade evidence

The reviewed source was applied to the existing project as migration `20261017233851_dm_admin_production_persistence_and_sharing`. Post-application queries confirmed anonymous direct-document access and the private owner reader are denied and an invalid share token returns no document. Do not assume a separate Vercel project's variables are configured from this database result. Mike's actual PR-linked Vercel project is documented in `docs/production-admin.md`.
