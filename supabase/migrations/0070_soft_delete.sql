-- ═══════════════════════════════════════════════════════════════════════════
-- 0070 · soft delete reaches the remaining six tables   (S3-core migration 10)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- S3-core §4.1 lists nine tables. Three already carry `deleted_at` —
-- `messages`, `message_rooms`, `approvals` — and six do not: `files`,
-- `documents`, `tasks`, `clients`, `projects`, `invoices`.
--
-- The spec's own warning about this migration: "This is the change most likely
-- to break something QUIETLY — a policy that forgets the predicate shows
-- deleted rows, and a query that adds it twice costs nothing."
--
-- ── THE TRAP THAT WOULD HAVE BROKEN SOFT DELETE ITSELF ─────────────────────
--
-- The predicate goes in USING **and never in WITH CHECK**, and getting that
-- backwards breaks the feature in the least obvious way available:
--
--   · USING is evaluated against the OLD row. A live row has deleted_at NULL,
--     so the UPDATE that SETS deleted_at is permitted. Correct.
--   · WITH CHECK is evaluated against the NEW row. The new row HAS deleted_at
--     set — so a WITH CHECK carrying `deleted_at is null` refuses the soft
--     delete itself, and every "Delete" button in the product starts failing
--     with a policy violation on a row the caller plainly owns.
--
-- Every ALL policy below therefore gains the predicate on one side only. This
-- is the same USING/WITH-CHECK asymmetry 0059 had to reason about from the
-- other direction, where the omission was in WITH CHECK and INSERT was the hole.
--
-- ── THE CONSEQUENCE, STATED RATHER THAN DISCOVERED ─────────────────────────
--
-- Because USING also governs UPDATE and DELETE, a soft-deleted row becomes
-- invisible AND unwritable on the user client. **Restore is therefore a
-- service-role operation** until an explicit undelete path exists, and the
-- purge (0071) is a cron that bypasses RLS anyway. That is the right trade
-- while undelete is not a feature; it is written down so the first person who
-- tries to build one knows where the wall is.
--
-- ── SAFE TO APPLY TODAY, EXPENSIVE TO APPLY LATER ──────────────────────────
--
-- Every existing row gets `deleted_at` NULL, so every row still satisfies every
-- amended policy and NOTHING changes for any live reader. The predicate is free
-- now precisely because nothing has been soft-deleted yet — the same argument
-- 0064 made about its constraints.
--
-- I-12: forward-only, every create policy preceded by a drop, one transaction.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.files     add column if not exists deleted_at timestamptz;
alter table public.documents add column if not exists deleted_at timestamptz;
alter table public.tasks     add column if not exists deleted_at timestamptz;
alter table public.clients   add column if not exists deleted_at timestamptz;
alter table public.projects  add column if not exists deleted_at timestamptz;
alter table public.invoices  add column if not exists deleted_at timestamptz;

-- The purge's own lookup. Partial, because the rows it wants are the rare ones.
create index if not exists files_deleted_idx     on public.files     (deleted_at) where deleted_at is not null;
create index if not exists documents_deleted_idx on public.documents (deleted_at) where deleted_at is not null;
create index if not exists tasks_deleted_idx     on public.tasks     (deleted_at) where deleted_at is not null;
create index if not exists clients_deleted_idx   on public.clients   (deleted_at) where deleted_at is not null;
create index if not exists projects_deleted_idx  on public.projects  (deleted_at) where deleted_at is not null;
create index if not exists invoices_deleted_idx  on public.invoices  (deleted_at) where deleted_at is not null;

-- ── clients ────────────────────────────────────────────────────────────────
drop policy if exists clients_crew_all on public.clients;
create policy clients_crew_all on public.clients
  for all
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and deleted_at is null
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
  );

drop policy if exists clients_member_read on public.clients;
create policy clients_member_read on public.clients
  for select
  using (public.is_client_member(id) and deleted_at is null);

drop policy if exists clients_member_update on public.clients;
create policy clients_member_update on public.clients
  for update
  using (public.is_client_member(id) and deleted_at is null)
  with check (public.is_client_member(id));

-- ── documents ──────────────────────────────────────────────────────────────
drop policy if exists documents_org_all on public.documents;
create policy documents_org_all on public.documents
  for all
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
    and deleted_at is null
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  );

-- ── files ──────────────────────────────────────────────────────────────────
drop policy if exists files_crew_all on public.files;
create policy files_crew_all on public.files
  for all
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
    and deleted_at is null
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  );

drop policy if exists files_client_read on public.files;
create policy files_client_read on public.files
  for select
  using (
    public.is_client_member(client_id)
    and (project_id is null or public.client_project_visible(project_id))
    and deleted_at is null
  );

-- files_client_insert is INSERT-only: a new row's deleted_at is NULL by
-- definition, so the predicate would be inert there. Left exactly as it was.

-- ── invoices ───────────────────────────────────────────────────────────────
drop policy if exists invoices_crew_all on public.invoices;
create policy invoices_crew_all on public.invoices
  for all
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
    and (select public.has_cap('money.invoices'))
    and deleted_at is null
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
    and (select public.has_cap('money.invoices'))
  );

drop policy if exists invoices_client_read on public.invoices;
create policy invoices_client_read on public.invoices
  for select
  using (
    public.is_client_member(client_id)
    and (project_id is null or public.client_project_visible(project_id))
    and status <> 'draft'
    and deleted_at is null
  );

-- ── projects ───────────────────────────────────────────────────────────────
drop policy if exists projects_crew_all on public.projects;
create policy projects_crew_all on public.projects
  for all
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and public.org_project_visible(id)
    and deleted_at is null
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and public.org_project_visible(id)
  );

drop policy if exists projects_client_read on public.projects;
create policy projects_client_read on public.projects
  for select
  using (
    public.is_client_member(client_id)
    and public.client_project_visible(id)
    and deleted_at is null
  );

-- ── tasks ──────────────────────────────────────────────────────────────────
drop policy if exists tasks_crew_all on public.tasks;
create policy tasks_crew_all on public.tasks
  for all
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
    and deleted_at is null
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  );

drop policy if exists tasks_client_read on public.tasks;
create policy tasks_client_read on public.tasks
  for select
  using (
    visible_to_client = true
    and project_id is not null
    and public.client_project_visible(project_id)
    and deleted_at is null
  );

commit;

-- ── verification ───────────────────────────────────────────────────────────
-- select count(*) from pg_policies
--  where tablename in ('files','documents','tasks','clients','projects','invoices')
--    and qual like '%deleted_at IS NULL%';            -- expect 12
-- -- and a soft delete must still be PERMITTED as the owning persona.
