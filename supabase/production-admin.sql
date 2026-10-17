-- Reviewed additive upgrade for the EXISTING kqjbgvjgsvbjflumorjr project.
-- This is migration source, not a fabricated Supabase CLI migration filename.
-- The Supabase CLI is unavailable in the authoring environment. Apply once
-- through the authenticated migration tool and record its actual version.
begin;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.admin_documents add column if not exists external_id text;
update public.admin_documents set external_id = coalesce(nullif(payload->>'id', ''), id::text) where external_id is null;
alter table public.admin_documents alter column external_id set not null;
create unique index if not exists dm_documents_external_id on public.admin_documents(owner_id, external_id);
create unique index if not exists dm_documents_number on public.admin_documents(owner_id, kind, document_number) where document_number is not null;
alter table public.admin_settings add column if not exists revision bigint not null default 0;

create table if not exists private.dm_number_reservations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('quote', 'invoice')),
  number text not null,
  primary key (owner_id, kind, number)
);
insert into private.dm_number_reservations(owner_id, kind, number)
select owner_id, kind, document_number from public.admin_documents
where kind in ('quote', 'invoice') and document_number is not null on conflict do nothing;

create table if not exists private.dm_document_shares (
  document_id uuid primary key references public.admin_documents(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table private.dm_number_reservations enable row level security;
alter table private.dm_document_shares enable row level security;

-- Remove inherited access paths. Every operation below is an explicit RPC.
do $block$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('admin_members', 'admin_documents', 'admin_settings', 'admin_sequences')
  loop execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename); end loop;
  for p in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'dm_admin_%'
  loop execute format('revoke all on function %s from public, anon, authenticated', p.signature); end loop;
end
$block$;
alter table public.admin_members enable row level security;
alter table public.admin_documents enable row level security;
alter table public.admin_settings enable row level security;
alter table public.admin_sequences enable row level security;
revoke all on public.admin_members, public.admin_documents, public.admin_settings, public.admin_sequences from public, anon, authenticated;
revoke all on private.dm_number_reservations, private.dm_document_shares from public, anon, authenticated;

-- Email is checked against Auth's CURRENT confirmed user record, never editable
-- user metadata. A revoked/deleted session cannot replay an unexpired JWT.
create or replace function private.dm_is_admin() returns boolean
language sql stable security definer set search_path = '' as $function$
  select exists (
    select 1 from public.admin_members m join auth.users u on u.id = m.user_id
    join auth.sessions s on s.user_id = u.id and s.id::text = (auth.jwt()->>'session_id')
    where m.user_id = auth.uid() and lower(u.email) = 'mike@dmpaintingdecorating.co.uk'
      and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until <= now())
  );
$function$;

create or replace function private.dm_enrol_admin() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  if lower(new.email) = 'mike@dmpaintingdecorating.co.uk' and new.email_confirmed_at is not null then
    insert into public.admin_members(user_id) values (new.id) on conflict do nothing;
  else
    delete from public.admin_members where user_id = new.id;
  end if;
  return new;
end;
$function$;
drop trigger if exists dm_enrol_confirmed_admin on auth.users;
create trigger dm_enrol_confirmed_admin after insert or update of email, email_confirmed_at on auth.users
for each row execute function private.dm_enrol_admin();
insert into public.admin_members(user_id)
select id from auth.users where lower(email) = 'mike@dmpaintingdecorating.co.uk' and email_confirmed_at is not null
on conflict do nothing;
delete from public.admin_members m where not exists (
  select 1 from auth.users u where u.id = m.user_id and lower(u.email) = 'mike@dmpaintingdecorating.co.uk' and u.email_confirmed_at is not null
);

create or replace function public.dm_admin_is_member() returns boolean
language sql stable security invoker set search_path = '' as $function$
  select private.dm_is_admin();
$function$;

