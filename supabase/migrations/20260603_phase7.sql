-- Batch 7: make Realtime actually deliver to the admin (live task board,
-- approvals, notifications — no refresh). Idempotent — safe to run many times.
-- Paste into Supabase → SQL Editor → Run.
--
-- Why: the app reads everything with the service-role key (which bypasses RLS),
-- so admins were never given a SELECT policy. Supabase Realtime evaluates RLS on
-- the *browser* (authenticated) connection, so with no admin SELECT policy the
-- admin received NO postgres_changes events — task cards, approvals and the bell
-- only updated on a manual refresh. This grants admins SELECT (they already see
-- everything via the service role, so this exposes nothing new), re-ensures the
-- realtime publication, and sets full row images so filtered subscriptions work.

do $$
declare
  t text;
  tables text[] := array[
    'tasks','activity_log','notifications','project_phases',
    'projects','messages','files','invoices'
  ];
begin
  foreach t in array tables
  loop
    -- Skip any table that doesn't exist on this database.
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    -- 1) Ensure the table streams over Realtime (no-op if already added).
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;

    -- 2) Full row images so UPDATE/DELETE events carry the columns that
    --    filters + RLS need (project_id, client_id, for_admin, …).
    execute format('alter table public.%I replica identity full', t);

    -- 3) Admins can SELECT everything → Realtime now delivers to the admin.
    --    Reads in the app still go through the service role; this only unblocks
    --    the realtime subscription. Matches the app's role check
    --    (user.user_metadata.role === 'admin'); also accepts app_metadata.
    execute format('drop policy if exists %I on public.%I', 'admin_realtime_select_' || t, t);
    execute format(
      $f$create policy %I on public.%I for select to authenticated
         using (coalesce(
           auth.jwt() -> 'user_metadata' ->> 'role',
           auth.jwt() -> 'app_metadata'  ->> 'role'
         ) = 'admin')$f$,
      'admin_realtime_select_' || t, t
    );
  end loop;
end $$;
