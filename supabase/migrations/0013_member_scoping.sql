-- ============================================================================
-- 0013_member_scoping.sql — per-member experience controls
-- history_from: owner decides whether an invited member sees past messages
--   (null = full history) or only messages after they joined (set at invite).
-- client_member_projects: optional project scoping — NO rows = member sees all
--   of the company's projects; any rows = member sees ONLY those projects.
-- Both tables org-side too-ready (organization_members gets history_from for
-- the crew Chat rooms when Phase 2 lands). Additive + idempotent.
-- ============================================================================

begin;

alter table public.client_members add column if not exists history_from timestamptz;
alter table public.organization_members add column if not exists history_from timestamptz;

create table if not exists public.client_member_projects (
  member_id uuid not null references public.client_members(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, project_id)
);
create index if not exists client_member_projects_project_idx on public.client_member_projects(project_id);

alter table public.client_member_projects enable row level security;

drop policy if exists client_member_projects_admin_all on public.client_member_projects;
create policy client_member_projects_admin_all on public.client_member_projects
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists client_member_projects_team_read on public.client_member_projects;
create policy client_member_projects_team_read on public.client_member_projects
  for select to authenticated using (
    exists (
      select 1 from public.client_members m
      where m.id = member_id and public.is_client_member(m.client_id)
    )
  );

-- realtime: membership tables must be in the publication or roster
-- subscriptions never fire (each add throws if already present — ignore).
do $$ begin
  alter publication supabase_realtime add table public.client_members;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.organization_members;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.client_member_projects;
exception when duplicate_object then null; end $$;

commit;
