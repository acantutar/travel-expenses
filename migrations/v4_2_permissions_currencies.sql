-- TripSplit v4.2 reference migration (already applied to production).
-- Previous project version: v4.1. No user/ledger rows are deleted.
create table if not exists public.currency_catalog (
 code text primary key,
 name_tr text not null
);
insert into public.currency_catalog(code,name_tr) values
('TL','Türk lirası'),
('AED','Birleşik Arap Emirlikleri dirhemi'),
('AFN','Afganistan afganisi'),
('ALL','Arnavutluk leki'),
('AMD','Ermenistan dramı'),
('ANG','Hollanda Antilleri guldeni'),
('AOA','Angola kvanzası'),
('ARS','Arjantin pesosu'),
('AUD','Avustralya doları'),
('AWG','Aruba florini'),
('AZN','Azerbaycan manatı'),
('BAM','Konvertibl Bosna Hersek markı'),
('BBD','Barbados doları'),
('BDT','Bangladeş takası'),
('BGN','Bulgar levası'),
('BHD','Bahreyn dinarı'),
('BIF','Burundi frangı'),
('BMD','Bermuda doları'),
('BND','Brunei doları'),
('BOB','Bolivya bolivyanosu'),
('BRL','Brezilya reali'),
('BSD','Bahama doları'),
('BTN','Butan ngultrumu'),
('BWP','Botsvana pulası'),
('BYN','Belarus rublesi'),
('BZD','Belize doları'),
('CAD','Kanada doları'),
('CDF','Kongo frangı'),
('CHF','İsviçre frangı'),
('CLP','Şili pesosu'),
('CNY','Çin yuanı'),
('COP','Kolombiya pesosu'),
('CRC','Kosta Rika kolonu'),
('CUC','Konvertibl Küba pesosu'),
('CUP','Küba pesosu'),
('CVE','Cape Verde esküdosu'),
('CZK','Çek korunası'),
('DJF','Cibuti frangı'),
('DKK','Danimarka kronu'),
('DOP','Dominik pesosu'),
('DZD','Cezayir dinarı'),
('EGP','Mısır lirası'),
('ERN','Eritre nakfası'),
('ETB','Etiyopya birri'),
('EUR','Euro'),
('FJD','Fiji doları'),
('FKP','Falkland Adaları lirası'),
('GBP','İngiliz sterlini'),
('GEL','Gürcistan larisi'),
('GHS','Gana sedisi'),
('GIP','Cebelitarık lirası'),
('GMD','Gambiya dalasisi'),
('GNF','Gine frangı'),
('GTQ','Guatemala quetzalı'),
('GYD','Guyana doları'),
('HKD','Hong Kong doları'),
('HNL','Honduras lempirası'),
('HRK','Hırvatistan kunası'),
('HTG','Haiti gurdu'),
('HUF','Macar forinti'),
('IDR','Endonezya rupisi'),
('ILS','Yeni İsrail şekeli'),
('INR','Hindistan rupisi'),
('IQD','Irak dinarı'),
('IRR','İran riyali'),
('ISK','İzlanda kronu'),
('JMD','Jamaika doları'),
('JOD','Ürdün dinarı'),
('JPY','Japon yeni'),
('KES','Kenya şilini'),
('KGS','Kırgızistan somu'),
('KHR','Kamboçya rieli'),
('KMF','Komorlar frangı'),
('KPW','Kuzey Kore wonu'),
('KRW','Güney Kore wonu'),
('KWD','Kuveyt dinarı'),
('KYD','Cayman Adaları doları'),
('KZT','Kazakistan tengesi'),
('LAK','Laos kipi'),
('LBP','Lübnan lirası'),
('LKR','Sri Lanka rupisi'),
('LRD','Liberya doları'),
('LSL','Lesotho lotisi'),
('LYD','Libya dinarı'),
('MAD','Fas dirhemi'),
('MDL','Moldova leyi'),
('MGA','Madagaskar ariarisi'),
('MKD','Makedonya dinarı'),
('MMK','Myanmar kyatı'),
('MNT','Moğolistan tugriki'),
('MOP','Makao patakası'),
('MRU','Moritanya ugiyası'),
('MUR','Mauritius rupisi'),
('MVR','Maldiv rufiyaası'),
('MWK','Malavi kvaçası'),
('MXN','Meksika pesosu'),
('MYR','Malezya ringgiti'),
('MZN','Mozambik metikali'),
('NAD','Namibya doları'),
('NGN','Nijerya nairası'),
('NIO','Nikaragua kordobası'),
('NOK','Norveç kronu'),
('NPR','Nepal rupisi'),
('NZD','Yeni Zelanda doları'),
('OMR','Umman riyali'),
('PAB','Panama balboası'),
('PEN','Peru solü'),
('PGK','Papua Yeni Gine kinası'),
('PHP','Filipinler pesosu'),
('PKR','Pakistan rupisi'),
('PLN','Polonya zlotisi'),
('PYG','Paraguay guaranisi'),
('QAR','Katar riyali'),
('RON','Romen leyi'),
('RSD','Sırp dinarı'),
('RUB','Rus rublesi'),
('RWF','Ruanda frangı'),
('SAR','Suudi Arabistan riyali'),
('SBD','Solomon Adaları doları'),
('SCR','Seyşeller rupisi'),
('SDG','Sudan lirası'),
('SEK','İsveç kronu'),
('SGD','Singapur doları'),
('SHP','Saint Helena lirası'),
('SLL','Sierra Leone leonesi (1964–2022)'),
('SOS','Somali şilini'),
('SRD','Surinam doları'),
('SSP','Güney Sudan lirası'),
('STN','Sao Tome ve Principe dobrası'),
('SVC','El Salvador Kolonu'),
('SYP','Suriye lirası'),
('SZL','Svaziland lilangenisi'),
('THB','Tayland bahtı'),
('TJS','Tacikistan somonisi'),
('TMT','Türkmenistan manatı'),
('TND','Tunus dinarı'),
('TOP','Tonga paʻangası'),
('TTD','Trinidad ve Tobago doları'),
('TWD','Yeni Tayvan doları'),
('TZS','Tanzanya şilini'),
('UAH','Ukrayna grivnası'),
('UGX','Uganda şilini'),
('USD','ABD doları'),
('UYU','Uruguay pesosu'),
('UZS','Özbekistan somu'),
('VES','Venezuela bolivarı'),
('VND','Vietnam dongu'),
('VUV','Vanuatu vatusu'),
('WST','Samoa talası'),
('XAF','Orta Afrika CFA frangı'),
('XCD','Doğu Karayip doları'),
('XDR','Özel Çekme Hakkı (SDR)'),
('XOF','Batı Afrika CFA frangı'),
('XPF','CFP frangı'),
('XSU','Sucre'),
('YER','Yemen riyali'),
('ZAR','Güney Afrika randı'),
('ZMW','Zambiya kvaçası'),
('ZWL','Zimbabve Doları (2009)')
on conflict(code) do update set name_tr=excluded.name_tr;
alter table public.currency_catalog enable row level security;
drop policy if exists "Currency catalogue readable" on public.currency_catalog;
create policy "Currency catalogue readable" on public.currency_catalog
 for select to anon,authenticated using(true);
