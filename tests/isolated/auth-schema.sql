\set ON_ERROR_STOP on

-- ISOLATED BROWSER WORKFLOW ONLY. Minimal Supabase Auth objects for a disposable,
-- loopback-only PostgreSQL database, mirroring tests/db/auth-fixture.sql. Roles
-- are cluster-wide, so they are created only when absent to allow repeated runs.
-- Never apply this file to an actual Supabase project.
do $block$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end
$block$;

create schema auth;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  deleted_at timestamptz,
  banned_until timestamptz
);

create table auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  not_after timestamptz
);

create function auth.jwt() returns jsonb
language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

create function auth.uid() returns uuid
language sql stable
as $$ select nullif(auth.jwt()->>'sub', '')::uuid $$;

grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;
