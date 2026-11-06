-- TripSplit v4.5: account-independent people in a trip.
-- Additive only: NO changes to existing profiles, memberships, expenses,
-- settlements, historical ledger versions, or existing trip records.
--
-- A trip participant represents a HUMAN in the shared calculation, not an
-- account with login privileges. Identity linking is deliberately reserved
-- for a later explicit, verified workflow.
create table public.trip_participants (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete restrict,
  display_name text not null,
  linked_user_id uuid references public.profiles(id) on delete restrict,
  is_active boolean not null default true,
  created_by uuid not null default auth.uid()
    references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  linked_at timestamptz,
  linked_by uuid references public.profiles(id) on delete restrict,
  constraint trip_participants_name_length
    check (char_length(btrim(display_name)) between 2 and 60),
  constraint trip_participants_link_consistency
    check (
      (linked_user_id is null and linked_at is null and linked_by is null)
      or
      (linked_user_id is not null and linked_at is not null and linked_by is not null)
    ),
  -- Future ledger entries will reference both trip and participant; an ID
  -- from another trip must never be accepted as part of the wrong trip.
  constraint trip_participants_trip_id_id_unique unique (trip_id,id)
);

-- Prevent accidental duplicate visible names within one trip. Names can be
-- reused in other trips and may be reused after a participant is deactivated.
create unique index trip_participants_unique_active_name
  on public.trip_participants(trip_id,lower(btrim(display_name)))
  where is_active;
create unique index trip_participants_unique_linked_identity
  on public.trip_participants(trip_id,linked_user_id)
  where linked_user_id is not null;
create index trip_participants_trip_lookup
  on public.trip_participants(trip_id);

alter table public.trip_participants enable row level security;

-- A member can view their OWN trip's participant roster, even when their
-- role is not owner/admin; the row is otherwise invisible.
create policy "Active trip members view named participants"
  on public.trip_participants for select to authenticated
  using ((select app_private.is_trip_member(trip_id)));

-- Only an actual trip manager can add an unlinked, active participant. All
-- identity fields must remain null and created_by cannot be forged.
create policy "Trip managers create unlinked participants"
  on public.trip_participants for insert to authenticated
  with check (
    (select app_private.is_trip_manager(trip_id))
    and created_by = (select auth.uid())
    and is_active
    and linked_user_id is null
    and linked_at is null
    and linked_by is null
  );

revoke all on table public.trip_participants from public,anon,authenticated;
grant select,insert on table public.trip_participants to authenticated;
-- No UPDATE or DELETE grant. Only a future verified binding/deactivation flow
-- may assign linked_user_id or change an existing person.

-- SECURITY INVOKER: same INSERT + RLS checks as the caller; never bypasses
-- trip membership authorization. Existing Supabase anonymous Auth sessions
-- also use the authenticated role with their own auth.uid().
create function public.add_named_trip_participant(
  p_trip_id uuid,
  p_display_name text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text;
  v_id uuid;
begin
  if auth.uid() is null or p_trip_id is null
    or not app_private.is_trip_manager(p_trip_id) then
    raise exception 'Bu geziyi yönetme yetkin yok';
  end if;

  v_name := regexp_replace(
    btrim(coalesce(p_display_name,'')),
    '[[:space:]]+',' ','g'
  );
  if char_length(v_name) not between 2 and 60 then
    raise exception 'Katılımcı adı 2-60 karakter olmalı';
  end if;

  insert into public.trip_participants(trip_id,display_name,created_by)
    values(p_trip_id,v_name,auth.uid())
    returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.add_named_trip_participant(uuid,text)
  from public,anon,authenticated;
grant execute on function public.add_named_trip_participant(uuid,text)
  to authenticated;
