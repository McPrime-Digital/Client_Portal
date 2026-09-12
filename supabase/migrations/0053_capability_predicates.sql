-- ============================================================================
-- 0053_capability_predicates.sql — Batch 24 item 6. CONSTRAINING.
--
-- Governing: S-R §9 (the amendment to AD-001), S-R R-5 (enforcement at or below
-- the row), Batch 24 ruling 1 as superseded (policies name COARSE caps).
-- Runs after 0052. Forward-only, idempotent, every create guarded by a drop.
--
-- ── WHAT THIS IS FOR, AND WHAT IT IS NOT FOR ────────────────────────────────
-- AD-001 puts the USER client on these paths, so a crew member with a session
-- can query invoices through PostgREST directly. Until this migration, the only
-- thing between them and the company's books was a check in a route handler —
-- and the item-0 audit PROVED the hole by doing it: signed in as a roster
-- 'member' on the anon key, it read every org_credits / org_budgets /
-- credit_ledger / usage_events row and both INSERTED and UPDATED invoices.
--
-- THE HONEST SCOPE, recorded because the batch brief asked for it: all 23 of the
-- application's money paths run on the SERVICE ROLE (audit q8), so these policies
-- change no application behaviour. They close the PostgREST door, which is the
-- door the probe walked. Item 5's route gates are what affect the app. Neither is
-- decorative; they act in different places, and the owner-verification either
-- side of this migration CANNOT FAIL for exactly that reason — it is recorded as
-- a precaution honoured, not as evidence.
--
-- ── THE PREDICATE IS ANDed ON, NEVER SUBSTITUTED ────────────────────────────
-- Every policy below keeps its existing tenancy predicate and adds a capability
-- one. S-R §0: "It does not loosen tenancy. Every predicate here is an AND on
-- top of the existing tenant predicates, never an OR beside them."
--
-- Wrapped in subselects per 0021's InitPlan rule — `(select public.has_cap(…))`
-- evaluates ONCE per query rather than once per row. On a 200k-row table that is
-- the difference between 8ms and 4 seconds.
--
-- ── SELF-READ IS NEVER GATED, AND GATING IT TAKES THE APP DOWN ──────────────
-- organization_members_self_read (`user_id = auth.uid()`) and
-- client_members_team_read are NOT TOUCHED. A person must always read their own
-- roster row: S2 b.4b and harness assertion 6 establish it (reading the record
-- of your own revocation is correct, not a leak), app/(portal)/layout.tsx,
-- app/studio/layout.tsx and lib/team.ts all depend on it — and since Batch 24
-- item 3, so does resolveCaps(), which reads the caller's own row on the USER
-- client. Gating self-read would make the capability layer unable to resolve the
-- capability that would ungate it.
--
-- ── WHY has_cap() MUST BE SECURITY DEFINER, DEMONSTRATED HERE ───────────────
-- The policies on organization_members below CALL has_cap(), which READS
-- organization_members. Without SECURITY DEFINER that recurses. 0051 defines it
-- correctly and is_org_admin() (0020) is the working precedent.
-- ============================================================================

-- ── MONEY ───────────────────────────────────────────────────────────────────
-- invoices: the crew policy is ALL, so this gate covers read AND write. The
-- audit's probe inserted and updated rows through it as a roster 'member'.
drop policy if exists invoices_crew_all on public.invoices;
create policy invoices_crew_all on public.invoices
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
    and (select public.has_cap('money.invoices'))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (select public.has_cap('money.invoices'))
  );

-- invoices_client_read is NOT TOUCHED. A client reading their own company's
-- non-draft invoices is the portal flow, authorized by is_client_member() — the
-- client side is a parallel tree (S1 §0), not the studio's minus some, and its
-- ceiling is Batch 26.

-- The cost/usage family: money.costs, not money.invoices. `finance` holds both;
-- `producer` holds costs and not invoices, which is S-R §3.1's producer exactly
-- ("sees budget on their own productions — not the company's books").
drop policy if exists org_credits_org_read on public.org_credits;
create policy org_credits_org_read on public.org_credits
  for select to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (select public.has_cap('money.costs'))
  );

drop policy if exists org_budgets_org_read on public.org_budgets;
create policy org_budgets_org_read on public.org_budgets
  for select to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (select public.has_cap('money.costs'))
  );

