-- TripSplit v4.1: invite-only signup, token-based gezi daveti and per-trip currencies.
-- Run AFTER migrations/v4_multitrip.sql on a fresh v4 installation.
-- Production application uses the applied Supabase migrations.
-- This script contains no access tokens, credentials or user data.
alter table public.trips add column if not exists base_currency text not null default 'TL';
alter table public.trips add column if not exists allowed_currencies text[] not null default array['MYR','VND','USD','TL']::text[];
alter table public.trips drop constraint if exists trips_base_currency_check;
alter table public.trips add constraint trips_base_currency_check
check (base_currency = any(array['TL','USD','EUR','MYR','VND','THB','SGD','GBP','JPY']::text[]));
alter table public.trips drop constraint if exists trips_allowed_currencies_check;
alter table public.trips add constraint trips_allowed_currencies_check
check (cardinality(allowed_currencies) between 1 and 9 and base_currency=any(allowed_currencies)
and allowed_currencies <@ array['TL','USD','EUR','MYR','VND','THB','SGD','GBP','JPY']::text[]);
alter table public.trip_display_rates add column if not exists base_rate numeric;
update public.trip_display_rates set base_rate=tl_rate where base_rate is null and tl_rate is not null;
alter table public.trip_display_rates drop constraint if exists trip_display_rates_currency_check;
alter table public.trip_display_rates add constraint trip_display_rates_currency_check
check(currency=any(array['TL','USD','EUR','MYR','VND','THB','SGD','GBP','JPY']::text[]));
alter table public.trip_display_rates drop constraint if exists trip_display_rates_base_rate_check;
alter table public.trip_display_rates add constraint trip_display_rates_base_rate_check
check(base_rate is null or base_rate>0);
alter table public.expense_versions drop constraint if exists expense_versions_currency_check;
alter table public.expense_versions add constraint expense_versions_currency_check
check(currency=any(array['TL','USD','EUR','MYR','VND','THB','SGD','GBP','JPY']::text[]));
alter table public.settlement_versions drop constraint if exists settlement_versions_currency_check;
alter table public.settlement_versions add constraint settlement_versions_currency_check
check(currency=any(array['TL','USD','EUR','MYR','VND','THB','SGD','GBP','JPY']::text[]));

