-- ============================================================================
-- 0050_role_vocabulary_and_blocked_status.sql — Batch 24 item 1
--
-- Governing: S-R §3.1 (the six company roles), S-R R-11 + Batch 24 ruling 4
-- (an assignee who can no longer decide is reported, never lapsed).
-- Runs after 0049. Forward-only, idempotent, guarded (I-12).
--
-- ── THE TRAP THIS FILE EXISTS TO NOT FALL INTO ──────────────────────────────
-- `member` means opposite things on the two rosters, and a future batch
-- pattern-matching on the column name will get this wrong:
--
--   organization_members.role = 'member'  → DEPRECATED. S-R §3.1 retires it and
--                                           maps it to the `crew` baseline.
--   client_members.role       = 'member'  → LIVE AND CURRENT. S-R §8 keeps it:
--                                           "a `member` sees the projects they
--                                           are scoped to."
--
-- So there is no such thing as a "member → crew" sweep across both tables. Doing
-- it on client_members would silently delete a role the spec keeps, on eight
-- production rows. This migration touches ONE roster and names its rows by id.
--
-- ── WHAT THE AUDIT FOUND, AND WHY THIS FILE IS SHORT ────────────────────────
-- The batch brief called item 1 "the most dangerous item in this batch… every
-- later item assumes the role column tells the truth. Today it probably does
-- not." It does. Live read 2026-09-12: both McPrime crew rows carry a
-- deliberate non-default role (owner, admin), and all eight production
-- client_members rows carry one too (6 owner, 1 approver, 1 member). The
-- 'member' column default had fired on exactly TWO rows, both synthetic harness
-- fixtures.
--
-- It is honest because it HAS A WRITER: app/api/admin/team/route.ts:103 on the
-- crew side, the client-creation paths since Batch 8.1 on the other. That is
-- `organizations.plan` (HANDOFF §11 q9) inverted — a column with a writer tells
-- the truth; a column with only a default tells you its default.
--
-- So NO PRODUCTION ROW IS WRITTEN HERE. Two harness fixtures move off the
-- deprecated alias so assertions 30-36 prove a role the spec is keeping.
-- ============================================================================

-- ── 1. organization_members.role — six live roles plus two deprecated ───────
-- S-R §3.1: owner · admin · producer · coordinator · finance · crew.
-- `editor` and `member` stay ADMITTED and DEPRECATED: 'editor' is live in
-- Gabby's roles[] and retiring it is its own migration in a later batch
-- (recorded in HANDOFF §9 as owed). Dropping either value here would 23514 a
-- live row, which is the whole reason they stay.
alter table public.organization_members
  drop constraint if exists organization_members_role_check;
alter table public.organization_members
  add constraint organization_members_role_check check (
    role in (
      'owner', 'admin', 'producer', 'coordinator', 'finance', 'crew',
      'editor', 'member'   -- deprecated aliases, mapped to the crew baseline
    )
  );

-- client_members_role_check is DELIBERATELY NOT TOUCHED. It already admits
-- exactly S-R §8's four — owner, approver, member, viewer — verbatim. There is
-- nothing to widen and nothing to remap. See the trap note above.

-- ── 2. approval_stages.status — R-11's sixth value ──────────────────────────
-- `blocked_on_permission`, not `blocked_on_access`: the latter misreads as
-- `blocked_on_changes` at a glance and the two mean opposite things about whose
-- fault the stall is. blocked_on_changes = someone asked for changes and the
-- work is in flight. blocked_on_permission = the person we are waiting on was
-- silently prevented from answering, which is a defect in OUR configuration.
--
-- Without this value the sweep can only lapse a stage whose assignees can no
-- longer decide, and the certificate then says "no response was received" about
-- a person who was never able to respond — S3-c AP-2's failure mode reached
-- through the permission layer (S-R R-11). Item 9 is what writes it.
alter table public.approval_stages
  drop constraint if exists approval_stages_status_check;
alter table public.approval_stages
  add constraint approval_stages_status_check check (
    status in ('pending', 'active', 'complete', 'auto_advanced',
               'blocked_on_changes', 'blocked_on_permission')
  );

-- ── 3. The two harness fixtures, by id ──────────────────────────────────────
-- Named by primary key, not by role, so this can never reach a production row
-- and a re-run is a no-op. Status and scope_mode are untouched: the revoked
-- persona's status is what harness assertion 6 asserts against, and the crew
-- persona's scope_mode='selected' is what assertion 4 asserts against.
update public.organization_members
   set role = 'crew'
 where id in (
   '0f0f0f0f-0004-4000-8000-000000000002',  -- harness-crew   (was 'member')
   '0f0f0f0f-0004-4000-8000-000000000003'   -- harness-revoked (was 'member')
 )
   and role = 'member';

-- ── verification ────────────────────────────────────────────────────────────
-- Run immediately after applying, live (HANDOFF §10).

-- a. Every roster row and its role. Expect: clinton=owner, gabby=admin,
--    harness-owner=owner, harness-crew=crew, harness-revoked=crew.
--    Expect ZERO rows still reading 'member' on this table.
-- select o.name as org, m.email, m.role, m.status
--   from public.organization_members m
--   join public.organizations o on o.id = m.organization_id
--  order by o.name, m.role, m.email;

-- b. At least one ACTIVE owner per organization that has any roster row.
--    Expect zero rows returned.
-- select o.id, o.name
--   from public.organizations o
--  where exists (select 1 from public.organization_members m
--                 where m.organization_id = o.id)
--    and not exists (select 1 from public.organization_members m
--                     where m.organization_id = o.id
--                       and m.status = 'active' and m.role = 'owner');

-- c. No row outside the new CHECK. Expect zero.
-- select id, email, role from public.organization_members
--  where role not in ('owner','admin','producer','coordinator','finance',
--                     'crew','editor','member');

-- d. client_members untouched and still S-R §8's four. Expect 8 owner,
--    1 approver, 2 member across 11 rows, and zero outside the four.
--    (This comment first said 7/1/3 — a miscount written from memory of the
--    audit rather than from its output. The live run corrected it before this
--    file was committed; HANDOFF §12 lesson 4 is about exactly this.)
-- select role, count(*) from public.client_members group by role order by role;

-- e. The new stage status is accepted and a garbage value is still rejected.
--    Both proven by probe rather than by reading the constraint — see the
--    commit message for the run.
