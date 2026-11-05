-- Original schema.sql is v3; these policies were removed by manual v4 cutover
-- in production. Drop ONLY the obsolete blanket READ policies in the test DB.
drop policy if exists "Authenticated users can view profiles" on public.profiles;
drop policy if exists "Authenticated users can view ledger" on public.expense_versions;
-- Verify the intended strict v4 production-like policy set exists, and no
-- obsolete open grants survive. Fail before running any security assertions.
do $$
declare tbl text;
begin
  foreach tbl in array array['trips','trip_members','expense_versions',
    'settlement_versions','trip_display_rates','profiles'] loop
    if not exists (
      select 1 from pg_policies p where p.schemaname='public'
      and p.tablename=tbl and p.cmd='SELECT' and p.roles @> array['authenticated']
    ) then raise exception 'Missing authenticated RLS SELECT policy: %',tbl; end if;
    if (select count(*) from pg_policies p where p.schemaname='public'
        and p.tablename=tbl and p.cmd='SELECT')<>1
    then raise exception 'Unexpected additional SELECT policy: %',tbl; end if;
    if not (select c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname=tbl)
    then raise exception 'RLS disabled: %',tbl; end if;
  end loop;
end $$;
