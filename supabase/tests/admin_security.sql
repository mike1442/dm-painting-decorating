-- D&M admin security checks. Run in the Supabase SQL editor (or psql) AFTER
-- applying supabase/migrations/20261017170000_dm_admin_sync.sql.
--
-- Everything runs inside one transaction that is rolled back at the end, so it
-- leaves no users, documents or numbers behind. Each check raises an error that
-- starts with "FAIL" if security is wrong; a clean run ends with
-- "ALL D&M ADMIN SECURITY CHECKS PASSED".

begin;

-- Throwaway users: two admin members and one signed-in non-member.
insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-4000-8000-0000000000a1', 'member-a@dm-admin.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000b2', 'member-b@dm-admin.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000c3', 'outsider@dm-admin.test', 'authenticated', 'authenticated');
insert into public.admin_members (user_id)
values ('00000000-0000-4000-8000-0000000000a1'), ('00000000-0000-4000-8000-0000000000b2');
insert into public.admin_documents (id, owner_id, kind, document_number, payload)
values ('00000000-0000-4000-8000-00000000d0b2', '00000000-0000-4000-8000-0000000000b2', 'quote', 'Q-0001', '{"title":"B private"}');

-- 1. Anonymous visitors -----------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  begin perform 1 from public.admin_documents; raise exception 'FAIL: anon can read admin_documents';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.admin_settings; raise exception 'FAIL: anon can read admin_settings';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.admin_members; raise exception 'FAIL: anon can read admin_members';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.admin_sequences; raise exception 'FAIL: anon can read admin_sequences';
  exception when insufficient_privilege then null; end;
  begin insert into public.admin_documents (owner_id, kind, payload) values ('00000000-0000-4000-8000-0000000000a1', 'quote', '{}');
    raise exception 'FAIL: anon can insert documents';
  exception when insufficient_privilege then null; end;
  begin perform public.dm_admin_allocate_number('quote'); raise exception 'FAIL: anon can allocate numbers';
  exception when insufficient_privilege then null; end;
  begin perform public.dm_admin_is_member(); raise exception 'FAIL: anon can call dm_admin_is_member';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS: anonymous access denied';
end $$;
reset role;

-- 2. Signed-in non-member -----------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
do $$
declare n integer;
begin
  if public.dm_admin_is_member() then raise exception 'FAIL: non-member reported as member'; end if;
  select count(*) into n from public.admin_documents;
  if n <> 0 then raise exception 'FAIL: non-member can see % documents', n; end if;
  select count(*) into n from public.admin_settings;
  if n <> 0 then raise exception 'FAIL: non-member can see settings'; end if;
  begin
    insert into public.admin_documents (owner_id, kind, payload) values ('00000000-0000-4000-8000-0000000000c3', 'quote', '{}');
    raise exception 'FAIL: non-member can insert documents';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.admin_settings (owner_id, payload) values ('00000000-0000-4000-8000-0000000000c3', '{}');
    raise exception 'FAIL: non-member can insert settings';
  exception when insufficient_privilege then null; end;
  begin perform public.dm_admin_allocate_number('quote'); raise exception 'FAIL: non-member can allocate numbers';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.admin_members (user_id) values ('00000000-0000-4000-8000-0000000000c3');
    raise exception 'FAIL: a user can make themselves a member';
  exception when insufficient_privilege then null; end;
  update public.admin_documents set payload = '{"hacked":true}' where id = '00000000-0000-4000-8000-00000000d0b2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: non-member updated a document'; end if;
  raise notice 'PASS: signed-in non-member denied';
end $$;
reset role;

-- 3. Member A: own data only, atomic numbering, versioned saves ------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
do $$
declare
  n integer;
  v1 timestamptz;
  v2 timestamptz;
  doc uuid := '00000000-0000-4000-8000-00000000d0a1';
