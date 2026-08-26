-- ============================================================================
-- 0020_authorization_helpers.sql — S2 Batch 1: the predicate vocabulary,
-- plus the three Class C policies that are the live cross-tenant hole.
--
-- Governing: docs/specs/S1-tenancy-and-entitlement.md §5–6, S0 AD-001.
-- Runs after 0019. Forward-only and idempotent (I-12).
--
--   A1  is_org_member()          — active crew in current_org()
--   A2  is_org_admin()           — A1 + owner/admin via role or roles[]
--   A3  is_client_member(cid)    — REDEFINED: client_members is sole authority
--   A4  org_project_visible(pid)    — crew project scoping (S1 §5.1 step 5)
--   A5  client_project_visible(pid) — client project scoping (S1 §5.2 step 4)
--   A6  member_history_from()       — message cutoff; null = full history
--
--   B   organization_members_admin_all      (was 0012:69)
--       client_members_admin_all            (was 0012:77)
--       client_member_projects_admin_all    (was 0013:27)
--       organization_member_projects_admin_all (was 0018:141 — restated)
--
-- NO APPLICATION CODE CHANGES ACCOMPANY THIS FILE. Every reader of these four
-- tables goes through supabaseAdmin (service role, RLS bypassed); the only
-- RLS-dependent consumers are three realtime subscriptions, listed at the foot
-- of this file. This migration is therefore safe to apply on its own.
--
-- Do NOT touch the retired supabase/migrations/2026*_phaseN.sql series.
-- ============================================================================

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- POLICY AUTHORING RULE, enforced from here on.
--
-- Every zero-argument helper call in a policy is wrapped in a subselect:
--     (select public.is_org_admin())      NOT   public.is_org_admin()
--
-- Postgres hoists an uncorrelated scalar subquery into an InitPlan, evaluated
-- ONCE per query. Unwrapped, the function is re-evaluated per row: on a
-- 200k-row table that is the difference between ~8ms and seconds.
--
-- The rule applies to UNCORRELATED calls. A row-dependent call —
-- client_project_visible(project_id) — is correlated by definition and cannot
-- become an InitPlan; wrapping it in a subselect is harmless but buys nothing.
-- Do not mistake one for the other.
-- ────────────────────────────────────────────────────────────────────────────


-- ── A1 · active crew membership in the current tenant ───────────────────────
-- Step 1 of the crew entitlement chain (S1 §5.1): default deny.
--
-- SECURITY DEFINER is load-bearing, not incidental. organization_members has
-- RLS enabled, and a policy ON that table calls this function — as invoker it
-- would recurse forever. The function is owned by postgres, which owns the
-- table and is not under FORCE ROW LEVEL SECURITY, so the read inside runs
-- unfiltered. This is the pattern is_client_member() has used since 0012.
--
-- current_org() returns NULL when the JWT carries no organization_id claim,
-- and `organization_id = NULL` is NULL, not true — so a member whose token
-- lacks the claim FAILS CLOSED. That is correct, and it is also the
-- silent-empty-Workspace failure AD-001 consequence 1 exists to prevent:
-- the Custom Access Token Hook is what guarantees the claim is present.
create or replace function public.is_org_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.status = 'active'
      and m.organization_id = public.current_org()
  )
$$;


-- ── A2 · crew administrator ─────────────────────────────────────────────────
-- A1, narrowed to the roles that may write a roster. `role` is the member's
-- primary role; `roles[]` (0015:11) holds any additional roles they carry, and
-- capability is the union of both — so either may confer admin.
--
-- This is deliberately NOT is_admin(). is_admin() reads the JWT's
-- app_metadata.role and knows nothing about which organization the caller is
-- acting in; it is the reason the three policies below leak across tenants.
-- The roster row is the authority, the JWT only routes (CLAUDE.md, S1 §5.1).
create or replace function public.is_org_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.status = 'active'
      and m.organization_id = public.current_org()
      and (
        m.role in ('owner', 'admin')
        or m.roles && array['owner', 'admin']::text[]
      )
  )
$$;


