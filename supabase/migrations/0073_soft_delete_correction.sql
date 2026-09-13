-- ═══════════════════════════════════════════════════════════════════════════
-- 0073 · 0070 was wrong twice. This is the correction.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 0070 added `deleted_at IS NULL` to twelve policies and broke two things. Both
-- were caught by the harness — assertions 9 and 50 went red — and both are worth
-- writing down, because one of them contradicts a lesson this repo had ALREADY
-- LEARNED AND RECORDED.
--
-- ── DEFECT 1 · A `FOR ALL` POLICY'S USING APPLIES TO THE NEW ROW ───────────
--
-- 0070's header states, confidently: "USING is evaluated against the OLD row."
-- That is true for `FOR UPDATE`. It is FALSE for `FOR ALL`, where USING is
-- applied to the existing row AND the new one.
--
-- So `deleted_at IS NULL` in a FOR ALL policy's USING refuses the very UPDATE
-- that performs a soft delete: the new row HAS `deleted_at` set, so USING fails
-- on it and PostgREST returns 42501. Every "Delete" button in the product would
-- have failed on a row the caller plainly owned — which is precisely the
-- failure 0070's header claimed to be avoiding, arrived at from the other side.
--
-- **HANDOFF §12 lesson 11 ALREADY SAYS THIS**, in these words: "a `FOR ALL`
-- policy's USING expression is applied to the NEW row as well as the old, so
-- USING already governs where a row may MOVE — proven by control, not by
-- reading the docs." It was proven in Batch 26, written down, and then
-- contradicted here by the same person who wrote it. A lesson in a file is not
-- a lesson in the head.
--
-- THE FIX: every table keeps its ORIGINAL policies exactly as they were before
-- 0070, and the predicate moves to the CLIENT-facing permissive SELECT policies
-- only. Part 3 carries the evidence for why the obvious alternative — one
-- restrictive SELECT policy per table — fails in exactly the same way.
-- Soft delete works again, and RESTORE works too (0070 claimed restore was
-- impossible; that was the bug talking).
--
-- ── DEFECT 2 · `create policy` WITHOUT `TO authenticated` IS `TO PUBLIC` ───
--
-- Every policy this session created omitted the roles clause, so all 42 landed
-- as `TO public` rather than `TO authenticated` like every policy before them.
--
-- For the ANON role that is not cosmetic. With no policy applicable, an
-- unauthenticated SELECT simply matched zero rows. With a PUBLIC policy it now
-- EVALUATES the policy — and anon holds no EXECUTE on `is_org_member`,
-- `is_client_member`, `org_project_visible` or `client_project_visible`, so the
-- read returns **401 "permission denied for function is_org_member"** instead of
-- an empty set. Harness assertion 9 ("unauthenticated session reads zero rows
-- from every table") caught it on five tables.
--
-- An error is not a leak, so nothing was exposed. But it converts "nothing here"
-- into "something is broken", which is the failure mode S-R R-6 exists to avoid,
-- and it would have reached any anonymous surface that touches these tables.
--
-- Fixed with ALTER POLICY ... TO authenticated, which changes the roles and
-- leaves every expression untouched — the narrowest possible correction.
-- `user_prefs` also sits at `TO public`, from migration 0034; it is NOT touched
-- here. Its policies read `auth.uid()`, which anon may execute, and fixing
-- somebody else's table as a side effect of correcting mine is how unrelated
-- breakage gets attributed to the wrong batch.
--
-- I-12: forward-only, every create policy preceded by a drop.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1 · every policy this session created becomes TO authenticated ─────────
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and roles::text = '{public}'
      -- The explicit allowlist is the audit trail: these are the tables whose
      -- policies were written in 0063–0072. user_prefs (0034) is deliberately
      -- absent.
      and tablename in (
        'member_budgets', 'org_seat_budgets',
        'asset_provenance', 'rights',
        'calendar_entries', 'calendar_entry_attendees',
        'availability_rules', 'booking_types', 'bookings',
        'meetings', 'meeting_participants',
        'contracts', 'contract_signers', 'contract_fields', 'contract_events',
        'calendar_connections',
        'clients', 'documents', 'files', 'invoices', 'projects', 'tasks'
      )
  loop
    execute format('alter policy %I on public.%I to authenticated',
                   r.policyname, r.tablename);
  end loop;
end
$$;

-- ── 2 · the twelve policies 0070 rewrote go back to what they were ────────
-- Restored verbatim from the definitions read out of pg_policies before 0070
-- touched them. Where the `deleted_at` predicate belongs is settled in part 3.

alter policy clients_crew_all on public.clients
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
  );