-- Internal reader is reused inside the write transaction, avoiding lost updates.
create or replace function private.dm_read_data(p_owner uuid) returns jsonb
language sql stable security definer set search_path = '' as $function$
select jsonb_build_object('data', jsonb_build_object(
  'schemaVersion', coalesce(s.payload->'schemaVersion', '1'::jsonb),
  'quotes', coalesce((select jsonb_agg(d.payload order by d.created_at, d.id) from public.admin_documents d where d.owner_id=p_owner and d.kind='quote'), '[]'::jsonb),
  'invoices', coalesce((select jsonb_agg(d.payload order by d.created_at, d.id) from public.admin_documents d where d.owner_id=p_owner and d.kind='invoice'), '[]'::jsonb),
  'bookings', coalesce((select jsonb_agg(d.payload order by d.created_at, d.id) from public.admin_documents d where d.owner_id=p_owner and d.kind='booking'), '[]'::jsonb),
  'settings', coalesce(s.payload->'settings', s.payload, '{}'::jsonb),
  'meta', coalesce(s.payload->'meta', jsonb_build_object('createdAt', now(), 'lastBackupAt', null))
), 'revision', coalesce(s.revision,0))
from (select 1) seed left join public.admin_settings s on s.owner_id=p_owner;
$function$;

create or replace function private.dm_get_data() returns jsonb
language plpgsql security definer set search_path = '' as $function$
begin
  if not private.dm_is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  return private.dm_read_data(auth.uid());
end;
$function$;
create or replace function public.dm_get_data() returns jsonb
language sql security invoker set search_path = '' as $function$ select private.dm_get_data(); $function$;

create or replace function private.dm_save_data(p_data jsonb, p_revision bigint) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare
  v_owner uuid := auth.uid(); v_revision bigint; v_docs jsonb; v_doc jsonb;
  v_existing public.admin_documents%rowtype; v_number text; v_kind text; v_prefix text;
  v_seq integer; v_suffix text; v_settings jsonb; v_meta jsonb; v_n integer;
