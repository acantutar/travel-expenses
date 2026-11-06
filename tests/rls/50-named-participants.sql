-- P0 synthetic integration test for account-independent trip participants.
-- Runs AFTER cross-user and guest tests, in a temporary PostgreSQL 17 database.
\set ON_ERROR_STOP on
create temporary table original_ledger_counts as
  select (select count(*) from public.expense_versions) as expenses,
         (select count(*) from public.settlement_versions) as settlements;

-- An earlier isolated RLS test removed B from their trip. Re-enable B in this
-- test-only fixture so each owner can be tested independently.
update public.trip_members set is_active=true
where trip_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  and user_id='22222222-2222-4222-8222-222222222222';

select test.assert(
  not has_table_privilege('anon','public.trip_participants','SELECT'),
  'Unauthenticated API clients have no roster SELECT grant');
select test.assert(
  not has_function_privilege('anon',
    'public.add_named_trip_participant(uuid,text)','EXECUTE'),
  'Unauthenticated API clients cannot invoke participant creation');
select test.assert(
  not has_table_privilege('authenticated','public.trip_participants','UPDATE')
  and not has_table_privilege('authenticated','public.trip_participants','DELETE'),
  'No direct linked identity edits or hard deletes');

set role authenticated;
select set_config('request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',false);

select test.assert(
  public.add_named_trip_participant(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Ahmet') is not null,
  'A can add Ahmet to own trip without any Auth account');
select test.assert(
  public.add_named_trip_participant(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','  Sena    Yılmaz   ') is not null,
  'A can add another person by name');

select test.assert((select count(*) from public.trip_participants
  where trip_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=2,
  'Exactly two named participants exist in trip A');
select test.assert((select count(*) from public.trip_participants
  where trip_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and display_name='Sena Yılmaz')=1,
  'Whitespace normalized before storage');
select test.assert((select count(*) from public.trip_participants
  where trip_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and linked_user_id is null and linked_at is null and linked_by is null)=2,
  'No name is silently claimed by an Auth identity');

select test.expect_denied($query$
  select public.add_named_trip_participant(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Yetkisiz Kişi')
$query$,'Bu geziyi yönetme yetkin yok',
'A cannot add a participant to B trip');

do $$
declare blocked boolean := false;
begin
  begin
    perform public.add_named_trip_participant(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aHmEt');
  exception when unique_violation then
    blocked:=true;
  end;
  perform test.assert(blocked,
    'Case-insensitive duplicate participant names are rejected per trip');
end $$;

do $$
declare blocked boolean := false;
begin
  begin
    insert into public.trip_participants(
      trip_id,display_name,created_by,linked_user_id,linked_at,linked_by)
    values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Forged Link',
           '11111111-1111-4111-8111-111111111111',
           '22222222-2222-4222-8222-222222222222',
           now(),'11111111-1111-4111-8111-111111111111');
  exception when insufficient_privilege then
    blocked:=true;
  end;
  perform test.assert(blocked,
    'Direct insert cannot assign linked identity without verified approval');
end $$;

do $$
declare blocked boolean := false;
begin
  begin
    insert into public.trip_participants(trip_id,display_name,created_by)
    values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Forged Creator',
           '22222222-2222-4222-8222-222222222222');
  exception when insufficient_privilege then
    blocked:=true;
  end;
  perform test.assert(blocked,
    'Direct insert cannot impersonate another profile');
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub',
  '22222222-2222-4222-8222-222222222222',false);
select test.assert(
 (select count(*) from public.trip_participants
  where trip_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=0,
 'B cannot view A roster');
select test.assert(
  public.add_named_trip_participant(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Ahmet') is not null,
  'The same display name is allowed in a different trip');
select test.assert(
  (select count(*) from public.trip_participants
  where trip_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=1,
  'B sees exactly own participant');
reset role;

-- Real anonymous Supabase Auth users have the 'authenticated' DB role.
-- The previous guest test created a genuine synthetic guest and private trip.
set role authenticated;
select set_config('request.jwt.claim.sub',
  '33333333-3333-4333-8333-333333333333',false);
select test.assert(
  public.add_named_trip_participant(
    (select id from public.trips where owner_id=auth.uid()
      order by created_at desc limit 1),'Mehmet') is not null,
  'Anonymous guest may add names to own private trip');
select test.assert(
  (select count(*) from public.trip_participants
   where trip_id in(select id from public.trips where owner_id=auth.uid()))=1,
  'Guest sees their own roster only');
reset role;

select test.assert(
  (select count(*) from public.expense_versions)
    =(select expenses from original_ledger_counts)
  and
  (select count(*) from public.settlement_versions)
    =(select settlements from original_ledger_counts),
  'Existing expense and settlement version counts are unchanged');
select test.assert(
  (select count(*) from public.trip_participants
   where linked_user_id is not null)=0,
  'The first release creates no verified identity links');

\echo 'PASS: trip-participant RLS, guest accounts, no identity forgery, legacy ledger unchanged.'
