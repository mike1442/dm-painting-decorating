\set ON_ERROR_STOP on

-- TEST ONLY. The minimal Supabase Storage tables that supabase/site-photos.sql
-- configures, for a disposable PostgreSQL database. Like hosted Supabase, the
-- API roles hold table grants and row-level security decides every access.
-- Never apply this file to an actual Supabase project.
create schema storage;

create table storage.buckets (
  id text primary key,
  name text not null unique,
  owner uuid,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (bucket_id, name)
);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;

-- Another application's bucket: the photo policies must never reach it.
insert into storage.buckets(id, name, public) values ('unrelated-bucket', 'unrelated-bucket', false);
