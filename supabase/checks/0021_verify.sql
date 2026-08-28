-- POST-APPLY VERIFICATION for 0021. Every column must come back true.
select
  -- 1. No policy on any of the 22 tables still gates on bare is_admin().
  --    A single leftover ORs with the new one and grants back everything.
  (select count(*) from pg_policies
    where schemaname='public'
      and tablename in ('documents','document_versions','document_comments','storyboards',
        'storyboard_shots','usage_events','org_budgets','org_credits','credit_ledger',
        'asset_provenance','rights','projects','files','messages','tasks','invoices',
        'notifications','project_phases','activity_log','organizations','business_settings','clients')
      and (coalesce(qual,'') ilike '%is_admin()%' or coalesce(with_check,'') ilike '%is_admin()%')
  ) = 0                                                            as chk1_no_bare_is_admin,

  -- 2. Every Class A table carries a member-scoped policy.
  (select count(distinct tablename) from pg_policies
    where schemaname='public'
      and tablename in ('documents','document_versions','document_comments','storyboards',
        'storyboard_shots','asset_provenance','rights','usage_events','org_budgets',
        'org_credits','credit_ledger')
      and qual like '%is_org_member()%' and qual like '%current_org()%'
  ) = 11                                                           as chk2_class_a_complete,

  -- 3. Every Class B table has BOTH a crew and a client policy.
  (select count(*) from (
     select tablename from pg_policies
     where schemaname='public'
       and tablename in ('projects','files','messages','tasks','invoices','notifications',
                         'project_phases','activity_log')
       and policyname like '%_crew_all'
     intersect
     select tablename from pg_policies
     where schemaname='public' and policyname like '%_client_%') x
  ) = 8                                                            as chk3_class_b_both_sides,

  -- 4. history_from is enforced on messages and activity_log, and ONLY there.
  (select count(*) from pg_policies
    where schemaname='public' and qual like '%member_history_from()%'
  ) = 2                                                            as chk4_history_two_tables,

  -- 5. Class D: no business_settings policy without an org predicate.
  (select count(*) from pg_policies
    where schemaname='public' and tablename='business_settings'
      and coalesce(qual,'') not like '%current_org()%'
  ) = 0                                                            as chk5_bank_details_scoped,

  -- 6. Class E column grants: the five dangerous columns are NOT writable...
  (not has_column_privilege('authenticated','public.clients','is_active','UPDATE')
   and not has_column_privilege('authenticated','public.clients','invite_policy','UPDATE')
   and not has_column_privilege('authenticated','public.clients','organization_id','UPDATE')
   and not has_column_privilege('authenticated','public.clients','user_id','UPDATE')
   and not has_column_privilege('authenticated','public.clients','email','UPDATE')
  )                                                                as chk6_dangerous_cols_revoked,

  -- 7. ...and the six the app actually writes still are.
  (has_column_privilege('authenticated','public.clients','name','UPDATE')
   and has_column_privilege('authenticated','public.clients','phone','UPDATE')
   and has_column_privilege('authenticated','public.clients','avatar_url','UPDATE')
   and has_column_privilege('authenticated','public.clients','notification_prefs','UPDATE')
   and has_column_privilege('authenticated','public.clients','welcome_dismissed_at','UPDATE')
   and has_column_privilege('authenticated','public.clients','onboarded_at','UPDATE')
  )                                                                as chk7_granted_cols_writable,

  -- 8. No policy anywhere on these tables still keys on clients.user_id.
  (select count(*) from pg_policies
    where schemaname='public'
      and tablename in ('projects','files','messages','tasks','invoices','notifications',
                        'project_phases','activity_log','clients')
      and coalesce(qual,'') like '%user_id = auth.uid()%'
  ) = 0                                                            as chk8_no_legacy_user_id_path,

  -- 9. Nothing is left addressed to PUBLIC — every new policy is `to authenticated`.
  (select count(*) from pg_policies
    where schemaname='public'
      and tablename in ('projects','files','messages','tasks','invoices','notifications',
                        'project_phases','activity_log','clients')
      and roles::text like '%public%'
  ) = 0                                                            as chk9_no_public_role_policies;
