-- TripSplit v3 - Supabase schema
-- Bu script sıfır kurulumda çalışır; v2 daha önce çalıştırıldıysa mevcut kayıtları silmeden v3 alanlarını ekler.
-- Harcama ledger'ında UPDATE/DELETE uygulama kullanıcılarına kapalıdır; düzeltmeler yeni revizyon olarak eklenir.

create extension if not exists pgcrypto;

-- 1) Sabit gezi grubu kullanıcı profilleri
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  username text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- v2'deki ASCII kullanıcı adı kontrolünü kaldır (Büşra gibi görüntü adları için).
alter table public.profiles drop constraint if exists profiles_username_format;
create unique index if not exists profiles_username_lower_unique on public.profiles (lower(username));

-- 2) Append-only harcama ledger / audit geçmişi
create table if not exists public.expense_versions (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null,
  version_no integer not null check (version_no > 0),
  status text not null default 'active' check (status in ('active','voided')),
  payer_id uuid not null references public.profiles(id) on delete restrict,
  description text not null check (char_length(description) between 1 and 150),
  amount numeric(18,2) not null check (amount > 0),
  currency text not null check (currency in ('USD','VND','MYR','TL')),
  payment_type text not null check (payment_type in ('Kart','Cash')),
  participant_ids uuid[] not null,
  card_tl_amount numeric(18,2),
  spent_on date not null default current_date,
  changed_by uuid not null references public.profiles(id) on delete restrict,
  change_reason text,
  created_at timestamptz not null default now(),
  constraint expense_versions_participants_nonempty check (cardinality(participant_ids) > 0),
  constraint expense_versions_card_tl_positive check (card_tl_amount is null or card_tl_amount > 0),
  unique (expense_id, version_no)
);

-- Eski v2 mutation trigger'ı varsa tarih migrasyonu için geçici kaldır.
drop trigger if exists block_expense_update_delete on public.expense_versions;

-- v2 -> v3: spent_on yoksa ekle ve eski spent_at değerinden doldur.
alter table public.expense_versions add column if not exists spent_on date;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='expense_versions' and column_name='spent_at'
  ) then
    execute 'update public.expense_versions set spent_on = spent_at::date where spent_on is null';
  end if;
end $$;
update public.expense_versions set spent_on = current_date where spent_on is null;
alter table public.expense_versions alter column spent_on set not null;
alter table public.expense_versions alter column spent_on set default current_date;

create index if not exists expense_versions_expense_idx on public.expense_versions (expense_id, version_no desc);
create index if not exists expense_versions_payer_idx on public.expense_versions (payer_id);
create index if not exists expense_versions_spent_on_idx on public.expense_versions (spent_on desc);

-- 3) Auth kullanıcısı oluşunca sabit profile map et.
-- Uygulama login için dahili email kullanır: act/busra/fatma/sena @ travel-expenses.app
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_login text;
  v_name text;
begin
  v_login := lower(split_part(coalesce(new.email,''), '@', 1));
  v_name := case v_login
    when 'act' then 'ACT'
    when 'busra' then 'Büşra'
    when 'fatma' then 'Fatma'
    when 'sena' then 'Sena'
    else null
  end;

  if v_name is null then
    raise exception 'Bu uygulama için izinli kullanıcı değil';
  end if;

  insert into public.profiles (id, username, is_admin)
  values (new.id, v_name, v_login = 'act')
  on conflict (id) do update
    set username = excluded.username,
        is_admin = excluded.is_admin;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Eğer Auth kullanıcıları schema'dan önce oluşturulduysa profilleri senkronla.
insert into public.profiles (id, username, is_admin)
select
  u.id,
  case lower(split_part(coalesce(u.email,''),'@',1))
    when 'act' then 'ACT'
    when 'busra' then 'Büşra'
    when 'fatma' then 'Fatma'
    when 'sena' then 'Sena'
  end as username,
  lower(split_part(coalesce(u.email,''),'@',1)) = 'act' as is_admin
from auth.users u
where lower(split_part(coalesce(u.email,''),'@',1)) in ('act','busra','fatma','sena')
on conflict (id) do update
set username = excluded.username,
    is_admin = excluded.is_admin;

-- Var olan v2 profillerinin görünen adlarını düzelt.
update public.profiles set username='ACT', is_admin=true where lower(username)='act';
update public.profiles set username='Büşra' where lower(username) in ('busra','büşra');
update public.profiles set username='Fatma' where lower(username)='fatma';
update public.profiles set username='Sena' where lower(username)='sena';

