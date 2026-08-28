-- POST-APPLY VERIFICATION for 0022. Every column must come back true.
--
-- Run this in the Supabase SQL editor (as postgres). Note check 6: it invokes
-- the hook against every real auth user, which is a read-only call.
select
  -- 1. The function exists with the exact signature GoTrue calls.
  --    Resolved with to_regprocedure rather than by string-matching a rendered
  --    argument list. The first version of this check compared
  --    pg_get_function_identity_arguments(oid) = 'jsonb' and returned false
  --    against a perfectly good function, because that renders the DECLARED
  --    parameter (`event jsonb`), not the bare type. to_regprocedure resolves
  --    the signature the same way a GRANT or the hook config does, so it
  --    cannot disagree with checks 3 and 4 about what exists.
  coalesce((
    select p.prorettype = 'jsonb'::regtype and p.pronargs = 1
      from pg_proc p
     where p.oid = to_regprocedure('public.custom_access_token_hook(jsonb)')
  ), false)                                                      as chk1_function_exists,

  -- 2. security definer with a pinned search_path. Without definer it runs as
  --    supabase_auth_admin, which has no read on the roster tables and would
  --    take the exception path on every login — silently, and forever.
  (select p.prosecdef and 'search_path=public' = any(coalesce(p.proconfig, '{}'))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'custom_access_token_hook'
  )                                                              as chk2_definer_and_search_path,

  -- 3. GoTrue's role can call it. If this is false the hook cannot fire at all.
  has_function_privilege('supabase_auth_admin',
    'public.custom_access_token_hook(jsonb)', 'EXECUTE')         as chk3_auth_admin_can_execute,

  -- 4. Nobody else can. `create function` grants EXECUTE to PUBLIC by default,
  --    so this is checking the revoke actually landed.
  (not has_function_privilege('authenticated',
        'public.custom_access_token_hook(jsonb)', 'EXECUTE')
   and not has_function_privilege('anon',
        'public.custom_access_token_hook(jsonb)', 'EXECUTE'))    as chk4_not_world_callable,

  -- 5. current_org() still reads the claim this hook writes. If 0001's helper
  --    is ever redefined to read a different path, the hook goes quietly inert.
  (select pg_get_functiondef(p.oid) like '%app_metadata%organization_id%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'current_org'
  )                                                              as chk5_current_org_reads_claim,

  -- 6. THE BEHAVIOURAL ONE. For every non-harness auth user that has a roster
  --    row, feed the hook a bare event carrying NO app_metadata at all — the
  --    exact shape of the failure class this migration exists to remove — and
  --    require a non-null organization_id back. Counts users where it is still
  --    null; must be 0.
  (select count(*) from auth.users u
    where (exists (select 1 from public.organization_members m
                    where m.user_id = u.id and m.status <> 'revoked')
        or exists (select 1 from public.client_members c
                    where c.user_id = u.id and c.status <> 'revoked')
        or exists (select 1 from public.clients cl where cl.user_id = u.id))
      and (public.custom_access_token_hook(
             jsonb_build_object('user_id', u.id::text, 'claims', '{}'::jsonb)
           ) #>> '{claims,app_metadata,organization_id}') is null
  ) = 0                                                          as chk6_every_rostered_user_gets_an_org,

  -- 7. The hook never DROPS a claim it did not set. Passing an unknown user id
  --    with an existing claim must return that claim untouched.
  (public.custom_access_token_hook(jsonb_build_object(
     'user_id', '00000000-0000-0000-0000-0000000000ff',
     'claims', jsonb_build_object('app_metadata',
       jsonb_build_object('organization_id', '00000000-0000-0000-0000-000000000001',
                          'role', 'admin'))
   )) #>> '{claims,app_metadata,organization_id}')
   = '00000000-0000-0000-0000-000000000001'                      as chk7_preserves_existing_claim,

  -- 8. app_metadata.role is passed through untouched — the hook must never
  --    become a second writer of the trust anchor lib/auth/role.ts reads.
  (public.custom_access_token_hook(jsonb_build_object(
     'user_id', '00000000-0000-0000-0000-0000000000ff',
     'claims', jsonb_build_object('app_metadata',
       jsonb_build_object('role', 'admin'))
   )) #>> '{claims,app_metadata,role}') = 'admin'                as chk8_role_untouched,

  -- 9. A malformed event does not raise. GoTrue cannot issue a token if this
  --    function throws, so a throw is a total login outage for every tenant.
  (public.custom_access_token_hook('{}'::jsonb) = '{}'::jsonb)   as chk9_fails_soft;

-- ── NOT CHECKABLE FROM SQL ──────────────────────────────────────────────────
-- Whether the hook is ENABLED lives in GoTrue's configuration, not in the
-- database. All nine checks above pass on a project where the hook has been
-- created and never registered, in which case it is inert.
--
--   Dashboard → Authentication → Hooks → Customize Access Token (JWT) Claims
--   → select public.custom_access_token_hook → Enable.
--
-- Confirm end to end by signing in and decoding the access token:
--   JSON.parse(atob(session.access_token.split('.')[1])).app_metadata
-- organization_id must be present, and roles must be an array for active crew.

-- ── diagnostic, if chk1 ever disagrees with chk3/chk4 again ─────────────────
-- select p.oid::regprocedure                        as signature,
--        pg_get_function_arguments(p.oid)           as arguments,
--        pg_get_function_identity_arguments(p.oid)  as identity_arguments,
--        p.pronargs, p.prorettype::regtype
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname = 'custom_access_token_hook';
