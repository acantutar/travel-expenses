-- Travel Expenses v2 - Supabase kurulumu
-- BU DOSYAYI ESKI schema.sql YERINE kullan.
-- Harcamalar append-only tutulur: UPDATE ve DELETE veritabanı seviyesinde yasaktır.

create extension if not exists pgcrypto;

-- 1) Kullanıcı profilleri
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  username text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9._-]{2,30}$')
);
create unique index if not exists profiles_username_lower_unique on public.profiles (lower(username));

-- 2) Değiştirilemez harcama sürümleri / audit ledger
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
  spent_at timestamptz not null default now(),
  changed_by uuid not null references public.profiles(id) on delete restrict,
  change_reason text,
  created_at timestamptz not null default now(),
  constraint expense_versions_participants_nonempty check (cardinality(participant_ids) > 0),
  constraint expense_versions_card_tl_positive check (card_tl_amount is null or card_tl_amount > 0),
  unique (expense_id, version_no)
);
create index if not exists expense_versions_expense_idx on public.expense_versions (expense_id, version_no desc);
create index if not exists expense_versions_payer_idx on public.expense_versions (payer_id);
create index if not exists expense_versions_spent_idx on public.expense_versions (spent_at desc);

-- 3) Auth kullanıcısı oluşunca profil oluştur
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, lower(new.raw_user_meta_data ->> 'username'));
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

-- 4) Admin kontrolü
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- 5) Participant listesinin gerçekten mevcut profillerden oluştuğunu doğrula
create or replace function public.validate_participants(p_ids uuid[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select cardinality(p_ids) > 0
     and cardinality(array(select distinct x from unnest(p_ids) x)) = cardinality(p_ids)
     and (select count(*) from public.profiles p where p.id = any(p_ids)) = cardinality(p_ids);
$$;
revoke all on function public.validate_participants(uuid[]) from public;

-- 6) İlk harcama kaydı. Kullanıcı sadece kendi adına harcama ekleyebilir.
create or replace function public.create_expense(
  p_description text,
  p_amount numeric,
  p_currency text,
  p_payment_type text,
  p_participant_ids uuid[],
  p_spent_at timestamptz default now()
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_expense_id uuid := gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'Giriş gerekli'; end if;
  if not public.validate_participants(p_participant_ids) then raise exception 'Geçersiz katılımcı listesi'; end if;
  if p_currency not in ('USD','VND','MYR','TL') then raise exception 'Geçersiz para birimi'; end if;
  if p_payment_type not in ('Kart','Cash') then raise exception 'Geçersiz ödeme tipi'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Tutar sıfırdan büyük olmalı'; end if;
  if char_length(trim(p_description)) not between 1 and 150 then raise exception 'Harcama detayı geçersiz'; end if;

  insert into public.expense_versions(
    expense_id, version_no, status, payer_id, description, amount, currency,
    payment_type, participant_ids, card_tl_amount, spent_at, changed_by, change_reason
  ) values (
    v_expense_id, 1, 'active', auth.uid(), trim(p_description), p_amount, p_currency,
    p_payment_type, p_participant_ids, null, coalesce(p_spent_at, now()), auth.uid(), 'İlk kayıt'
  );
  return v_expense_id;
end;
$$;

-- 7) Admin düzeltmesi: eski satır değişmez, yeni version eklenir.
create or replace function public.revise_expense(
  p_expense_id uuid,
  p_payer_id uuid,
  p_description text,
  p_amount numeric,
  p_currency text,
  p_payment_type text,
  p_participant_ids uuid[],
  p_card_tl_amount numeric,
  p_change_reason text default null
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_prev public.expense_versions%rowtype; v_next integer;
begin
  if not public.is_admin() then raise exception 'Admin yetkisi gerekli'; end if;
  select * into v_prev from public.expense_versions where expense_id = p_expense_id order by version_no desc limit 1;
  if not found then raise exception 'Harcama bulunamadı'; end if;
  if not exists(select 1 from public.profiles where id = p_payer_id) then raise exception 'Geçersiz harcayan'; end if;
  if not public.validate_participants(p_participant_ids) then raise exception 'Geçersiz katılımcı listesi'; end if;
  if p_currency not in ('USD','VND','MYR','TL') then raise exception 'Geçersiz para birimi'; end if;
  if p_payment_type not in ('Kart','Cash') then raise exception 'Geçersiz ödeme tipi'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Tutar sıfırdan büyük olmalı'; end if;
  if p_card_tl_amount is not null and p_card_tl_amount <= 0 then raise exception 'TL karşılığı sıfırdan büyük olmalı'; end if;
  v_next := v_prev.version_no + 1;

  insert into public.expense_versions(
    expense_id, version_no, status, payer_id, description, amount, currency,
    payment_type, participant_ids, card_tl_amount, spent_at, changed_by, change_reason
  ) values (
    p_expense_id, v_next, 'active', p_payer_id, trim(p_description), p_amount, p_currency,
    p_payment_type, p_participant_ids,
    case when p_payment_type='Kart' and p_currency <> 'TL' then p_card_tl_amount else null end,
    v_prev.spent_at, auth.uid(), nullif(trim(coalesce(p_change_reason,'')), '')
  );
  return v_next;
end;
$$;

-- 8) Silmek yerine iptal sürümü ekle.
create or replace function public.void_expense(p_expense_id uuid, p_change_reason text default 'Admin tarafından iptal edildi')
returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_prev public.expense_versions%rowtype; v_next integer;
begin
  if not public.is_admin() then raise exception 'Admin yetkisi gerekli'; end if;
  select * into v_prev from public.expense_versions where expense_id = p_expense_id order by version_no desc limit 1;
  if not found then raise exception 'Harcama bulunamadı'; end if;
  v_next := v_prev.version_no + 1;
  insert into public.expense_versions(
    expense_id, version_no, status, payer_id, description, amount, currency,
    payment_type, participant_ids, card_tl_amount, spent_at, changed_by, change_reason
  ) values (
    p_expense_id, v_next, 'voided', v_prev.payer_id, v_prev.description, v_prev.amount, v_prev.currency,
    v_prev.payment_type, v_prev.participant_ids, v_prev.card_tl_amount, v_prev.spent_at, auth.uid(),
    coalesce(nullif(trim(p_change_reason),''),'Admin tarafından iptal edildi')
  );
  return v_next;
end;
$$;

-- 9) Ledger'da UPDATE/DELETE fiziksel olarak yasak.
create or replace function public.block_expense_mutation()
returns trigger language plpgsql set search_path = ''
as $$ begin raise exception 'expense_versions değiştirilemez veya silinemez; yeni revision ekleyin'; end; $$;
drop trigger if exists block_expense_update_delete on public.expense_versions;
create trigger block_expense_update_delete before update or delete on public.expense_versions
for each row execute function public.block_expense_mutation();

-- 10) RLS + en az yetki
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

revoke all on function public.create_expense(text,numeric,text,text,uuid[],timestamptz) from public;
revoke all on function public.revise_expense(uuid,uuid,text,numeric,text,text,uuid[],numeric,text) from public;
revoke all on function public.void_expense(uuid,text) from public;
grant execute on function public.create_expense(text,numeric,text,text,uuid[],timestamptz) to authenticated;
grant execute on function public.revise_expense(uuid,uuid,text,numeric,text,text,uuid[],numeric,text) to authenticated;
grant execute on function public.void_expense(uuid,text) to authenticated;

-- İlk hesabı uygulamadan oluşturduktan sonra admin yapmak için:
-- update public.profiles set is_admin = true where username = 'act';
