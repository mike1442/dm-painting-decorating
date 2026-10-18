\set ON_ERROR_STOP on

-- All fixtures are disposable and rolled back. These checks run against
-- PostgreSQL, including real roles, privileges, RLS, functions and triggers.
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

select test.check((select count(*) = 1 from public.admin_members), 'Upgrade removes unrelated legacy members');
select test.check((select count(*) = 2 from public.admin_documents), 'Upgrade preserves both owners historical documents');
select test.check((select count(*) = 1 from private.dm_number_reservations where number = 'Q-0042'), 'Historical numbers are reserved');
select test.check((select bool_and(relrowsecurity) from pg_class where oid in (
  'public.admin_members'::regclass, 'public.admin_documents'::regclass,
  'public.admin_settings'::regclass, 'public.admin_sequences'::regclass,
  'private.dm_document_shares'::regclass, 'private.dm_number_reservations'::regclass
)), 'RLS remains enabled on every admin table');
select test.check(not has_function_privilege('anon', 'private.dm_read_data(uuid)', 'execute'), 'Anonymous callers cannot use the private owner reader');
select test.check(not has_function_privilege('authenticated', 'private.dm_read_data(uuid)', 'execute'), 'Authenticated callers cannot use the private owner reader');
select test.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.proname like 'dm_%'
    and p.prosecdef and not coalesce('search_path=""' = any(p.proconfig), false)
), 'Every privileged helper fixes an empty search_path');

set local role anon;
select test.expect_error('select * from public.admin_documents', '42501', 'Anonymous direct document reads are denied');
select test.expect_error('select * from public.admin_members', '42501', 'Anonymous membership reads are denied');
select test.expect_error('select * from public.admin_settings', '42501', 'Anonymous settings reads are denied');
select test.expect_error('select * from public.admin_sequences', '42501', 'Anonymous sequence reads are denied');
select test.expect_error('select * from private.dm_document_shares', '42501', 'Anonymous share-hash reads are denied');
select test.expect_error('select public.dm_get_data()', '42501', 'Anonymous admin RPC is denied');
select test.expect_error('select private.dm_read_data(''11111111-1111-4111-8111-111111111111'')', '42501', 'Anonymous private reader is denied');
select test.check(public.dm_get_shared_document('not-a-token') is null, 'Malformed customer tokens return no document');
select test.check(public.dm_get_shared_document(repeat('0', 64)) is null, 'Unguessed customer tokens return no document');
reset role;

