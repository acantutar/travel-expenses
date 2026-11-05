-- Local integration-test bootstrap. NEVER run against the live Supabase project.
-- PostgreSQL 17 container, disposable database. No real accounts, tokens or production data.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema extensions;
create extension if not exists pgcrypto with schema extensions;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table auth.users(
  id uuid primary key,
  email text not null unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
grant usage on schema public to anon,authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
insert into auth.users(id,email) values
  ('11111111-1111-4111-8111-111111111111','act@travel-expenses.app'),
  ('22222222-2222-4222-8222-222222222222','busra@travel-expenses.app');

-- Pre-v4 structures live in migrations that were applied manually to the
-- original Supabase project, but are not in the versioned repository.
-- Only structural adapters required by versioned migrations are recreated.
create table public.display_rates(
  currency text primary key,
  tl_rate numeric,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.display_rates enable row level security;
grant select on public.display_rates to authenticated;

create table public.settlement_versions(
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null,
  version_no integer not null check(version_no>0),
  status text not null default 'active' check(status in('active','voided')),
  from_user_id uuid not null,
  to_user_id uuid not null,
  amount numeric(18,2) not null check(amount>0),
  currency text not null,
  note text,
  spent_on date not null default current_date,
  changed_by uuid not null,
  change_reason text,
  created_at timestamptz not null default now(),
  source_expense_id uuid,
  unique(settlement_id,version_no)
);
alter table public.settlement_versions enable row level security;
grant select on public.settlement_versions to authenticated;