-- The WRITE policy keeps is_org_admin() as well as gaining the capability:
-- changing a hard_stop is a money decision AND an administrative one, and this
-- table is the one that can switch off every AI call in the tenant (I-5).
drop policy if exists org_budgets_admin_write on public.org_budgets;
create policy org_budgets_admin_write on public.org_budgets
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_admin())
    and (select public.has_cap('money.costs'))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_admin())
    and (select public.has_cap('money.costs'))
  );

drop policy if exists credit_ledger_org_read on public.credit_ledger;
create policy credit_ledger_org_read on public.credit_ledger
  for select to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (select public.has_cap('money.costs'))
  );

drop policy if exists usage_events_org_read on public.usage_events;
create policy usage_events_org_read on public.usage_events
  for select to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (select public.has_cap('money.costs'))
  );

-- ── PEOPLE ──────────────────────────────────────────────────────────────────
-- is_org_admin() → has_cap('people.manage'). This is not a rename: the roles
-- that satisfied the old predicate (owner, admin) hold people.manage by
-- baseline, so nobody loses access — and a person GRANTED people.manage now
-- gains it, which is the entire point of the capability layer existing.
drop policy if exists organization_members_admin_all on public.organization_members;
create policy organization_members_admin_all on public.organization_members
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.has_cap('people.manage'))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.has_cap('people.manage'))
  );

-- organization_members_self_read: UNTOUCHED, deliberately. See the header.

drop policy if exists client_members_admin_all on public.client_members;
create policy client_members_admin_all on public.client_members
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.has_cap('people.manage'))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.has_cap('people.manage'))
  );

-- client_members_team_read: UNTOUCHED. A client company's teammates seeing each
-- other is within ONE company and is the portal's own roster, not the studio's
-- view of it. Narrowing it is Batch 26's client ceiling.

-- The project-scope tables move with their rosters: the scope of a membership is
-- part of the membership record, and leaving them on is_org_admin() would mean a
-- granted people.manage could change a role but not the project scope attached
-- to it — a half-grant that reads as a bug.
drop policy if exists organization_member_projects_admin_all on public.organization_member_projects;
create policy organization_member_projects_admin_all on public.organization_member_projects
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.has_cap('people.manage'))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.has_cap('people.manage'))
  );

drop policy if exists client_member_projects_admin_all on public.client_member_projects;
create policy client_member_projects_admin_all on public.client_member_projects
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.has_cap('people.manage'))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.has_cap('people.manage'))
  );

-- ── THE GRANT TABLES ────────────────────────────────────────────────────────
-- Same flip. The delegation LIMITS (G-1…G-4 — you cannot grant what you do not
-- hold, platform.* is ungrantable, nobody edits their own row, never zero
-- owners) are NOT expressible as a row predicate and land as triggers in the
-- next migration. This policy answers "may you touch grant rows at all".
drop policy if exists org_member_cap_grants_admin_all on public.org_member_cap_grants;
create policy org_member_cap_grants_admin_all on public.org_member_cap_grants
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.has_cap('people.manage'))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.has_cap('people.manage'))
  );

drop policy if exists client_member_cap_grants_admin_all on public.client_member_cap_grants;
create policy client_member_cap_grants_admin_all on public.client_member_cap_grants
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.has_cap('people.manage'))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.has_cap('people.manage'))
  );

-- The two *_cap_grants_self_read policies from 0051 are UNTOUCHED: a person
-- must be able to see what they hold, or "your access changed" is
-- indistinguishable from "you were never here".

-- ── verification, run live immediately (HANDOFF §10) ────────────────────────
-- Proven in BOTH directions as the personas on the anon key, never as the
-- service role — a probe that does not run as the persona proves nothing about
-- the persona (§12 lesson 6). Expected, with a money.costs GRANT seeded on the
-- crew persona to prove a grant flows through the policy:
--
--   owner  invoices 2 · credits/budgets/ledger/usage 1 each · org_members 3 ·
--          client_members 3 · grants 1
--   crew   invoices 0  (no money.invoices)
--          credits/budgets/ledger/usage 1 each  (GRANTED money.costs)
--          org_members 1  (own row, self_read — never gated)
--          client_members 0 · own grant row 1
--   c1own  invoices 1 (client policy) · client_members 2 (team_read) · rest 0
--
-- Then: notify pgrst, 'reload schema'.
