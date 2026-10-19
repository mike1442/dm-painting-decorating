\set ON_ERROR_STOP on

-- Photo library checks for both scenarios, after storage-fixture.sql and
-- supabase/site-photos.sql. Everything is disposable and rolled back. They run
-- against real PostgreSQL roles, grants, RLS policies and functions; the Storage
-- HTTP service itself (MIME/size limits, public URLs) is verified separately.
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
/** Rows a statement changed, so silent RLS filtering is observable. */
create function test.affected(statement text) returns bigint
language plpgsql as $$
declare n bigint;
begin
  execute statement;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- The historical scenario already has confirmed Mike; the fresh one confirms him
-- now, and the real enrolment trigger grants membership.
insert into auth.users(id, email, email_confirmed_at)
select '66666666-6666-4666-8666-666666666666', 'mike@dmpaintingdecorating.co.uk', now()
where not exists (select 1 from auth.users where lower(email) = 'mike@dmpaintingdecorating.co.uk');
insert into auth.users(id, email, email_confirmed_at) values ('77777777-7777-4777-8777-777777777777', 'photo-intruder@example.test', now());
select set_config('dm_test.mike', (select id::text from auth.users where lower(email) = 'mike@dmpaintingdecorating.co.uk'), true);
insert into auth.sessions(id, user_id) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', current_setting('dm_test.mike')::uuid),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '77777777-7777-4777-8777-777777777777');
select set_config('dm_test.mike_claims', jsonb_build_object('sub', current_setting('dm_test.mike'), 'session_id', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'role', 'authenticated', 'email', 'mike@dmpaintingdecorating.co.uk')::text, true);
-- JWT-controlled email and metadata cannot turn another account into Mike.
select set_config('dm_test.intruder_claims', '{"sub":"77777777-7777-4777-8777-777777777777","session_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated","email":"mike@dmpaintingdecorating.co.uk","user_metadata":{"admin":true}}', true);

select test.check((select public and file_size_limit = 5242880 and allowed_mime_types = array['image/webp'] from storage.buckets where id = 'site-photos'), 'The photo bucket is public, WebP-only and limited to 5 MB');
select test.check((select bool_and(relrowsecurity) from pg_class where oid in ('public.admin_photos'::regclass, 'private.dm_photo_names'::regclass, 'storage.objects'::regclass)), 'RLS is enabled on photo metadata, name reservations and storage objects');
select test.check((select count(*) = 4 and bool_and(roles = array['authenticated']::name[]) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'dm_site_photos_%'), 'Only signed-in sessions have photo storage policies; anonymous visitors have none');
select test.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.proname like 'dm_%photo%'
    and p.prosecdef and not coalesce('search_path=""' = any(p.proconfig), false)
), 'Every privileged photo function fixes an empty search_path');
select test.check(not has_function_privilege('anon', 'public.dm_list_photos()', 'execute') and not has_function_privilege('anon', 'public.dm_reserve_photo_name(text)', 'execute')
  and not has_function_privilege('anon', 'public.dm_add_photo(jsonb)', 'execute') and not has_function_privilege('anon', 'public.dm_update_photo(uuid,text,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.dm_delete_photo(uuid)', 'execute'), 'Anonymous callers cannot execute any photo function');
select test.check(not has_function_privilege('authenticated', 'private.dm_photo_json(public.admin_photos)', 'execute'), 'The internal photo serialiser is not callable');

-- Mike: names, files and metadata.
select set_config('request.jwt.claims', current_setting('dm_test.mike_claims'), true);
set local role authenticated;
select test.check(public.dm_reserve_photo_name('hallway-repaint-stockton-heath') = 'hallway-repaint-stockton-heath', 'The first photo with a title gets its plain slug');
select test.check(public.dm_reserve_photo_name('hallway-repaint-stockton-heath') = 'hallway-repaint-stockton-heath-2', 'A repeated title gets the next free name');
select test.expect_error('select public.dm_reserve_photo_name(''Hallway'')', '22023', 'Names are lower-case slugs');
select test.expect_error('select public.dm_reserve_photo_name(''../escape'')', '22023', 'Names cannot contain paths');
select test.expect_error('select public.dm_reserve_photo_name(''a--b'')', '22023', 'Names cannot contain empty words');
select test.expect_error('select public.dm_reserve_photo_name('''')', '22023', 'Names cannot be empty');
select test.expect_error('select public.dm_reserve_photo_name(repeat(''a'', 71))', '22023', 'Names leave room for a numeric suffix');

insert into storage.objects(bucket_id, name, owner, metadata) values
  ('site-photos', 'hallway-repaint-stockton-heath.webp', auth.uid(), '{"mimetype":"image/webp"}'),
  ('site-photos', 'thumbs/hallway-repaint-stockton-heath.webp', auth.uid(), '{"mimetype":"image/webp"}');
select test.check((select count(*) = 2 from storage.objects where bucket_id = 'site-photos'), 'Mike can upload a photo and its thumbnail and see them');
select test.expect_error('insert into storage.objects(bucket_id, name) values (''site-photos'', ''evil.html'')', '42501', 'Only .webp files can be stored');
select test.expect_error('insert into storage.objects(bucket_id, name) values (''site-photos'', ''photo.webp.html'')', '42501', 'A double extension is refused');
select test.expect_error('insert into storage.objects(bucket_id, name) values (''site-photos'', ''../escape.webp'')', '42501', 'Path traversal names are refused');
select test.expect_error('insert into storage.objects(bucket_id, name) values (''site-photos'', ''thumbs/../escape.webp'')', '42501', 'Traversal inside the thumbnail folder is refused');
select test.expect_error('insert into storage.objects(bucket_id, name) values (''site-photos'', ''other/folder.webp'')', '42501', 'Only the thumbnail folder exists');
select test.expect_error('insert into storage.objects(bucket_id, name) values (''site-photos'', ''Upper-Case.webp'')', '42501', 'Names stay lower-case slugs');
select test.expect_error('insert into storage.objects(bucket_id, name) values (''unrelated-bucket'', ''x.webp'')', '42501', 'Photo access does not extend to other buckets');
select test.expect_error('update storage.objects set name = ''renamed.svg'' where bucket_id = ''site-photos'' and name = ''hallway-repaint-stockton-heath.webp''', '42501', 'A move cannot give a stored photo an unsafe name');