-- 4) Admin kontrolü
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- 5) Katılımcı doğrulama
create or replace function public.validate_participants(p_ids uuid[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select cardinality(p_ids) > 0
     and cardinality(array(select distinct x from unnest(p_ids) x)) = cardinality(p_ids)
     and (select count(*) from public.profiles p where p.id = any(p_ids)) = cardinality(p_ids);
$$;
revoke all on function public.validate_participants(uuid[]) from public;

-- v2 eski fonksiyon imzalarını kaldır.
drop function if exists public.create_expense(text,numeric,text,text,uuid[],timestamptz);
drop function if exists public.revise_expense(uuid,uuid,text,numeric,text,text,uuid[],numeric,text);

-- 6) İlk harcama kaydı. Harcayan otomatik giriş yapan kişidir.
create or replace function public.create_expense(
  p_description text,
  p_amount numeric,
  p_currency text,
  p_payment_type text,
  p_participant_ids uuid[],
  p_spent_on date
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_expense_id uuid := gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'Giriş gerekli'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Profil bulunamadı'; end if;
  if not public.validate_participants(p_participant_ids) then raise exception 'Geçersiz katılımcı listesi'; end if;
  if p_currency not in ('USD','VND','MYR','TL') then raise exception 'Geçersiz para birimi'; end if;
  if p_payment_type not in ('Kart','Cash') then raise exception 'Geçersiz ödeme tipi'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Tutar sıfırdan büyük olmalı'; end if;
  if p_spent_on is null then raise exception 'Harcama tarihi gerekli'; end if;
  if char_length(trim(p_description)) not between 1 and 150 then raise exception 'Harcama detayı geçersiz'; end if;

  insert into public.expense_versions(
    expense_id, version_no, status, payer_id, description, amount, currency,
    payment_type, participant_ids, card_tl_amount, spent_on, changed_by, change_reason
  ) values (
    v_expense_id, 1, 'active', auth.uid(), trim(p_description), p_amount, p_currency,
    p_payment_type, p_participant_ids, null, p_spent_on, auth.uid(), 'İlk kayıt'
  );
  return v_expense_id;
end;
$$;

-- 7) Admin düzeltmesi: eski kayıt dokunulmadan yeni sürüm eklenir.
create or replace function public.revise_expense(
  p_expense_id uuid,
  p_payer_id uuid,
  p_description text,
  p_amount numeric,
  p_currency text,
  p_payment_type text,
  p_participant_ids uuid[],
  p_card_tl_amount numeric,
  p_spent_on date,
  p_change_reason text default null
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev public.expense_versions%rowtype;
  v_next integer;
begin
  if not public.is_admin() then raise exception 'Admin yetkisi gerekli'; end if;
  select * into v_prev from public.expense_versions where expense_id = p_expense_id order by version_no desc limit 1;
  if not found then raise exception 'Harcama bulunamadı'; end if;
  if not exists(select 1 from public.profiles where id = p_payer_id) then raise exception 'Geçersiz harcayan'; end if;
  if not public.validate_participants(p_participant_ids) then raise exception 'Geçersiz katılımcı listesi'; end if;
  if p_currency not in ('USD','VND','MYR','TL') then raise exception 'Geçersiz para birimi'; end if;
  if p_payment_type not in ('Kart','Cash') then raise exception 'Geçersiz ödeme tipi'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Tutar sıfırdan büyük olmalı'; end if;
  if p_spent_on is null then raise exception 'Harcama tarihi gerekli'; end if;
  if p_card_tl_amount is not null and p_card_tl_amount <= 0 then raise exception 'TL karşılığı sıfırdan büyük olmalı'; end if;
  if char_length(trim(p_description)) not between 1 and 150 then raise exception 'Harcama detayı geçersiz'; end if;

  v_next := v_prev.version_no + 1;
  insert into public.expense_versions(
    expense_id, version_no, status, payer_id, description, amount, currency,
    payment_type, participant_ids, card_tl_amount, spent_on, changed_by, change_reason
  ) values (
    p_expense_id, v_next, 'active', p_payer_id, trim(p_description), p_amount, p_currency,
    p_payment_type, p_participant_ids,
    case when p_payment_type='Kart' and p_currency <> 'TL' then p_card_tl_amount else null end,
    p_spent_on, auth.uid(), nullif(trim(coalesce(p_change_reason,'')), '')
  );
  return v_next;
end;
$$;

-- 8) Silmek yerine iptal revizyonu ekle.
create or replace function public.void_expense(
  p_expense_id uuid,
  p_change_reason text default 'Admin tarafından iptal edildi'
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev public.expense_versions%rowtype;
  v_next integer;
begin
  if not public.is_admin() then raise exception 'Admin yetkisi gerekli'; end if;
  select * into v_prev from public.expense_versions where expense_id = p_expense_id order by version_no desc limit 1;
  if not found then raise exception 'Harcama bulunamadı'; end if;
  v_next := v_prev.version_no + 1;

  insert into public.expense_versions(
    expense_id, version_no, status, payer_id, description, amount, currency,
    payment_type, participant_ids, card_tl_amount, spent_on, changed_by, change_reason
  ) values (
    p_expense_id, v_next, 'voided', v_prev.payer_id, v_prev.description, v_prev.amount, v_prev.currency,
    v_prev.payment_type, v_prev.participant_ids, v_prev.card_tl_amount, v_prev.spent_on, auth.uid(),
    coalesce(nullif(trim(p_change_reason),''),'Admin tarafından iptal edildi')
  );
  return v_next;
end;
$$;

-- 9) Ledger fiziksel mutation koruması
create or replace function public.block_expense_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'expense_versions değiştirilemez veya silinemez; yeni revision ekleyin';
end;
$$;

drop trigger if exists block_expense_update_delete on public.expense_versions;
create trigger block_expense_update_delete
before update or delete on public.expense_versions
for each row execute function public.block_expense_mutation();

-- 10) RLS + minimum yetki
alter table public.profiles enable row level security;
alter table public.expense_versions enable row level security;

drop policy if exists "Authenticated users can view profiles" on public.profiles;
drop policy if exists "Authenticated users can view ledger" on public.expense_versions;
create policy "Authenticated users can view profiles" on public.profiles for select to authenticated using (true);
create policy "Authenticated users can view ledger" on public.expense_versions for select to authenticated using (true);

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.expense_versions from anon, authenticated;
grant select on table public.profiles to authenticated;
grant select on table public.expense_versions to authenticated;

revoke all on function public.create_expense(text,numeric,text,text,uuid[],date) from public;
revoke all on function public.revise_expense(uuid,uuid,text,numeric,text,text,uuid[],numeric,date,text) from public;
revoke all on function public.void_expense(uuid,text) from public;
grant execute on function public.create_expense(text,numeric,text,text,uuid[],date) to authenticated;
grant execute on function public.revise_expense(uuid,uuid,text,numeric,text,text,uuid[],numeric,date,text) to authenticated;
grant execute on function public.void_expense(uuid,text) to authenticated;
