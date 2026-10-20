\set ON_ERROR_STOP on

-- Invoices from Mike's ChatGPT through its Supabase connection, whose SQL tool
-- runs as the postgres role (this harness's session user). Runs after
-- supabase/chatgpt-invoices.sql in both CI scenarios. Every fixture, invoice
-- and customer link is disposable and rolled back.
begin;
create schema test;
grant usage on schema test to anon, authenticated, service_role;
create function test.check(condition boolean, message text) returns void
language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'FAILED: %', message; end if;
end;
$$;
create function test.expect_error(statement text, expected_state text, message text, expected_text text default null) returns void
language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate = expected_state and (expected_text is null or strpos(sqlerrm, expected_text) > 0) then return; end if;
    raise exception 'FAILED: % (expected SQLSTATE % %, got %: %)', message, expected_state, coalesce('"' || expected_text || '"', ''), sqlstate, sqlerrm;
  end;
  raise exception 'FAILED: % (statement unexpectedly succeeded)', message;
end;
$$;
-- The request ChatGPT sends for "Invoice John Smith, 12 Mill Lane, Lymm, WA13 9SD, £850 decorating labour".
create function test.req(overrides jsonb default '{}') returns jsonb
language sql as $$
  select jsonb_build_object(
    'customer', jsonb_build_object('name', 'John Smith', 'address', jsonb_build_object('line1', '12 Mill Lane', 'town', 'Lymm', 'postcode', 'WA13 9SD')),
    'title', 'Decorating labour',
    'works', jsonb_build_array(jsonb_build_object('description', 'Decorating labour', 'quantity', 1, 'unitPrice', 850)),
    'expectedSubtotal', 850) || overrides;
$$;
create function test.create(request jsonb) returns jsonb language sql as $$ select private.dm_chatgpt_create_invoice(request) $$;
create function test.revision() returns bigint language sql as $$
  select revision from public.admin_settings s join auth.users u on u.id = s.owner_id where lower(u.email) = 'mike@dmpaintingdecorating.co.uk'
$$;
create function test.invoice_count() returns bigint language sql as $$ select count(*) from public.admin_documents where kind = 'invoice' $$;

-- Mike's confirmed account with a live browser session (already present in the upgrade scenario).
insert into auth.users(id, email, email_confirmed_at)
select '11111111-1111-4111-8111-111111111111', 'mike@dmpaintingdecorating.co.uk', now()
where not exists (select 1 from auth.users where lower(email) = 'mike@dmpaintingdecorating.co.uk');
insert into auth.sessions(id, user_id)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111'
where not exists (select 1 from auth.sessions where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select test.check((select count(*) = 1 from public.admin_members), 'Only Mike is enrolled');
select set_config('dm_test.others', (select coalesce(jsonb_agg(to_jsonb(d) order by d.id), '[]')::text from public.admin_documents d where d.owner_id <> '11111111-1111-4111-8111-111111111111'), true);

-- 1. Nothing new is reachable through the Data API.
select test.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and (p.proname like 'dm_chatgpt%' or p.proname like 'dm_%owner%')
), 'The entrypoint lives only in the unexposed private schema');
do $test$
declare fn regprocedure; api_role text;
begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('dm_save_owner_data', 'dm_create_owner_share', 'dm_normal', 'dm_lines_pence', 'dm_gbp',
      'dm_chatgpt_only', 'dm_chatgpt_text', 'dm_chatgpt_number', 'dm_chatgpt_flag', 'dm_chatgpt_owner', 'dm_chatgpt_invoice_summary',
      'dm_chatgpt_create_invoice', 'dm_chatgpt_remove_test_invoice')
  loop
    foreach api_role in array array['anon', 'authenticated', 'service_role'] loop
      perform test.check(not has_function_privilege(api_role, fn, 'execute'), format('%s cannot execute %s', api_role, fn));
    end loop;
    perform test.check(not (select prosecdef from pg_proc where oid = fn), format('%s runs as its caller, never with elevated rights', fn));
    perform test.check((select coalesce('search_path=""' = any(proconfig), false) from pg_proc where oid = fn), format('%s fixes an empty search_path', fn));
  end loop;
  perform test.check((select count(*) = 13 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private'
    and p.proname in ('dm_save_owner_data', 'dm_create_owner_share', 'dm_normal', 'dm_lines_pence', 'dm_gbp', 'dm_chatgpt_only', 'dm_chatgpt_text',
      'dm_chatgpt_number', 'dm_chatgpt_flag', 'dm_chatgpt_owner', 'dm_chatgpt_invoice_summary', 'dm_chatgpt_create_invoice', 'dm_chatgpt_remove_test_invoice')),
    'All thirteen new functions were checked');
  perform test.check(has_function_privilege('authenticated', 'public.dm_save_data(jsonb,bigint)', 'execute')
    and has_function_privilege('authenticated', 'public.dm_create_share(text)', 'execute')
    and has_function_privilege('anon', 'public.dm_get_shared_document(text)', 'execute'), 'The admin and customer RPC grants are unchanged');