begin
  if not public.dm_admin_is_member() then raise exception 'FAIL: member not recognised'; end if;

  -- Cross-user isolation
  select count(*) into n from public.admin_documents;
  if n <> 0 then raise exception 'FAIL: member A can see member B''s documents'; end if;
  update public.admin_documents set payload = '{"hacked":true}' where id = '00000000-0000-4000-8000-00000000d0b2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: member A updated member B''s document'; end if;
  delete from public.admin_documents where id = '00000000-0000-4000-8000-00000000d0b2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: member A deleted member B''s document'; end if;
  begin
    insert into public.admin_documents (owner_id, kind, payload) values ('00000000-0000-4000-8000-0000000000b2', 'quote', '{}');
    raise exception 'FAIL: member A can write rows owned by member B';
  exception when insufficient_privilege then null; end;

  -- Own documents: create, version, update, delete
  insert into public.admin_documents (id, owner_id, kind, document_number, payload)
  values (doc, '00000000-0000-4000-8000-0000000000a1', 'quote', 'Q-0001', '{"title":"A"}');
  select updated_at into v1 from public.admin_documents where id = doc;
  update public.admin_documents set payload = '{"title":"A2"}' where id = doc and updated_at = v1;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: versioned update did not apply'; end if;
  select updated_at into v2 from public.admin_documents where id = doc;
  if v2 <= v1 then raise exception 'FAIL: updated_at not advanced by the database'; end if;
  update public.admin_documents set payload = '{"title":"stale"}' where id = doc and updated_at = v1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: stale version overwrote a newer save'; end if;
  update public.admin_documents set owner_id = '00000000-0000-4000-8000-0000000000b2' where id = doc;
  if (select owner_id from public.admin_documents where id = doc) <> '00000000-0000-4000-8000-0000000000a1' then
    raise exception 'FAIL: a document was handed to another owner';
  end if;

  -- Unique numbers per owner and kind (member B also has Q-0001; that is allowed)
  begin
    insert into public.admin_documents (owner_id, kind, document_number, payload)
    values ('00000000-0000-4000-8000-0000000000a1', 'quote', 'Q-0001', '{}');
    raise exception 'FAIL: duplicate quote number accepted';
  exception when unique_violation then null; end;
  insert into public.admin_documents (owner_id, kind, document_number, payload)
  values ('00000000-0000-4000-8000-0000000000a1', 'invoice', 'Q-0001', '{}'),
         ('00000000-0000-4000-8000-0000000000a1', 'booking', null, '{}'),
         ('00000000-0000-4000-8000-0000000000a1', 'booking', null, '{}');

  -- Atomic numbering that never goes backwards
  if public.dm_admin_allocate_number('quote') <> 1 then raise exception 'FAIL: first quote number is not 1'; end if;
  if public.dm_admin_allocate_number('quote') <> 2 then raise exception 'FAIL: second quote number is not 2'; end if;
  if public.dm_admin_allocate_number('quote', 250) <> 250 then raise exception 'FAIL: minimum not honoured'; end if;
  if public.dm_admin_allocate_number('quote', 5) <> 251 then raise exception 'FAIL: numbering went backwards'; end if;
  if public.dm_admin_allocate_number('invoice') <> 1 then raise exception 'FAIL: invoice numbers not independent'; end if;
  if (public.dm_admin_sequence_state() ->> 'quote')::integer <> 252 then raise exception 'FAIL: sequence state wrong'; end if;
  begin perform public.dm_admin_allocate_number('booking'); raise exception 'FAIL: bookings should not be numbered';
  exception when invalid_parameter_value then null; end;
  begin
    update public.admin_sequences set next_number = 1;
    raise exception 'FAIL: counters can be changed directly';
  exception when insufficient_privilege then null; end;

  -- Settings
  insert into public.admin_settings (owner_id, payload) values ('00000000-0000-4000-8000-0000000000a1', '{"settings":{}}');
  update public.admin_settings set payload = '{"settings":{"phone":"1"}}' where owner_id = '00000000-0000-4000-8000-0000000000a1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: member cannot update own settings'; end if;

  delete from public.admin_documents where id = doc;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: member cannot delete own document'; end if;
  raise notice 'PASS: member access, isolation, versioning and numbering';
end $$;
reset role;

-- 4. Member B cannot see member A's numbers or settings ----------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.admin_settings) <> 0 then raise exception 'FAIL: member B sees member A''s settings'; end if;
  if public.dm_admin_allocate_number('quote') <> 1 then raise exception 'FAIL: numbering shared between members'; end if;
  if (select count(*) from public.admin_documents) <> 1 then raise exception 'FAIL: member B document visibility wrong'; end if;
  raise notice 'PASS: members are isolated from each other';
end $$;
reset role;

-- 5. No policy may grant blanket access -----------------------------------------------
do $$
declare p record;
begin
  for p in
    select tablename, policyname, qual, with_check, roles
    from pg_policies
    where schemaname = 'public' and tablename in ('admin_members', 'admin_documents', 'admin_settings', 'admin_sequences')
  loop
    if coalesce(p.qual, '') in ('true', '(true)') or coalesce(p.with_check, '') in ('true', '(true)') then
      raise exception 'FAIL: policy % on % allows every row', p.policyname, p.tablename;
    end if;
    if 'anon' = any (p.roles) or 'public' = any (p.roles) then
      raise exception 'FAIL: policy % on % applies to %', p.policyname, p.tablename, p.roles;
    end if;
  end loop;
  raise notice 'ALL D&M ADMIN SECURITY CHECKS PASSED';
end $$;

rollback;