grant select on public.currency_catalog to anon,authenticated;
revoke insert,update,delete on public.currency_catalog from anon,authenticated;

create table if not exists public.user_currency_favorites(
 user_id uuid not null references public.profiles(id) on delete cascade,
 currency text not null references public.currency_catalog(code),
 created_at timestamptz not null default now(),
 primary key(user_id,currency)
);
alter table public.user_currency_favorites enable row level security;
drop policy if exists "Only own currency favorites visible" on public.user_currency_favorites;
drop policy if exists "Only own currency favorites inserted" on public.user_currency_favorites;
drop policy if exists "Only own currency favorites removed" on public.user_currency_favorites;
create policy "Only own currency favorites visible" on public.user_currency_favorites
 for select to authenticated using(user_id=(select auth.uid()));
create policy "Only own currency favorites inserted" on public.user_currency_favorites
 for insert to authenticated with check(user_id=(select auth.uid()));
create policy "Only own currency favorites removed" on public.user_currency_favorites
 for delete to authenticated using(user_id=(select auth.uid()));
revoke all on public.user_currency_favorites from anon,authenticated;
grant select,insert,delete on public.user_currency_favorites to authenticated;

alter table public.trips drop constraint if exists trips_base_currency_check;
alter table public.trips add constraint trips_base_currency_check check(base_currency ~ '^[A-Z]{2,3}$');
alter table public.trips drop constraint if exists trips_allowed_currencies_check;
alter table public.trips add constraint trips_allowed_currencies_check check(
 cardinality(allowed_currencies) between 1 and 40
 and base_currency=any(allowed_currencies)
 and array_to_string(allowed_currencies,',') ~ '^[A-Z]{2,3}(,[A-Z]{2,3})*$'
);
alter table public.expense_versions drop constraint if exists expense_versions_currency_check;
alter table public.expense_versions add constraint expense_versions_currency_check check(currency ~ '^[A-Z]{2,3}$');
alter table public.settlement_versions drop constraint if exists settlement_versions_currency_check;
alter table public.settlement_versions add constraint settlement_versions_currency_check check(currency ~ '^[A-Z]{2,3}$');
alter table public.trip_display_rates drop constraint if exists trip_display_rates_currency_check;
alter table public.trip_display_rates add constraint trip_display_rates_currency_check check(currency ~ '^[A-Z]{2,3}$');

create or replace function public.valid_trip_currency_choices(p_base text,p_choices text[])
returns boolean language sql stable set search_path='' as $$
 select p_base is not null and p_choices is not null
  and cardinality(p_choices) between 1 and 40
  and p_base=any(p_choices)
  and cardinality(p_choices)=cardinality(array(select distinct x from unnest(p_choices) x))
  and not exists(
    select 1 from unnest(p_choices) x
    left join public.currency_catalog c on c.code=x
    where c.code is null
  );
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path='' as $$
 select false;
$$;
create or replace function app_private.can_view_profile(p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_user() and (
   p_user_id=auth.uid()
   or exists (
     select 1 from public.trip_members me
     join public.trip_members other on other.trip_id=me.trip_id
     where me.user_id=auth.uid() and me.is_active and other.user_id=p_user_id
   )
 );
$$;
update public.profiles set is_admin=false where is_admin=true;
