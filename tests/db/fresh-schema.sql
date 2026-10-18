\set ON_ERROR_STOP on

-- A separate empty-install path complements security.sql's historical upgrade.
-- Fixtures are test-only and rolled back; no account or invoice is issued.
begin;
create schema test;
grant usage on schema test to anon, authenticated;
create function test.check(condition boolean, message text) returns void
language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'FAILED: %', message; end if;
end;
$$;
create function test.expect_error(statement text, expected_state text, message text) returns void
language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate = expected_state then return; end if;
    raise exception 'FAILED: % (expected SQLSTATE %, got %: %)', message, expected_state, sqlstate, sqlerrm;
  end;
  raise exception 'FAILED: % (statement unexpectedly succeeded)', message;
end;
$$;

select test.check((select count(*)=0 from public.admin_members)
  and (select count(*)=0 from public.admin_documents)
  and (select count(*)=0 from public.admin_settings)
  and (select count(*)=0 from public.admin_sequences), 'Base plus canonical installation starts without fabricated application records');
select test.check((select count(*)=0 from auth.users), 'Installation does not fabricate Auth users');
select test.check((select bool_and(relrowsecurity) from pg_class where oid in (
  'public.admin_members'::regclass, 'public.admin_documents'::regclass,
  'public.admin_settings'::regclass, 'public.admin_sequences'::regclass
)), 'Fresh application tables have RLS enabled');
select test.check((select count(*)=4 from pg_constraint where conrelid in (
  'public.admin_members'::regclass, 'public.admin_documents'::regclass,
  'public.admin_settings'::regclass, 'public.admin_sequences'::regclass
) and confrelid='auth.users'::regclass and confdeltype='c'), 'Every base owner/member foreign key preserves the source Auth deletion semantics');

set local role anon;
select test.expect_error('select * from public.admin_documents', '42501', 'Fresh-schema anonymous direct document reads are denied');
select test.expect_error('select public.dm_get_data()', '42501', 'Fresh-schema anonymous admin RPC is denied');
select test.check(public.dm_get_shared_document(repeat('0',64)) is null, 'Fresh-schema unknown share tokens return no data');
reset role;

-- Test the real production enrolment trigger after installation, rather than
-- relying on the migration's backfill of an already-confirmed fixture user.
insert into auth.users(id,email) values
  ('33333333-3333-4333-8333-333333333333','mike@dmpaintingdecorating.co.uk'),
  ('44444444-4444-4444-8444-444444444444','other@example.test');
insert into auth.sessions(id,user_id) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','33333333-3333-4333-8333-333333333333');
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333","session_id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}',true);
set local role authenticated;
select test.check(not public.dm_admin_is_member(), 'A newly created unconfirmed Mike account is denied');
reset role;
update auth.users set email_confirmed_at=now();
select test.check((select count(*)=1 from public.admin_members), 'Post-install confirmation enrols only Mike');
set local role authenticated;
select test.check(public.dm_admin_is_member(), 'Post-install confirmed Mike with a real matching fixture session is authorised');

do $test$
declare initial jsonb := public.dm_get_data(); data jsonb; saved jsonb;
begin
  perform test.check((initial->>'revision')::bigint=0, 'First read has revision zero without a settings row');
  perform test.check(initial#>'{data,quotes}'='[]'::jsonb and initial#>'{data,invoices}'='[]'::jsonb and initial#>'{data,bookings}'='[]'::jsonb, 'First read returns empty document collections');
  data := (initial->'data') || jsonb_build_object(
    'settings',jsonb_build_object('businessName','Fresh test business','quotePrefix','Q-','invoicePrefix','INV-','nextQuoteNumber',1,'nextInvoiceNumber',1),
    'quotes',jsonb_build_array(jsonb_build_object('id','fresh-quote','kind','quote','number','','title','Fresh quotation','customer',jsonb_build_object('name','Fresh test customer'))),
    'invoices',jsonb_build_array(jsonb_build_object('id','fresh-invoice','kind','invoice','number','','isTest',true,'title','Unissued fresh test invoice','quoteId','fresh-quote','quoteNumber','','customer',jsonb_build_object('name','Fresh test customer'),'works','[]'::jsonb,'materials','[]'::jsonb,'payments','[]'::jsonb)),
    'bookings',jsonb_build_array(jsonb_build_object('id','fresh-booking','kind','booking','job','Fresh test booking','quoteId','fresh-quote','invoiceId','fresh-invoice'))
  );
  saved := public.dm_save_data(data,0);
  perform test.check((saved->>'revision')::bigint=1, 'First save initialises the owner settings/revision row atomically');
  perform test.check(saved#>>'{data,quotes,0,number}'='Q-0001' and saved#>>'{data,invoices,0,number}'='INV-0001', 'Fresh sequence allocation starts at one for both kinds');
  perform test.check(saved#>>'{data,invoices,0,quoteNumber}'='Q-0001', 'Fresh invoice receives the canonical linked quote number');
  perform test.check(saved#>>'{data,bookings,0,invoiceId}'='fresh-invoice', 'Fresh diary links persist');
  perform test.check(public.dm_get_data()=saved, 'A subsequent independent read returns the persisted first save');
end;
$test$;
select set_config('dm_test.fresh_token',public.dm_create_share('fresh-invoice'),true);
reset role;
select set_config('request.jwt.claims','{}',true);
set local role anon;
select test.check(public.dm_get_shared_document(current_setting('dm_test.fresh_token'))#>>'{document,customer,name}'='Fresh test customer', 'Fresh customer share resolves without admin credentials');
select test.expect_error('select public.dm_get_data()', '42501', 'Fresh customer access cannot enter admin RPCs');
reset role;
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333","session_id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}',true);
set local role authenticated;
select public.dm_revoke_share('fresh-invoice');
reset role;
set local role anon;
select test.check(public.dm_get_shared_document(current_setting('dm_test.fresh_token')) is null, 'Fresh customer link revocation works');
reset role;

-- Exercise source constraints using real rows, not text comparisons of SQL.
select test.expect_error('insert into public.admin_sequences(owner_id,kind,next_number) values(''44444444-4444-4444-8444-444444444444'',''invoice'',0)','23514','Fresh sequences reject a nonpositive next number');
select test.expect_error('insert into public.admin_documents(owner_id,external_id,kind,payload) values(''44444444-4444-4444-8444-444444444444'',''bad-payload'',''invoice'',''[]'')','23514','Fresh document payloads must be JSON objects');
select test.expect_error('insert into public.admin_documents(owner_id,external_id,kind,payload) values(''44444444-4444-4444-8444-444444444444'',''bad-kind'',''unknown'',''{}'')','23514','Fresh documents reject unsupported kinds');

rollback;
\echo 'Fresh base-schema installation, enrolment, persistence and share checks passed.'
