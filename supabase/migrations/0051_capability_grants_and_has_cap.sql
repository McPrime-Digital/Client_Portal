-- ============================================================================
-- 0051_capability_grants_and_has_cap.sql — Batch 24 item 2
--
-- Governing: S-R §10 (the grant tables), S-R §9 (has_cap), S-R R-3 (deny wins),
-- S-R §6 G-5 (grants may expire), Batch 24 ruling 1 AS SUPERSEDED (option A:
-- the STORED vocabulary is renamed into dot form, NOT re-granulated).
-- Runs after 0050. Forward-only, idempotent, guarded (I-12).
--
-- ── WHAT IS STORED HERE IS COARSE, AND THAT IS THE DECISION ─────────────────
-- S-R §4 enumerates 38 FINE keys; this database stores the 14 COARSE caps
-- lib/permissions.ts has always stored. The original ruling read that
-- difference as spelling and it is granularity: expanding one stored
-- `run_projects` grant into ten fine keys asserts an intent nobody recorded
-- (HANDOFF §12 lesson 1 — a migration that repairs state while inventing the
-- invariant behind it).
--
-- So policies and has_cap() name COARSE caps — has_cap('money.invoices'), not
-- has_cap('money.invoice.read'). The fine→coarse table is CAP_RESOLUTION in
-- lib/capabilities.ts and lives in TypeScript only, because duplicating it here
-- would recreate exactly the two-hand-maintained-copies problem that ruling 2
-- exists to forbid.
--
-- THE VALID COARSE CAPS, crew side:
--   work.projects · work.suite · client.manage · people.manage
--   money.invoices · money.costs · org.settings · record.approval_policy
-- Portal side:
--   portal.view · portal.message · portal.upload · portal.approve
--   portal.invoices · portal.team
--
-- ── THE RENAME IS 1→1 AND NO ROW CHANGES MEANING ────────────────────────────
-- Live cost: four values on ONE production row (Gabby's extra_caps) plus the
-- harness fixtures. It happens now because it gets more expensive with every
-- grant made, and no grant can exist before the tables below.
-- ============================================================================

-- ── 1. role_baseline() / client_role_baseline() — GENERATED ─────────────────
-- Emitted by `npx tsx scripts/gen-capability-sql.ts --print` from
-- lib/capabilities.ts. `npm run check:caps` calls these live and fails on drift.
-- Do not hand-edit: the constant is the source, this is the projection.

create or replace function public.role_baseline(p_role text)
returns text[]
language sql
immutable
set search_path = public
as $fn$
  -- GENERATED from lib/capabilities.ts ORG_ROLE_BASELINE by
  -- scripts/gen-capability-sql.ts. Do not edit by hand: npm run check:caps
  -- compares this function's live output against that constant and fails on
  -- drift. An unknown role returns the EMPTY array, never null — so a role this
  -- function has never heard of grants nothing rather than making every
  -- comparison against it null (and therefore not-true, but for the wrong
  -- reason and invisibly).
  select case p_role
    when 'owner' then array['work.projects', 'work.suite', 'client.manage', 'people.manage', 'money.invoices', 'money.costs', 'org.settings', 'record.approval_policy']::text[]
    when 'admin' then array['work.projects', 'work.suite', 'client.manage', 'people.manage', 'money.invoices', 'money.costs', 'org.settings', 'record.approval_policy']::text[]
    when 'producer' then array['work.projects', 'work.suite', 'client.manage', 'money.costs', 'record.approval_policy']::text[]
    when 'coordinator' then array['work.projects']::text[]
    when 'finance' then array['money.invoices', 'money.costs']::text[]
    when 'crew' then array['work.projects', 'work.suite']::text[]
    when 'editor' then array['work.projects', 'work.suite']::text[]
    when 'member' then array['work.projects', 'work.suite']::text[]
    else array[]::text[]
  end
$fn$;

create or replace function public.client_role_baseline(p_role text)
returns text[]
language sql
immutable
set search_path = public
as $fn$
  -- GENERATED from lib/capabilities.ts CLIENT_ROLE_BASELINE. See above.
  -- NOTE: 'member' here is a LIVE S-R §8 role, unlike organization_members.role
  -- 'member' which 0050 deprecates. Same word, opposite fates, two tables.
  select case p_role
    when 'owner' then array['portal.view', 'portal.message', 'portal.upload', 'portal.approve', 'portal.invoices', 'portal.team']::text[]
    when 'approver' then array['portal.view', 'portal.message', 'portal.upload', 'portal.approve', 'portal.invoices']::text[]
    when 'member' then array['portal.view', 'portal.message', 'portal.upload']::text[]
    when 'viewer' then array['portal.view']::text[]
    else array[]::text[]
  end
$fn$;

-- ── 2. The two grant tables ─────────────────────────────────────────────────
-- TWO TABLES, NOT ONE POLYMORPHIC TABLE (S-R §10). The rosters are separate
-- tables with separate FKs, and a real foreign key is worth more than one fewer
-- table — S3-core §2.2 records what polymorphism costs and there is no reason to
-- pay it twice.

create table if not exists public.org_member_cap_grants (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_id       uuid not null references public.organization_members(id) on delete cascade,
  capability      text not null,
  mode            text not null check (mode in ('grant', 'deny')),
  granted_by      uuid null references auth.users(id) on delete set null,
  -- Resolved from the ROSTER at grant time via rosterName(), never from
  -- user_metadata — the 7.8 / 11.5 defect, and the rule
  -- approval_decisions.actor_name already follows. NOT NULL so the record can
  -- never say "somebody" about a permission change.
  granted_by_name text not null,
  granted_at      timestamptz not null default now(),
  -- G-5. null = permanent. For a freelance bench, access granted for one
  -- production should not accumulate across every job a person has touched.
  expires_at      timestamptz null,
  -- Revocation is a STAMP, not a delete: the record of what was held and when
  -- survives, which is the whole point of R-8.
  revoked_at      timestamptz null
);

create table if not exists public.client_member_cap_grants (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_id       uuid not null references public.client_members(id) on delete cascade,
  capability      text not null,
  mode            text not null check (mode in ('grant', 'deny')),
  granted_by      uuid null references auth.users(id) on delete set null,
  granted_by_name text not null,
  granted_at      timestamptz not null default now(),
  expires_at      timestamptz null,
  revoked_at      timestamptz null
);

-- One LIVE row per (member, capability). Partial, so a revoked grant does not
-- block re-granting the same capability later — which is the difference between
-- an audit trail and a lockout.
create unique index if not exists org_member_cap_grants_live_idx
  on public.org_member_cap_grants (member_id, capability) where revoked_at is null;
create unique index if not exists client_member_cap_grants_live_idx
  on public.client_member_cap_grants (member_id, capability) where revoked_at is null;

-- has_cap() resolves per request, so the member lookup is the hot path.
create index if not exists org_member_cap_grants_member_idx
  on public.org_member_cap_grants (member_id) where revoked_at is null;
create index if not exists client_member_cap_grants_member_idx
  on public.client_member_cap_grants (member_id) where revoked_at is null;

alter table public.org_member_cap_grants    enable row level security;
alter table public.client_member_cap_grants enable row level security;

-- Class C shape, matching organization_members' own policies (0021). The
-- capability predicate arrives in 0052 — additive first, constraining second.
-- SELF-READ IS NOT GATED, deliberately and for the same reason
-- organization_members_self_read is not: a person must be able to see what they
-- hold, or "your access changed" is indistinguishable from "you were never
-- here" (S2 b.4b, harness assertion 6).
drop policy if exists org_member_cap_grants_admin_all on public.org_member_cap_grants;
create policy org_member_cap_grants_admin_all on public.org_member_cap_grants
  for all to authenticated
  using (organization_id = (select public.current_org()) and (select public.is_org_admin()))
  with check (organization_id = (select public.current_org()) and (select public.is_org_admin()));

drop policy if exists org_member_cap_grants_self_read on public.org_member_cap_grants;
create policy org_member_cap_grants_self_read on public.org_member_cap_grants
  for select to authenticated
  using (exists (
    select 1 from public.organization_members m
     where m.id = org_member_cap_grants.member_id and m.user_id = auth.uid()
  ));

drop policy if exists client_member_cap_grants_admin_all on public.client_member_cap_grants;
create policy client_member_cap_grants_admin_all on public.client_member_cap_grants
  for all to authenticated
  using (organization_id = (select public.current_org()) and (select public.is_org_admin()))
  with check (organization_id = (select public.current_org()) and (select public.is_org_admin()));

drop policy if exists client_member_cap_grants_self_read on public.client_member_cap_grants;
create policy client_member_cap_grants_self_read on public.client_member_cap_grants
  for select to authenticated
  using (exists (
    select 1 from public.client_members m
     where m.id = client_member_cap_grants.member_id and m.user_id = auth.uid()
  ));

-- ── 3. has_cap() ────────────────────────────────────────────────────────────
-- SECURITY DEFINER IS NOT OPTIONAL. Migration 0052 puts policies on
-- organization_members, and a function that reads that table from inside its own
-- policy recurses. is_org_member() is the working precedent (0020).
--
-- STABLE, not IMMUTABLE: it reads tables. Callers must wrap it in a subselect —
-- `(select public.has_cap('money.invoices'))` — per 0021's InitPlan rule, so it
-- evaluates once per query rather than once per row.
--
-- RESOLUTION ORDER, and the order is the rule (S-R R-3):
--     (role baseline ∪ roles[] baselines ∪ extra_caps ∪ active grants)
--   − active denials
-- DENY SUBTRACTS LAST, which is what makes it beat everything including a stale
-- extra_caps entry. extra_caps is still written as a derived projection of the
-- grant rows until a later batch drops it (S-R §10, Rule Zero), so a denial that
-- did not subtract last could be defeated by the projection it is supposed to
-- govern.
--
-- ONE FUNCTION, BOTH ROSTERS. A person is crew or portal, never both in one
-- org, and the two coarse vocabularies are disjoint (work.*/money.*/people.*/
-- client.*/org.*/record.* vs portal.*) — so there is no key whose meaning
-- depends on which branch answered.
--
-- CAPABILITY IS RESOLVED FROM THE ROSTER ON EVERY CALL, NEVER FROM THE TOKEN
-- (S-R R-2). Only the tenant identity comes from the claim, via current_org().
drop function if exists public.has_cap(text);
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

  -- crew side
  select m.id,
         public.role_baseline(m.role)
           || coalesce((
                select array_agg(distinct c)
                  from unnest(coalesce(m.roles, array[]::text[])) r,
                       unnest(public.role_baseline(r)) c
              ), array[]::text[])
           || coalesce(m.extra_caps, array[]::text[])
    into v_id, v_caps
    from public.organization_members m
   where m.user_id = auth.uid()
     and m.organization_id = v_org
     and m.status = 'active'
   limit 1;

  if v_id is not null then
    -- grants, then denials. Both filtered to LIVE: not revoked, not expired.
    v_caps := v_caps || coalesce((
      select array_agg(g.capability) from public.org_member_cap_grants g
       where g.member_id = v_id and g.mode = 'grant'
         and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
    ), array[]::text[]);

    if p_cap = any (v_caps) then
      return not exists (
        select 1 from public.org_member_cap_grants g
         where g.member_id = v_id and g.mode = 'deny' and g.capability = p_cap
           and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
      );
    end if;
    return false;
  end if;

  -- portal side
  select m.id,
         public.client_role_baseline(m.role) || coalesce(m.extra_caps, array[]::text[])
    into v_id, v_caps
    from public.client_members m
   where m.user_id = auth.uid()
     and m.organization_id = v_org
     and m.status = 'active'
   limit 1;

  if v_id is null then
    return false;   -- no active roster row anywhere: default deny (S-R §5 step 0)
  end if;

  v_caps := v_caps || coalesce((
    select array_agg(g.capability) from public.client_member_cap_grants g
     where g.member_id = v_id and g.mode = 'grant'
       and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
  ), array[]::text[]);

  if p_cap = any (v_caps) then
    return not exists (
      select 1 from public.client_member_cap_grants g
       where g.member_id = v_id and g.mode = 'deny' and g.capability = p_cap
         and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
    );
  end if;
  return false;
end
$fn$;

revoke all on function public.has_cap(text) from public;
grant execute on function public.has_cap(text) to authenticated, service_role;
grant execute on function public.role_baseline(text) to authenticated, service_role;
grant execute on function public.client_role_baseline(text) to authenticated, service_role;

-- ── 4. THE extra_caps RENAME — 1→1, no row changes meaning ───────────────────
-- Guarded by the value itself, so a re-run is a no-op and a row already carrying
-- the new spelling is untouched.
update public.organization_members
   set extra_caps = (
     select coalesce(array_agg(distinct
       case c
         when 'run_projects'    then 'work.projects'
         when 'workspace'       then 'work.suite'
         when 'manage_clients'  then 'client.manage'
         when 'manage_team'     then 'people.manage'
         when 'client_money'    then 'money.invoices'
         when 'cost_control'    then 'money.costs'
         when 'org_settings'    then 'org.settings'
         when 'approval_policy' then 'record.approval_policy'
         else c
       end), array[]::text[])
       from unnest(extra_caps) c
   )
 where extra_caps && array['run_projects','workspace','manage_clients','manage_team',
                           'client_money','cost_control','org_settings','approval_policy']::text[];

-- client_members.extra_caps: the PORTAL vocabulary, which is a different set of
-- six. 'manage_team' appears in BOTH old vocabularies and means different things
-- — crew roster management vs portal teammate management — which is why the two
-- statements are separate and neither is a generic sweep.
update public.client_members
   set extra_caps = (
     select coalesce(array_agg(distinct
       case c
         when 'view'        then 'portal.view'
         when 'message'     then 'portal.message'
         when 'upload'      then 'portal.upload'
         when 'approve'     then 'portal.approve'
         when 'invoices'    then 'portal.invoices'
         when 'manage_team' then 'portal.team'
         else c
       end), array[]::text[])
       from unnest(extra_caps) c
   )
 where extra_caps && array['view','message','upload','approve','invoices','manage_team']::text[];

-- ── verification (run live, immediately) ────────────────────────────────────
-- a. Gabby's extra_caps: expect exactly
--    {work.projects, work.suite, client.manage, people.manage} — four in, four
--    out, same authorities.
-- select email, extra_caps from public.organization_members
--  where extra_caps <> array[]::text[];
-- b. No snake_case value survives on either roster. Expect zero rows.
-- select 'org' side, email, extra_caps from public.organization_members
--  where extra_caps && array['run_projects','workspace','manage_clients','manage_team',
--                            'client_money','cost_control','org_settings','approval_policy']::text[]
-- union all select 'client', email, extra_caps from public.client_members
--  where extra_caps && array['view','message','upload','approve','invoices','manage_team']::text[];
-- c. has_cap() answers correctly per persona — proven by PROBE as the persona,
--    not by reading the function (HANDOFF §12 lesson 6). See the commit message.
-- d. npm run check:caps — live SQL matches lib/capabilities.ts.
