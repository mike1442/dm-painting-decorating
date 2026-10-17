-- D&M admin: server-side pieces the web app relies on.
--
-- Apply once in the Supabase SQL editor (project kqjbgvjgsvbjflumorjr) after the
-- tables from docs/supabase-integration.md exist. Safe to re-run: every
-- statement is idempotent and nothing here drops tables or data.
--
-- Adds:
--   1. dm_admin_is_member()                membership check used by the app's auth gate
--   2. dm_admin_allocate_number(kind, min)  atomic, unique quote/invoice numbers
--   3. dm_admin_sequence_state()           next numbers, for display in Settings
--   4. server-owned updated_at timestamps   used to detect edits made on another device
--   5. unique (owner, kind, document number) so a number can never be issued twice
--   6. reference RLS policies and privilege tightening (member + owner only, no anon)

begin;

-- 1. Membership ---------------------------------------------------------------

create or replace function public.dm_admin_is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and exists (select 1 from public.admin_members m where m.user_id = auth.uid());
$$;

revoke all on function public.dm_admin_is_member() from public, anon;
grant execute on function public.dm_admin_is_member() to authenticated;

-- 2. Atomic numbering -----------------------------------------------------------
-- Returns the number to use and advances the counter in one statement. Concurrent
-- calls from different devices serialise on the counter row, so each caller gets a
-- different number. p_min lets the business continue from existing paperwork; the
-- counter never moves backwards.

create unique index if not exists admin_sequences_owner_kind_key
  on public.admin_sequences (owner_id, kind);

create or replace function public.dm_admin_allocate_number(p_kind text, p_min integer default 1)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_kind public.admin_sequences.kind%type;
  v_floor integer := greatest(coalesce(p_min, 1), 1);
  v_number integer;
begin
  if not public.dm_admin_is_member() then
    raise exception 'not an admin member' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('quote', 'invoice') then
    raise exception 'unknown document kind %', p_kind using errcode = '22023';
  end if;
  if v_floor > 99999999 then
    raise exception 'number too large' using errcode = '22003';
  end if;
  v_kind := p_kind;

  insert into public.admin_sequences as s (owner_id, kind, next_number)
  values (v_owner, v_kind, v_floor + 1)
  on conflict (owner_id, kind) do update
    set next_number = greatest(s.next_number, v_floor) + 1
  returning s.next_number - 1 into v_number;

  return v_number;
end;
$$;

revoke all on function public.dm_admin_allocate_number(text, integer) from public, anon;
grant execute on function public.dm_admin_allocate_number(text, integer) to authenticated;

-- 3. Counter state for display -------------------------------------------------

create or replace function public.dm_admin_sequence_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb := jsonb_build_object('quote', 1, 'invoice', 1);
  r record;
begin
  if not public.dm_admin_is_member() then
    raise exception 'not an admin member' using errcode = '42501';
  end if;
  for r in select kind::text as kind, next_number from public.admin_sequences where owner_id = auth.uid() loop
    v_result := v_result || jsonb_build_object(r.kind, r.next_number);
  end loop;
  return v_result;
end;
$$;

revoke all on function public.dm_admin_sequence_state() from public, anon;
grant execute on function public.dm_admin_sequence_state() to authenticated;

-- 4. Server-owned timestamps ---------------------------------------------------
-- updated_at is always set by the database, so the app can use it as a version:
-- a save only succeeds if the row still has the updated_at the device last saw.

create or replace function public.dm_admin_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  if tg_op = 'UPDATE' then
    new.owner_id := old.owner_id;
    if tg_table_name = 'admin_documents' then
      new.created_at := old.created_at;
      new.kind := old.kind;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists dm_admin_documents_touch on public.admin_documents;
create trigger dm_admin_documents_touch
  before insert or update on public.admin_documents
  for each row execute function public.dm_admin_touch();

drop trigger if exists dm_admin_settings_touch on public.admin_settings;
create trigger dm_admin_settings_touch
  before insert or update on public.admin_settings
  for each row execute function public.dm_admin_touch();

-- 5. Unique document numbers ---------------------------------------------------

create unique index if not exists admin_documents_owner_kind_number_key
  on public.admin_documents (owner_id, kind, document_number)
  where document_number is not null;

create index if not exists admin_documents_owner_kind_idx
  on public.admin_documents (owner_id, kind);

-- 6. Row-level security --------------------------------------------------------
-- RLS stays enabled. These policies grant a signed-in admin member access to their
-- own rows only. If any older policy on these tables is looser (for example
-- `using (true)`), drop it: Postgres combines permissive policies with OR.

alter table public.admin_members enable row level security;
alter table public.admin_documents enable row level security;
alter table public.admin_settings enable row level security;
alter table public.admin_sequences enable row level security;

drop policy if exists dm_admin_documents_member_access on public.admin_documents;
create policy dm_admin_documents_member_access on public.admin_documents
  for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.dm_admin_is_member()))
  with check (owner_id = (select auth.uid()) and (select public.dm_admin_is_member()));

drop policy if exists dm_admin_settings_member_access on public.admin_settings;
create policy dm_admin_settings_member_access on public.admin_settings
  for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.dm_admin_is_member()))
  with check (owner_id = (select auth.uid()) and (select public.dm_admin_is_member()));

drop policy if exists dm_admin_members_read_self on public.admin_members;
create policy dm_admin_members_read_self on public.admin_members
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Anonymous visitors get nothing. Membership and numbering can only change
-- through the SQL editor (members) or the functions above (numbers).
revoke all on table public.admin_members, public.admin_documents, public.admin_settings, public.admin_sequences from anon;
revoke insert, update, delete on table public.admin_members from authenticated;
revoke insert, update, delete on table public.admin_sequences from authenticated;
grant select, insert, update, delete on table public.admin_documents, public.admin_settings to authenticated;
grant select on table public.admin_members, public.admin_sequences to authenticated;

commit;
