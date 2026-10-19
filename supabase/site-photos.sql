-- Website photo library: an additive migration applied after production-admin.sql.
-- This is migration source, not a fabricated Supabase CLI migration filename.
-- Apply once through the authenticated migration tool and record its version.
--
-- Photo files live in the public Supabase Storage bucket `site-photos` so the
-- website can use their permanent URLs. Only metadata (title, alt text,
-- category, dimensions) is stored in the database. Every write goes through
-- Mike's own signed-in session: no service-role key is involved, and the same
-- private.dm_is_admin() guard as quotes and invoices protects the bucket.
begin;

do $block$
begin
  if to_regprocedure('private.dm_is_admin()') is null then
    raise exception 'Apply production-admin.sql before site-photos.sql' using errcode='55000';
  end if;
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise exception 'The existing Supabase Storage schema is required' using errcode='55000';
  end if;
end;
$block$;

-- Public reads are what make the URLs usable on website pages. Storage itself
-- refuses anything that is not labelled WebP or is over 5 MB; the application
-- converts and verifies every photo before it reaches this bucket.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('site-photos', 'site-photos', true, 5242880, array['image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- A file name is the SEO-friendly slug: <name>.webp is the main image and
-- thumbs/<name>.webp its thumbnail.
create table if not exists public.admin_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null unique check (file_name ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(file_name) <= 80),
  title text not null check (title = btrim(title) and length(title) between 1 and 120),
  alt_text text not null default '' check (alt_text = btrim(alt_text) and length(alt_text) <= 250),
  category text not null default 'other' check (category in ('interior', 'woodwork', 'exterior', 'whole-house', 'before-after', 'other')),
  width integer not null check (width between 1 and 1600),
  height integer not null check (height between 1 and 4800),
  thumb_width integer not null check (thumb_width between 1 and 480),
  thumb_height integer not null check (thumb_height between 1 and 1440),
  bytes integer not null check (bytes between 1 and 5242880),
  thumb_bytes integer not null check (thumb_bytes between 1 and 5242880),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- File names are never reused, even after deletion or renaming: browsers and
-- the storage CDN may cache a photo URL for a year, so a recycled name could
-- keep showing the old picture.
create table if not exists private.dm_photo_names (
  name text primary key check (name ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(name) <= 80),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_photos enable row level security;
alter table private.dm_photo_names enable row level security;
revoke all on public.admin_photos, private.dm_photo_names from public, anon, authenticated;

-- Writes to the bucket require Mike's live admin session and a server-generated
-- name; reads through the API also require it. Public URLs bypass these
-- policies by design, which is what lets the website show the photos.
drop policy if exists dm_site_photos_admin_select on storage.objects;
drop policy if exists dm_site_photos_admin_insert on storage.objects;
drop policy if exists dm_site_photos_admin_update on storage.objects;
drop policy if exists dm_site_photos_admin_delete on storage.objects;
create policy dm_site_photos_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'site-photos' and private.dm_is_admin());
create policy dm_site_photos_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'site-photos' and private.dm_is_admin() and name ~ '^(thumbs/)?[a-z0-9]+(-[a-z0-9]+)*\.webp$');
create policy dm_site_photos_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'site-photos' and private.dm_is_admin())
  with check (bucket_id = 'site-photos' and private.dm_is_admin() and name ~ '^(thumbs/)?[a-z0-9]+(-[a-z0-9]+)*\.webp$');
create policy dm_site_photos_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'site-photos' and private.dm_is_admin());

create or replace function private.dm_photo_json(p public.admin_photos) returns jsonb
language sql immutable set search_path = '' as $function$
  select jsonb_build_object('id', p.id, 'fileName', p.file_name, 'title', p.title, 'altText', p.alt_text, 'category', p.category,
    'width', p.width, 'height', p.height, 'thumbWidth', p.thumb_width, 'thumbHeight', p.thumb_height,
    'bytes', p.bytes, 'thumbBytes', p.thumb_bytes, 'createdAt', p.created_at, 'updatedAt', p.updated_at);
$function$;

create or replace function private.dm_list_photos() returns jsonb
language plpgsql stable security definer set search_path = '' as $function$
begin
  if not private.dm_is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(private.dm_photo_json(p) order by p.created_at desc, p.id) from public.admin_photos p where p.owner_id = auth.uid()), '[]'::jsonb);
end;
$function$;
create or replace function public.dm_list_photos() returns jsonb
language sql stable security invoker set search_path = '' as $function$ select private.dm_list_photos(); $function$;

