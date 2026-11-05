-- P0 real PostgreSQL RLS/RPC tests: only synthetic accounts in a disposable CI DB.
-- Run after schema.sql + all 3 versioned migrations + policy gate. Never use in production.
\set ON_ERROR_STOP on
create schema test;
create function test.assert(condition boolean, label text) returns void
language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'RLS ASSERTION FAILED: %',label; end if;
  raise notice 'PASS: %',label;
end $$;
grant usage on schema test to authenticated;
grant execute on function test.assert(boolean,text) to authenticated;

-- The nested exception block captures only the attempted RPC. An assertion
-- failure outside it cannot be mistaken for an expected denied RPC.
create function test.expect_denied(command text, expected_message text, label text)
returns void language plpgsql as $guard$
declare actual_message text; actual_state text;
begin
  begin
    execute command;
  exception when others then
    get stacked diagnostics actual_message=message_text, actual_state=returned_sqlstate;
    if actual_state <> 'P0001' or position(expected_message in actual_message)=0 then
      raise exception 'Wrong failure for % (state %, message: %)',label,actual_state,actual_message;
    end if;
    perform test.assert(true,label);
    return;
  end;
  raise exception 'Unauthorized operation unexpectedly succeeded: %',label;
end $guard$;
grant execute on function test.expect_denied(text,text,text) to authenticated;

-- Both identities also belong to the historical legacy trip because the
-- original v4 migration backfills memberships. Isolated A/B trips test the
-- actual multi-trip boundaries (NOT global profile visibility).
insert into public.trips(id,name,destination,owner_id) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Isolated Trip A','', '11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Isolated Trip B','', '22222222-2222-4222-8222-222222222222');
insert into public.trip_members(trip_id,user_id,role,is_active) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','owner',true),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','owner',true);
insert into public.expense_versions
  (expense_id,version_no,status,payer_id,description,amount,currency,
   payment_type,participant_ids,spent_on,changed_by,change_reason,trip_id)
values
 ('aaaaeeee-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'active','11111111-1111-4111-8111-111111111111',
  'Synthetic A',100,'TL','Cash',array['11111111-1111-4111-8111-111111111111']::uuid[],current_date,
  '11111111-1111-4111-8111-111111111111','Fixture','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('bbbbeeee-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,'active','22222222-2222-4222-8222-222222222222',
  'Synthetic B',200,'TL','Cash',array['22222222-2222-4222-8222-222222222222']::uuid[],current_date,
  '22222222-2222-4222-8222-222222222222','Fixture','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.settlement_versions
 (settlement_id,version_no,status,from_user_id,to_user_id,amount,currency,
  spent_on,changed_by,change_reason,trip_id)
values
 ('aaaccccc-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'active','11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',50,'TL',current_date,
  '11111111-1111-4111-8111-111111111111','Fixture','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('bbbccccc-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,'active','22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',60,'TL',current_date,
  '22222222-2222-4222-8222-222222222222','Fixture','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.trip_display_rates(trip_id,currency,base_rate,tl_rate) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','MYR',12,12),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','MYR',13,13);
insert into public.trip_invitations(trip_id,token_hash,created_by,expires_at)
values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  encode(extensions.digest(repeat('a',64),'sha256'),'hex'),
  '22222222-2222-4222-8222-222222222222',now()+interval '7 days');