select set_config('dm_test.photo', public.dm_add_photo('{"fileName":"hallway-repaint-stockton-heath","title":"Hallway repaint in Stockton Heath","altText":"Freshly painted hallway with white woodwork","category":"interior","width":1600,"height":1200,"thumbWidth":480,"thumbHeight":360,"bytes":210000,"thumbBytes":24000}')->>'id', true);
select test.check((public.dm_list_photos()->0->>'fileName') = 'hallway-repaint-stockton-heath' and (public.dm_list_photos()->0->>'altText') = 'Freshly painted hallway with white woodwork'
  and (public.dm_list_photos()->0->>'width')::integer = 1600 and jsonb_array_length(public.dm_list_photos()) = 1, 'A recorded photo is listed with its metadata');
select test.expect_error('select public.dm_add_photo(''{"fileName":"never-reserved","title":"x","width":1,"height":1,"thumbWidth":1,"thumbHeight":1,"bytes":1,"thumbBytes":1}'')', '22023', 'Only reserved names can be recorded');
select test.expect_error('select public.dm_add_photo(''{"fileName":"hallway-repaint-stockton-heath","title":"Again","width":1,"height":1,"thumbWidth":1,"thumbHeight":1,"bytes":1,"thumbBytes":1}'')', '23505', 'Two photos cannot share a file');
select test.expect_error('select public.dm_add_photo(''{"fileName":"hallway-repaint-stockton-heath-2","title":"Too wide","width":1601,"height":1,"thumbWidth":1,"thumbHeight":1,"bytes":1,"thumbBytes":1}'')', '23514', 'Main images are at most 1600 px wide');
select test.expect_error('select public.dm_add_photo(''{"fileName":"hallway-repaint-stockton-heath-2","title":"Thumb","width":1,"height":1,"thumbWidth":481,"thumbHeight":1,"bytes":1,"thumbBytes":1}'')', '23514', 'Thumbnails are at most 480 px wide');
select test.expect_error('select public.dm_add_photo(''{"fileName":"hallway-repaint-stockton-heath-2","title":"x","category":"unknown","width":1,"height":1,"thumbWidth":1,"thumbHeight":1,"bytes":1,"thumbBytes":1}'')', '23514', 'Categories come from the fixed list');
select test.expect_error('select public.dm_add_photo(''{"fileName":"hallway-repaint-stockton-heath-2","title":" ","width":1,"height":1,"thumbWidth":1,"thumbHeight":1,"bytes":1,"thumbBytes":1}'')', '23514', 'A title is required');
select test.expect_error('select public.dm_add_photo(jsonb_build_object(''fileName'',''hallway-repaint-stockton-heath-2'',''title'',repeat(''x'',121),''width'',1,''height'',1,''thumbWidth'',1,''thumbHeight'',1,''bytes'',1,''thumbBytes'',1))', '23514', 'Titles are at most 120 characters');
select test.expect_error('select public.dm_add_photo(jsonb_build_object(''fileName'',''hallway-repaint-stockton-heath-2'',''title'',''x'',''altText'',repeat(''x'',251),''width'',1,''height'',1,''thumbWidth'',1,''thumbHeight'',1,''bytes'',1,''thumbBytes'',1))', '23514', 'Alt text is at most 250 characters');
select test.expect_error('select * from public.admin_photos', '42501', 'Even Mike uses the guarded functions rather than the table');
select test.expect_error('select * from private.dm_photo_names', '42501', 'Name reservations are private');