end;
$test$;

-- 2. Only the project's own database administrator may call it.
set local role anon;
select test.expect_error($$select private.dm_chatgpt_create_invoice('{}')$$, '42501', 'Anonymous callers are refused');
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);
set local role authenticated;
select test.check(public.dm_admin_is_member(), 'Mike''s browser session is a valid admin session');
select test.expect_error($$select private.dm_chatgpt_create_invoice('{}')$$, '42501', 'Even Mike''s own browser session cannot call the entrypoint');
select test.expect_error($$select private.dm_save_owner_data('11111111-1111-4111-8111-111111111111', '{}', 0)$$, '42501', 'Browser sessions cannot call the owner save directly');
select test.expect_error($$select private.dm_create_owner_share('11111111-1111-4111-8111-111111111111', 'legacy-quote-1')$$, '42501', 'Browser sessions cannot call the owner share directly');
reset role;
select set_config('request.jwt.claims', '{}', true);
set local role service_role;
select test.expect_error($$select private.dm_chatgpt_create_invoice('{}')$$, '42501', 'The service role is refused');
reset role;
-- A Data API request logs in as `authenticator`. Even with EXECUTE granted by mistake it is refused.
create role test_authenticator login noinherit;
grant usage on schema private, test to test_authenticator;
grant execute on function private.dm_chatgpt_create_invoice(jsonb), private.dm_chatgpt_owner(), private.dm_chatgpt_remove_test_invoice(text) to test_authenticator;
set local session authorization test_authenticator;
select test.expect_error($$select private.dm_chatgpt_create_invoice('{}')$$, '42501', 'An API login role with a mistaken grant is refused by the caller check', 'own database administrator');
select test.expect_error($$select private.dm_chatgpt_remove_test_invoice('TEST-x')$$, '42501', 'An API login role cannot remove invoices', 'own database administrator');
reset session authorization;

-- 3. Preconditions: Mike's account and saved business settings.
select test.expect_error($$select test.create(test.req())$$, '55000', 'Without saved business settings nothing is created', 'business settings');
update auth.users set email_confirmed_at = null where lower(email) = 'mike@dmpaintingdecorating.co.uk';
select test.expect_error($$select test.create(test.req())$$, '42501', 'An unconfirmed Mike account cannot receive invoices', 'not set up');
update auth.users set email_confirmed_at = now(), banned_until = now() + interval '1 day' where lower(email) = 'mike@dmpaintingdecorating.co.uk';
select test.expect_error($$select test.create(test.req())$$, '42501', 'A banned Mike account cannot receive invoices', 'not set up');
update auth.users set banned_until = null where lower(email) = 'mike@dmpaintingdecorating.co.uk';
select test.check((select count(*) = 1 from public.admin_members), 'Re-confirming restores only Mike''s membership');

