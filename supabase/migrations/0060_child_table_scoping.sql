-- ═══════════════════════════════════════════════════════════════════════════
-- 0060 · project scoping reaches the three PARENTLESS tables
-- Batch 26 follow-up. Closes HANDOFF §9 item 1.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `document_versions`, `document_comments` and `storyboard_shots` have NO
-- `project_id` column, so 0059's shape could not apply to them and a migration
-- pretending otherwise would have reported success and narrowed nothing. They
-- were recorded as owed rather than improvised (owner ruling 3), and this is the
-- predicate they actually need — designed rather than guessed.
--
-- ── ONE HELPER, NOT THREE INLINE JOINS ─────────────────────────────────────
--
-- Each child reaches its project through its PARENT: document_versions and
-- document_comments via `documents.project_id`, storyboard_shots via
-- `storyboards.project_id`. Written as two SECURITY DEFINER helpers so the
-- policies stay readable in `pg_policies`, which `S2` §1 names as the reason the
-- tenancy/capability split exists at all.
--
-- SECURITY DEFINER is required rather than stylistic: the helper must read the
-- PARENT row to find its project_id, and the caller may not be able to see that
-- parent (that is the whole point — the parent is hidden by 0059's predicate on
-- `documents`). A SECURITY INVOKER helper would return false for a parent the
-- caller cannot read, which is the right answer by accident and the wrong one as
-- soon as a parent is visible for a different reason.
--
-- ── A CHILD WHOSE PARENT HAS NO PROJECT STAYS VISIBLE TO THE ORG ───────────
--
-- Same rule as 0059's `project_id is null` branch, one level down: an untagged
-- document is org-scoped rather than project-scoped, so its versions and comments
-- are too. `documents.project_id` is NULL on the single live row today, so this
-- is not a theoretical branch — it is the only branch that fires.
--
-- A child whose parent has been DELETED resolves to false. The FKs should make
-- that unreachable; false is the safe answer if it is not.
--
-- ── APPLIED WHILE ALL THREE TABLES ARE EMPTY ───────────────────────────────
--
-- Verified immediately before printing: document_versions 0 rows,
-- document_comments 0, storyboard_shots 0, documents 1 (project_id NULL),
-- storyboards 0. So this narrows nothing that exists and cannot regress a live
-- read — which is exactly why it is worth doing NOW rather than after the
-- document editor starts filling them.
--
-- I-12: forward-only, every create policy preceded by a drop, one transaction.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── the two helpers ────────────────────────────────────────────────────────
create or replace function public.org_document_visible(doc_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.documents d
    where d.id = doc_id
      and (d.project_id is null or public.org_project_visible(d.project_id))
  )
$function$;

comment on function public.org_document_visible(uuid) is
  'Batch 26 / 0060. Does the caller''s project scope admit this DOCUMENT? Used by '
  'document_versions and document_comments, which carry no project_id of their own '
  'and reach their project through documents.project_id. A document with no '
  'project is org-scoped, so its children are too.';

create or replace function public.org_storyboard_visible(board_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.storyboards s
    where s.id = board_id
      and (s.project_id is null or public.org_project_visible(s.project_id))
  )
$function$;

comment on function public.org_storyboard_visible(uuid) is
  'Batch 26 / 0060. The storyboard_shots equivalent of org_document_visible().';

-- ── the three policies, USING and WITH CHECK together ──────────────────────
-- Both clauses, for 0059's reason: INSERT is the one command a FOR ALL policy's
-- USING cannot reach, so WITH CHECK is the only gate on it.
drop policy if exists document_versions_org_all on public.document_versions;
create policy document_versions_org_all on public.document_versions
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and public.org_document_visible(document_id)
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and public.org_document_visible(document_id)
  );

drop policy if exists document_comments_org_all on public.document_comments;
create policy document_comments_org_all on public.document_comments
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and public.org_document_visible(document_id)
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and public.org_document_visible(document_id)
  );

drop policy if exists storyboard_shots_org_all on public.storyboard_shots;
create policy storyboard_shots_org_all on public.storyboard_shots
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and public.org_storyboard_visible(storyboard_id)
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and public.org_storyboard_visible(storyboard_id)
  );

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION
--
-- 1 · all three policies carry the predicate in BOTH clauses:
--     select tablename, policyname,
--            position('visible' in coalesce(qual,'')) > 0,
--            position('visible' in coalesce(with_check,'')) > 0
--       from pg_policies where tablename in
--       ('document_versions','document_comments','storyboard_shots');
--
-- 2 · a document with NO project stays visible to the org (the only live case):
--     select public.org_document_visible('<the live document id>') as caller;
--     → true for any active org member
--
-- 3 · owner and the scoped crew member read the same counts as before —
--     all three tables are empty, so "before" and "after" are both zero and the
--     assertion that matters is (2).
-- ═══════════════════════════════════════════════════════════════════════════