begin
  if not private.dm_is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_revision is null or p_revision < 0 or p_data is null or jsonb_typeof(p_data) is distinct from 'object'
    or jsonb_typeof(p_data->'quotes') is distinct from 'array' or jsonb_typeof(p_data->'invoices') is distinct from 'array'
    or jsonb_typeof(p_data->'bookings') is distinct from 'array' or jsonb_typeof(p_data->'settings') is distinct from 'object'
    or octet_length(p_data::text)>10000000 then raise exception 'Invalid document data' using errcode='22023'; end if;
  v_docs := (p_data->'quotes') || (p_data->'invoices') || (p_data->'bookings');
  if jsonb_array_length(v_docs)>10000 or exists(select 1 from jsonb_array_elements(v_docs) d where jsonb_typeof(d) is distinct from 'object' or coalesce(d->>'id','') !~ '^[A-Za-z0-9_-]{6,64}$')
    or (select count(*) from jsonb_array_elements(v_docs)) <> (select count(distinct d->>'id') from jsonb_array_elements(v_docs) d)
    or exists(select 1 from jsonb_array_elements(p_data->'quotes') d where d->>'kind' is distinct from 'quote')
    or exists(select 1 from jsonb_array_elements(p_data->'invoices') d where d->>'kind' is distinct from 'invoice')
    or exists(select 1 from jsonb_array_elements(p_data->'bookings') d where d->>'kind' is distinct from 'booking')
    then raise exception 'Invalid or duplicate document identifiers' using errcode='22023'; end if;

  -- A single owner row serialises save, number allocation, and share operations.
  insert into public.admin_settings(owner_id,payload,revision)
  values(v_owner,jsonb_build_object('settings','{}'::jsonb,'schemaVersion',1,'meta',jsonb_build_object('createdAt',now(),'lastBackupAt',null)),0)
  on conflict do nothing;
  select revision into v_revision from public.admin_settings where owner_id=v_owner for update;
  if v_revision <> p_revision then raise exception 'Records changed on another device' using errcode='40001'; end if;
  v_settings := p_data->'settings';
  v_meta := case when jsonb_typeof(p_data->'meta')='object' then p_data->'meta' else jsonb_build_object('createdAt',now(),'lastBackupAt',null) end;

  for v_kind in select unnest(array['quote','invoice']) loop
    v_n := case when coalesce(v_settings->>case when v_kind='quote' then 'nextQuoteNumber' else 'nextInvoiceNumber' end,'') ~ '^[0-9]{1,9}$'
      then greatest(1,(v_settings->>case when v_kind='quote' then 'nextQuoteNumber' else 'nextInvoiceNumber' end)::integer) else 1 end;
    insert into public.admin_sequences(owner_id,kind,next_number) values(v_owner,v_kind,v_n)
    on conflict(owner_id,kind) do update set next_number=greatest(public.admin_sequences.next_number,excluded.next_number);
  end loop;

  for v_doc in select value from jsonb_array_elements(v_docs) loop
    v_kind := v_doc->>'kind';
    select * into v_existing from public.admin_documents where owner_id=v_owner and external_id=v_doc->>'id';
    if found and v_existing.kind <> v_kind then raise exception 'Document type cannot change' using errcode='22023'; end if;
    v_number := null;
    if v_kind in ('quote','invoice') then
      v_prefix := left(coalesce(nullif(v_settings->>case when v_kind='quote' then 'quotePrefix' else 'invoicePrefix' end,''),case when v_kind='quote' then 'Q-' else 'INV-' end),20);
      if v_existing.id is not null then v_number := v_existing.document_number;
      else
        -- Preserve unique imported historical numbers. Collisions are allocated
        -- by the database; deleted numbers remain reserved permanently.
        v_number := nullif(left(btrim(v_doc->>'number'),40),'');
        if v_number is not null and exists(select 1 from private.dm_number_reservations where owner_id=v_owner and kind=v_kind and number=v_number) then v_number := null; end if;
      end if;
      if v_number is null then
        select next_number into v_seq from public.admin_sequences where owner_id=v_owner and kind=v_kind;
        loop
          v_number := v_prefix || lpad(v_seq::text,greatest(4,length(v_seq::text)),'0');
          exit when not exists(select 1 from private.dm_number_reservations where owner_id=v_owner and kind=v_kind and number=v_number);
          v_seq := v_seq+1;
        end loop;
      end if;
      insert into private.dm_number_reservations(owner_id,kind,number) values(v_owner,v_kind,v_number) on conflict do nothing;
      if left(v_number,length(v_prefix))=v_prefix then
        v_suffix := substring(v_number from length(v_prefix)+1);
        if v_suffix ~ '^[0-9]{1,9}$' then update public.admin_sequences set next_number=greatest(next_number,v_suffix::integer+1) where owner_id=v_owner and kind=v_kind; end if;
      end if;
      v_doc := jsonb_set(v_doc,'{number}',to_jsonb(v_number));
    end if;
    insert into public.admin_documents(owner_id,external_id,kind,document_number,payload)
    values(v_owner,v_doc->>'id',v_kind,v_number,v_doc)
    on conflict(owner_id,external_id) do update set document_number=excluded.document_number,payload=excluded.payload,updated_at=now();
  end loop;
  -- Missing records are an explicit deletion, protected by the revision check.
  delete from public.admin_documents d where d.owner_id=v_owner and not exists(select 1 from jsonb_array_elements(v_docs) x where x->>'id'=d.external_id);
  -- Keep customer-visible quote references in sync with canonical numbering.
  update public.admin_documents i set payload=jsonb_set(i.payload,'{quoteNumber}',to_jsonb(q.document_number))
    from public.admin_documents q where i.owner_id=v_owner and q.owner_id=v_owner and i.kind='invoice' and q.kind='quote' and i.payload->>'quoteId'=q.external_id;
  for v_kind in select unnest(array['quote','invoice']) loop
    select next_number into v_seq from public.admin_sequences where owner_id=v_owner and kind=v_kind;
    v_settings := jsonb_set(v_settings,array[case when v_kind='quote' then 'nextQuoteNumber' else 'nextInvoiceNumber' end],to_jsonb(v_seq));
  end loop;
  update public.admin_settings set payload=jsonb_build_object('schemaVersion',1,'settings',v_settings,'meta',v_meta),revision=revision+1,updated_at=now() where owner_id=v_owner;
  return private.dm_read_data(v_owner);
end;
$function$;
create or replace function public.dm_save_data(p_data jsonb,p_revision bigint) returns jsonb
language sql security invoker set search_path = '' as $function$ select private.dm_save_data(p_data,p_revision); $function$;

create or replace function private.dm_create_share(p_id text) returns text
language plpgsql security definer set search_path = '' as $function$
declare v_id uuid; v_token text; v_crypto_schema text;
begin
  if not private.dm_is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  perform 1 from public.admin_settings where owner_id=auth.uid() for update;
  select id into v_id from public.admin_documents where owner_id=auth.uid() and external_id=p_id and kind in ('quote','invoice');
  if v_id is null then raise exception 'Document not found' using errcode='P0002'; end if;
  select n.nspname into v_crypto_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto';
  execute format('select encode(%I.gen_random_bytes(32), ''hex'')',v_crypto_schema) into v_token;
  insert into private.dm_document_shares(document_id,token_hash) values(v_id,encode(sha256(convert_to(v_token,'UTF8')),'hex'))
  on conflict(document_id) do update set token_hash=excluded.token_hash,created_at=now(),revoked_at=null;
  return v_token;