alter policy clients_member_read on public.clients
  using (public.is_client_member(id));

alter policy clients_member_update on public.clients
  using (public.is_client_member(id))
  with check (public.is_client_member(id));

alter policy documents_org_all on public.documents
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  );

alter policy files_crew_all on public.files
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  );

alter policy files_client_read on public.files
  using (
    public.is_client_member(client_id)
    and (project_id is null or public.client_project_visible(project_id))
  );

alter policy invoices_crew_all on public.invoices
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
    and (select public.has_cap('money.invoices'))
  );

alter policy invoices_client_read on public.invoices
  using (
    public.is_client_member(client_id)
    and (project_id is null or public.client_project_visible(project_id))
    and status <> 'draft'
  );

alter policy projects_crew_all on public.projects
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and public.org_project_visible(id)
  );

alter policy projects_client_read on public.projects
  using (
    public.is_client_member(client_id)
    and public.client_project_visible(id)
  );

alter policy tasks_crew_all on public.tasks
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  );

alter policy tasks_client_read on public.tasks
  using (
    visible_to_client = true
    and project_id is not null
    and public.client_project_visible(project_id)
  );

-- ── 3 · where the predicate actually goes, proven rather than assumed ─────
--
-- A RESTRICTIVE `FOR SELECT` policy was tried first and DOES NOT WORK. On
-- PostgreSQL 17 it is applied to the NEW row of an UPDATE as well as to reads,
-- so `deleted_at is null` refused the soft delete a second time — the identical
-- symptom as defect 1, from a policy that names only SELECT:
--
--     new row violates row-level security policy "tasks_hide_deleted"
--
-- A PERMISSIVE SELECT policy carrying the same predicate does NOT interfere.
-- Both were run as a real `authenticated` session against the live database
-- before this file was written; the restrictive form was dropped on the
-- evidence, not on preference.
--
-- ── SO THE BOUNDARY IS ENFORCED WHERE IT IS A BOUNDARY ────────────────────
--
-- **Clients are blocked by RLS. Crew are not, and that is deliberate.**
--
-- A client seeing a deleted row is a leak across a tenant boundary, so it is
-- enforced in the database, in their permissive SELECT policies, where it
-- costs nothing — a client never sets `deleted_at`.
--
-- Crew keep their unfiltered ALL policy, which is what makes soft delete work
-- at all (defect 1) and what makes RESTORE possible. The consequence is that a
-- crew query returns soft-deleted rows unless it excludes them, so **crew reads
-- must filter `deleted_at is null` in the query**. That is a real obligation on
-- application code and it is the price of the row being writable. It also buys
-- something the restrictive version could not have: a trash view and an undelete
-- are now ordinary queries rather than service-role work.
--
-- `documents` gets no clause here because it has no client-facing policy at
-- all — it is crew-only, so the same obligation applies to every read of it.

drop policy if exists clients_hide_deleted   on public.clients;
drop policy if exists documents_hide_deleted on public.documents;
drop policy if exists files_hide_deleted     on public.files;
drop policy if exists invoices_hide_deleted  on public.invoices;
drop policy if exists projects_hide_deleted  on public.projects;
drop policy if exists tasks_hide_deleted     on public.tasks;

alter policy clients_member_read on public.clients
  using (public.is_client_member(id) and deleted_at is null);

alter policy files_client_read on public.files
  using (
    public.is_client_member(client_id)
    and (project_id is null or public.client_project_visible(project_id))
    and deleted_at is null
  );

alter policy invoices_client_read on public.invoices
  using (
    public.is_client_member(client_id)
    and (project_id is null or public.client_project_visible(project_id))
    and status <> 'draft'
    and deleted_at is null
  );

alter policy projects_client_read on public.projects
  using (
    public.is_client_member(client_id)
    and public.client_project_visible(id)
    and deleted_at is null
  );

alter policy tasks_client_read on public.tasks
  using (
    visible_to_client = true
    and project_id is not null
    and public.client_project_visible(project_id)
    and deleted_at is null
  );

commit;

-- ── verification ───────────────────────────────────────────────────────────
-- select count(*) from pg_policies
--  where schemaname='public' and roles::text='{public}'
--    and tablename <> 'user_prefs';                     -- expect 0
-- -- a soft delete must SUCCEED as a crew session; the row must vanish for the
-- -- CLIENT and remain visible to crew (who must filter it in the query);
-- -- an anon read must return zero rows, not 401.
