\set ON_ERROR_STOP on

-- Isolated PostgreSQL test harness, not a replacement for live Supabase Auth.
\ir auth-fixture.sql

-- The four tables and constraints already present in the connected project.
create table public.admin_members (
  user_id uuid primary key references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.admin_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  kind text not null check (kind in ('quote', 'invoice', 'booking')),
  document_number text,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.admin_settings (
  owner_id uuid primary key references auth.users(id),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now()
);
create table public.admin_sequences (
  owner_id uuid references auth.users(id),
  kind text check (kind in ('quote', 'invoice')),
  next_number integer not null default 1 check (next_number > 0),
  primary key (owner_id, kind)
);

-- Representative inherited grants/policies deliberately start permissive;
-- tests must establish that the upgrade removes these old access paths.
grant all on public.admin_members, public.admin_documents,
  public.admin_settings, public.admin_sequences to anon, authenticated;
alter table public.admin_members enable row level security;
alter table public.admin_documents enable row level security;
alter table public.admin_settings enable row level security;
alter table public.admin_sequences enable row level security;
create policy old_member_access on public.admin_members to authenticated using (true) with check (true);
create policy old_document_access on public.admin_documents to authenticated using (true) with check (true);
create policy old_setting_access on public.admin_settings to authenticated using (true) with check (true);
create policy old_sequence_access on public.admin_sequences to authenticated using (true) with check (true);

-- Existing confirmed Mike, an unrelated legacy member, and one historical
-- quotation prove that the additive upgrade preserves the correct records.
insert into auth.users(id, email, email_confirmed_at) values
  ('11111111-1111-4111-8111-111111111111', 'mike@dmpaintingdecorating.co.uk', now()),
  ('22222222-2222-4222-8222-222222222222', 'other@example.test', now());
insert into auth.sessions(id, user_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222');
insert into public.admin_members(user_id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
insert into public.admin_settings(owner_id, payload) values
  ('11111111-1111-4111-8111-111111111111', '{"businessName":"Existing business","quotePrefix":"Q-","invoicePrefix":"INV-","nextQuoteNumber":43,"nextInvoiceNumber":1}');
insert into public.admin_sequences(owner_id, kind, next_number) values
  ('11111111-1111-4111-8111-111111111111', 'quote', 43),
  ('11111111-1111-4111-8111-111111111111', 'invoice', 1);
insert into public.admin_documents(owner_id, kind, document_number, payload) values
  ('11111111-1111-4111-8111-111111111111', 'quote', 'Q-0042',
   '{"id":"legacy-quote-1","kind":"quote","number":"Q-0042","title":"Existing quotation","customer":{"name":"Existing customer"},"internalNotes":"Legacy private notes"}'),
  ('22222222-2222-4222-8222-222222222222', 'invoice', 'INV-9000',
   '{"id":"foreign-invoice-1","kind":"invoice","number":"INV-9000","title":"Unrelated owner record","internalNotes":"Never expose another owner"}');

