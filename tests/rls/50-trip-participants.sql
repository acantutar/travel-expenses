-- Synthetic integration tests. Execute only in disposable PostgreSQL CI.
\set ON_ERROR_STOP on
-- Fixture: A, B and guest identities already exist from 30/40 test cases.
-- User B was removed from B's trip by the cross-user fixture; A owns trip A.
select test.assert((select count(*) from public.trip_participants)=0,
  'New participant model starts empty; historical ledger remains untouched');

set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select test.assert(
 public.add_named_trip_participant('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','  Ahmet  ') is not null,
 'Owner adds participant name without an Auth account');
select test.assert(
 public.add_named_trip_participant('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Sena') is not null,
 'Owner adds a second person without a signup');
select test.assert((select count(*) from public.trip_participants
 where trip_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 and display_name in ('Ahmet','Sena') and linked_user_id is null
 and is_active)=2,'Two trip-local IDs exist with no linked real identity');

select test.assert(
  not has_table_privilege('authenticated','public.trip_participants','INSERT')
  and not has_table_privilege('authenticated','public.trip_participants','UPDATE')
  and not has_table_privilege('authenticated','public.trip_participants','DELETE'),
 'Direct participant writes are denied; only manager-scoped RPC is exposed');

select test.expect_denied($q$
 select public.add_named_trip_participant('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','B name')
$q$,'Yalnız gezi yöneticisi','A cannot add person to B trip');

-- Names are not credentials; guessing a linked_user_id is not supported.
select test.assert((select count(*) from public.trip_participants
 where linked_user_id is not null)=0,
 'Names never auto-claim a permanent account');

-- A second authenticated account must not see another trip's people.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select test.assert((select count(*) from public.trip_participants)=0,
 'Removed B cannot read any private participant names');
select test.expect_denied($q$
 select public.add_named_trip_participant('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Intruder')
$q$,'Yalnız gezi yöneticisi','B cannot add names to A trip');

-- A participant on the trip who is NOT a manager can read but cannot create.
reset role;
insert into public.trip_members(trip_id,user_id,role,is_active)
 values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '33333333-3333-4333-8333-333333333333','member',true);
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select test.assert((select count(*) from public.trip_participants
 where trip_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=2,
 'A real trip member may see their own trip named people');
select test.expect_denied($q$
 select public.add_named_trip_participant('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Forged owner')
$q$,'Yalnız gezi yöneticisi','Nonmanager member cannot create named participant');

-- Invalid names and case-insensitive duplicate detection.
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select test.expect_denied($q$
 select public.add_named_trip_participant('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',' ')
$q$,'Katılımcı adı 1-60 karakter','Blank names rejected');
do $$
declare blocked boolean := false;
begin
  begin
    perform public.add_named_trip_participant('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ahmet');
  exception when unique_violation then blocked:=true; end;
  perform test.assert(blocked,'Case-insensitive duplicate active names are rejected');
end $$;

reset role;
select test.assert((select count(*) from public.expense_versions
 where trip_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=2,
 'Original expenses remain unchanged by new participant creation');
select test.assert((select count(*) from public.settlement_versions
 where trip_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=1,
 'Original settlements remain unchanged by new participant creation');
\echo 'PASS: trip-local named participants, permissions and historical data isolation.'