-- JWT-controlled metadata cannot turn the unrelated authenticated user into Mike.
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","session_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","email":"mike@dmpaintingdecorating.co.uk","user_metadata":{"admin":true,"email":"mike@dmpaintingdecorating.co.uk"}}', true);
set local role authenticated;
select test.check(not public.dm_admin_is_member(), 'Forged email/metadata cannot grant administrator membership');
select test.expect_error('select public.dm_get_data()', '42501', 'Other authenticated users cannot read admin data');
select test.expect_error('select public.dm_create_share(''legacy-quote-1'')', '42501', 'Other authenticated users cannot share Mike documents');
select test.expect_error('select * from public.admin_documents', '42501', 'Authenticated direct-table access is denied');
select test.expect_error('insert into public.admin_members(user_id) values (auth.uid())', '42501', 'Authenticated users cannot enrol themselves');
reset role;

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","email":"mike@dmpaintingdecorating.co.uk"}', true);
set local role authenticated;
select test.check(public.dm_admin_is_member(), 'Confirmed Mike with an active session is authorised');
select test.check((public.dm_get_data()#>>'{data,quotes,0,number}') = 'Q-0042', 'Historical quotation is readable after upgrade');
select test.check(jsonb_array_length(public.dm_get_data()#>'{data,invoices}') = 0, 'Other owner documents never enter Mike data');
select test.expect_error('select public.dm_create_share(''foreign-invoice-1'')', 'P0002', 'Mike cannot share another owners document');
select test.expect_error('select * from public.admin_documents', '42501', 'Even Mike uses guarded RPCs rather than direct tables');
select set_config('dm_test.guard_snapshot', public.dm_get_data()::text, true);
reset role;

-- The enrolment trigger responds to current Auth state; old JWTs do not bypass it.
update auth.users set email_confirmed_at = null where id = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
select test.check(not public.dm_admin_is_member(), 'An unconfirmed Mike account is denied');
select test.expect_error('select public.dm_get_data()', '42501', 'Unconfirmed account cannot read existing records');
reset role;
update auth.users set email_confirmed_at = now() where id = '11111111-1111-4111-8111-111111111111';
update auth.users set email = 'changed@example.test' where id = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
select test.check(not public.dm_admin_is_member(), 'Changing the current Auth email revokes membership despite the old JWT');
reset role;
update auth.users set email = 'mike@dmpaintingdecorating.co.uk', banned_until = now() + interval '1 day' where id = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
select test.check(not public.dm_admin_is_member(), 'Banned Mike account is denied');
reset role;
update auth.users set banned_until = null where id = '11111111-1111-4111-8111-111111111111';
update auth.users set deleted_at = now() where id = '11111111-1111-4111-8111-111111111111';
select test.check(exists(select 1 from public.admin_members where user_id = '11111111-1111-4111-8111-111111111111'), 'Soft-deletion regression retains membership so the current Auth guard must deny access');
set local role authenticated;
select test.check(not public.dm_admin_is_member(), 'A soft-deleted Auth account is denied');
select test.expect_error('select public.dm_get_data()', '42501', 'A soft-deleted account cannot replay a read RPC with its existing JWT');
select test.expect_error(
  format('select public.dm_save_data(%L::jsonb, 0)', current_setting('dm_test.guard_snapshot')::jsonb->'data'),
  '42501', 'A soft-deleted account cannot replay a valid save RPC'
);
select test.expect_error('select public.dm_create_share(''legacy-quote-1'')', '42501', 'A soft-deleted account cannot create customer links');
reset role;
update auth.users set deleted_at = null where id = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
select test.check(public.dm_admin_is_member(), 'Restoring the Auth account restores access with the same live session');
select test.check((public.dm_get_data()->>'revision')::bigint = 0, 'Denied soft-deleted-account saves leave the cloud revision unchanged');
reset role;
update auth.sessions set not_after = now() - interval '1 second' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select test.check(exists(select 1 from auth.sessions where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'Expiry regression retains the session row so presence alone cannot authorise access');
set local role authenticated;
select test.check(not public.dm_admin_is_member(), 'An expired Auth session is denied');
select test.expect_error('select public.dm_get_data()', '42501', 'An expired session cannot replay an admin RPC');
select test.expect_error(
  format('select public.dm_save_data(%L::jsonb, 0)', current_setting('dm_test.guard_snapshot')::jsonb->'data'),
  '42501', 'An expired session cannot replay a valid save RPC'
);
select test.expect_error('select public.dm_create_share(''legacy-quote-1'')', '42501', 'An expired session cannot create customer links');
reset role;
update auth.sessions set not_after = now() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
select test.check(not public.dm_admin_is_member(), 'A session expiring exactly now is denied');
reset role;
update auth.sessions set not_after = now() + interval '1 hour' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
select test.check(public.dm_admin_is_member(), 'An explicitly unexpired session remains authorised');
select test.check((public.dm_get_data()->>'revision')::bigint = 0, 'Denied expired-session saves leave the cloud revision unchanged');
reset role;
update auth.sessions set not_after = null where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
delete from auth.sessions where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
select test.check(not public.dm_admin_is_member(), 'Deleting the session revokes an otherwise unexpired JWT');
select test.expect_error('select public.dm_get_data()', '42501', 'Revoked session cannot replay an admin RPC');
reset role;
insert into auth.sessions(id, user_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111');

set local role authenticated;
do $test$
declare
  initial jsonb := public.dm_get_data();
  data jsonb := initial->'data';
  saved jsonb;
begin
  data := data || jsonb_build_object(
    'settings', jsonb_build_object(
      'businessName', 'D&M Painting & Decorating', 'address', jsonb_build_object('line1', 'Test business address', 'line2', '', 'town', 'Test town', 'postcode', 'TE1 1ST'),
      'phone', 'TEST PHONE', 'email', 'test@example.test', 'website', 'example.test', 'vatNumber', '', 'companyNumber', '',
      'quotePrefix', 'Q-', 'invoicePrefix', 'INV-', 'nextQuoteNumber', 43, 'nextInvoiceNumber', 1,
      'bank', jsonb_build_object('accountName', 'PRIVATE BUSINESS BANK', 'sortCode', '00-00-00', 'accountNumber', '00000000'),
      'defaultQuoteIntro', 'PRIVATE DEFAULT', 'defaultTerms', jsonb_build_array('PRIVATE DEFAULT TERMS')
    ),
    'invoices', jsonb_build_array(
      jsonb_build_object(
        'id', 'bill-gates-test', 'kind', 'invoice', 'number', 'TEST-1680', 'status', 'draft', 'isTest', true,
        'title', 'Painting a 20m² wall', 'issueDate', '2026-10-17', 'dueDate', '2026-10-31', 'quoteId', null, 'quoteNumber', '',
        'customer', jsonb_build_object('name', 'Bill Gates', 'email', 'PRIVATE CUSTOMER EMAIL', 'phone', 'PRIVATE CUSTOMER PHONE', 'address', jsonb_build_object('line1', '', 'line2', '', 'town', '', 'postcode', '')),
        'scope', jsonb_build_array('Painting a 20m² wall'),
        'works', jsonb_build_array(
          jsonb_build_object('id', 'painter-one', 'description', 'Painter 1', 'quantity', 3, 'unit', 'days', 'unitPrice', 250),
          jsonb_build_object('id', 'painter-two', 'description', 'Painter 2', 'quantity', 3, 'unit', 'days', 'unitPrice', 250)
        ),
        'materials', jsonb_build_array(jsonb_build_object('id', 'materials-one', 'description', 'Materials', 'quantity', 1, 'unit', '', 'unitPrice', 180)),
        'materialsNote', '', 'vat', jsonb_build_object('enabled', false, 'rate', 20), 'payments', '[]'::jsonb,
        'bank', jsonb_build_object('accountName', 'PRIVATE TEST BANK', 'sortCode', '00-00-00', 'accountNumber', '00000000'),
        'paymentNote', '', 'internalNotes', 'PRIVATE BILL NOTES', 'futurePrivateField', 'PRIVATE FUTURE FIELD',
        'share', jsonb_build_object('token', 'PRIVATE OLD TOKEN')
      ),
      jsonb_build_object('id', 'other-customer-invoice', 'kind', 'invoice', 'number', 'TEST-1680', 'status', 'draft',
        'customer', jsonb_build_object('name', 'Other customer'), 'internalNotes', 'PRIVATE OTHER CUSTOMER', 'payments', '[]'::jsonb,
        'works', '[]'::jsonb, 'materials', '[]'::jsonb)
    ),
    'bookings', jsonb_build_array(jsonb_build_object('id', 'linked-booking', 'kind', 'booking', 'job', 'Painting a 20m² wall', 'customerName', 'Bill Gates', 'start', '2026-10-19', 'end', '2026-10-21', 'quoteId', 'legacy-quote-1', 'invoiceId', 'bill-gates-test', 'notes', 'PRIVATE DIARY NOTES'))
  );
  saved := public.dm_save_data(data, (initial->>'revision')::bigint);
  perform test.check((saved->>'revision')::bigint = 1, 'Saving advances the owner revision');
  perform test.check(jsonb_array_length(saved#>'{data,invoices}') = 2, 'Invoice creation persists both records');
  perform test.check(jsonb_array_length(saved#>'{data,bookings}') = 1, 'Linked diary booking persists');
  perform test.check(saved#>>'{data,bookings,0,invoiceId}' = 'bill-gates-test', 'Booking invoice link survives storage');
  perform set_config('dm_test.saved', saved::text, true);
end;
$test$;

select test.expect_error(
  format('select public.dm_save_data(%L::jsonb, 0)', current_setting('dm_test.saved')::jsonb->'data'),
  '40001', 'A stale device revision cannot overwrite newer cloud records'
);
select test.check((public.dm_get_data()->>'revision')::bigint = 1, 'A conflict does not advance the revision');
select test.expect_error('select public.dm_save_data(''{"quotes":[],"invoices":[],"bookings":[],"settings":{}}'', -1)', '22023', 'Negative revisions are rejected');
select test.expect_error('select public.dm_save_data(''{"quotes":[{"id":"duplicate-id","kind":"quote"},{"id":"duplicate-id","kind":"quote"}],"invoices":[],"bookings":[],"settings":{}}'', 1)', '22023', 'Duplicate document IDs are rejected');
select test.expect_error('select public.dm_save_data(''{"quotes":[{"id":"wrong-kind","kind":"invoice"}],"invoices":[],"bookings":[],"settings":{}}'', 1)', '22023', 'Document kinds cannot be smuggled into a different collection');
select test.expect_error('select public.dm_create_share(''linked-booking'')', 'P0002', 'Diary entries cannot be shared with customers');
select set_config('dm_test.invoice_token', public.dm_create_share('bill-gates-test'), true);
select set_config('dm_test.quote_token', public.dm_create_share('legacy-quote-1'), true);
select test.check(current_setting('dm_test.invoice_token') ~ '^[a-f0-9]{64}$', 'Share token has 256 bits of random hexadecimal material');
reset role;

select test.check((select count(distinct document_number) = 2 from public.admin_documents where owner_id = '11111111-1111-4111-8111-111111111111' and kind = 'invoice'), 'Colliding proposed invoice numbers are allocated uniquely');
select test.check((select document_number = 'TEST-1680' from public.admin_documents where external_id = 'bill-gates-test'), 'A unique imported test number is preserved');
select test.check((select next_number >= 2 from public.admin_sequences where owner_id = '11111111-1111-4111-8111-111111111111' and kind = 'invoice'), 'Canonical numbering advances the server counter');
select test.check(exists (
  select 1 from private.dm_document_shares where token_hash = encode(sha256(convert_to(current_setting('dm_test.invoice_token'), 'UTF8')), 'hex')
), 'The database stores a SHA-256 hash of the customer token');
select test.check(not exists (
  select 1 from private.dm_document_shares where token_hash = current_setting('dm_test.invoice_token')
), 'The raw customer token is never stored as its hash');

-- Anonymous role has no admin cookies/session; a token selects one document.
select set_config('request.jwt.claims', '{}', true);
set local role anon;
do $test$
declare
  shared jsonb := public.dm_get_shared_document(current_setting('dm_test.invoice_token'));
  total numeric;
begin
  perform test.check(shared#>>'{document,customer,name}' = 'Bill Gates', 'Anonymous customer link opens exactly Bill Gates test invoice');
  perform test.check(shared#>>'{document,isTest}' = 'true', 'The customer document retains the test-only marker');
  perform test.check(shared#>>'{document,status}' = 'draft', 'The test invoice remains unissued');
  select sum((item->>'quantity')::numeric * (item->>'unitPrice')::numeric) into total
  from jsonb_array_elements((shared#>'{document,works}') || (shared#>'{document,materials}')) item;
  perform test.check(total = 1680, 'Bill Gates example is GBP 1,680 before optional VAT');
  perform test.check(shared#>>'{document,vat,enabled}' = 'false', 'VAT is not silently charged on the test invoice');
  perform test.check(not (shared->'document' ?| array['id', 'internalNotes', 'futurePrivateField', 'share', 'quoteId']), 'Positive document projection excludes internal fields');
  perform test.check(not (shared->'business' ?| array['bank', 'defaultQuoteIntro', 'defaultTerms', 'nextInvoiceNumber', 'nextQuoteNumber']), 'Business projection excludes private defaults and banking');
  perform test.check(shared#>>'{document,customer,email}' = '' and shared#>>'{document,customer,phone}' = '', 'Private customer contact fields are not exposed');
  perform test.check(shared#>>'{document,bank,accountName}' = '' and shared#>>'{document,bank,accountNumber}' = '', 'Test customer links disclose no payment bank details');
  perform test.check(shared::text not like '%PRIVATE%' and shared::text not like '%Other customer%' and shared::text not like '%Unrelated owner%', 'No unrelated customer, diary or private metadata appears');
  perform test.check(public.dm_get_shared_document(current_setting('dm_test.quote_token'))#>>'{document,number}' = 'Q-0042', 'Anonymous quote links use the preserved template data');
  perform test.check(public.dm_get_shared_document(case when left(current_setting('dm_test.invoice_token'), 1) = 'a' then 'b' else 'a' end || substring(current_setting('dm_test.invoice_token') from 2)) is null, 'Changed tokens grant no access');
end;
$test$;
select test.expect_error('select public.dm_get_data()', '42501', 'A customer link confers no admin RPC access');
select test.expect_error('select * from public.admin_documents', '42501', 'A customer link confers no direct-table access');
reset role;

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);
set local role authenticated;
do $test$
declare
  data jsonb := public.dm_get_data()->'data';
  invoice jsonb;
  saved jsonb;
begin
  select value into invoice from jsonb_array_elements(data->'invoices') where value->>'id' = 'bill-gates-test';
  invoice := invoice || '{"payments":[{"id":"private-payment-id","date":"2026-10-17","amount":500,"method":"bank-transfer","label":"PRIVATE PAYMENT LABEL"}],"vat":{"enabled":true,"rate":20}}'::jsonb;
  data := jsonb_set(data, '{invoices}', (select jsonb_agg(case when value->>'id' = 'bill-gates-test' then invoice else value end) from jsonb_array_elements(data->'invoices')));
  saved := public.dm_save_data(data, 1);
  perform test.check((saved->>'revision')::bigint = 2, 'Invoice edits and partial payment persist at a new revision');
end;
$test$;
select set_config('dm_test.replacement_token', public.dm_create_share('bill-gates-test'), true);
select test.check(current_setting('dm_test.replacement_token') <> current_setting('dm_test.invoice_token'), 'Replacing a share produces a fresh random token');
reset role;
select set_config('request.jwt.claims', '{}', true);
set local role anon;
select test.check(public.dm_get_shared_document(current_setting('dm_test.invoice_token')) is null, 'Replacing a customer link invalidates its old token');
do $test$
declare
  doc jsonb := public.dm_get_shared_document(current_setting('dm_test.replacement_token'))->'document';
  subtotal numeric;
  paid numeric;
begin
  select sum((item->>'quantity')::numeric * (item->>'unitPrice')::numeric) into subtotal
    from jsonb_array_elements((doc->'works') || (doc->'materials')) item;
  select sum((p->>'amount')::numeric) into paid from jsonb_array_elements(doc->'payments') p;
  perform test.check(subtotal * 1.2 - paid = 1516, 'Shared invoice persists optional VAT and partial-payment balance GBP 1,516');
  perform test.check(not ((doc#>'{payments,0}') ? 'id') and doc#>>'{payments,0,label}' = '', 'Internal payment IDs and labels stay private');
end;
$test$;
reset role;

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);
set local role authenticated;
do $test$
declare
  data jsonb := public.dm_get_data()->'data';
  invoice jsonb;
  saved jsonb;
begin
  select value into invoice from jsonb_array_elements(data->'invoices') where value->>'id' = 'bill-gates-test';
  invoice := jsonb_set(invoice, '{payments}', (invoice->'payments') || '[{"id":"remaining-payment","date":"2026-10-17","amount":1516,"method":"bank-transfer","label":""}]'::jsonb);
  data := jsonb_set(data, '{invoices}', (select jsonb_agg(case when value->>'id' = 'bill-gates-test' then invoice else value end) from jsonb_array_elements(data->'invoices')));
  saved := public.dm_save_data(data, 2);
  perform test.check((saved->>'revision')::bigint = 3, 'Final balance payment persists');
end;
$test$;
reset role;
set local role anon;
select test.check((select sum((p->>'amount')::numeric) = 2016 from jsonb_array_elements(public.dm_get_shared_document(current_setting('dm_test.replacement_token'))#>'{document,payments}') p), 'Customer link reflects full payment including VAT');
reset role;
set local role authenticated;
select public.dm_revoke_share('bill-gates-test');
reset role;
set local role anon;
select test.check(public.dm_get_shared_document(current_setting('dm_test.replacement_token')) is null, 'Explicit share revocation immediately prevents customer reads');
reset role;

-- Deletion cascades link records; historical numbers remain unavailable.
set local role authenticated;
select set_config('dm_test.deleted_quote_token', public.dm_create_share('legacy-quote-1'), true);
do $test$
declare
  data jsonb := public.dm_get_data()->'data';
  saved jsonb;
begin
  data := jsonb_set(data, '{quotes}', '[]'::jsonb);
  saved := public.dm_save_data(data, 3);
  data := saved->'data';
  data := jsonb_set(data, '{quotes}', '[{"id":"replacement-quote","kind":"quote","number":"Q-0042","title":"New quote"}]'::jsonb);
  saved := public.dm_save_data(data, 4);
  perform test.check(saved#>>'{data,quotes,0,number}' <> 'Q-0042', 'A deleted historical quotation number cannot be reused');
  perform test.check((saved->>'revision')::bigint = 5, 'Delete and create operations persist independently');
end;
$test$;
reset role;
set local role anon;
select test.check(public.dm_get_shared_document(current_setting('dm_test.deleted_quote_token')) is null, 'Deleting a document invalidates its existing customer link');
reset role;
select test.check((select count(*) = 1 from public.admin_documents where owner_id = '22222222-2222-4222-8222-222222222222'), 'Saving and deleting Mike records never deletes another owner records');

rollback;
\echo 'All isolated PostgreSQL admin security and persistence checks passed.'