-- ── A3 · client company membership — REDEFINED ──────────────────────────────
-- S1 §5.2: client_members is the SOLE authority. The
-- `or clients.user_id = auth.uid()` branch from 0012:59-61 is dropped here.
--
-- Two identities for one human is the defect being closed. 0012:113-117
-- backfilled every clients.user_id into client_members as an active owner, so
-- the branch has been redundant since that migration ran — but only where the
-- backfill actually landed. It used `on conflict (client_id, email) do
-- nothing`, so a company that already had a client_members row at the same
-- address (user_id null, or a different user) was SKIPPED, and that primary
-- login has no row of its own. Dropping the branch would lock them out.
--
-- The guard below is the verification S1 §5.2 requires, run as a precondition
-- rather than as a checklist item. It counts primary logins with no ACTIVE
-- membership row of their own — covering all three ways the backfill could
-- have missed: no row, a row that never activated, and an email-matched row
-- that was never linked to the login's user_id.
--
-- Verified against production 2026-08-26 before this file was written:
-- 6 client companies, 6 with a login, 6 active member rows, 0 orphans in all
-- three classes. The guard is kept so the same proof is re-run on every
-- environment this is applied to.
do $$
declare orphans int;
begin
  select count(*) into orphans
  from public.clients c
  where c.user_id is not null
    and not exists (
      select 1
      from public.client_members m
      where m.client_id = c.id
        and m.user_id   = c.user_id
        and m.status    = 'active'
    );

  if orphans > 0 then
    raise exception
      '0020 A3: % clients.user_id login(s) have no ACTIVE client_members row. Dropping the clients.user_id branch would lock them out of the portal. Backfill them before applying — STOP.', orphans;
  end if;
end $$;

-- create or replace preserves the function OID, so client_members_team_read
-- (0012:82) and client_member_projects_team_read (0013:35) — the only two
-- policies in the database that reference this function — keep working across
-- the swap without being dropped and recreated.
create or replace function public.is_client_member(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.client_members m
    where m.client_id = cid
      and m.user_id   = auth.uid()
      and m.status    = 'active'
  )
$$;


-- ── A4 · crew project scoping ───────────────────────────────────────────────
-- Step 5 of the crew chain: a freelance editor sees one production, not the
-- whole studio (S1 §5.1).
--
-- scope_mode is read, never inferred. 0018 A5 retired "no rows means all" —
-- under which a bulk delete of the scoping rows SILENTLY GRANTED full access.
-- 'all' means every project in the tenant; 'selected' means exactly the rows
-- in organization_member_projects, and 'selected' with zero rows means zero
-- projects.
--
-- The join to projects binds the answer to the caller's own organization, so
-- this helper is safe used alone and cannot be made to return true for another
-- tenant's project id. Pair it with is_org_member() anyway — layered, per
-- AD-001. projects.organization_id is NOT NULL with zero rows disagreeing with
-- their client company's org (verified 2026-08-26), so the join denies nothing
-- it should permit.
create or replace function public.org_project_visible(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    join public.projects p
      on p.id = pid
     and p.organization_id = m.organization_id
    where m.user_id = auth.uid()
      and m.status  = 'active'
      and m.organization_id = public.current_org()
      and (
        m.scope_mode = 'all'
        or exists (
          select 1
          from public.organization_member_projects mp
          where mp.member_id  = m.id
            and mp.project_id = p.id
        )
      )
  )
$$;


-- ── A5 · client project scoping ─────────────────────────────────────────────
-- Step 4 of the client chain (S1 §5.2). Same shape as A4 against the client
-- roster.
--
-- The company binding (p.client_id = m.client_id) is the client-side analogue
-- of A4's org binding, and it is the tighter of the two: a client company
-- belongs to exactly one organization (clients.organization_id, not null), so
-- binding to the company binds the tenant transitively. current_org() is
-- deliberately NOT consulted here — the portal must not depend on a client
-- login carrying a crew-side claim.
--
-- This is also what makes primary logins scopable at last. lib/team.ts:182-186
-- short-circuits a clients.user_id match to `projectIds: null` — every project,
-- always — which is wrong for a real company whose billing contact is not the
-- person reviewing cuts. With A3 redefined, the primary login is an ordinary
-- member row and this predicate applies to them like anyone else.
create or replace function public.client_project_visible(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.client_members m
    join public.projects p
      on p.id = pid
     and p.client_id = m.client_id
    where m.user_id = auth.uid()
      and m.status  = 'active'
      and (
        m.scope_mode = 'all'
        or exists (
          select 1
          from public.client_member_projects mp
          where mp.member_id  = m.id
            and mp.project_id = p.id
        )
      )
  )
