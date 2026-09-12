-- ============================================================================
-- 0052_has_cap_legacy_aliases.sql — Batch 24 item 4, and it exists because a
-- probe found a divergence the parity check could not see.
--
-- Runs after 0051. Forward-only, idempotent.
--
-- ── THE DEFECT ──────────────────────────────────────────────────────────────
-- 0051 renamed the stored vocabulary and kept the old snake_case strings as READ
-- ALIASES for one release, so a row written by the OLD deploy during a rollout
-- keeps resolving. lib/capabilities.server.ts implements that aliasing
-- (normalizeOrgCap). has_cap() did NOT — it unioned extra_caps raw.
--
-- So with extra_caps = {'client_money'}:
--     TS  resolveCaps().caps.has('money.invoices')  → TRUE
--     SQL has_cap('money.invoices')                 → FALSE
--
-- Which is the precise failure AD-001 and S-R §5 exist to prevent: the route
-- says yes, the policy says no, and the user gets a silent empty result rather
-- than an error. It would have fired the moment 0053's policies landed, on any
-- member whose row still held a legacy value — and the old deploy's write
-- allowlist emitted exactly those values, so the rollout window is when it
-- happens.
--
-- ── WHY THE PARITY CHECK DID NOT CATCH IT ───────────────────────────────────
-- `npm run check:caps` compares the two resolvers as each harness persona, and
-- EVERY harness persona has extra_caps = '{}'. The aliasing branch was never
-- executed, so the check passed for the same reason a VACUOUS assertion passes:
-- it proved something about a case that was not present. Phase 3 of that script
-- now writes a legacy value onto the harness crew row, compares, and reverts.
--
-- This is HANDOFF §12 lesson 2 in a new place: a guard proves what it looks at,
-- and nothing else.
--
-- ── THE ALIAS TABLE IS TEMPORARY AND DUPLICATED ON PURPOSE ──────────────────
-- It now exists twice — LEGACY_ORG_CAP / LEGACY_CLIENT_CAP in TypeScript and the
-- CASE below. That is a deliberate, bounded exception to the one-source rule:
-- the alternative is the divergence above, and both copies are deleted together
-- in the same batch that drops the aliases (owed in HANDOFF §9). Until then the
-- parity check is what holds them together.
-- ============================================================================

create or replace function public.normalize_cap(p_cap text)
returns text
language sql
immutable
set search_path = public
as $fn$
  -- 0051's read aliases. DELETE THIS FUNCTION with the aliases (HANDOFF §9).
  select case p_cap
    -- crew vocabulary
    when 'run_projects'    then 'work.projects'
    when 'workspace'       then 'work.suite'
    when 'manage_clients'  then 'client.manage'
    when 'client_money'    then 'money.invoices'
    when 'cost_control'    then 'money.costs'
    when 'org_settings'    then 'org.settings'
    when 'approval_policy' then 'record.approval_policy'
    -- portal vocabulary. 'manage_team' is deliberately NOT here: it existed in
    -- BOTH old vocabularies and meant different things (crew roster management
    -- vs portal teammate management), so a single-valued mapping would be wrong
    -- on one of the two rosters. It is handled per-roster below instead.
    when 'view'            then 'portal.view'
    when 'message'         then 'portal.message'
    when 'upload'          then 'portal.upload'
    when 'approve'         then 'portal.approve'
    when 'invoices'        then 'portal.invoices'
    else p_cap
  end
$fn$;

-- The ambiguous one, resolved by which roster is asking.
create or replace function public.normalize_cap_org(p_cap text)
returns text language sql immutable set search_path = public as $fn$
  select case p_cap when 'manage_team' then 'people.manage'
                    else public.normalize_cap(p_cap) end
$fn$;

create or replace function public.normalize_cap_client(p_cap text)
returns text language sql immutable set search_path = public as $fn$
  select case p_cap when 'manage_team' then 'portal.team'
                    else public.normalize_cap(p_cap) end
$fn$;

-- has_cap(), with extra_caps and grant capabilities normalized on read. Only
-- those two are aliased: role baselines come from role_baseline(), which is
-- generated from the TS constant and only ever emits the new vocabulary.
create or replace function public.has_cap(p_cap text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org  uuid := public.current_org();
  v_id   uuid;
  v_caps text[];
begin
  if v_org is null or p_cap is null then
    return false;
  end if;

  select m.id,
         public.role_baseline(m.role)
           || coalesce((
                select array_agg(distinct c)
                  from unnest(coalesce(m.roles, array[]::text[])) r,
                       unnest(public.role_baseline(r)) c
              ), array[]::text[])
           || coalesce((
                select array_agg(public.normalize_cap_org(c))
                  from unnest(coalesce(m.extra_caps, array[]::text[])) c
              ), array[]::text[])
    into v_id, v_caps
    from public.organization_members m
   where m.user_id = auth.uid()
     and m.organization_id = v_org
     and m.status = 'active'
   limit 1;

  if v_id is not null then
    v_caps := v_caps || coalesce((
      select array_agg(public.normalize_cap_org(g.capability))
        from public.org_member_cap_grants g
       where g.member_id = v_id and g.mode = 'grant'
         and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
    ), array[]::text[]);

    if p_cap = any (v_caps) then
      -- DENY SUBTRACTS LAST (S-R R-3), so it beats the baseline, extra_caps and
      -- any grant row alike.
      return not exists (
        select 1 from public.org_member_cap_grants g
         where g.member_id = v_id and g.mode = 'deny'
           and public.normalize_cap_org(g.capability) = p_cap
           and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
      );
    end if;
    return false;
  end if;

  select m.id,
         public.client_role_baseline(m.role)
           || coalesce((
                select array_agg(public.normalize_cap_client(c))
                  from unnest(coalesce(m.extra_caps, array[]::text[])) c
              ), array[]::text[])
    into v_id, v_caps
    from public.client_members m
   where m.user_id = auth.uid()
     and m.organization_id = v_org
     and m.status = 'active'
   limit 1;

  if v_id is null then
    return false;
  end if;

  v_caps := v_caps || coalesce((
    select array_agg(public.normalize_cap_client(g.capability))
      from public.client_member_cap_grants g
     where g.member_id = v_id and g.mode = 'grant'
       and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
  ), array[]::text[]);

  if p_cap = any (v_caps) then
    return not exists (
      select 1 from public.client_member_cap_grants g
       where g.member_id = v_id and g.mode = 'deny'
         and public.normalize_cap_client(g.capability) = p_cap
         and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
    );
  end if;
  return false;
end
$fn$;

revoke all on function public.has_cap(text) from public;
grant execute on function public.has_cap(text) to authenticated, service_role;
grant execute on function public.normalize_cap(text) to authenticated, service_role;
grant execute on function public.normalize_cap_org(text) to authenticated, service_role;
grant execute on function public.normalize_cap_client(text) to authenticated, service_role;

-- verification: `npm run check:caps` phase 3 writes 'client_money' onto the
-- harness crew row and asserts both resolvers agree, then reverts.