create table if not exists public.trip_invitations(
 id uuid primary key default gen_random_uuid(),
 trip_id uuid not null references public.trips(id) on delete restrict,
 token_hash text not null unique,
 created_by uuid not null references public.profiles(id) on delete restrict,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 use_count integer not null default 0 check(use_count>=0),
 max_uses integer not null default 1 check(max_uses between 1 and 10),
 revoked_at timestamptz,
 constraint invitation_expiry check(expires_at>created_at)
);
create index if not exists trip_invitations_trip_idx on public.trip_invitations(trip_id,created_at desc);
alter table public.trip_invitations enable row level security;
revoke all on public.trip_invitations from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.create_trip_expense(p_trip_id uuid, p_payer_id uuid, p_description text, p_amount numeric, p_currency text, p_payment_type text, p_participant_ids uuid[], p_spent_on date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if not exists(select 1 from public.trips t where t.id=p_trip_id and p_currency=any(t.allowed_currencies)) then raise exception 'Para birimi geçersiz'; end if;
  if p_payment_type not in('Kart','Cash') then raise exception 'Ödeme türü geçersiz'; end if;
  if p_spent_on is null then raise exception 'Harcama tarihi gerekli'; end if;
  if char_length(btrim(coalesce(p_description,''))) not between 1 and 150 then raise exception 'Harcama detayı gerekli'; end if;
  insert into public.expense_versions(expense_id,version_no,status,payer_id,description,
    amount,currency,payment_type,participant_ids,card_tl_amount,spent_on,changed_by,change_reason,trip_id)
  values(v_id,1,'active',p_payer_id,btrim(p_description),p_amount,p_currency,p_payment_type,
    p_participant_ids,null,p_spent_on,auth.uid(),'İlk kayıt',p_trip_id);
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_trip_invite(p_trip_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_token text;
begin
  if not app_private.is_trip_manager(p_trip_id) then
    raise exception 'Gezi yöneticisi olmalısın';
  end if;
  v_token := encode(extensions.gen_random_bytes(32),'hex');
  insert into public.trip_invitations(trip_id,token_hash,created_by,expires_at)
  values(p_trip_id,encode(extensions.digest(v_token,'sha256'),'hex'),
         auth.uid(),now()+interval '7 days');
  return v_token;
end; $function$;

CREATE OR REPLACE FUNCTION public.create_trip_settlement(p_trip_id uuid, p_from_user_id uuid, p_to_user_id uuid, p_amount numeric, p_currency text, p_spent_on date, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid:=gen_random_uuid();
begin
  if not app_private.is_trip_member(p_trip_id) then raise exception 'Bu geziye erişimin yok'; end if;
  if p_from_user_id=p_to_user_id then raise exception 'Gönderen ve alan farklı olmalı'; end if;
  if not exists(select 1 from public.trip_members m where m.trip_id=p_trip_id and m.user_id=p_from_user_id and m.is_active)
     or not exists(select 1 from public.trip_members m where m.trip_id=p_trip_id and m.user_id=p_to_user_id and m.is_active)
     then raise exception 'Gönderen ve alan aktif gezi üyesi olmalı'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Tutar geçersiz'; end if;
  if not exists(select 1 from public.trips t where t.id=p_trip_id and p_currency=any(t.allowed_currencies)) then raise exception 'Para birimi geçersiz'; end if;
  if p_spent_on is null then raise exception 'Ödeme tarihi gerekli'; end if;
  if char_length(coalesce(p_note,''))>150 then raise exception 'Not en fazla 150 karakter'; end if;
  insert into public.settlement_versions(settlement_id,version_no,status,from_user_id,to_user_id,
    amount,currency,note,spent_on,changed_by,change_reason,trip_id)
  values(v_id,1,'active',p_from_user_id,p_to_user_id,p_amount,p_currency,
    nullif(btrim(coalesce(p_note,'')),''),p_spent_on,auth.uid(),'İlk kayıt',p_trip_id);
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_trip_with_settings(p_name text, p_destination text, p_starts_on date, p_ends_on date, p_base_currency text, p_currencies text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
 if not public.valid_trip_currency_choices(p_base_currency,p_currencies) then raise exception 'Geçersiz para birimi seçimi';end if;
 v_id:=public.create_trip(p_name,p_destination,p_starts_on,p_ends_on);
 update public.trips set base_currency=p_base_currency,allowed_currencies=p_currencies where id=v_id;
 return v_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.list_trip_invites(p_trip_id uuid)
 RETURNS TABLE(id uuid, created_at timestamp with time zone, expires_at timestamp with time zone, use_count integer, max_uses integer, revoked_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app_private.is_trip_manager(p_trip_id) then
    raise exception 'Yönetici yetkisi gerekli';
  end if;
  return query select i.id,i.created_at,i.expires_at,i.use_count,i.max_uses,i.revoked_at
    from public.trip_invitations i where i.trip_id=p_trip_id
    order by i.created_at desc limit 30;
end; $function$;

CREATE OR REPLACE FUNCTION public.preview_trip_invite(p_token text)
 RETURNS TABLE(trip_id uuid, trip_name text, destination text, expires_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select t.id,t.name,t.destination,i.expires_at
  from public.trip_invitations i
  join public.trips t on t.id=i.trip_id
  where length(coalesce(p_token,''))=64
    and i.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
    and i.revoked_at is null and i.expires_at>now() and i.use_count<i.max_uses
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.redeem_trip_invite(p_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_inv public.trip_invitations%rowtype;
begin
  if not public.is_active_user() or auth.uid() is null then
    raise exception 'Geziye katılmak için giriş yapmalısın';
  end if;
  if length(coalesce(p_token,''))<>64 then raise exception 'Davet geçersiz'; end if;
  select * into v_inv from public.trip_invitations i
  where i.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
  for update;
  if not found or v_inv.revoked_at is not null or v_inv.expires_at<=now() then
    raise exception 'Davet geçersiz veya süresi dolmuş';
  end if;
  if exists (select 1 from public.trip_members m
      where m.trip_id=v_inv.trip_id and m.user_id=auth.uid() and m.is_active)
  then return v_inv.trip_id; end if;
  if v_inv.use_count>=v_inv.max_uses then raise exception 'Davet kullanılmış'; end if;
  insert into public.trip_members (trip_id,user_id,role,is_active)
  values(v_inv.trip_id,auth.uid(),'member',true)
  on conflict(trip_id,user_id) do update set is_active=true;
  update public.trip_invitations set use_count=use_count+1 where id=v_inv.id;
  return v_inv.trip_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.revise_expense(p_expense_id uuid, p_payer_id uuid, p_description text, p_amount numeric, p_currency text, p_payment_type text, p_participant_ids uuid[], p_card_tl_amount numeric, p_spent_on date, p_change_reason text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prev public.expense_versions%rowtype;
  v_next integer;
begin
  if not public.can_manage_expense(p_expense_id) then raise exception 'Bu kaydı düzenleme yetkin yok'; end if;
  select * into v_prev from public.expense_versions where expense_id = p_expense_id order by version_no desc limit 1;
  if not found then raise exception 'Harcama bulunamadı'; end if;
  if v_prev.status <> 'active' then raise exception 'İptal edilmiş kayıt düzenlenemez'; end if;
  if not exists(select 1 from public.profiles where id = p_payer_id and is_active) then raise exception 'Geçersiz harcayan'; end if;
  if not public.validate_participants(p_participant_ids) then raise exception 'Geçersiz katılımcı listesi'; end if;
  if not exists(select 1 from public.trips t where t.id=v_prev.trip_id and p_currency=any(t.allowed_currencies)) then raise exception 'Geçersiz para birimi'; end if;
  if p_payment_type not in ('Kart','Cash') then raise exception 'Geçersiz ödeme tipi'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Tutar sıfırdan büyük olmalı'; end if;
  if p_spent_on is null then raise exception 'Harcama tarihi gerekli'; end if;
  if p_card_tl_amount is not null and p_card_tl_amount <= 0 then raise exception 'TL karşılığı sıfırdan büyük olmalı'; end if;
  if char_length(trim(p_description)) not between 1 and 150 then raise exception 'Harcama detayı geçersiz'; end if;

  v_next := v_prev.version_no + 1;
  insert into public.expense_versions(
    expense_id, version_no, status, payer_id, description, amount, currency,
    payment_type, participant_ids, card_tl_amount, spent_on, changed_by, change_reason, trip_id
  ) values (
    p_expense_id, v_next, 'active', p_payer_id, trim(p_description), p_amount, p_currency,
    p_payment_type, p_participant_ids,
    case when p_payment_type='Kart' and p_currency <> 'TL' then p_card_tl_amount else null end,
    p_spent_on, auth.uid(), nullif(trim(coalesce(p_change_reason,'')), ''), v_prev.trip_id
  );
  return v_next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.revise_settlement(p_settlement_id uuid, p_from_user_id uuid, p_to_user_id uuid, p_amount numeric, p_currency text, p_spent_on date, p_note text DEFAULT NULL::text, p_change_reason text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prev public.settlement_versions%rowtype;
  v_next integer;
begin
  if not public.can_manage_settlement(p_settlement_id) then raise exception 'Bu transferi düzenleme yetkin yok'; end if;
  select * into v_prev from public.settlement_versions where settlement_id=p_settlement_id order by version_no desc limit 1;
  if not found then raise exception 'Transfer bulunamadı'; end if;
  if v_prev.status <> 'active' then raise exception 'İptal edilmiş transfer düzenlenemez'; end if;
  if p_from_user_id = p_to_user_id then raise exception 'Gönderen ve alan aynı kişi olamaz'; end if;
  if not exists(select 1 from public.profiles where id=p_from_user_id) then raise exception 'Geçersiz gönderen'; end if;
  if not exists(select 1 from public.profiles where id=p_to_user_id) then raise exception 'Geçersiz alan'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Tutar sıfırdan büyük olmalı'; end if;
  if not exists(select 1 from public.trips t where t.id=v_prev.trip_id and p_currency=any(t.allowed_currencies)) then raise exception 'Geçersiz para birimi'; end if;
  if p_spent_on is null then raise exception 'Tarih gerekli'; end if;
  if p_note is not null and char_length(trim(p_note)) > 150 then raise exception 'Not en fazla 150 karakter olabilir'; end if;

  v_next := v_prev.version_no + 1;
  insert into public.settlement_versions(
    settlement_id, version_no, status, from_user_id, to_user_id, amount, currency,
    note, spent_on, changed_by, change_reason, source_expense_id, trip_id
  ) values (
    p_settlement_id, v_next, 'active', p_from_user_id, p_to_user_id, p_amount, p_currency,
    nullif(trim(coalesce(p_note,'')), ''), p_spent_on, auth.uid(),
    nullif(trim(coalesce(p_change_reason,'')), ''), v_prev.source_expense_id, v_prev.trip_id
  );
  return v_next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_trip_invite(p_invitation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_trip_id uuid;
begin
  select trip_id into v_trip_id from public.trip_invitations where id=p_invitation_id;
  if v_trip_id is null or not app_private.is_trip_manager(v_trip_id) then
    raise exception 'Yönetici yetkisi gerekli';
  end if;
  update public.trip_invitations set revoked_at=now()
  where id=p_invitation_id and revoked_at is null;
end; $function$;

CREATE OR REPLACE FUNCTION public.set_trip_currency_rate(p_trip_id uuid, p_currency text, p_rate numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_trip public.trips%rowtype;
begin
 if not app_private.is_trip_manager(p_trip_id) then raise exception 'Yönetici yetkisi gerekli';end if;
 select * into v_trip from public.trips where id=p_trip_id;
 if not p_currency=any(v_trip.allowed_currencies) or p_currency=v_trip.base_currency
   or p_rate is null or p_rate<=0 or p_rate>1000000000 then raise exception 'Geçersiz kur';end if;
 insert into public.trip_display_rates(trip_id,currency,base_rate,tl_rate,updated_by,updated_at)
 values(p_trip_id,p_currency,p_rate,case when v_trip.base_currency='TL' then p_rate else null end,auth.uid(),now())
 on conflict(trip_id,currency) do update set base_rate=excluded.base_rate,tl_rate=excluded.tl_rate,
 updated_by=excluded.updated_by,updated_at=excluded.updated_at;
end; $function$;

CREATE OR REPLACE FUNCTION public.set_trip_currency_settings(p_trip_id uuid, p_base_currency text, p_currencies text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_old_base text;
begin
 if not app_private.is_trip_manager(p_trip_id) then raise exception 'Yönetici yetkisi gerekli';end if;
 if not public.valid_trip_currency_choices(p_base_currency,p_currencies) then raise exception 'Geçersiz para birimi seçimi';end if;
 if exists(select 1 from public.expense_versions e where e.trip_id=p_trip_id and not e.currency=any(p_currencies))
    or exists(select 1 from public.settlement_versions s where s.trip_id=p_trip_id and not s.currency=any(p_currencies))
 then raise exception 'Kayıt bulunan para birimleri çıkarılamaz';end if;
 select base_currency into v_old_base from public.trips where id=p_trip_id for update;
 update public.trips set base_currency=p_base_currency,allowed_currencies=p_currencies where id=p_trip_id;
 if v_old_base is distinct from p_base_currency then
   delete from public.trip_display_rates where trip_id=p_trip_id;
 end if;
end; $function$;

CREATE OR REPLACE FUNCTION public.valid_trip_currency_choices(p_base text, p_choices text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select p_base in('TL','USD','EUR','MYR','VND','THB','SGD','GBP','JPY')
  and p_choices is not null and cardinality(p_choices) between 1 and 9
  and p_base=any(p_choices)
  and p_choices <@ array['TL','USD','EUR','MYR','VND','THB','SGD','GBP','JPY']::text[]
  and cardinality(p_choices)=cardinality(array(select distinct x from unnest(p_choices) as x));
$function$;


-- Only invite preview is callable without a session; invitation secrets are hashed.
revoke all on function public.create_trip_invite(uuid) from public,anon,authenticated;
revoke all on function public.preview_trip_invite(text) from public,anon,authenticated;
revoke all on function public.redeem_trip_invite(text) from public,anon,authenticated;
revoke all on function public.list_trip_invites(uuid) from public,anon,authenticated;
revoke all on function public.revoke_trip_invite(uuid) from public,anon,authenticated;
revoke all on function public.valid_trip_currency_choices(text,text[]) from public,anon,authenticated;
revoke all on function public.create_trip_with_settings(text,text,date,date,text,text[]) from public,anon,authenticated;
revoke all on function public.set_trip_currency_settings(uuid,text,text[]) from public,anon,authenticated;
revoke all on function public.set_trip_currency_rate(uuid,text,numeric) from public,anon,authenticated;
grant execute on function public.create_trip_invite(uuid) to authenticated;
grant execute on function public.preview_trip_invite(text) to anon,authenticated,service_role;
grant execute on function public.redeem_trip_invite(text) to authenticated;
grant execute on function public.list_trip_invites(uuid) to authenticated;
grant execute on function public.revoke_trip_invite(uuid) to authenticated;
grant execute on function public.create_trip_with_settings(text,text,date,date,text,text[]) to authenticated;
grant execute on function public.set_trip_currency_settings(uuid,text,text[]) to authenticated;
grant execute on function public.set_trip_currency_rate(uuid,text,numeric) to authenticated;
