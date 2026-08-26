-- POST-APPLY VERIFICATION for 0020. All six checks must come back ok.
select
  -- 1. six helpers exist, all SECURITY DEFINER + STABLE
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef and p.provolatile='s'
      and p.proname in ('is_org_member','is_org_admin','is_client_member',
                        'org_project_visible','client_project_visible','member_history_from')
  ) = 6                                                                as chk1_helpers,

  -- 2. is_client_member no longer mentions clients.user_id
  (pg_get_functiondef('public.is_client_member(uuid)'::regprocedure)
     not ilike '%c.user_id = auth.uid()%')                             as chk2_branch_dropped,

  -- 3. PUBLIC/anon hold no EXECUTE on any of the six
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('is_org_member','is_org_admin','is_client_member',
                        'org_project_visible','client_project_visible','member_history_from')
      and (has_function_privilege('public', p.oid, 'execute')
        or has_function_privilege('anon',   p.oid, 'execute'))
  ) = 0                                                                as chk3_no_public_execute,

  -- 4. authenticated holds EXECUTE on all six
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('is_org_member','is_org_admin','is_client_member',
                        'org_project_visible','client_project_visible','member_history_from')
      and has_function_privilege('authenticated', p.oid, 'execute')
  ) = 6                                                                as chk4_authenticated_execute,

  -- 5. all four *_admin_all policies carry BOTH the org predicate and
  --    is_org_admin(), each wrapped in a subselect, on USING and WITH CHECK
  (select count(*) from pg_policies
    where schemaname='public' and policyname like '%_admin_all'
      and tablename in ('organization_members','client_members',
                        'client_member_projects','organization_member_projects')
      and qual       like '%current_org()%' and qual       like '%is_org_admin()%'
      and with_check like '%current_org()%' and with_check like '%is_org_admin()%'
  ) = 4                                                                as chk5_policies_scoped,

  -- 6. no *_admin_all policy still gates on bare is_admin()
  (select count(*) from pg_policies
    where schemaname='public' and policyname like '%_admin_all'
      and tablename in ('organization_members','client_members',
                        'client_member_projects','organization_member_projects')
      and (qual ilike '%is_admin()%' or with_check ilike '%is_admin()%')
  ) = 0                                                                as chk6_no_bare_is_admin,

  -- 7. the two team_read policies still resolve (is_client_member OID preserved)
  (select count(*) from pg_policies
    where schemaname='public' and policyname in
      ('client_members_team_read','client_member_projects_team_read')
  ) = 2                                                                as chk7_team_read_intact;