$$;


-- ── A6 · message history cutoff ─────────────────────────────────────────────
-- Step 5 of the client chain. NULL means full history — an owner may let an
-- invited member read everything said before they joined, or not (0013:13).
--
-- PRECEDENCE, because the zero-argument shape cannot ask "which room?":
-- a crew row in the current org wins outright; only a caller with no crew row
-- falls through to the client roster. `case ... when exists` rather than
-- coalesce() is what makes that true — coalesce() would treat a crew member's
-- legitimate NULL (full history) as "no answer" and wrongly apply their
-- client-side cutoff to a crew room.
--
-- organization_members.user_id is UNIQUE (T-1, 0012:17), so the crew arm
-- returns at most one row. The client arm uses max() only because
-- client_members.user_id has no such constraint; where a person somehow holds
-- two active memberships, the later cutoff — the more restrictive answer —
-- wins. v1 permits only one (S1 §2, application-enforced), and S0-A §2 records
-- that two already break lib/team.ts's .single() calls independently of this.
--
-- SEAM: when Batch 2 writes the message policies, the honest signature is
-- member_history_from(cid uuid) — a cutoff is a property of a room, not of a
-- person. This zero-argument form is correct under v1 cardinality and should
-- be superseded, not extended, when that stops holding.
create or replace function public.member_history_from()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1
      from public.organization_members m
      where m.user_id = auth.uid()
        and m.status  = 'active'
        and m.organization_id = public.current_org()
    )
    then (
      select m.history_from
      from public.organization_members m
      where m.user_id = auth.uid()
        and m.status  = 'active'
        and m.organization_id = public.current_org()
    )
    else (
      select max(m.history_from)
      from public.client_members m
      where m.user_id = auth.uid()
        and m.status  = 'active'
    )
  end
$$;


-- ── grants ──────────────────────────────────────────────────────────────────
-- Postgres grants EXECUTE to PUBLIC on every new function by default. These
-- are SECURITY DEFINER and read whole rosters unfiltered, so that default is
-- withdrawn and re-granted to `authenticated` only.
--
-- anon is revoked explicitly as well. Redundant once PUBLIC is gone — anon
-- holds no separate grant — but stated so the intent survives someone later
-- re-granting to PUBLIC.
--
-- service_role loses its implicit PUBLIC grant too. That is deliberate and
-- costs nothing today: no application code calls any of these via .rpc()
-- (verified across app/, lib/, components/, hooks/), and service_role bypasses
-- RLS so it never evaluates a policy that calls them. If a server path ever
-- needs one directly, add that single grant rather than restoring PUBLIC.
do $$
declare
  f text;
  has_anon boolean := exists (select 1 from pg_roles where rolname = 'anon');
begin
  foreach f in array array[
    'public.is_org_member()',
    'public.is_org_admin()',
    'public.is_client_member(uuid)',
    'public.org_project_visible(uuid)',
    'public.client_project_visible(uuid)',
    'public.member_history_from()'
  ]
  loop
    execute format('revoke execute on function %s from public', f);
    -- guarded: REVOKE against a role that does not exist is an ERROR, not a
    -- no-op, and would abort the batch on a non-Supabase target.
    if has_anon then
      execute format('revoke execute on function %s from anon', f);
    end if;
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;


