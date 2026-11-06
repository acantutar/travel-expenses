-- TripSplit P0: create an internal profile for genuine Supabase anonymous Auth users.
-- Run only after enabling Supabase Auth anonymous sign-ins and reviewing RLS.
-- Backwards compatible: existing username + synthetic-email logins are unchanged.
-- No existing profiles/trips/ledgers are updated.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $body$
declare
  v_login text;
  v_name text;
begin
  if new.is_anonymous is true then
    -- Anonymous users have no verified email/password. Their profile identity
    -- comes ONLY from auth.users, not from user-controlled JWT metadata.
    v_login := 'guest.' || replace(new.id::text, '-', '');
    insert into public.profiles (id, username, login_name, is_admin, is_active)
    values (new.id, 'Misafir', v_login, false, true)
    on conflict (id) do nothing;
    return new;
  end if;

  -- Preserve the legacy accounts and their existing trigger behavior.
  if lower(split_part(coalesce(new.email, ''), '@', 2)) <> 'travel-expenses.app' then
    return new;
  end if;
  v_login := lower(split_part(coalesce(new.email, ''), '@', 1));
  v_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')), '');
  if v_name is null then v_name := v_login; end if;
  insert into public.profiles (id, username, login_name, is_admin, is_active)
  values (new.id, v_name, v_login, false, true)
  on conflict (id) do update
    set username = excluded.username,
        login_name = excluded.login_name,
        is_active = true;
  return new;
end;
$body$;

-- This is an auth trigger, not an externally callable RPC.
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- The existing trigger on auth.users is intentionally preserved. DO NOT
-- recreate users or backfill real customer records from this migration.