end;
$function$;
create or replace function public.dm_create_share(p_id text) returns text
language sql security invoker set search_path = '' as $function$ select private.dm_create_share(p_id); $function$;

create or replace function private.dm_revoke_share(p_id text) returns void
language plpgsql security definer set search_path = '' as $function$
begin
  if not private.dm_is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  perform 1 from public.admin_settings where owner_id=auth.uid() for update;
  update private.dm_document_shares s set revoked_at=now() from public.admin_documents d
  where d.id=s.document_id and d.owner_id=auth.uid() and d.external_id=p_id;
end;
$function$;
create or replace function public.dm_revoke_share(p_id text) returns void
language sql security invoker set search_path = '' as $function$ select private.dm_revoke_share(p_id); $function$;

create or replace function private.dm_get_shared_document(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $function$
declare v_doc jsonb; v_business jsonb; v_kind text; v_result jsonb; v_keys text[];
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return null; end if;
  select d.payload, coalesce(b.payload->'settings',b.payload), d.kind into v_doc,v_business,v_kind
  from private.dm_document_shares s join public.admin_documents d on d.id=s.document_id
  join public.admin_settings b on b.owner_id=d.owner_id
  join public.admin_members m on m.user_id=d.owner_id join auth.users u on u.id=m.user_id
  where s.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and s.revoked_at is null
    and d.kind in ('quote','invoice') and lower(u.email)='mike@dmpaintingdecorating.co.uk' and u.email_confirmed_at is not null;
  if v_doc is null then return null; end if;
  -- Positive allowlists mean newly added internal fields cannot leak later.
  v_keys := array['kind','number','status','title','issueDate','scope','works','materials','materialsNote','vat','isTest'];
  if v_kind='quote' then v_keys := v_keys || array['validUntil','intro','deposit','terms'];
  else v_keys := v_keys || array['dueDate','quoteNumber','payments','bank','paymentNote']; end if;
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into v_result from jsonb_each(v_doc) where key=any(v_keys);
  v_result := v_result || jsonb_build_object('customer',jsonb_build_object('name',v_doc#>'{customer,name}','address',v_doc#>'{customer,address}','email','','phone',''));
  -- Payment labels and IDs are internal bookkeeping; totals need amount only.
  if v_kind='invoice' then
    v_result := v_result || jsonb_build_object('payments',coalesce((select jsonb_agg(jsonb_build_object('date',p->'date','amount',p->'amount','method',p->'method','label','')) from jsonb_array_elements(coalesce(v_doc->'payments','[]'::jsonb)) p),'[]'::jsonb));
    if v_doc->'isTest'='true'::jsonb then v_result := v_result || jsonb_build_object('bank',jsonb_build_object('accountName','','sortCode','','accountNumber','')); end if;
  end if;
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into v_business from jsonb_each(v_business)
  where key=any(array['businessName','address','phone','email','website','vatNumber','companyNumber']);
  return jsonb_build_object('document',v_result,'business',v_business);
end;
$function$;
create or replace function public.dm_get_shared_document(p_token text) returns jsonb
language sql stable security invoker set search_path = '' as $function$ select private.dm_get_shared_document(p_token); $function$;

-- Internal helpers cannot be called directly, including through an accidentally
-- exposed private schema. Only guarded entrypoints get explicit EXECUTE grants.
revoke all on function private.dm_is_admin(),private.dm_enrol_admin(),private.dm_read_data(uuid),private.dm_get_data(),private.dm_save_data(jsonb,bigint),private.dm_create_share(text),private.dm_revoke_share(text),private.dm_get_shared_document(text) from public,anon,authenticated;
revoke all on function public.dm_admin_is_member(),public.dm_get_data(),public.dm_save_data(jsonb,bigint),public.dm_create_share(text),public.dm_revoke_share(text),public.dm_get_shared_document(text) from public,anon,authenticated;
grant execute on function private.dm_is_admin(),private.dm_get_data(),private.dm_save_data(jsonb,bigint),private.dm_create_share(text),private.dm_revoke_share(text) to authenticated;
grant execute on function public.dm_admin_is_member(),public.dm_get_data(),public.dm_save_data(jsonb,bigint),public.dm_create_share(text),public.dm_revoke_share(text) to authenticated;
grant execute on function private.dm_get_shared_document(text),public.dm_get_shared_document(text) to anon,authenticated;
commit;