-- Mike saves his business settings in the browser, through the refactored guarded save.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);
set local role authenticated;
do $test$
declare initial jsonb := public.dm_get_data(); saved jsonb;
begin
  saved := public.dm_save_data((initial->'data') || jsonb_build_object('settings', jsonb_build_object(
    'businessName', 'D&M Painting & Decorating', 'address', jsonb_build_object('line1', '', 'line2', '', 'town', '', 'postcode', ''),
    'phone', '', 'email', 'info@dmpaintingdecorating.co.uk', 'website', 'www.dmpaintingdecorating.co.uk', 'vatNumber', '', 'companyNumber', '',
    'vatRegistered', false, 'defaultVatRate', 20, 'paymentTermsDays', 14, 'quoteValidityDays', 30,
    'bank', jsonb_build_object('accountName', 'D&M TEST ACCOUNT', 'sortCode', '00-00-00', 'accountNumber', '00000000'),
    'quotePrefix', 'Q-', 'nextQuoteNumber', 43, 'invoicePrefix', 'INV-', 'nextInvoiceNumber', 11,
    'defaultQuoteIntro', 'Intro', 'defaultTerms', jsonb_build_array('Terms'), 'defaultPaymentNote', 'Please use the invoice number as your payment reference.')),
    (initial->>'revision')::bigint);
  perform test.check(saved#>>'{data,settings,nextInvoiceNumber}' = '11', 'The guarded browser save still works after the refactor');
  perform set_config('dm_test.browser_revision', saved->>'revision', true);
end;
$test$;
reset role;
select set_config('request.jwt.claims', '{}', true);

-- 4. Requests that cannot be stored exactly are refused and nothing is saved.
select set_config('dm_test.revision', test.revision()::text, true);
select set_config('dm_test.invoices_before', test.invoice_count()::text, true);
select test.expect_error($$select test.create('[]')$$, '22023', 'A non-object request is refused');
select test.expect_error($$select test.create(test.req('{"unit_price": 850}'))$$, '22023', 'Misspelt fields are refused, not ignored', 'unit_price');
select test.expect_error($$select test.create(test.req() - 'customer')$$, '22023', 'A customer is required', 'Ask Mike who');
select test.expect_error($$select test.create(test.req('{"customer": {"name": "  "}}'))$$, '22023', 'A blank customer name is refused', 'customer.name');
select test.expect_error($$select test.create(test.req('{"customer": {"name": "John Smith", "address": "12 Mill Lane, Lymm"}}'))$$, '22023', 'A one-line address must be split into its parts', 'customer.address');
select test.expect_error($$select test.create(test.req() - 'title')$$, '22023', 'A job title is required', 'title');
select test.expect_error($$select test.create(test.req('{"works": [], "materials": []}'))$$, '22023', 'At least one priced item is required', 'at least one');
select test.expect_error($$select test.create(test.req('{"works": [{"description": "Labour", "quantity": 1, "unitPrice": "850"}]}'))$$, '22023', 'Prices given as text are refused', 'not text');
select test.expect_error($$select test.create(test.req('{"works": [{"description": "Labour", "quantity": 1, "unitPrice": -850}]}'))$$, '22023', 'Negative prices are refused', 'from 0');
select test.expect_error($$select test.create(test.req('{"works": [{"description": "Labour", "quantity": 1, "unitPrice": 850.125}]}'))$$, '22023', 'Fractions of a penny are refused', 'decimal places');
select test.expect_error($$select test.create(test.req('{"works": [{"description": "Labour", "quantity": 0, "unitPrice": 850}]}'))$$, '22023', 'A zero quantity is refused', 'quantity');
select test.expect_error($$select test.create(test.req('{"works": [{"description": "Labour", "quantity": 1}]}'))$$, '22023', 'An item without a price from Mike is refused', 'Never estimate');
select test.expect_error($$select test.create(test.req('{"works": [{"description": "Labour", "qty": 1, "unitPrice": 850}]}'))$$, '22023', 'Unknown item fields are refused', 'qty');
select test.expect_error($$select test.create(test.req() - 'expectedSubtotal')$$, '22023', 'Mike''s total is required as a check', 'expectedSubtotal is required');
select test.expect_error($$select test.create(test.req('{"expectedSubtotal": 800}'))$$, '22023', 'A total that does not match the items is refused', 'The items add up to £850.00 before VAT, but Mike''s figures came to £800.00');
select test.expect_error($$select test.create(test.req('{"vat": "yes"}'))$$, '22023', 'An unclear VAT instruction is refused', 'vat must be');
select test.expect_error($$select test.create(test.req('{"dueInDays": 400}'))$$, '22023', 'Impossible payment terms are refused', 'dueInDays');
select test.check(test.revision() = current_setting('dm_test.revision')::bigint and test.invoice_count() = current_setting('dm_test.invoices_before')::bigint, 'Refused requests save nothing');

-- 5. Mike's example: a real invoice with the next canonical number and a working link.
select set_config('dm_test.first', test.create(test.req())::text, true);
do $test$
declare r jsonb := current_setting('dm_test.first')::jsonb; doc public.admin_documents%rowtype; token text;
begin
  perform test.check(r->>'status' = 'created' and r->'verified' = 'true'::jsonb, 'The invoice is created and verified');
  perform test.check(r#>>'{invoice,number}' = 'INV-0011', 'The database issues the next invoice number from Mike''s sequence');
  perform test.check(r#>>'{invoice,total}' = '£850.00' and r#>>'{invoice,vat}' = 'no VAT' and r#>>'{invoice,balance}' = '£850.00', 'The total follows the business VAT setting (off)');
  perform test.check(r#>>'{invoice,dueDate}' = to_char((now() at time zone 'Europe/London')::date + 14, 'YYYY-MM-DD'), 'Payment is due after the business payment terms');
  perform test.check(r->>'customerLink' ~ '^https://www\.dmpaintingdecorating\.co\.uk/d/[a-f0-9]{64}$' and r->>'customerLinkStatus' = 'new', 'A genuine customer link is returned');
  perform test.check(r->>'message' like 'Created invoice INV-0011 for John Smith: Decorating labour. Total £850.00 (no VAT), due %' and strpos(r->>'message', r->>'customerLink') > 0, 'The message states number, customer, total, due date and link');
  token := substring(r->>'customerLink' from '[a-f0-9]{64}$');
  perform set_config('dm_test.first_token', token, true);
  select * into doc from public.admin_documents where external_id = r#>>'{invoice,id}';
  perform test.check(doc.document_number = 'INV-0011' and doc.payload->>'number' = 'INV-0011' and doc.owner_id = '11111111-1111-4111-8111-111111111111', 'The invoice is stored for Mike with its number');
  perform test.check(doc.payload->>'status' = 'draft' and doc.payload->>'issueDate' = to_char((now() at time zone 'Europe/London')::date, 'YYYY-MM-DD') and doc.payload->'quoteId' = 'null'::jsonb, 'A new draft invoice dated today (UK)');
  perform test.check(doc.payload->'customer' = '{"name":"John Smith","email":"","phone":"","address":{"line1":"12 Mill Lane","line2":"","town":"Lymm","postcode":"WA13 9SD"}}'::jsonb, 'The customer is stored as given');
  perform test.check(doc.payload#>>'{works,0,id}' ~ '^[0-9a-f-]{36}$' and (doc.payload#>'{works,0}') - 'id' = '{"description":"Decorating labour","quantity":1,"unit":"","unitPrice":850}'::jsonb, 'The priced line is stored exactly');
  perform test.check(doc.payload->'bank' = '{"accountName":"D&M TEST ACCOUNT","sortCode":"00-00-00","accountNumber":"00000000"}'::jsonb and doc.payload->>'paymentNote' = 'Please use the invoice number as your payment reference.', 'Bank details and payment note come from the business settings');
  perform test.check(doc.payload->'payments' = '[]'::jsonb and doc.payload->'share' = '{"token":null,"status":"not-available"}'::jsonb and not doc.payload ? 'isTest', 'No payments, no stored token, not a test');
  perform test.check(exists(select 1 from private.dm_number_reservations where number = 'INV-0011' and kind = 'invoice'), 'The number is reserved permanently');
  perform test.check((select next_number = 12 from public.admin_sequences where kind = 'invoice' and owner_id = doc.owner_id), 'The sequence advances');
  perform test.check((select payload#>>'{settings,nextInvoiceNumber}' = '12' from public.admin_settings where owner_id = doc.owner_id), 'The settings show the next number');
  perform test.check(test.revision() = current_setting('dm_test.revision')::bigint + 1, 'One save, at a new revision');
  perform test.check(exists(select 1 from private.dm_document_shares where document_id = doc.id and token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex')), 'Only the token''s SHA-256 hash is stored');
  perform test.check(test.invoice_count() = current_setting('dm_test.invoices_before')::bigint + 1, 'Exactly one invoice was added');
end;
$test$;
set local role anon;
do $test$
declare shared jsonb := public.dm_get_shared_document(current_setting('dm_test.first_token'));
begin
  perform test.check(shared#>>'{document,number}' = 'INV-0011' and shared#>>'{document,customer,name}' = 'John Smith', 'An anonymous customer opens exactly this invoice');
  perform test.check(shared#>>'{document,bank,accountName}' = 'D&M TEST ACCOUNT', 'The customer sees the payment details');
  perform test.check(not (shared->'document' ?| array['id', 'internalNotes', 'share', 'quoteId']) and shared::text not like '%Unrelated owner%', 'Private fields and other records stay private');
end;
$test$;
reset role;

-- 6. Repeats never make a second invoice.
select set_config('dm_test.revision', test.revision()::text, true);
do $test$
declare r jsonb := test.create(test.req());
begin
  perform test.check(r->>'status' = 'already_created' and r#>>'{invoice,number}' = 'INV-0011' and r->'customerLink' = 'null'::jsonb, 'An identical retry returns the existing invoice without a link');
  perform test.check(r->>'customerLinkStatus' = 'already_issued' and r->>'message' like 'Invoice INV-0011 for John Smith (total £850.00) was already created%', 'The answer says the link was already issued');
end;
$test$;
select test.check((select r->>'status' = 'already_created' from test.create(test.req('{"customer": {"name": "  JOHN   smith ", "address": {"line1": "12 MILL LANE", "town": "lymm", "postcode": "wa13 9sd"}}, "title": "decorating  labour"}')) r), 'Case and spacing differences are the same request');
select test.check((select r#>>'{existingInvoice,number}' = 'INV-0011' and r->>'status' = 'possible_duplicate' from test.create(test.req('{"title": "Painting the hallway"}')) r), 'A reworded repeat for the same customer and subtotal is held back');
select test.check(test.revision() = current_setting('dm_test.revision')::bigint and test.invoice_count() = current_setting('dm_test.invoices_before')::bigint + 1, 'Repeats save nothing');
set local role anon;
select test.check(public.dm_get_shared_document(current_setting('dm_test.first_token'))#>>'{document,number}' = 'INV-0011', 'A repeat leaves the issued link working');
reset role;
select test.check((select r->>'status' = 'created' and r#>>'{invoice,number}' = 'INV-0012' from test.create(test.req('{"title": "Painting the hallway", "allowDuplicate": true}')) r), 'Mike can explicitly ask for a second invoice');

-- 7. VAT, materials, scope points and an apostrophe, as ChatGPT sends them.
do $test$
declare r jsonb; doc jsonb;
begin
  r := private.dm_chatgpt_create_invoice($dm${
    "customer": {"name": "Sarah O'Neill", "address": {"line1": "4 Mill Lane", "line2": "", "town": "Lymm", "postcode": "WA13 9SD"}, "email": "sarah@example.test"},
    "title": "Lounge redecoration",
    "scope": ["- Prepare walls", "2. Two coats of emulsion", "  "],
    "works": [{"description": "Painter", "quantity": 3, "unit": "day", "unitPrice": 250}],
    "materials": [{"description": "Paint and sundries", "quantity": 1, "unitPrice": 180}],
    "expectedSubtotal": 930, "vat": {"enabled": true}, "dueInDays": 7
  }$dm$::jsonb);
  perform test.check(r->>'status' = 'created' and r#>>'{invoice,number}' = 'INV-0013', 'The next number follows');
  perform test.check(r#>>'{invoice,subtotal}' = '£930.00' and r#>>'{invoice,vat}' = 'VAT at 20%' and r#>>'{invoice,vatAmount}' = '£186.00' and r#>>'{invoice,total}' = '£1,116.00', 'VAT at the business rate is added to works and materials');
  select payload into doc from public.admin_documents where external_id = r#>>'{invoice,id}';
  perform test.check(doc->'scope' = '["Prepare walls", "Two coats of emulsion"]'::jsonb, 'Scope points lose list markers and blanks, as in the admin');
  perform test.check(doc#>>'{customer,name}' = 'Sarah O''Neill' and doc#>>'{customer,email}' = 'sarah@example.test' and doc->>'dueDate' = to_char((now() at time zone 'Europe/London')::date + 7, 'YYYY-MM-DD'), 'Names with apostrophes, email and payment terms are kept');
  perform test.check(doc->'vat' = '{"enabled": true, "rate": 20}'::jsonb and doc#>>'{materials,0,unit}' = '', 'VAT and materials are stored as the admin stores them');
end;
$test$;

-- 8. A TEST invoice takes a TEST number, no bank details and no real number.
select set_config('dm_test.test_result', test.create(test.req('{"customer": {"name": "TEST Customer"}, "title": "TEST invoice", "testDocument": true}'))::text, true);
do $test$
declare r jsonb := current_setting('dm_test.test_result')::jsonb; doc jsonb;
begin
  perform test.check(r->>'status' = 'created' and r#>>'{invoice,number}' ~ '^TEST-cgs[0-9a-f]{30}$' and r#>>'{invoice,testDocument}' = 'true', 'A TEST invoice is created with a TEST number');
  perform test.check(r->>'message' like '%This is a TEST invoice: no payment is due.%', 'The answer says it is a test');
  select payload into doc from public.admin_documents where external_id = r#>>'{invoice,id}';
  perform test.check(doc->'isTest' = 'true'::jsonb and doc->'bank' = '{"accountName":"","sortCode":"","accountNumber":""}'::jsonb and doc->>'paymentNote' = ''
    and doc->>'internalNotes' = 'Test example only. Not issued to a customer. No payment is due.', 'A TEST invoice carries no payment details');
  perform test.check((select next_number = 14 from public.admin_sequences where kind = 'invoice'), 'A TEST invoice does not use up a real number');
  perform set_config('dm_test.test_token', substring(r->>'customerLink' from '[a-f0-9]{64}$'), true);
end;
$test$;
set local role anon;
select test.check((select s#>>'{document,isTest}' = 'true' and s#>>'{document,bank,accountNumber}' = '' from public.dm_get_shared_document(current_setting('dm_test.test_token')) s), 'The TEST customer link shows a test with no bank details');
reset role;

-- 9. The browser path is unchanged: Mike sees ChatGPT's invoices, and a stale device cannot overwrite them.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);
set local role authenticated;
do $test$
declare current jsonb := public.dm_get_data(); stale jsonb;
begin
  perform test.check(jsonb_array_length(current#>'{data,invoices}') = 4, 'The admin reads the four invoices made through ChatGPT');
  perform test.check((select count(*) = 1 from jsonb_array_elements(current#>'{data,invoices}') i where i->>'number' = 'INV-0011'), 'The admin sees the canonical number');
  stale := current->'data';
  perform test.expect_error(format('select public.dm_save_data(%L::jsonb, %s)', stale, current_setting('dm_test.browser_revision')), '40001', 'A device that has not seen ChatGPT''s invoices cannot overwrite them');
  -- Link the TEST invoice to a diary booking from the browser, to check removal unlinks it.
  perform public.dm_save_data(jsonb_set(stale, '{bookings}', (stale->'bookings') || jsonb_build_array(jsonb_build_object('id', 'test-booking', 'kind', 'booking', 'job', 'TEST booking',
    'invoiceId', current_setting('dm_test.test_result')::jsonb#>>'{invoice,id}'))), (current->>'revision')::bigint);
end;
$test$;
reset role;
select set_config('request.jwt.claims', '{}', true);

-- 10. TEST invoices are removed through the same save path; real ones are refused.
select test.expect_error($$select private.dm_chatgpt_remove_test_invoice('INV-0011')$$, '42501', 'Real invoices cannot be removed this way', 'not a TEST invoice');
select test.expect_error($$select private.dm_chatgpt_remove_test_invoice('TEST-unknown')$$, 'P0002', 'An unknown number is reported');
do $test$
declare r jsonb; v_number text := current_setting('dm_test.test_result')::jsonb#>>'{invoice,number}'; v_id text := current_setting('dm_test.test_result')::jsonb#>>'{invoice,id}';
begin
  r := private.dm_chatgpt_remove_test_invoice(v_number);
  perform test.check(r->>'status' = 'removed' and r->>'number' = v_number, 'The TEST invoice is removed');
  perform test.check(not exists(select 1 from public.admin_documents where external_id = v_id), 'Its record is gone');
  perform test.check(not exists(select 1 from private.dm_number_reservations where dm_number_reservations.number = r->>'number'), 'Its TEST number is released');
  perform test.check((select payload->'invoiceId' = 'null'::jsonb from public.admin_documents where external_id = 'test-booking'), 'The linked booking stays, unlinked');
  perform test.check(exists(select 1 from public.admin_documents where document_number = 'INV-0011'), 'Real invoices are untouched');
end;
$test$;
set local role anon;
select test.check(public.dm_get_shared_document(current_setting('dm_test.test_token')) is null, 'The removed TEST invoice''s link no longer opens');
reset role;
select test.check((select r->>'status' = 'created' and r#>>'{invoice,number}' = current_setting('dm_test.test_result')::jsonb#>>'{invoice,number}'
  from test.create(test.req('{"customer": {"name": "TEST Customer"}, "title": "TEST invoice", "testDocument": true}')) r), 'The same TEST request can run again after removal');
select test.check((select next_number = 14 from public.admin_sequences where kind = 'invoice'), 'Repeating a TEST invoice still uses no real number');
select test.check((select coalesce(jsonb_agg(to_jsonb(d) order by d.id), '[]')::text from public.admin_documents d where d.owner_id <> '11111111-1111-4111-8111-111111111111') = current_setting('dm_test.others'), 'Other owners'' records are never touched');

rollback;
\echo 'ChatGPT invoice entrypoint security, numbering, duplicate, failure and customer-link checks passed.'
