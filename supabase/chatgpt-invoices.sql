-- Invoices from Mike's ordinary ChatGPT, through its existing Supabase
-- connection (docs/chatgpt-invoices.md). That connection's SQL tool runs as the
-- project's own `postgres` role without a Supabase Auth session, so the guarded
-- admin RPCs rightly refuse it. This adds one narrow entrypoint for that role
-- only, built on the same save, numbering and customer-link code as the admin.
-- Nothing here is reachable through the Data API (anon, authenticated or
-- service_role). Migration source: apply once after production-admin.sql with
-- the authenticated migration tool and record its actual version.
begin;

-- The save and share bodies are unchanged from production-admin.sql except that
-- the owner is a parameter. They run as their caller, so only code that already
-- holds table privileges (the guarded RPCs below, or the postgres role) can use
-- them. The guarded RPCs keep their administrator check and pass auth.uid().
create or replace function private.dm_save_owner_data(p_owner uuid, p_data jsonb, p_revision bigint) returns jsonb
language plpgsql security invoker set search_path = '' as $function$
declare
  v_owner uuid := p_owner; v_revision bigint; v_docs jsonb; v_doc jsonb;
  v_existing public.admin_documents%rowtype; v_number text; v_kind text; v_prefix text;
  v_seq integer; v_suffix text; v_settings jsonb; v_meta jsonb; v_n integer;
begin
  if v_owner is null then raise exception 'Administrator access required' using errcode='42501'; end if;
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

create or replace function private.dm_save_data(p_data jsonb, p_revision bigint) returns jsonb
language plpgsql security definer set search_path = '' as $function$
begin
  if not private.dm_is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  return private.dm_save_owner_data(auth.uid(), p_data, p_revision);
end;
$function$;

create or replace function private.dm_create_owner_share(p_owner uuid, p_id text) returns text
language plpgsql security invoker set search_path = '' as $function$
declare v_id uuid; v_token text; v_crypto_schema text;
begin
  if p_owner is null then raise exception 'Administrator access required' using errcode='42501'; end if;
  perform 1 from public.admin_settings where owner_id=p_owner for update;
  select id into v_id from public.admin_documents where owner_id=p_owner and external_id=p_id and kind in ('quote','invoice');
  if v_id is null then raise exception 'Document not found' using errcode='P0002'; end if;
  select n.nspname into v_crypto_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto';
  execute format('select encode(%I.gen_random_bytes(32), ''hex'')',v_crypto_schema) into v_token;
  insert into private.dm_document_shares(document_id,token_hash) values(v_id,encode(sha256(convert_to(v_token,'UTF8')),'hex'))
  on conflict(document_id) do update set token_hash=excluded.token_hash,created_at=now(),revoked_at=null;
  return v_token;
end;
$function$;

create or replace function private.dm_create_share(p_id text) returns text
language plpgsql security definer set search_path = '' as $function$
begin
  if not private.dm_is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  return private.dm_create_owner_share(auth.uid(), p_id);
end;
$function$;

-- Pure helpers. Money follows lib/admin/money.ts: whole pence per line,
-- VAT rounded on the subtotal.
create or replace function private.dm_normal(p_text text) returns text
language sql immutable set search_path = '' as $function$
  select lower(regexp_replace(regexp_replace(coalesce(p_text,''),'^\s+|\s+$','','g'),'\s+',' ','g'));
$function$;

create or replace function private.dm_lines_pence(p_lines jsonb) returns bigint
language sql immutable set search_path = '' as $function$
  select coalesce(sum(round(
    (case when jsonb_typeof(l->'quantity')='number' then (l->>'quantity')::numeric else 1 end)
    * round((case when jsonb_typeof(l->'unitPrice')='number' then (l->>'unitPrice')::numeric else 0 end)*100)
  )),0)::bigint
  from jsonb_array_elements(case when jsonb_typeof(p_lines)='array' then p_lines else '[]'::jsonb end) l;
$function$;

