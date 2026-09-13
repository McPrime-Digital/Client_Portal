-- ═══════════════════════════════════════════════════════════════════════════
-- 0065 · calendar_entries + calendar_entry_attendees   (S3-b migration 2)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- S3-b §1.1's premise, which is the reason this table exists at all: a meeting,
-- an approval deadline and an invoice due date are THE SAME KIND OF THING to a
-- person looking at a week. Model them separately and you build three calendars
-- and then a fourth to reconcile them.
--
-- ── A DERIVED ENTRY IS A PROJECTION, NOT A DUPLICATE ───────────────────────
--
-- An approval deadline already exists on `approval_stages.deadline_at`; an
-- invoice due date on `invoices`. The entry is written by the same server action
-- that sets the deadline and deleted when it is cleared — `source_kind` +
-- `source_id` record where it came from. The alternative, unioning four tables
-- at read time, grows a join every time a feature is added, which S0 §3 forbids.
--
-- This is the same polymorphic trade-off `S3-core` §2.2 and 0038 both took
-- (`subject_kind`/`subject_id`), so it is a precedent rather than a novelty:
-- there is no FK on `source_id`, and the cost is that a deleted source leaves an
-- entry nobody cleans up. That cost is accepted because the alternative is five
-- nullable FK columns, one per source, and a CHECK that exactly one is set.
--
-- ── ON DELETE SET NULL, NOT CASCADE, AND S3-core-A A-3 IS WHY ──────────────
--
-- A-3 recorded real data loss: `messages.project_id` was CASCADE, which was
-- correct while a message belonged to a project and wrong the moment the column
-- became a TAG. A calendar entry has the same duality — a shoot day belongs to
-- its production, but a manual entry somebody tagged to a production does not
-- stop existing when the production does. SET NULL keeps it as an org entry.
-- `usage_events.project_id` (0062) was settled the same way for the same reason.
--
-- `client_id` is SET NULL rather than 0038's RESTRICT: blocking the deletion of
-- a client company because somebody put a date in a calendar is a worse outcome
-- than an entry quietly becoming internal.
--
-- ── RLS ────────────────────────────────────────────────────────────────────
--
-- Crew: Class B exactly as 0059 writes it — org, membership, project scope.
-- Client: mirrors `files_client_read` verbatim, plus the entry must actually
-- name their company. A NULL `client_id` is an INTERNAL entry and no client sees
-- it; that is the default, so forgetting to set it fails closed.
--
-- The attendee child reads THROUGH its parent (`exists (select 1 from
-- calendar_entries …)`), which is 0038's idiom for approval_stages and
-- approval_assignees: the subquery is SECURITY INVOKER, so it sees only entries
-- the caller may already read, and the child inherits every predicate above
-- without restating one of them.
--
-- I-12: forward-only, additive, every create policy preceded by a drop.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.calendar_entries (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  kind        text not null,
  source_kind text,
  source_id   uuid,

  project_id uuid references public.projects(id) on delete set null,
  client_id  uuid references public.clients(id)  on delete set null,

  title     text not null,
  starts_at timestamptz not null,
  -- Nullable: a milestone is an instant, not a span (S3-b §1.2).
  ends_at   timestamptz,
  all_day   boolean not null default false,

  created_by uuid references auth.users(id) on delete set null,   -- AD-003
  created_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint calendar_entries_kind_check check (
    kind in ('meeting', 'approval_deadline', 'invoice_due', 'shoot_day', 'manual')
  ),
  constraint calendar_entries_source_kind_check check (
    source_kind is null
    or source_kind in ('meeting', 'approval_stage', 'invoice', 'manual')
  ),
  -- A source_kind with no id (or the reverse) is half a reference, and half a
  -- reference is what makes a projection impossible to clean up. Both or
  -- neither — the same both-or-neither rule 0038 applied to the anchor model.
  constraint calendar_entries_source_pair_check check (
    (source_kind is null) = (source_id is null)
  ),
  constraint calendar_entries_span_check check (
    ends_at is null or ends_at >= starts_at
  )
);

comment on table public.calendar_entries is
  'S3-b §1.2. Anything that occupies time. Derived entries are projections of '
  'their source (source_kind + source_id), written by the action that creates '
  'the source and deleted when it is cleared.';

create index if not exists calendar_entries_org_start_idx
  on public.calendar_entries (organization_id, starts_at) where deleted_at is null;
create index if not exists calendar_entries_project_idx
  on public.calendar_entries (project_id) where project_id is not null;
create index if not exists calendar_entries_client_idx
  on public.calendar_entries (client_id) where client_id is not null;
-- The projection's own lookup: "does an entry already exist for this deadline".
create index if not exists calendar_entries_source_idx
  on public.calendar_entries (source_kind, source_id) where source_id is not null;

create table if not exists public.calendar_entry_attendees (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references public.calendar_entries(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  response   text not null default 'needs_action',
  created_at timestamptz not null default now(),

  constraint calendar_entry_attendees_response_check check (
    response in ('needs_action', 'accepted', 'declined', 'tentative')
  ),
  constraint calendar_entry_attendees_unique unique (entry_id, user_id)
);

comment on table public.calendar_entry_attendees is
  'S3-b §1.2. Attendance is PER PERSON, so one entry appears correctly on '
  'several calendars with a different response on each.';

create index if not exists calendar_entry_attendees_user_idx
  on public.calendar_entry_attendees (user_id);

alter table public.calendar_entries          enable row level security;
alter table public.calendar_entry_attendees  enable row level security;

drop policy if exists calendar_entries_crew_all on public.calendar_entries;
create policy calendar_entries_crew_all on public.calendar_entries
  for all
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

drop policy if exists calendar_entries_client_read on public.calendar_entries;
create policy calendar_entries_client_read on public.calendar_entries
  for select
  using (
    client_id is not null
    and public.is_client_member(client_id)
    and (project_id is null or public.client_project_visible(project_id))
    and deleted_at is null
  );

drop policy if exists calendar_entry_attendees_read on public.calendar_entry_attendees;
create policy calendar_entry_attendees_read on public.calendar_entry_attendees
  for select
  using (
    exists (select 1 from public.calendar_entries e where e.id = entry_id)
  );

-- A person answers for THEMSELVES. Crew may seat and unseat anyone on an entry
-- they can write; nobody accepts on somebody else's behalf, which is why the
-- self policy is separate rather than folded into the crew one.
drop policy if exists calendar_entry_attendees_self on public.calendar_entry_attendees;
create policy calendar_entry_attendees_self on public.calendar_entry_attendees
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists calendar_entry_attendees_crew_write on public.calendar_entry_attendees;
create policy calendar_entry_attendees_crew_write on public.calendar_entry_attendees
  for all
  using (
    exists (
      select 1 from public.calendar_entries e
      where e.id = entry_id
        and e.organization_id = (select public.current_org())
        and (select public.is_org_member())
    )
  )
  with check (
    exists (
      select 1 from public.calendar_entries e
      where e.id = entry_id
        and e.organization_id = (select public.current_org())
        and (select public.is_org_member())
    )
  );

commit;

-- ── verification ───────────────────────────────────────────────────────────
-- select count(*) from calendar_entries;   -- 0
-- select policyname from pg_policies where tablename like 'calendar_entry%';
