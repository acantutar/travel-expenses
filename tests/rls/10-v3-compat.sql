-- Run after schema.sql but before v4 migrations.
-- Match the two columns/identity function applied in the live v3.11 phase.
alter table public.profiles add column login_name text;
alter table public.profiles add column is_active boolean not null default true;
update public.profiles p set login_name=split_part(u.email,'@',1)
from auth.users u where u.id=p.id;
alter table public.profiles alter column login_name set not null;
create unique index profiles_login_name_ci on public.profiles (lower(login_name));
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select p.is_active from public.profiles p where p.id=auth.uid()),false)
$$;
revoke all on function public.is_active_user() from public,anon;
grant execute on function public.is_active_user() to authenticated;