-- ============================================================================
-- PART B · Class C policies — the live cross-tenant hole (S1 §6 item 1)
--
-- organization_members_admin_all (0012:69), client_members_admin_all
-- (0012:77) and client_member_projects_admin_all (0013:27) gate on is_admin()
-- ALONE. is_admin() reads app_metadata.role and carries no tenant. The moment
-- a second organization exists, every admin reads and writes every org's
-- rosters — names, email addresses, roles, project assignments. Every other
-- post-0001 table pairs is_admin() with current_org(); these three do not.
--
-- Two changes per policy:
--   1. the org predicate that was missing;
--   2. is_admin() → is_org_admin(), so admin is a fact about the roster in
--      THIS organization rather than a claim in a token.
--
-- No new index is needed. organization_members.user_id is UNIQUE and
-- client_members_user_idx (0012:47) exists, so each helper is a single-row
-- probe; the org predicate on each policy is satisfied from the row itself.
--
-- The self_read (0012:73) and team_read (0012:81, 0013:31) policies are left
-- exactly as they are, per the batch scope. Note for Batch 2: all three still
-- call their helper unwrapped and should be restated under the subselect rule
-- when their tables are next touched.
--
-- ONBOARDING SEAM, do not discover this later: is_org_admin() requires an
-- existing active roster row, so the FIRST admin of a new organization cannot
-- create their own row through RLS. Tenant bootstrap must stay on the service
-- role (app/api/admin/team/route.ts already does, and lib/team.ts's owner
-- bootstrap is service-role too). This migration does not change that; it
-- makes the requirement permanent.
-- ============================================================================

drop policy if exists organization_members_admin_all on public.organization_members;
create policy organization_members_admin_all on public.organization_members
  for all to authenticated
  using       (organization_id = (select public.current_org()) and (select public.is_org_admin()))
  with check  (organization_id = (select public.current_org()) and (select public.is_org_admin()));

drop policy if exists client_members_admin_all on public.client_members;
create policy client_members_admin_all on public.client_members
  for all to authenticated
  using       (organization_id = (select public.current_org()) and (select public.is_org_admin()))
  with check  (organization_id = (select public.current_org()) and (select public.is_org_admin()));

-- client_member_projects.organization_id arrived in 0018 A6 (not null,
-- backfilled from the owning member row) — which is what lets this policy be
-- satisfied from the row rather than through a correlated subquery.
drop policy if exists client_member_projects_admin_all on public.client_member_projects;
create policy client_member_projects_admin_all on public.client_member_projects
  for all to authenticated
  using       (organization_id = (select public.current_org()) and (select public.is_org_admin()))
  with check  (organization_id = (select public.current_org()) and (select public.is_org_admin()));

-- organization_member_projects was created org-scoped in 0018:141, so the
-- cross-tenant hole above never existed here — verified against production,
-- the live policy reads `is_admin() AND organization_id = current_org()`.
-- Restated rather than duplicated, for the same two reasons as the other
-- three: is_admin() → is_org_admin(), and both calls wrapped. Behaviour is
-- unchanged for any admin who is also an active owner/admin on the roster.
drop policy if exists organization_member_projects_admin_all on public.organization_member_projects;
create policy organization_member_projects_admin_all on public.organization_member_projects
  for all to authenticated
  using       (organization_id = (select public.current_org()) and (select public.is_org_admin()))
  with check  (organization_id = (select public.current_org()) and (select public.is_org_admin()));

commit;

-- ============================================================================
-- BROWSER-CLIENT BLAST RADIUS — the whole of it.
--
-- Every .from() query against these four tables in the repo runs through
-- supabaseAdmin (service role, RLS bypassed). Nothing reads them through
-- lib/supabase/client.ts or lib/supabase/server.ts. So the only thing this
-- migration can break is realtime DELIVERY, which authenticates as the user
-- and is filtered by each table's SELECT policy:
--
--   components/portal/ClientTeamManager.tsx:77   table: client_members
--       delivered by client_members_team_read → is_client_member(client_id).
--       Affected by A3. Holds for every active member; a primary login whose
--       row is not active would go silent — the A3 guard proves there is none.
--
--   components/admin/ClientTeamPanel.tsx:61      table: client_members
--   components/studio/TeamManager.tsx:65         table: organization_members
--       delivered by the *_admin_all policies rewritten above. Both hold for
--       an admin who carries app_metadata.organization_id AND holds an active
--       owner/admin roster row in that org. Verified 2026-08-26: 1 JWT admin,
--       1 roster owner, 0 admins failing either half, 0 users missing the
--       claim.
--
-- All three subscribe only to fire a refetch against a service-role route, so
-- a delivery failure degrades to a stale panel until reload — not an error and
-- not a data leak. client_member_projects and organization_member_projects
-- have no browser subscription at all.
-- ============================================================================