-- Reserve the first free name for a slug: base, base-2, base-3, ...
create or replace function private.dm_reserve_photo_name(p_base text) returns text
language plpgsql security definer set search_path = '' as $function$
declare v_name text; v_candidate text;
begin
  if not private.dm_is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_base is null or p_base !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_base) > 70 then raise exception 'Invalid photo name' using errcode='22023'; end if;
  for i in 1..50 loop
    v_candidate := case when i = 1 then p_base else p_base || '-' || i end;
    insert into private.dm_photo_names(name, owner_id) values (v_candidate, auth.uid()) on conflict do nothing returning name into v_name;
    if v_name is not null then return v_name; end if;
  end loop;
  loop
    v_candidate := p_base || '-' || left(replace(gen_random_uuid()::text, '-', ''), 8);
    insert into private.dm_photo_names(name, owner_id) values (v_candidate, auth.uid()) on conflict do nothing returning name into v_name;
    if v_name is not null then return v_name; end if;
  end loop;
end;
$function$;
create or replace function public.dm_reserve_photo_name(p_base text) returns text
language sql security invoker set search_path = '' as $function$ select private.dm_reserve_photo_name(p_base); $function$;

-- Record a photo after both files are in the bucket. The name must be one this
-- administrator reserved; table constraints validate every other field.
create or replace function private.dm_add_photo(p_photo jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_photo public.admin_photos%rowtype;
begin
  if not private.dm_is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_photo is null or jsonb_typeof(p_photo) is distinct from 'object'
    or not exists(select 1 from private.dm_photo_names n where n.name = p_photo->>'fileName' and n.owner_id = auth.uid()) then
    raise exception 'Invalid photo' using errcode='22023';
  end if;
  insert into public.admin_photos(owner_id, file_name, title, alt_text, category, width, height, thumb_width, thumb_height, bytes, thumb_bytes)
  values (auth.uid(), p_photo->>'fileName', p_photo->>'title', coalesce(p_photo->>'altText', ''), coalesce(p_photo->>'category', 'other'),
    (p_photo->>'width')::integer, (p_photo->>'height')::integer, (p_photo->>'thumbWidth')::integer, (p_photo->>'thumbHeight')::integer,
    (p_photo->>'bytes')::integer, (p_photo->>'thumbBytes')::integer)
  returning * into v_photo;
  return private.dm_photo_json(v_photo);
end;
$function$;
create or replace function public.dm_add_photo(p_photo jsonb) returns jsonb
language sql security invoker set search_path = '' as $function$ select private.dm_add_photo(p_photo); $function$;

-- Rename, describe or recategorise a photo. A new file name (after the files
-- have been moved) must also be a name this administrator reserved.
create or replace function private.dm_update_photo(p_id uuid, p_title text, p_alt_text text, p_category text, p_file_name text) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_photo public.admin_photos%rowtype;
begin
  if not private.dm_is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_file_name is not null and not exists(select 1 from private.dm_photo_names n where n.name = p_file_name and n.owner_id = auth.uid()) then
    raise exception 'Invalid photo name' using errcode='22023';
  end if;
  update public.admin_photos set title = p_title, alt_text = coalesce(p_alt_text, ''), category = p_category,
    file_name = coalesce(p_file_name, file_name), updated_at = now()
  where id = p_id and owner_id = auth.uid()
  returning * into v_photo;
  if not found then raise exception 'Photo not found' using errcode='P0002'; end if;
  return private.dm_photo_json(v_photo);
end;
$function$;
create or replace function public.dm_update_photo(p_id uuid, p_title text, p_alt_text text, p_category text, p_file_name text) returns jsonb
language sql security invoker set search_path = '' as $function$ select private.dm_update_photo(p_id, p_title, p_alt_text, p_category, p_file_name); $function$;

-- Called after the files have left the bucket. Repeating it is harmless.
create or replace function private.dm_delete_photo(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $function$
begin
  if not private.dm_is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  delete from public.admin_photos where id = p_id and owner_id = auth.uid();
end;
$function$;
create or replace function public.dm_delete_photo(p_id uuid) returns void
language sql security invoker set search_path = '' as $function$ select private.dm_delete_photo(p_id); $function$;

revoke all on function private.dm_photo_json(public.admin_photos), private.dm_list_photos(), private.dm_reserve_photo_name(text), private.dm_add_photo(jsonb),
  private.dm_update_photo(uuid, text, text, text, text), private.dm_delete_photo(uuid) from public, anon, authenticated;
revoke all on function public.dm_list_photos(), public.dm_reserve_photo_name(text), public.dm_add_photo(jsonb),
  public.dm_update_photo(uuid, text, text, text, text), public.dm_delete_photo(uuid) from public, anon, authenticated;
grant execute on function private.dm_list_photos(), private.dm_reserve_photo_name(text), private.dm_add_photo(jsonb),
  private.dm_update_photo(uuid, text, text, text, text), private.dm_delete_photo(uuid) to authenticated;
grant execute on function public.dm_list_photos(), public.dm_reserve_photo_name(text), public.dm_add_photo(jsonb),
  public.dm_update_photo(uuid, text, text, text, text), public.dm_delete_photo(uuid) to authenticated;
commit;
