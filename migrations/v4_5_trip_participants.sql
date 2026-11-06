-- P0 additive trip-local participant identities. DOES NOT modify historical ledgers.
-- Deploy only after the isolated tests and a deliberate, reviewed release decision.
-- Unlike trip_members, rows here do not confer any authorization.
create table public.trip_participants (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete restrict,
  display_name text not null,
  linked_user_id uuid references public.profiles(id) on delete restrict,
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint trip_participants_name_length check (
    char_length(btrim(display_name)) between 1 and 60
    and display_name = btrim(display_name)
  ),
  constraint trip_participants_name_no_controls check (
    display_name !~ '[[:cntrl:]]'
  ),
  constraint trip_participants_link_requires_active check (
    linked_user_id is null or is_active
  ),
  constraint trip_participants_trip_identity unique (trip_id, id)
);

-- One active participant label per trip. Different trips can reuse names.
-- A participant's label is NOT proof of their account identity.
create unique index trip_participants_active_name_unique
  on public.trip_participants (trip_id, lower(display_name))
  where is_active;

-- A real account may be linked to at most one trip-local identity.
-- No direct client writes to linked_user_id are permitted.
create unique index trip_participants_linked_user_unique
  on public.trip_participants (trip_id, linked_user_id)
  where linked_user_id is not null;

create index trip_participants_trip_active_idx
  on public.trip_participants (trip_id, is_active);

alter table public.trip_participants enable row level security;

-- Read access only to actual active trip members. A named participant
-- without a linked account gets NO Data API privileges from this row.
create policy "Trip members view named participants"
  on public.trip_participants
  for select to authenticated
  using ((select app_private.is_trip_member(trip_id)));

revoke all on public.trip_participants from public, anon, authenticated;
grant select on public.trip_participants to authenticated;

-- The only client mutation exposed in this phase is an audited, owner/admin-
-- controlled name creation. Direct INSERT/UPDATE/DELETE remain forbidden.
create or replace function public.add_named_trip_participant(
  p_trip_id uuid, p_display_name text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_display_name, ''));
begin
  if auth.uid() is null or not public.is_active_user()
    or not app_private.is_trip_manager(p_trip_id) then
    raise exception 'Yalnız gezi yöneticisi katılımcı ekleyebilir';
  end if;
  if char_length(v_name) not between 1 and 60
     or v_name ~ '[[:cntrl:]]' then
    raise exception 'Katılımcı adı 1-60 karakter olmalı';
  end if;
  -- Lock this trip row against concurrent inserts bypassing the capacity check.
  perform 1 from public.trips where id = p_trip_id for update;
  if (select count(*) from public.trip_participants
      where trip_id = p_trip_id and is_active) >= 30 then
    raise exception 'Bir gezi en fazla 30 aktif isimli katılımcı içerebilir';
  end if;
  insert into public.trip_participants
    (trip_id, display_name, created_by)
  values (p_trip_id, v_name, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Prevent accidental regrant to unauthenticated users via default PUBLIC EXECUTE.
revoke all on function public.add_named_trip_participant(uuid,text)
  from public, anon, authenticated;
grant execute on function public.add_named_trip_participant(uuid,text)
  to authenticated;

-- To avoid forged claims, account-linking is intentionally not implemented:
-- linked_user_id remains NULL until a separate verified-claim workflow ships.
-- Existing expense_versions/settlement_versions foreign keys and rows untouched.
