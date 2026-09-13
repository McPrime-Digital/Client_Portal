-- ═══════════════════════════════════════════════════════════════════════════
-- 0059 · close the project-scoping gaps — S2 §4 Class B, S-R R-5a
-- Batch 26 item 6. CONSTRAINING. Read the deploy note before applying.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Item 0's audit found eight crew policies carrying org_project_visible() in
-- USING and four work tables carrying it nowhere. It also found something the
-- brief did not ask about and that resizes this item:
--
--   THE PREDICATE IS IN `WITH CHECK` ON EXACTLY ONE POLICY IN THE DATABASE.
--
-- `messages_member_insert` (Batch 23) is that one. Every other crew policy is a
-- single `FOR ALL` whose USING carries the scope predicate and whose WITH CHECK
-- does not. So today a scope_mode='selected' crew member CANNOT READ a sibling
-- production's rows and CAN INSERT onto one, and can UPDATE a visible row INTO a
-- production they cannot see — WITH CHECK requires only organization_id plus
-- is_org_member().
--
-- Owner ruling: close both clauses together, and it does not need permission to
-- grow. "A policy whose USING carries the predicate and whose WITH CHECK does not
-- is a read gate on a table that accepts writes, which is HANDOFF §12 lesson 6 in
-- the policy layer itself. Half-closing it would ship a scoping model that stops
-- people looking and lets them write."
--
-- ── CORRECTION TO ITEM 0, FOUND BY PROBING BEFORE WRITING THIS FILE ────────
--
-- Item 0 reported, and the ruling repeated, that a scoped crew member "can UPDATE
-- a sibling production's approval by id" and "can move a visible row INTO a
-- production they cannot see." BOTH OF THOSE UPDATE PATHS ARE ALREADY REFUSED,
-- and the item-0 finding was a code reading that the database contradicts. Probed
-- as the harness scoped crew member on the anon key:
--
--   · UPDATE approvals SET … WHERE id = <sibling production's approval>
--       → the ROW DOES NOT CHANGE. A TARGETED update has to FIND the row first,
--         and Postgres applies the SELECT policies to do that. approvals_crew_read
--         already carries org_project_visible, so the read gate closes the write.
--
--   · UPDATE tasks SET project_id = <sibling> WHERE id = <my own task>
--       → 42501, new row violates row-level security policy. A `FOR ALL` policy's
--         USING expression is applied to the NEW row as well as the old, so the
--         scope predicate in USING already governs where a row may MOVE.
--         Confirmed by the control: the same update to project_id = NULL SUCCEEDS,
--         which is exactly what `(project_id is null or …)` permits.
--
-- WHAT IS GENUINELY OPEN IS **INSERT**, and only INSERT. There is no old row, so a
-- FOR ALL policy's USING cannot apply and WITH CHECK is the only gate — and WITH
-- CHECK carries no scope predicate on any of these tables. Proven:
--
--   · INSERT INTO tasks (organization_id, project_id = <sibling>, …) as the scoped
--     crew member → NO ERROR, and the row LANDS. They cannot see that production
--     and can write to it.
--
-- So the REMEDY the ruling ordered is exactly right and the REASON is different:
-- WITH CHECK is not a redundant second copy of USING, it is the only gate on the
-- one command USING cannot reach. Stated here because "close both clauses" and
-- "an unpredicated UPDATE is live" are different claims, and only the first
-- survives contact with the database.
--
-- ── approvals IS STILL FIRST ───────────────────────────────────────────────
--
-- approvals_crew_insert has the same open INSERT, and approvals are the
-- CONTRACTUAL record (S3-c §3.2) — approval_decisions is append-only precisely so
-- the record cannot be rewritten, and minting an approval onto a production you
-- cannot see is the same class of forgery one table up.
--
-- ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
--
-- `message_rooms` — owner ruling, and item 0 raised it rather than inheriting it.
-- org_project_visible() is FALSE BY CONSTRUCTION for an MD-4 external
-- collaborator, who holds a room seat and no roster row anywhere. Adding the
-- predicate to message_rooms_member_read would make a project-tagged room
-- invisible to the very person invited into it. `is_room_member()` is already the
-- correct authority for a room: a room's membership is STATED, not derived from
-- project scope, and that is the point of the room model (S3-d MD-1).
-- `messages_member_read` already carries the predicate at the MESSAGE level,
-- which is the right layer. Recorded so the next batch does not "fix" this.
--
-- `document_versions`, `document_comments`, `storyboard_shots` — they have NO
-- project_id column (verified live), so this shape cannot apply and a migration
-- pretending otherwise would report success and narrow nothing. They need a join
-- through the parent documents/storyboards row: a different predicate with
-- different performance characteristics. Owed in HANDOFF §9, not improvised here.
-- `documents` holds 1 row and `storyboards` 0, so nothing is exposed while it waits.
--
-- ── THE SHAPE, WHICH IS S2 §4 CLASS B's AND messages_member_insert's ───────
--
--   organization_id = (select current_org())
--   and (select is_org_member())
--   and (project_id is null or org_project_visible(project_id))
--
-- PROJECT_ID NULL STAYS VISIBLE TO THE ORG, deliberately. An untagged message in
-- a client room is ROOM-scoped, not project-scoped, and narrowing that would break
-- the General thread. Same for an org-wide notification or an untagged file.
--
-- org_project_visible takes a COLUMN ARGUMENT and therefore cannot be wrapped as
-- an InitPlan — the live exception to 0021's wrapped-subselect rule, which is
-- correct rather than an oversight (Batch 25 q14). Everything else stays wrapped.
--
-- `projects` is the one table where the predicate reads `id` rather than
-- `project_id`, and it has no null branch because a project's own id is never
-- null. Consequence, stated because it is a real behaviour change: a
-- scope_mode='selected' member can no longer INSERT a project, because the new
-- row is not assigned to them and so is not visible to them. That is correct —
-- S-R §8 gives a freelance seat "no client company list, no roster, no money" —
-- and it touches no live person, since every production member is scope_mode='all'
-- and the create-project route runs on the service role regardless.
--
-- ── EVERY OTHER CONJUNCT IS PRESERVED EXACTLY ──────────────────────────────
--
-- Each policy below was read out of pg_policies immediately before this file was
-- written and is reproduced verbatim plus the one new conjunct. In particular
-- `invoices` keeps its has_cap('money.invoices') predicate in BOTH clauses
-- (0053), and no `deleted_at`/`for_admin` clause is added or removed — a
-- migration that "tidies" a neighbouring conjunct while narrowing scope is two
-- changes wearing one diff.
--
-- ── DEPLOY ORDER ───────────────────────────────────────────────────────────
--
-- Constraining, but NO CODE CHANGE IS OWED FIRST and that is checked rather than
-- assumed: every application path to these tables runs on the SERVICE ROLE, which
-- bypasses RLS. What this closes is the PostgREST door and the Realtime filter —
-- browser subscriptions authenticate as the user, so a scoped member's live
-- updates narrow with their reads, which is the intended behaviour and the reason
-- correct RLS has to exist regardless (AD-001).
--
-- Verified before AND immediately after applying, as real personas on the anon
-- key. Roll back on any owner-side failure.
--
-- I-12: every create policy is preceded by a drop, and the whole file is one
-- transaction, so there is no window in which a table sits unprotected.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1 · approvals — the live one, first ────────────────────────────────────
drop policy if exists approvals_crew_update on public.approvals;
create policy approvals_crew_update on public.approvals
  for update to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  );

