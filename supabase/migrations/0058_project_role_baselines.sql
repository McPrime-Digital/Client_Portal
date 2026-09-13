-- ═══════════════════════════════════════════════════════════════════════════
-- 0058 · project_role_baseline() + has_cap() unions it — S-R R-10
-- Batch 26 item 5. ADDITIVE: it can only ADD capabilities, never remove one.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- R-10, approved by the owner 2026-09-12: a project role carries a capability
-- baseline, overridable per person. "A `colorist` on a production gets the Suite
-- surfaces for colour without an admin granting four keys by hand; an `observer`
-- gets read-only without four denials. The alternative is administratively
-- hopeless at bench scale, and what a studio does instead is make everyone an
-- admin — which is the state this document exists to fix."
--
-- ── WHY THIS IS IN SQL AND NOT ONLY IN TYPESCRIPT ──────────────────────────
--
-- Not house style. The PARITY CHECK demands it.
--
-- `npm run check:caps` phase 2 signs in as every persona and asserts that
-- lib/capabilities.server.ts's resolveCaps() and this database's has_cap() agree
-- on every coarse capability. Item 5 teaches resolveCaps() to union project-role
-- baselines (S-R §5 step 4). The moment a persona holds a project role — item 9
-- seeds exactly that — the two sides would disagree and phase 2 would FAIL.
--
-- So has_cap() has to learn the same rule, or "one resolver" stops being true and
-- the failure surfaces as a route saying yes while a policy says no. That exact
-- divergence already happened once, in Batch 25: 0051's rename left has_cap()
-- blind to the legacy aliases the TS resolver honoured, producing a silent empty
-- set that 0052 had to repair. This migration is that lesson applied in advance
-- rather than after a probe.
--
-- The alternative — generate the function and leave it unused — is `is_admin()`,
-- which has had ZERO database consumers since 0021 and survives only as a trap.
--
-- ── WHAT IT UNIONS, AND THE THREE FILTERS ON IT ────────────────────────────
--
--   1 · the assignment must be the CALLER's own row in organization_member_projects
--   2 · it must not be EXPIRED (G-5, 0057) — `expires_at is null or > now()`
--   3 · project_role may be NULL, and NULL resolves to the empty array, which is
--       0057's "on the production, no stated role" honoured rather than guessed
--
-- `observer` also resolves to empty, and that is the point rather than an
-- oversight: S-R §3.2 has observer exist so somebody can be put on a production
-- read-only WITHOUT inventing a denial for every write capability. Read-only then
-- falls out of the row policies — the assigned project is visible through
-- org_project_visible(), and every write needs a capability they do not hold.
--
-- ── IT CANNOT REMOVE A CAPABILITY, WHICH IS WHY THIS IS SAFE TO APPLY ──────
--
-- The union is added BEFORE the deny subtraction, in the same place extra_caps
-- and grant rows are added. So the only possible effect on an existing session is
-- to ADD a capability, and only to somebody holding a project assignment with a
-- non-null role — of which there are ZERO rows today (verified live: 1 assignment
-- row, project_role NULL). Every live member is therefore bit-identical before
-- and after, which is checked by probe rather than argued.
--
-- DENY STILL SUBTRACTS LAST (R-3). A denial beats a project-role baseline exactly
-- as it beats a company-role baseline and a grant row — that is what "with no
-- branch and no precedence table to argue about" means, and it is why the
-- subtraction is the final step rather than one of several.
--
-- ── SCOPE IS STILL A FILTER, NOT A CAPABILITY (R-5a) ───────────────────────
--
-- A project role puts capabilities in the flat set; org_project_visible() decides
-- WHICH ROWS they reach. The known imprecision — a colorist on production A and an
-- observer on production B holds work.suite on both — is S-R §5's own model (one
-- capability set, then a row filter) and R-10 names it as a cost in its own text.
-- Recorded in lib/capabilities.ts's PROJECT_ROLE_BASELINE comment, not hidden.
--
-- I-12: forward-only, create-or-replace, no policies touched.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1 · the generated baseline function ────────────────────────────────────
create or replace function public.project_role_baseline(p_role text)
returns text[]
language sql
immutable
set search_path = public
as $fn$
  -- GENERATED from lib/capabilities.ts PROJECT_ROLE_BASELINE. See role_baseline
  -- above for the drift rule. An unknown role — and a NULL project_role, which
  -- 0057 admits and which means "on the production, no stated role" — both return
  -- the EMPTY array. `observer` also returns empty, deliberately: S-R §3.2 has it
  -- exist so somebody can be put on a production read-only without inventing a
  -- denial for every write capability.
  select case p_role
    when 'director' then array['work.projects', 'work.suite', 'record.approval_policy']::text[]
    when 'producer' then array['work.projects', 'work.suite', 'record.approval_policy']::text[]
    when 'line_producer' then array['work.projects', 'record.approval_policy']::text[]
    when 'account_director' then array['work.projects', 'work.suite', 'record.approval_policy']::text[]
    when 'creative_director' then array['work.projects', 'work.suite', 'record.approval_policy']::text[]
    when 'coordinator' then array['work.projects']::text[]
    when 'post_supervisor' then array['work.projects', 'work.suite']::text[]
    when 'writer' then array['work.projects', 'work.suite']::text[]
    when 'editor' then array['work.projects', 'work.suite']::text[]
    when 'assistant_editor' then array['work.projects', 'work.suite']::text[]
    when 'colorist' then array['work.projects', 'work.suite']::text[]
    when 'sound' then array['work.projects', 'work.suite']::text[]
    when 'vfx' then array['work.projects', 'work.suite']::text[]
    when 'motion' then array['work.projects', 'work.suite']::text[]
    when 'observer' then array[]::text[]
    when 'strategist' then array['work.projects']::text[]
    else array[]::text[]
  end
