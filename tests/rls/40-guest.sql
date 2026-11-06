-- Executed only inside disposable PostgreSQL 17 CI, never production.
-- A guest account created by Supabase Auth must receive a profile, while
-- retaining the same cross-trip isolation as a password-based account.
\set ON_ERROR_STOP on

insert into auth.users(id,email,is_anonymous,raw_user_meta_data)
values('33333333-3333-4333-8333-333333333333',null,true,
  '{"username":"I AM ADMIN","is_admin":true,"role":"owner"}'::jsonb);

select test.assert(
 (select count(*) from public.profiles
  where id='33333333-3333-4333-8333-333333333333'
    and username='Misafir'
    and login_name='guest.33333333333343338333333333333333'
    and is_admin=false and is_active=true)=1,
 'Guest profile created using the auth UUID, never user-controlled metadata'
);

set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select test.assert((select count(*) from public.profiles where id=auth.uid())=1,
 'Guest can read their own profile');
select test.assert((select count(*) from public.trips
 where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
              'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid))=0,
 'Guest cannot see other users trips');
select test.expect_denied($query$
  select public.create_trip_expense('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111','Unauthorized',1,'TL','Cash',
    array['11111111-1111-4111-8111-111111111111']::uuid[],current_date)
$query$, 'Bu geziye erişimin yok', 'Guest cannot modify another account trip');

create temporary table test_created_trip as
select public.create_trip_with_settings(
  'Kayıtsız Hafta Sonu','',null,null,'TL',array['TL']::text[]) as trip_id;

select test.assert(
  (select count(*) from public.trips
    where id=(select trip_id from test_created_trip)
    and owner_id=auth.uid() and base_currency='TL')=1,
  'Guest creates a private TL trip via real RPC'
);
select test.assert(
  (select count(*) from public.trip_members
    where trip_id=(select trip_id from test_created_trip)
    and user_id=auth.uid() and role='owner' and is_active)=1,
  'Guest has owner membership for own trip'
);

-- The default legacy expense engine accepts the guest's own identity,
-- but the friend-without-account feature remains a separate migration.
select test.assert(public.create_trip_expense(
   (select trip_id from test_created_trip),auth.uid(),
   'Misafir ilk harcama',100,'TL','Cash',array[auth.uid()],current_date
 ) is not null,'Guest can safely record a self-paid expense in own trip');

reset role;
\echo 'PASS: guest profile, private trip, existing ledgers and RLS checks.'
