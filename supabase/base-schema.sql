-- Base application schema reconstructed from the existing project's metadata.
-- Local migration source only: no project is created, and Auth is provided by
-- the selected EXISTING Supabase project. Apply only after its exact reference
-- and the user's authorization have been verified, then production-admin.sql.
begin;

-- Fail before making changes if this is an upgrade rather than an empty app
-- schema. Existing tables/records must be inspected instead of overwritten.
do $block$
begin
  if to_regclass('auth.users') is null then
    raise exception 'An existing Supabase Auth schema is required' using errcode='55000';
  end if;
  if to_regclass('public.admin_members') is not null
    or to_regclass('public.admin_documents') is not null
    or to_regclass('public.admin_settings') is not null
    or to_regclass('public.admin_sequences') is not null then
    raise exception 'Application tables already exist; inspect the existing schema before upgrading' using errcode='55000';
  end if;
end;
$block$;

create table public.admin_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.admin_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('quote', 'invoice', 'booking')),
  document_number text,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, kind, document_number)
);

create table public.admin_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now()
);

create table public.admin_sequences (
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('quote', 'invoice')),
  next_number integer not null default 1 check (next_number > 0),
  primary key (owner_id, kind)
);

-- These tables stay inaccessible between the base and canonical upgrade.
alter table public.admin_members enable row level security;
alter table public.admin_documents enable row level security;
alter table public.admin_settings enable row level security;
alter table public.admin_sequences enable row level security;
revoke all on public.admin_members, public.admin_documents,
  public.admin_settings, public.admin_sequences from public, anon, authenticated;

commit;
