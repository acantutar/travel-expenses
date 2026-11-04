-- TripSplit v4.0/v4.1 - additive multi-trip migration. All existing ledger versions retained.
-- Backfill via constant DEFAULT when adding trip_id (no UPDATE to append-only ledger rows).

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  destination text not null default '' check (char_length(destination) <= 120),
  starts_on date,
  ends_on date,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint trip_dates_valid check (starts_on is null or ends_on is null or starts_on <= ends_on)
);

create table if not exists public.trip_members (
  trip_id uuid not null references public.trips(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  role text not null default 'member' check (role in ('owner','admin','member')),
  is_active boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key(trip_id,user_id)
);
create index if not exists trip_members_user_idx on public.trip_members (user_id, is_active, trip_id);

-- Real existing trip is identified by this once-generated constant.
insert into public.trips (id, name, destination, owner_id)
select '065e617e-e67c-4e98-b2d2-57d133edbce3'::uuid,
       'Vietnam & Malezya 2026', 'Vietnam ve Malezya', p.id
from public.profiles p where p.is_admin and p.is_active
order by p.created_at limit 1
on conflict (id) do nothing;

-- Protect historical access: all original users remain members of the legacy trip.
insert into public.trip_members (trip_id,user_id,role)
select '065e617e-e67c-4e98-b2d2-57d133edbce3'::uuid,p.id,
       case when p.id = t.owner_id then 'owner' else 'member' end
from public.profiles p
join public.trips t on t.id='065e617e-e67c-4e98-b2d2-57d133edbce3'::uuid
on conflict (trip_id,user_id) do nothing;

-- A catalog-level constant default labels historical immutable versions without changing
-- their content, version numbers or triggering their UPDATE/DELETE protection.
alter table public.expense_versions
  add column if not exists trip_id uuid not null default '065e617e-e67c-4e98-b2d2-57d133edbce3'::uuid references public.trips(id);
alter table public.settlement_versions
  add column if not exists trip_id uuid not null default '065e617e-e67c-4e98-b2d2-57d133edbce3'::uuid references public.trips(id);
create index if not exists expense_versions_trip_idx on public.expense_versions(trip_id,expense_id,version_no desc);
create index if not exists settlement_versions_trip_idx on public.settlement_versions(trip_id,settlement_id,version_no desc);

create table if not exists public.trip_display_rates (
  trip_id uuid not null references public.trips(id) on delete restrict,
  currency text not null check(currency in ('MYR','VND','USD')),
  tl_rate numeric check (tl_rate is null or tl_rate > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete restrict,
  primary key(trip_id,currency)
);
insert into public.trip_display_rates (trip_id,currency,tl_rate,updated_at,updated_by)
select '065e617e-e67c-4e98-b2d2-57d133edbce3'::uuid,currency,tl_rate,updated_at,updated_by
from public.display_rates
on conflict (trip_id,currency) do nothing;

create schema if not exists app_private;
revoke all on schema app_private from public,anon;
grant usage on schema app_private to authenticated;

-- These predicates execute behind the RLS boundary and are NOT exposed as Data API RPCs.
create or replace function app_private.is_trip_member(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and public.is_active_user() and exists (
    select 1 from public.trip_members m
    where m.trip_id=p_trip_id and m.user_id=auth.uid() and m.is_active
  );
$$;
create or replace function app_private.is_trip_manager(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and public.is_active_user() and exists (
    select 1 from public.trip_members m
    where m.trip_id=p_trip_id and m.user_id=auth.uid() and m.is_active
    and m.role in ('owner','admin')
  );
$$;
create or replace function app_private.can_view_profile(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active_user() and (
    p_user_id=auth.uid()
    or exists (select 1 from public.profiles a where a.id=auth.uid() and a.is_admin and a.is_active)
    or exists (
      select 1 from public.trip_members me
      join public.trip_members other on other.trip_id=me.trip_id
      where me.user_id=auth.uid() and me.is_active and other.user_id=p_user_id
    )
  );
$$;
revoke all on function app_private.is_trip_member(uuid) from public,anon,authenticated;
revoke all on function app_private.is_trip_manager(uuid) from public,anon,authenticated;
revoke all on function app_private.can_view_profile(uuid) from public,anon,authenticated;
grant execute on function app_private.is_trip_member(uuid) to authenticated;
grant execute on function app_private.is_trip_manager(uuid) to authenticated;
grant execute on function app_private.can_view_profile(uuid) to authenticated;

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_display_rates enable row level security;

grant select on table public.trips,public.trip_members,public.trip_display_rates to authenticated;
revoke all on table public.trips,public.trip_members,public.trip_display_rates from anon;
revoke insert,update,delete on table public.trips,public.trip_members,public.trip_display_rates from authenticated;

drop policy if exists "Trip members view trips" on public.trips;
create policy "Trip members view trips" on public.trips for select to authenticated
using ((select app_private.is_trip_member(id)));
drop policy if exists "Trip members view member list" on public.trip_members;
create policy "Trip members view member list" on public.trip_members for select to authenticated
using ((select app_private.is_trip_member(trip_id)));
drop policy if exists "Trip members view exchange rates" on public.trip_display_rates;
create policy "Trip members view exchange rates" on public.trip_display_rates for select to authenticated
using ((select app_private.is_trip_member(trip_id)));

drop policy if exists "Active users can view ledger" on public.expense_versions;
drop policy if exists "Trip members view expense ledger" on public.expense_versions;
create policy "Trip members view expense ledger" on public.expense_versions for select to authenticated
using ((select app_private.is_trip_member(trip_id)));
drop policy if exists "Active users can view settlements" on public.settlement_versions;
drop policy if exists "Trip members view settlement ledger" on public.settlement_versions;
create policy "Trip members view settlement ledger" on public.settlement_versions for select to authenticated
using ((select app_private.is_trip_member(trip_id)));
drop policy if exists "Active users can view profiles" on public.profiles;
drop policy if exists "Active users see shared profiles" on public.profiles;
create policy "Active users see shared profiles" on public.profiles for select to authenticated
using ((select app_private.can_view_profile(id)));
drop policy if exists "Active users can view display rates" on public.display_rates;
drop policy if exists "Legacy trip members view display rates" on public.display_rates;
create policy "Legacy trip members view display rates" on public.display_rates for select to authenticated
using ((select app_private.is_trip_member('065e617e-e67c-4e98-b2d2-57d133edbce3'::uuid)));

-- Guard immutable append-only ledger insertions and preserve the original trip_id on revisions.
create or replace function app_private.check_expense_trip_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_trip uuid;
begin
  if new.version_no > 1 then
    select e.trip_id into v_trip from public.expense_versions e
    where e.expense_id=new.expense_id and e.version_no=1;
    if v_trip is null then raise exception 'İlk harcama sürümü bulunamadı'; end if;
    new.trip_id:=v_trip;
  end if;
  if auth.uid() is not null then
    if not app_private.is_trip_member(new.trip_id) then raise exception 'Bu geziye erişimin yok'; end if;
    if not exists (select 1 from public.trip_members m
      where m.trip_id=new.trip_id and m.user_id=new.payer_id)
      then raise exception 'Harcayan bu gezide değil'; end if;
    if exists (
      select 1 from unnest(new.participant_ids) as u(id)
      where not exists (select 1 from public.trip_members m where m.trip_id=new.trip_id and m.user_id=u.id)
    ) then raise exception 'Katılımcı başka bir geziye ait'; end if;
    if new.version_no=1 and (
      not exists (select 1 from public.trip_members m where m.trip_id=new.trip_id and m.user_id=new.payer_id and m.is_active)
      or exists(select 1 from unnest(new.participant_ids) as u(id)
        where not exists(select 1 from public.trip_members m where m.trip_id=new.trip_id and m.user_id=u.id and m.is_active))
    ) then raise exception 'Pasif gezi üyesine yeni harcama girilemez'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists check_expense_trip_before_insert on public.expense_versions;
create trigger check_expense_trip_before_insert before insert on public.expense_versions
for each row execute function app_private.check_expense_trip_insert();

create or replace function app_private.check_settlement_trip_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_trip uuid;
begin
  if new.version_no > 1 then
    select s.trip_id into v_trip from public.settlement_versions s
    where s.settlement_id=new.settlement_id and s.version_no=1;
    if v_trip is null then raise exception 'İlk borç ödemesi sürümü bulunamadı'; end if;
    new.trip_id:=v_trip;
  end if;
  if auth.uid() is not null then
    if not app_private.is_trip_member(new.trip_id) then raise exception 'Bu geziye erişimin yok'; end if;
    if new.from_user_id=new.to_user_id then raise exception 'Gönderen ve alan farklı olmalı'; end if;
    if not exists(select 1 from public.trip_members m where m.trip_id=new.trip_id and m.user_id=new.from_user_id)
       or not exists(select 1 from public.trip_members m where m.trip_id=new.trip_id and m.user_id=new.to_user_id)
       then raise exception 'Transferdeki kişiler bu gezide değil'; end if;
    if new.version_no=1 and (
      not exists(select 1 from public.trip_members m where m.trip_id=new.trip_id and m.user_id=new.from_user_id and m.is_active)
      or not exists(select 1 from public.trip_members m where m.trip_id=new.trip_id and m.user_id=new.to_user_id and m.is_active)
    ) then raise exception 'Pasif üyeyle yeni transfer girilemez'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists check_settlement_trip_before_insert on public.settlement_versions;
create trigger check_settlement_trip_before_insert before insert on public.settlement_versions
for each row execute function app_private.check_settlement_trip_insert();
revoke all on function app_private.check_expense_trip_insert() from public,anon,authenticated;
revoke all on function app_private.check_settlement_trip_insert() from public,anon,authenticated;

create or replace function public.can_manage_expense(p_expense_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.expense_versions e
    where e.expense_id=p_expense_id and e.version_no=1
      and app_private.is_trip_member(e.trip_id)
      and (app_private.is_trip_manager(e.trip_id) or e.changed_by=auth.uid())
  );
$$;
create or replace function public.can_manage_settlement(p_settlement_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.settlement_versions s
    where s.settlement_id=p_settlement_id and s.version_no=1
      and app_private.is_trip_member(s.trip_id)
      and (app_private.is_trip_manager(s.trip_id) or s.changed_by=auth.uid())
  );
$$;

-- This is one compact RPC per business action. No unauthenticated write access.
create or replace function public.create_trip(
  p_name text,p_destination text default '',p_starts_on date default null,p_ends_on date default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.is_active_user() then raise exception 'Giriş yapmalısın'; end if;
  if char_length(btrim(coalesce(p_name,''))) not between 2 and 100 then raise exception 'Gezi adı 2-100 karakter olmalı'; end if;
  if char_length(coalesce(p_destination,'')) > 120 then raise exception 'Hedef en fazla 120 karakter'; end if;
  if p_starts_on is not null and p_ends_on is not null and p_starts_on>p_ends_on then raise exception 'Tarih aralığı geçersiz'; end if;
  insert into public.trips(name,destination,starts_on,ends_on,owner_id)
  values(btrim(p_name),btrim(coalesce(p_destination,'')),p_starts_on,p_ends_on,auth.uid()) returning id into v_id;
  insert into public.trip_members(trip_id,user_id,role,is_active)
  values(v_id,auth.uid(),'owner',true);
  return v_id;
end;
$$;

create or replace function public.add_trip_member(p_trip_id uuid,p_login_name text)
returns void language plpgsql security definer set search_path='' as $$
declare v_user_id uuid;
begin
  if not app_private.is_trip_manager(p_trip_id) then raise exception 'Yalnız gezi yöneticisi üye ekleyebilir'; end if;
  select id into v_user_id from public.profiles
  where lower(login_name)=lower(btrim(p_login_name)) and is_active;
  if v_user_id is null then raise exception 'Aktif kullanıcı bulunamadı. Önce admin hesabından kullanıcı oluşturun'; end if;
  insert into public.trip_members(trip_id,user_id,role,is_active)
  values(p_trip_id,v_user_id,'member',true)
  on conflict(trip_id,user_id) do update set is_active=true;
end;
$$;

create or replace function public.set_trip_member_active(p_trip_id uuid,p_user_id uuid,p_active boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_role text;
begin
  if not app_private.is_trip_manager(p_trip_id) then raise exception 'Yalnız gezi yöneticisi üye yönetebilir'; end if;
  select role into v_role from public.trip_members where trip_id=p_trip_id and user_id=p_user_id;
  if v_role is null then raise exception 'Üye bulunamadı'; end if;
  if v_role='owner' then raise exception 'Gezi sahibi çıkarılamaz'; end if;
  if p_user_id=auth.uid() then raise exception 'Kendini bu ekrandan çıkaramazsın'; end if;
  update public.trip_members set is_active=p_active where trip_id=p_trip_id and user_id=p_user_id;
end;
$$;

create or replace function public.create_trip_expense(
  p_trip_id uuid,p_payer_id uuid,p_description text,p_amount numeric,p_currency text,
  p_payment_type text,p_participant_ids uuid[],p_spent_on date
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid:=gen_random_uuid();
begin
  if not app_private.is_trip_member(p_trip_id) then raise exception 'Bu geziye erişimin yok'; end if;
  if not exists (select 1 from public.trip_members where trip_id=p_trip_id and user_id=p_payer_id and is_active)
    then raise exception 'Harcayan aktif gezi üyesi olmalı'; end if;
  if p_participant_ids is null or cardinality(p_participant_ids)=0
     or cardinality(array(select distinct x from unnest(p_participant_ids)x))<>cardinality(p_participant_ids)
     or exists(select 1 from unnest(p_participant_ids) as p(id)
      where not exists(select 1 from public.trip_members m where m.trip_id=p_trip_id and m.user_id=p.id and m.is_active))
    then raise exception 'Katılımcılar aktif gezi üyelerinden seçilmeli'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Tutar geçersiz'; end if;
  if p_currency not in('MYR','VND','USD','TL') then raise exception 'Para birimi geçersiz'; end if;
  if p_payment_type not in('Kart','Cash') then raise exception 'Ödeme türü geçersiz'; end if;
  if p_spent_on is null then raise exception 'Harcama tarihi gerekli'; end if;
  if char_length(btrim(coalesce(p_description,''))) not between 1 and 150 then raise exception 'Harcama detayı gerekli'; end if;
  insert into public.expense_versions(expense_id,version_no,status,payer_id,description,
    amount,currency,payment_type,participant_ids,card_tl_amount,spent_on,changed_by,change_reason,trip_id)
  values(v_id,1,'active',p_payer_id,btrim(p_description),p_amount,p_currency,p_payment_type,
    p_participant_ids,null,p_spent_on,auth.uid(),'İlk kayıt',p_trip_id);
  return v_id;
end;
$$;

create or replace function public.create_trip_settlement(
  p_trip_id uuid,p_from_user_id uuid,p_to_user_id uuid,p_amount numeric,
  p_currency text,p_spent_on date,p_note text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid:=gen_random_uuid();
begin
  if not app_private.is_trip_member(p_trip_id) then raise exception 'Bu geziye erişimin yok'; end if;
  if p_from_user_id=p_to_user_id then raise exception 'Gönderen ve alan farklı olmalı'; end if;
  if not exists(select 1 from public.trip_members m where m.trip_id=p_trip_id and m.user_id=p_from_user_id and m.is_active)
     or not exists(select 1 from public.trip_members m where m.trip_id=p_trip_id and m.user_id=p_to_user_id and m.is_active)
     then raise exception 'Gönderen ve alan aktif gezi üyesi olmalı'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Tutar geçersiz'; end if;
  if p_currency not in('MYR','VND','USD','TL') then raise exception 'Para birimi geçersiz'; end if;
  if p_spent_on is null then raise exception 'Ödeme tarihi gerekli'; end if;
  if char_length(coalesce(p_note,''))>150 then raise exception 'Not en fazla 150 karakter'; end if;
  insert into public.settlement_versions(settlement_id,version_no,status,from_user_id,to_user_id,
    amount,currency,note,spent_on,changed_by,change_reason,trip_id)
  values(v_id,1,'active',p_from_user_id,p_to_user_id,p_amount,p_currency,
    nullif(btrim(coalesce(p_note,'')),''),p_spent_on,auth.uid(),'İlk kayıt',p_trip_id);
  return v_id;
end;
$$;

create or replace function public.set_trip_display_rates(p_trip_id uuid,p_myr numeric,p_vnd numeric,p_usd numeric)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not app_private.is_trip_manager(p_trip_id) then raise exception 'Gezi yönetici yetkisi gerekli'; end if;
  if p_myr is null or p_myr<=0 or p_vnd is null or p_vnd<=0 or p_usd is null or p_usd<=0
    then raise exception 'Kurlar sıfırdan büyük olmalı'; end if;
  insert into public.trip_display_rates(trip_id,currency,tl_rate,updated_by,updated_at)
  values(p_trip_id,'MYR',p_myr,auth.uid(),now()),(p_trip_id,'VND',p_vnd,auth.uid(),now()),
        (p_trip_id,'USD',p_usd,auth.uid(),now())
  on conflict(trip_id,currency) do update
  set tl_rate=excluded.tl_rate,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
end;
$$;

-- All RPC functions default to PUBLIC EXECUTE; remove it explicitly.
revoke all on function public.create_trip(text,text,date,date) from public,anon,authenticated;
revoke all on function public.add_trip_member(uuid,text) from public,anon,authenticated;
revoke all on function public.set_trip_member_active(uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.create_trip_expense(uuid,uuid,text,numeric,text,text,uuid[],date) from public,anon,authenticated;
revoke all on function public.create_trip_settlement(uuid,uuid,uuid,numeric,text,date,text) from public,anon,authenticated;
revoke all on function public.set_trip_display_rates(uuid,numeric,numeric,numeric) from public,anon,authenticated;
grant execute on function public.create_trip(text,text,date,date) to authenticated;
grant execute on function public.add_trip_member(uuid,text) to authenticated;
grant execute on function public.set_trip_member_active(uuid,uuid,boolean) to authenticated;
grant execute on function public.create_trip_expense(uuid,uuid,text,numeric,text,text,uuid[],date) to authenticated;
grant execute on function public.create_trip_settlement(uuid,uuid,uuid,numeric,text,date,text) to authenticated;
grant execute on function public.set_trip_display_rates(uuid,numeric,numeric,numeric) to authenticated;