select test.check((public.dm_update_photo(current_setting('dm_test.photo')::uuid, 'Victorian hallway, Stockton Heath', 'Hallway after repainting', 'before-after', null)->>'fileName') = 'hallway-repaint-stockton-heath', 'Renaming the title keeps the permanent file address');
select test.check((public.dm_list_photos()->0->>'category') = 'before-after' and (public.dm_list_photos()->0->>'title') = 'Victorian hallway, Stockton Heath', 'Title and category changes persist');
select test.expect_error('select public.dm_update_photo(''' || current_setting('dm_test.photo') || ''', ''x'', '''', ''interior'', ''never-reserved'')', '22023', 'A file can only move to a reserved name');
select test.check((public.dm_update_photo(current_setting('dm_test.photo')::uuid, 'Victorian hallway, Stockton Heath', '', 'interior', 'hallway-repaint-stockton-heath-2')->>'fileName') = 'hallway-repaint-stockton-heath-2', 'A file can move to a newly reserved name');
select test.expect_error('select public.dm_update_photo(''00000000-0000-4000-8000-000000000000'', ''x'', '''', ''other'', null)', 'P0002', 'Updating an unknown photo fails');
reset role;

-- Anonymous visitors can use public URLs only; nothing through the API.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select test.expect_error('insert into storage.objects(bucket_id, name) values (''site-photos'', ''anonymous.webp'')', '42501', 'Anonymous uploads are refused');
select test.check((select count(*) = 0 from storage.objects), 'Anonymous callers cannot list stored files');
select test.check(test.affected('delete from storage.objects where bucket_id = ''site-photos''') = 0, 'Anonymous callers cannot delete photos');
select test.expect_error('select public.dm_list_photos()', '42501', 'Anonymous callers cannot list photo metadata');
select test.expect_error('select public.dm_reserve_photo_name(''anonymous'')', '42501', 'Anonymous callers cannot reserve names');
select test.expect_error('select * from public.admin_photos', '42501', 'Anonymous table reads are denied');
reset role;

-- Another signed-in account, even one claiming Mike's email.
select set_config('request.jwt.claims', current_setting('dm_test.intruder_claims'), true);
set local role authenticated;
select test.check(not public.dm_admin_is_member(), 'The intruder is not an administrator');
select test.expect_error('insert into storage.objects(bucket_id, name) values (''site-photos'', ''intruder.webp'')', '42501', 'Other accounts cannot upload photos');
select test.check((select count(*) = 0 from storage.objects where bucket_id = 'site-photos'), 'Other accounts cannot list photo files');
select test.check(test.affected('update storage.objects set name = ''hijacked.webp'' where bucket_id = ''site-photos''') = 0, 'Other accounts cannot rename photo files');
select test.check(test.affected('delete from storage.objects where bucket_id = ''site-photos''') = 0, 'Other accounts cannot delete photo files');
select test.expect_error('select public.dm_list_photos()', '42501', 'Other accounts cannot list photos');
select test.expect_error('select public.dm_reserve_photo_name(''intruder'')', '42501', 'Other accounts cannot reserve names');
select test.expect_error('select public.dm_add_photo(''{"fileName":"hallway-repaint-stockton-heath","title":"x"}'')', '42501', 'Other accounts cannot record photos');
select test.expect_error('select public.dm_update_photo(''' || current_setting('dm_test.photo') || ''', ''Hijacked'', '''', ''other'', null)', '42501', 'Other accounts cannot rename photos');
select test.expect_error('select public.dm_delete_photo(''' || current_setting('dm_test.photo') || ''')', '42501', 'Other accounts cannot delete photos');
reset role;
select test.check((select count(*) = 2 from storage.objects where bucket_id = 'site-photos') and (select title = 'Victorian hallway, Stockton Heath' from public.admin_photos where id = current_setting('dm_test.photo')::uuid), 'Refused callers changed nothing');

-- A revoked or expired session loses access immediately.
update auth.sessions set not_after = now() where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
select set_config('request.jwt.claims', current_setting('dm_test.mike_claims'), true);
set local role authenticated;
select test.expect_error('select public.dm_list_photos()', '42501', 'An expired session cannot list photos');
select test.expect_error('insert into storage.objects(bucket_id, name) values (''site-photos'', ''expired.webp'')', '42501', 'An expired session cannot upload');
reset role;
update auth.sessions set not_after = null where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

-- Deleting: files first (by the application), then the record. Names stay reserved.
set local role authenticated;
select test.check(test.affected('delete from storage.objects where bucket_id = ''site-photos'' and name in (''hallway-repaint-stockton-heath.webp'', ''thumbs/hallway-repaint-stockton-heath.webp'')') = 2, 'Mike can delete photo files');
select public.dm_delete_photo(current_setting('dm_test.photo')::uuid);
select public.dm_delete_photo(current_setting('dm_test.photo')::uuid);
select test.check(jsonb_array_length(public.dm_list_photos()) = 0, 'A deleted photo leaves the library, and repeating the delete is harmless');
select test.check(public.dm_reserve_photo_name('hallway-repaint-stockton-heath') = 'hallway-repaint-stockton-heath-3', 'Deleted and renamed file names are never reused');
reset role;

rollback;
\echo 'Photo library storage and metadata security checks passed.'