drop policy if exists approvals_crew_insert on public.approvals;
create policy approvals_crew_insert on public.approvals
  for insert to authenticated
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  );

-- ── 2 · the five that had USING but not WITH CHECK ─────────────────────────
drop policy if exists tasks_crew_all on public.tasks;
create policy tasks_crew_all on public.tasks
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  );

drop policy if exists files_crew_all on public.files;
create policy files_crew_all on public.files
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  );

drop policy if exists project_phases_crew_all on public.project_phases;
create policy project_phases_crew_all on public.project_phases
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  );

drop policy if exists activity_log_crew_all on public.activity_log;
create policy activity_log_crew_all on public.activity_log
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  );

-- invoices keeps its capability predicate (0053) in BOTH clauses.
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
    and (project_id is null or public.org_project_visible(project_id))
    and (select public.has_cap('money.invoices'))
  );

-- projects: the predicate reads `id`, and there is no null branch.
drop policy if exists projects_crew_all on public.projects;
create policy projects_crew_all on public.projects
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and public.org_project_visible(id)
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and public.org_project_visible(id)
  );

-- ── 3 · the three that carried it NOWHERE ──────────────────────────────────
-- notifications is the only one of the three with live rows that carry
-- project_id: 108 of 121. A scoped crew member reads all 13 of the harness
-- tenant's notifications today — the same count as the owner — which is the gap
-- this closes, and it is measured before and after rather than asserted.
drop policy if exists notifications_crew_all on public.notifications;
create policy notifications_crew_all on public.notifications
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  );

drop policy if exists documents_org_all on public.documents;
create policy documents_org_all on public.documents
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  );

drop policy if exists storyboards_org_all on public.storyboards;
create policy storyboards_org_all on public.storyboards
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  );

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION
--
-- 1 · every crew policy now carries the predicate in BOTH clauses:
--     select tablename, policyname,
--            position('org_project_visible' in coalesce(qual,'')) > 0 as using_has,
--            position('org_project_visible' in coalesce(with_check,'')) > 0 as check_has
--       from pg_policies where schemaname='public'
--        and policyname in (…the eleven above…);
--     → every row true/true, except approvals_crew_insert which has no USING.
--
-- 2 · the owner reads everything, unchanged. The SCOPED crew member's
--     notifications DROP from 13 to the ones tagged to their own production or
--     untagged. Measured as personas on the anon key, before and after.
--
-- 3 · the hole that IS live: as the scoped crew member, INSERT a task carrying a
--     sibling production's project_id. Before: no error and the row lands.
--     After: refused.
--
--     AND THE PROBE ITSELF HAS A TRAP, recorded because it cost a wrong answer
--     here first. A refusal in Postgres is an empty result, not an error, so
--     §12 lesson 6 says to ask for rows back — but `.select()` adds RETURNING,
--     RETURNING needs SELECT, and on these tables SELECT is NARROWER than the
--     write. So a SUCCESSFUL write comes back as zero rows and reads as a
--     refusal: the advice defeated by the very asymmetry being probed. The only
--     trustworthy witness is the ROW, read back as the service role.
--
-- Harness assertions 38/39 (item 9) make (2) and (3) standing tests.
-- ═══════════════════════════════════════════════════════════════════════════