create or replace function private.dm_gbp(p_pence bigint) returns text
language sql immutable set search_path = '' as $function$
  select '£' || to_char(p_pence/100.0,'FM999,999,999,990.00');
$function$;

-- Request checks refuse what they cannot store exactly; nothing is truncated.
create or replace function private.dm_chatgpt_only(p_object jsonb, p_label text, p_allowed text[]) returns void
language plpgsql immutable set search_path = '' as $function$
declare v_unknown text;
begin
  select string_agg(k,', ') into v_unknown from jsonb_object_keys(p_object) k where k <> all(p_allowed);
  if v_unknown is not null then
    raise exception '% has unknown field(s): %. Allowed: %.', p_label, v_unknown, array_to_string(p_allowed,', ') using errcode='22023';
  end if;
end;
$function$;

create or replace function private.dm_chatgpt_text(p_value jsonb, p_label text, p_max integer) returns text
language plpgsql immutable set search_path = '' as $function$
declare v_text text;
begin
  if p_value is null or jsonb_typeof(p_value)='null' then return ''; end if;
  if jsonb_typeof(p_value)<>'string' then raise exception '% must be text.', p_label using errcode='22023'; end if;
  v_text := regexp_replace(p_value#>>'{}','^\s+|\s+$','','g');
  if length(v_text)>p_max then raise exception '% is longer than % characters.', p_label, p_max using errcode='22023'; end if;
  return v_text;
end;
$function$;

create or replace function private.dm_chatgpt_number(p_value jsonb, p_label text, p_min numeric, p_max numeric, p_places integer) returns numeric
language plpgsql immutable set search_path = '' as $function$
declare v_number numeric;
begin
  if p_value is null or jsonb_typeof(p_value)='null' then return null; end if;
  if jsonb_typeof(p_value)<>'number' then raise exception '% must be a number such as 850 or 249.50, not text.', p_label using errcode='22023'; end if;
  v_number := trim_scale((p_value#>>'{}')::numeric);
  if v_number<p_min or v_number>p_max then raise exception '% must be from % to %.', p_label, p_min, p_max using errcode='22023'; end if;
  if scale(v_number)>p_places then raise exception '% can have at most % decimal places.', p_label, p_places using errcode='22023'; end if;
  return v_number;
end;
$function$;

create or replace function private.dm_chatgpt_flag(p_value jsonb, p_label text) returns boolean
language plpgsql immutable set search_path = '' as $function$
begin
  if p_value is null or jsonb_typeof(p_value)='null' then return null; end if;
  if jsonb_typeof(p_value)<>'boolean' then raise exception '% must be true or false.', p_label using errcode='22023'; end if;
  return (p_value#>>'{}')::boolean;
end;
$function$;

-- The caller must be the project's own database administrator: the Supabase
-- connection's SQL tool, the dashboard SQL editor or a direct postgres login.
-- Data API requests arrive as `authenticator` and never qualify, even if EXECUTE
-- were granted by mistake. Records belong to Mike's confirmed, enrolled account,
-- checked exactly as the customer-link resolver checks the document owner.
create or replace function private.dm_chatgpt_owner() returns uuid
language plpgsql stable security invoker set search_path = '' as $function$
declare v_owners uuid[];
begin
  if current_user<>session_user or not pg_has_role(session_user,'postgres','member') then
    raise exception 'Only the D&M Supabase project''s own database administrator can use this.' using errcode='42501';
  end if;
  select array_agg(m.user_id) into v_owners from public.admin_members m join auth.users u on u.id=m.user_id
  where lower(u.email)='mike@dmpaintingdecorating.co.uk' and u.email_confirmed_at is not null and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=now());
  if coalesce(cardinality(v_owners),0)<>1 then
    raise exception 'Mike''s confirmed D&M admin account is not set up, so nothing can be saved for it.' using errcode='42501';
  end if;
  return v_owners[1];
end;
$function$;

-- The same summary for every answer, computed from the stored record.
create or replace function private.dm_chatgpt_invoice_summary(p_doc jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $function$
declare v_subtotal bigint; v_vat bigint := 0; v_paid bigint; v_rate numeric; v_enabled boolean;
begin
  v_subtotal := private.dm_lines_pence(p_doc->'works') + private.dm_lines_pence(p_doc->'materials');
  v_enabled := p_doc#>'{vat,enabled}' = 'true'::jsonb;
  v_rate := case when jsonb_typeof(p_doc#>'{vat,rate}')='number' then (p_doc#>>'{vat,rate}')::numeric else 0 end;
  if v_enabled and v_rate>0 then v_vat := round(v_subtotal*v_rate/100); end if;
  select coalesce(sum(round((p->>'amount')::numeric*100)),0) into v_paid
  from jsonb_array_elements(case when jsonb_typeof(p_doc->'payments')='array' then p_doc->'payments' else '[]'::jsonb end) p
  where jsonb_typeof(p->'amount')='number';
  return jsonb_build_object(
    'id',p_doc->>'id','number',p_doc->>'number','customer',p_doc#>>'{customer,name}','title',p_doc->>'title',
    'issueDate',p_doc->>'issueDate','dueDate',p_doc->>'dueDate',
    'subtotal',private.dm_gbp(v_subtotal),'vat',case when v_enabled then format('VAT at %s%%',trim_scale(v_rate)) else 'no VAT' end,
    'vatAmount',private.dm_gbp(v_vat),'total',private.dm_gbp(v_subtotal+v_vat),'paid',private.dm_gbp(v_paid),'balance',private.dm_gbp(v_subtotal+v_vat-v_paid),
    'testDocument',p_doc->'isTest' is not distinct from 'true'::jsonb,
    'adminUrl','https://www.dmpaintingdecorating.co.uk/admin/invoices/' || (p_doc->>'id'));
end;
$function$;

-- Creates and saves an invoice from Mike's figures, exactly as the admin's own
-- createInvoice would, then makes its customer link and opens that link as an
-- anonymous customer before answering. Everything happens in one transaction:
-- any failed check raises and nothing is saved.
create or replace function private.dm_chatgpt_create_invoice(p_request jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $function$
declare
  c_site constant text := 'https://www.dmpaintingdecorating.co.uk';
  c_test_note constant text := 'Test example only. Not issued to a customer. No payment is due.';
  v_owner uuid; v_snapshot jsonb; v_settings jsonb; v_data jsonb;
  v_customer jsonb; v_address jsonb; v_name text; v_title text;
  v_lines jsonb := '{}'::jsonb; v_line_keys jsonb := '{}'::jsonb; v_group text; v_line jsonb; v_items jsonb; v_keys jsonb;
  v_description text; v_unit text; v_quantity numeric; v_price numeric; v_text text; v_scope jsonb := '[]'::jsonb;
  v_subtotal bigint; v_expected numeric; v_enabled boolean; v_rate numeric; v_vat jsonb; v_due integer;
  v_test boolean; v_allow boolean; v_today date; v_now text; v_id text; v_invoice jsonb; v_summary jsonb;
  v_row public.admin_documents%rowtype; v_twin jsonb; v_number text; v_prefix text; v_token text; v_shown jsonb;
begin
  v_owner := private.dm_chatgpt_owner();
  if current_setting('transaction_read_only')='on' then
    raise exception 'This Supabase connection is read-only, so no invoice can be created. Turn off read-only mode for the D&M project.' using errcode='25006';
  end if;

  -- 1. The request, checked before anything is read or locked.
  if p_request is null or jsonb_typeof(p_request)<>'object' then raise exception 'The request must be one JSON object.' using errcode='22023'; end if;
  perform private.dm_chatgpt_only(p_request,'The request',array['customer','title','works','materials','expectedSubtotal','vat','dueInDays','scope','materialsNote','paymentNote','internalNotes','testDocument','allowDuplicate']);
  v_customer := p_request->'customer';
  if jsonb_typeof(v_customer) is distinct from 'object' then raise exception 'customer is required, e.g. {"name": "John Smith", "address": {"line1": "...", "town": "...", "postcode": "..."}}. Ask Mike who the invoice is for.' using errcode='22023'; end if;
  perform private.dm_chatgpt_only(v_customer,'customer',array['name','address','email','phone']);
  v_name := private.dm_chatgpt_text(v_customer->'name','customer.name',200);
  if v_name='' then raise exception 'customer.name is required. Ask Mike who the invoice is for.' using errcode='22023'; end if;
  v_address := coalesce(nullif(v_customer->'address','null'::jsonb),'{}'::jsonb);
  if jsonb_typeof(v_address)<>'object' then raise exception 'customer.address must be {"line1": "...", "line2": "...", "town": "...", "postcode": "..."}.' using errcode='22023'; end if;
  perform private.dm_chatgpt_only(v_address,'customer.address',array['line1','line2','town','postcode']);
  v_customer := jsonb_build_object('name',v_name,
    'email',private.dm_chatgpt_text(v_customer->'email','customer.email',200),
    'phone',private.dm_chatgpt_text(v_customer->'phone','customer.phone',60),
    'address',jsonb_build_object(
      'line1',private.dm_chatgpt_text(v_address->'line1','customer.address.line1',200),
      'line2',private.dm_chatgpt_text(v_address->'line2','customer.address.line2',200),
      'town',private.dm_chatgpt_text(v_address->'town','customer.address.town',120),
      'postcode',private.dm_chatgpt_text(v_address->'postcode','customer.address.postcode',20)));
  v_title := private.dm_chatgpt_text(p_request->'title','title',300);
  if v_title='' then raise exception 'title is required: a short job title for the invoice.' using errcode='22023'; end if;

  foreach v_group in array array['works','materials'] loop
    v_items := '[]'::jsonb; v_keys := '[]'::jsonb;
    if coalesce(jsonb_typeof(p_request->v_group),'null')<>'null' then
      if jsonb_typeof(p_request->v_group)<>'array' then raise exception '% must be a list of items.', v_group using errcode='22023'; end if;
      if jsonb_array_length(p_request->v_group)>200 then raise exception '% can have at most 200 items.', v_group using errcode='22023'; end if;
      for v_line in select value from jsonb_array_elements(p_request->v_group) loop
        if jsonb_typeof(v_line)<>'object' then raise exception 'Every item in % must be {"description", "quantity", "unit", "unitPrice"}.', v_group using errcode='22023'; end if;
        perform private.dm_chatgpt_only(v_line,'An item in '||v_group,array['description','quantity','unit','unitPrice']);
        v_description := private.dm_chatgpt_text(v_line->'description','An item description',1000);
        if v_description='' then raise exception 'Every item in % needs a description.', v_group using errcode='22023'; end if;
        v_quantity := private.dm_chatgpt_number(v_line->'quantity',format('The quantity of "%s"',v_description),0.001,1000000,3);
        v_price := private.dm_chatgpt_number(v_line->'unitPrice',format('The unitPrice of "%s" (pounds, before VAT)',v_description),0,10000000,2);
        if v_quantity is null or v_price is null then raise exception '"%" needs a quantity and a unitPrice from Mike. Never estimate a price.', v_description using errcode='22023'; end if;
        v_unit := private.dm_chatgpt_text(v_line->'unit',format('The unit of "%s"',v_description),30);
        v_items := v_items || jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'description',v_description,'quantity',v_quantity,'unit',v_unit,'unitPrice',v_price));
        v_keys := v_keys || jsonb_build_array(jsonb_build_array(private.dm_normal(v_description),v_quantity,private.dm_normal(v_unit),round(v_price*100)));
      end loop;
    end if;
    v_lines := v_lines || jsonb_build_object(v_group,v_items);
    v_line_keys := v_line_keys || jsonb_build_object(v_group,v_keys);
  end loop;
  if jsonb_array_length(v_lines->'works')+jsonb_array_length(v_lines->'materials')=0 then
    raise exception 'Add at least one priced item from Mike in works or materials.' using errcode='22023';
  end if;
  v_subtotal := private.dm_lines_pence(v_lines->'works')+private.dm_lines_pence(v_lines->'materials');
  if v_subtotal>1000000000 then raise exception 'The items add up to more than £10,000,000. Check the figures with Mike.' using errcode='22023'; end if;
  v_expected := private.dm_chatgpt_number(p_request->'expectedSubtotal','expectedSubtotal',0,10000000,2);
  if v_expected is null then raise exception 'expectedSubtotal is required: the sum of Mike''s prices in pounds before VAT.' using errcode='22023'; end if;
  if round(v_expected*100)<>v_subtotal then
    raise exception 'The items add up to % before VAT, but Mike''s figures came to %. Nothing was saved. Check the quantities and prices with Mike.',
      private.dm_gbp(v_subtotal), private.dm_gbp(round(v_expected*100)::bigint) using errcode='22023';
  end if;
  if coalesce(jsonb_typeof(p_request->'scope'),'null')<>'null' then
    if jsonb_typeof(p_request->'scope')<>'array' or jsonb_array_length(p_request->'scope')>60 then raise exception 'scope must be a list of at most 60 short points.' using errcode='22023'; end if;
    for v_line in select value from jsonb_array_elements(p_request->'scope') loop
      -- As lib/admin/normalise.ts textList: list markers are not part of a point.
      v_text := regexp_replace(regexp_replace(private.dm_chatgpt_text(v_line,'Each scope point',1000),'^\s*(?:[-•*]|\d+[.)])\s+',''),'^\s+|\s+$','','g');
      if v_text<>'' then v_scope := v_scope || to_jsonb(v_text); end if;
    end loop;
  end if;
  v_test := coalesce(private.dm_chatgpt_flag(p_request->'testDocument','testDocument'),false);
  v_allow := coalesce(private.dm_chatgpt_flag(p_request->'allowDuplicate','allowDuplicate'),false);

  -- 2. Mike's records, locked like every admin save, so concurrent and repeated
  --    requests are serialised and see each other's results.
  perform 1 from public.admin_settings where owner_id=v_owner for update;
  if not found then raise exception 'D&M business settings have not been saved yet. Open D&M admin, check Settings and save them once, then try again.' using errcode='55000'; end if;
  v_snapshot := private.dm_read_data(v_owner);
  v_settings := v_snapshot#>'{data,settings}';
  if jsonb_typeof(v_settings->'paymentTermsDays') is distinct from 'number' or jsonb_typeof(v_settings->'vatRegistered') is distinct from 'boolean'
    or jsonb_typeof(v_settings->'defaultVatRate') is distinct from 'number' or jsonb_typeof(v_settings->'bank') is distinct from 'object'
    or jsonb_typeof(v_settings->'defaultPaymentNote') is distinct from 'string' or jsonb_typeof(v_settings->'invoicePrefix') is distinct from 'string' then
    raise exception 'D&M business settings have not been saved yet. Open D&M admin, check Settings and save them once, then try again.' using errcode='55000';
  end if;
  v_enabled := (v_settings->>'vatRegistered')::boolean;
  v_rate := (v_settings->>'defaultVatRate')::numeric;
  if jsonb_typeof(p_request->'vat')='boolean' then v_enabled := (p_request->>'vat')::boolean;
  elsif jsonb_typeof(p_request->'vat')='object' then
    perform private.dm_chatgpt_only(p_request->'vat','vat',array['enabled','rate']);
    v_enabled := coalesce(private.dm_chatgpt_flag(p_request#>'{vat,enabled}','vat.enabled'),v_enabled);
    v_rate := coalesce(private.dm_chatgpt_number(p_request#>'{vat,rate}','vat.rate',0,100,2),v_rate);
  elsif coalesce(jsonb_typeof(p_request->'vat'),'null')<>'null' then
    raise exception 'vat must be true, false or {"enabled": true, "rate": 20}. Leave it out to use the business setting.' using errcode='22023';
  end if;
  if v_rate<0 or v_rate>100 then raise exception 'The VAT rate must be from 0 to 100.' using errcode='22023'; end if;
  v_vat := jsonb_build_object('enabled',v_enabled,'rate',trim_scale(v_rate));
  v_due := coalesce(private.dm_chatgpt_number(p_request->'dueInDays','dueInDays',0,365,0),(v_settings->>'paymentTermsDays')::numeric)::integer;
  v_today := (now() at time zone 'Europe/London')::date;
  v_now := to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  -- 3. Duplicates. The ID is derived from the request, so a retried call finds
  --    its earlier result; a reworded repeat within 30 minutes is held back.
  v_id := 'cgs-' || case when v_allow then left(replace(gen_random_uuid()::text,'-',''),30)
    else left(encode(sha256(convert_to(jsonb_build_array('invoice',v_today,private.dm_normal(v_name),
      private.dm_normal(concat_ws(', ',nullif(v_customer#>>'{address,line1}',''),nullif(v_customer#>>'{address,line2}',''),nullif(v_customer#>>'{address,town}',''),nullif(v_customer#>>'{address,postcode}',''))),
      private.dm_normal(v_title),v_line_keys->'works',v_line_keys->'materials',v_vat,v_test)::text,'UTF8')),'hex'),30) end;
  select * into v_row from public.admin_documents where owner_id=v_owner and external_id=v_id;
  if found then
    if v_row.kind<>'invoice' then raise exception 'A different record already uses this request''s ID. Nothing was saved.'; end if;
    v_summary := private.dm_chatgpt_invoice_summary(v_row.payload);
    return jsonb_build_object('status','already_created','verified',true,'invoice',v_summary,'customerLink',null,
      'customerLinkStatus',case when exists(select 1 from private.dm_document_shares s where s.document_id=v_row.id and s.revoked_at is null) then 'already_issued' else 'none' end,
      'message',format('Invoice %s for %s (total %s) was already created by an identical earlier request; no duplicate was made. Its customer link was given when it was first made and is left working, because links cannot be shown again. If Mike needs a new link, he can make one in D&M admin (the earlier link then stops working): %s',
        v_summary->>'number',v_summary->>'customer',v_summary->>'total',v_summary->>'adminUrl'));
  end if;
  if not v_allow then
    select d.payload into v_twin from public.admin_documents d
    where d.owner_id=v_owner and d.kind='invoice' and d.created_at>now()-interval '30 minutes'
      and private.dm_normal(d.payload#>>'{customer,name}')=private.dm_normal(v_name)
      and private.dm_lines_pence(d.payload->'works')+private.dm_lines_pence(d.payload->'materials')=v_subtotal
    order by d.created_at desc limit 1;
    if v_twin is not null then
      v_summary := private.dm_chatgpt_invoice_summary(v_twin);
      return jsonb_build_object('status','possible_duplicate','verified',false,'existingInvoice',v_summary,'customerLink',null,
        'message',format('Nothing was created: invoice %s for %s with the same subtotal (%s) was made in the last 30 minutes. Ask Mike whether that is the one he means. Only if he explicitly wants a second invoice, run the request again with "allowDuplicate": true.',
          v_summary->>'number',v_summary->>'customer',v_summary->>'subtotal'));
    end if;
  end if;

  -- 4. The invoice as lib/admin/operations.ts createInvoice makes it. The database
  --    allocates the real number while saving; TEST invoices take a TEST- number.
  v_invoice := jsonb_build_object(
    'kind','invoice','id',v_id,'number',case when v_test then 'TEST-'||replace(v_id,'-','') else '' end,'status','draft',
    'title',v_title,'customer',v_customer,'issueDate',v_today,'dueDate',v_today+v_due,'quoteId',null,'quoteNumber','',
    'scope',v_scope,'works',v_lines->'works','materials',v_lines->'materials',
    'materialsNote',private.dm_chatgpt_text(p_request->'materialsNote','materialsNote',4000),'vat',v_vat,'payments','[]'::jsonb,
    'bank',case when v_test then jsonb_build_object('accountName','','sortCode','','accountNumber','')
      else jsonb_build_object('accountName',coalesce(v_settings#>>'{bank,accountName}',''),'sortCode',coalesce(v_settings#>>'{bank,sortCode}',''),'accountNumber',coalesce(v_settings#>>'{bank,accountNumber}','')) end,
    'paymentNote',case when v_test then '' when p_request ? 'paymentNote' then private.dm_chatgpt_text(p_request->'paymentNote','paymentNote',4000) else v_settings->>'defaultPaymentNote' end,
    'internalNotes',case when p_request ? 'internalNotes' then private.dm_chatgpt_text(p_request->'internalNotes','internalNotes',4000) when v_test then c_test_note else '' end,
    'share',jsonb_build_object('token',null,'status','not-available'),'createdAt',v_now,'updatedAt',v_now)
    || case when v_test then jsonb_build_object('isTest',true) else '{}'::jsonb end;
  v_data := v_snapshot->'data';
  v_data := jsonb_set(v_data,'{invoices}',jsonb_build_array(v_invoice)||(v_data->'invoices'));
  perform private.dm_save_owner_data(v_owner,v_data,(v_snapshot->>'revision')::bigint);

  -- 5. Read back: the record must hold exactly what was asked, with a database-issued number.
  select * into v_row from public.admin_documents where owner_id=v_owner and external_id=v_id and kind='invoice';
  v_number := v_row.document_number;
  v_prefix := left(coalesce(nullif(v_settings->>'invoicePrefix',''),'INV-'),20);
  if v_row.id is null or v_number is null or v_row.payload->>'number' is distinct from v_number
    or (v_row.payload-'number') is distinct from (v_invoice-'number')
    or (v_test and v_number<>'TEST-'||replace(v_id,'-',''))
    or (not v_test and not (left(v_number,length(v_prefix))=v_prefix and substring(v_number from length(v_prefix)+1) ~ '^[0-9]{4,9}$')) then
    raise exception 'D&M could not confirm the invoice when it read it back, so nothing was saved. Check D&M admin before trying again.';
  end if;

  -- 6. The customer link, opened exactly as the customer's page opens it: as the
  --    anonymous role, through public.dm_get_shared_document.
  v_token := private.dm_create_owner_share(v_owner,v_id);
  set local role anon;
  v_shown := public.dm_get_shared_document(v_token)->'document';
  set local role none;
  if v_shown is null or v_shown->>'kind' is distinct from 'invoice' or v_shown->>'number' is distinct from v_number
    or v_shown#>>'{customer,name}' is distinct from v_name or v_shown->'vat' is distinct from v_vat
    or coalesce(v_shown->'isTest','false'::jsonb) is distinct from to_jsonb(v_test)
    or private.dm_lines_pence(v_shown->'works')+private.dm_lines_pence(v_shown->'materials')<>v_subtotal then
    raise exception 'The customer link did not open this invoice when it was checked, so nothing was saved. Try again later or create the invoice in D&M admin.';
  end if;

  v_summary := private.dm_chatgpt_invoice_summary(v_row.payload);
  return jsonb_build_object('status','created','verified',true,'invoice',v_summary,
    'customerLink',c_site||'/d/'||v_token,'customerLinkStatus','new',
    'message',format('Created invoice %s for %s: %s. Total %s (%s), due %s. Customer link: %s (checked: it opens this invoice; anyone with the link can view and print it).%s In D&M admin: %s',
      v_number,v_name,v_title,v_summary->>'total',v_summary->>'vat',to_char(v_today+v_due,'FMDD FMMonth YYYY'),c_site||'/d/'||v_token,
      case when v_test then ' This is a TEST invoice: no payment is due. Remove it afterwards with private.dm_chatgpt_remove_test_invoice.' else '' end,
      v_summary->>'adminUrl'));
end;
$function$;

-- Removes one TEST invoice through the same save path (its customer link stops
-- working at once). Real invoices are refused: Mike deletes those in D&M admin.
create or replace function private.dm_chatgpt_remove_test_invoice(p_number text) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $function$
declare v_owner uuid; v_row public.admin_documents%rowtype; v_snapshot jsonb; v_data jsonb;
begin
  v_owner := private.dm_chatgpt_owner();
  perform 1 from public.admin_settings where owner_id=v_owner for update;
  select * into v_row from public.admin_documents where owner_id=v_owner and kind='invoice' and document_number=btrim(coalesce(p_number,''));
  if not found then raise exception 'No invoice is numbered %.', p_number using errcode='P0002'; end if;
  if v_row.payload->'isTest' is distinct from 'true'::jsonb or left(v_row.document_number,5)<>'TEST-' then
    raise exception 'Invoice % is not a TEST invoice. Only TEST invoices can be removed this way; Mike deletes real invoices in D&M admin.', v_row.document_number using errcode='42501';
  end if;
  v_snapshot := private.dm_read_data(v_owner);
  v_data := v_snapshot->'data';
  -- As lib/admin/operations.ts deleteInvoice: linked diary bookings stay, unlinked.
  v_data := jsonb_set(v_data,'{invoices}',coalesce((select jsonb_agg(i) from jsonb_array_elements(v_data->'invoices') i where i->>'id'<>v_row.external_id),'[]'::jsonb));
  v_data := jsonb_set(v_data,'{bookings}',coalesce((select jsonb_agg(case when b->>'invoiceId'=v_row.external_id then jsonb_set(b,'{invoiceId}','null'::jsonb) else b end) from jsonb_array_elements(v_data->'bookings') b),'[]'::jsonb));
  perform private.dm_save_owner_data(v_owner,v_data,(v_snapshot->>'revision')::bigint);
  -- A TEST number is derived from its request; releasing it lets the same test run again.
  delete from private.dm_number_reservations where owner_id=v_owner and kind='invoice' and number=v_row.document_number;
  if exists(select 1 from public.admin_documents where id=v_row.id) or exists(select 1 from private.dm_document_shares where document_id=v_row.id) then
    raise exception 'TEST invoice % was still present when read back, so nothing was removed.', v_row.document_number;
  end if;
  return jsonb_build_object('status','removed','number',v_row.document_number,
    'message',format('TEST invoice %s has been removed and its customer link no longer opens.',v_row.document_number));
end;
$function$;

comment on function private.dm_chatgpt_create_invoice(jsonb) is
  'Creates a D&M invoice from Mike''s figures for his ChatGPT''s Supabase connection (postgres role only) and returns its number, total and checked customer link. See docs/chatgpt-invoices.md.';
comment on function private.dm_chatgpt_remove_test_invoice(text) is
  'Removes one TEST invoice made by private.dm_chatgpt_create_invoice (postgres role only). See docs/chatgpt-invoices.md.';

-- No API role may call any of these. The guarded RPCs keep their existing grants.
revoke all on function private.dm_save_owner_data(uuid,jsonb,bigint),private.dm_create_owner_share(uuid,text),
  private.dm_normal(text),private.dm_lines_pence(jsonb),private.dm_gbp(bigint),private.dm_chatgpt_only(jsonb,text,text[]),
  private.dm_chatgpt_text(jsonb,text,integer),private.dm_chatgpt_number(jsonb,text,numeric,numeric,integer),private.dm_chatgpt_flag(jsonb,text),
  private.dm_chatgpt_owner(),private.dm_chatgpt_invoice_summary(jsonb),private.dm_chatgpt_create_invoice(jsonb),private.dm_chatgpt_remove_test_invoice(text)
  from public,anon,authenticated,service_role;
commit;