$fn$;

-- ── 2 · has_cap() learns it, crew side only ────────────────────────────────
--
-- Unchanged from 0051/0052 except for the project-role union marked below.
-- The CLIENT half is untouched: S-R §14 q4 recommends no client-side project
-- roles for v1 ("a client company's people are not staffed per production the way
-- a crew is"), and client_member_projects has no project_role column.
create or replace function public.has_cap(p_cap text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $function$
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
    -- ── R-10: PROJECT-ROLE BASELINES (0058) ──────────────────────────────
    -- Their own live, unexpired assignments only. A NULL project_role and an
    -- `observer` both contribute the empty array — the first is the absence of a
    -- decision (0057), the second is a decision that somebody writes nothing.
    -- Added here, alongside extra_caps and before grants, so the DENY below
    -- still subtracts last and still beats all of them (R-3).
    v_caps := v_caps || coalesce((
      select array_agg(distinct c)
        from public.organization_member_projects mp,
             unnest(public.project_role_baseline(mp.project_role)) c
       where mp.member_id = v_id
         and (mp.expires_at is null or mp.expires_at > now())
    ), array[]::text[]);

    v_caps := v_caps || coalesce((
      select array_agg(public.normalize_cap_org(g.capability))
        from public.org_member_cap_grants g
       where g.member_id = v_id and g.mode = 'grant'
         and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
    ), array[]::text[]);

    if p_cap = any (v_caps) then
      -- DENY SUBTRACTS LAST (S-R R-3), so it beats the baseline, extra_caps,
      -- a PROJECT-ROLE baseline and any grant row alike.
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
$function$;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION — run after applying.
--
-- 1 · the generated function matches the TS constant:
--     npm run check:caps  → phase 1 now covers project_role_baseline for all 16
--     roles plus the unknown-role case.
--
-- 2 · NULL and observer both resolve to {}:
--     select public.project_role_baseline(null),
--            public.project_role_baseline('observer'),
--            public.project_role_baseline('colorist');
--     → {} · {} · {work.projects,work.suite}
--
-- 3 · INERT TODAY, by probe rather than by claim: every live persona's has_cap()
--     answers are identical before and after, because zero assignment rows carry
--     a non-null project_role.
--
-- 4 · the rule it exists for: give the scoped crew member a `colorist` role on
--     their assigned project and has_cap('work.suite') flips false → true; expire
--     the assignment and it flips back. Harness assertion 41 (item 9) makes that
--     standing.
-- ═══════════════════════════════════════════════════════════════════════════