-- Synthetic identity A: positive read for its own trip; zero reads for B.
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select test.assert((select count(*) from public.trips where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=1,'A can read A trip');
select test.assert((select count(*) from public.trips where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=0,'A cannot read B trip');
select test.assert((select count(*) from public.trip_members where trip_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=0,'A cannot read B membership');
select test.assert((select count(*) from public.expense_versions where trip_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=0,'A cannot read B ledger');
select test.assert((select count(*) from public.settlement_versions where trip_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=0,'A cannot read B settlements');
select test.assert((select count(*) from public.trip_display_rates where trip_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=0,'A cannot read B exchange rates');
select test.assert((select count(*) from public.expense_versions where trip_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=1,'A can read own ledger');
select test.assert(not has_table_privilege('authenticated','public.trips','UPDATE'),'No direct UPDATE permission on trips');
select test.assert(not has_table_privilege('authenticated','public.expense_versions','INSERT'),'No direct ledger INSERT permission');
select test.assert(not has_table_privilege('authenticated','public.settlement_versions','DELETE'),'No direct settlement DELETE permission');
select test.assert(not has_table_privilege('authenticated','public.trip_invitations','SELECT'),'Invite token hashes inaccessible via Data API');

-- Authorization failures must be SPECIFIC. A missing function, malformed SQL or
-- invalid input must NOT count as a passing permission denial.
select test.expect_denied($query$
  select public.create_trip_expense('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '22222222-2222-4222-8222-222222222222','Unauthorized',1,'TL','Cash',
    array['22222222-2222-4222-8222-222222222222']::uuid[],current_date)
$query$,'Bu geziye erişimin yok','A cannot insert expense in B trip');

select test.expect_denied($query$
  select public.create_trip_settlement('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '22222222-2222-4222-8222-222222222222',
    '11111111-1111-4111-8111-111111111111',1,'TL',current_date,'Unauthorized')
$query$,'Bu geziye erişimin yok','A cannot insert settlement in B trip');

select test.expect_denied($query$
  select public.set_trip_member_active('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '22222222-2222-4222-8222-222222222222',false)
$query$,'Yalnız gezi yöneticisi','A cannot remove B trip owner');

select test.expect_denied($query$
  select public.create_trip_invite('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
$query$,'Gezi yöneticisi olmalısın','A cannot create B invite');

select test.expect_denied($query$
  select public.revise_expense('bbbbeeee-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '22222222-2222-4222-8222-222222222222','Unauthorized revision',2,'TL','Cash',
    array['22222222-2222-4222-8222-222222222222']::uuid[],null,current_date,'Unauthorized')
$query$,'Bu kaydı düzenleme yetkin yok','A cannot revise B expense');

-- The repo only contains the legacy void_expense() body; current production
-- has an updated owner-scoped body. Keep this assertion explicit until
-- that missing production migration is versioned in the repository.
select test.expect_denied($query$
  select public.void_expense('bbbbeeee-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Unauthorized')
$query$,'Admin yetkisi gerekli','Legacy void RPC denies A in local fixture');

select test.expect_denied($query$
  select public.set_trip_currency_rate('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','MYR',99)
$query$,'Yönetici yetkisi gerekli','A cannot change B exchange rates');

-- Positive RPC: A can add an expense to A, then A can read it.
select test.assert(public.create_trip_expense('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111','Allowed',8,'TL','Cash',
  array['11111111-1111-4111-8111-111111111111']::uuid[],current_date) is not null,
  'A can create expense in own trip');
select test.assert((select count(*) from public.expense_versions where trip_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=2,'A sees own RPC-added expense');

-- Synthetic identity B: inverse visibility.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select test.assert((select count(*) from public.trips where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=1,'B can read B trip');
select test.assert((select count(*) from public.trips where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=0,'B cannot read A trip');
select test.assert((select count(*) from public.trip_members where trip_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=0,'B cannot read A members');
select test.assert((select count(*) from public.expense_versions where trip_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=0,'B cannot read A expenses');
select test.assert((select count(*) from public.settlement_versions where trip_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=0,'B cannot read A settlements');
select test.assert((select count(*) from public.trip_display_rates where trip_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=0,'B cannot read A rates');

-- Positive owner RPCs guard against false passes caused by a broken function.
select test.assert(public.create_trip_invite('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  ~ '^[0-9a-f]{64}-- guessed tokens produce no preview result.
select test.assert((select count(*) from public.list_trip_invites('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'))=2,'B sees own issued invite');
select test.assert((select count(*) from public.preview_trip_invite(repeat('f',64)))=0,'Unknown invite token gives no preview');
reset role;

-- Removing B revokes B access, without rewriting historical ledger rows.
update public.trip_members set is_active=false where trip_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and user_id='22222222-2222-4222-8222-222222222222';
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select test.assert((select count(*) from public.trips where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=0,'Removed B cannot read former trip');
select test.assert((select count(*) from public.expense_versions where trip_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=0,'Removed B cannot read old ledger');
reset role;
select test.assert((select count(*) from public.expense_versions where trip_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=2,'Removed B ledger history remains intact');
\echo 'All disposable two-user RLS integration assertions passed.'
,'B can create invite for own trip');
select public.set_trip_currency_rate('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','MYR',14);
select test.assert((select base_rate from public.trip_display_rates
  where trip_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and currency='MYR')=14,
  'B can update own exchange rate');
select test.assert(public.revise_expense('bbbbeeee-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '22222222-2222-4222-8222-222222222222','Owner revision',200,'TL','Cash',
  array['22222222-2222-4222-8222-222222222222']::uuid[],null,current_date,'Owner edit')=2,
  'B can revise own trip expense');

-- Owner B can read the existing invite using the intended privileged RPC;
-- guessed tokens produce no preview result.
select test.assert((select count(*) from public.list_trip_invites('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'))=1,'B sees own issued invite');
select test.assert((select count(*) from public.preview_trip_invite(repeat('f',64)))=0,'Unknown invite token gives no preview');
reset role;

-- Removing B revokes B access, without rewriting historical ledger rows.
update public.trip_members set is_active=false where trip_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and user_id='22222222-2222-4222-8222-222222222222';
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select test.assert((select count(*) from public.trips where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=0,'Removed B cannot read former trip');
select test.assert((select count(*) from public.expense_versions where trip_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=0,'Removed B cannot read old ledger');
reset role;
select test.assert((select count(*) from public.expense_versions where trip_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=1,'Removed B ledger history remains intact');
\echo 'All disposable two-user RLS integration assertions passed.'
