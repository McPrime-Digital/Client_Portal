-- ============================================================================
-- 0007_storyboards.sql — P2: Storyboard (film) tab
-- A storyboard is an ordered set of shots; each shot carries craft metadata
-- (type, description, the generation prompt) and a reserved frame slot
-- (image_key) the AI generation hub fills in later. Live multi-user via
-- Postgres changes. Internal/team-facing for now (admins), mirroring documents.
-- Runs on throughline-dev (after 0006).
-- ============================================================================

begin;

create table if not exists public.storyboards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id),
  project_id uuid references public.projects(id) on delete set null,
  title text not null default 'Untitled board',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists storyboards_org_idx on public.storyboards(organization_id, updated_at desc);

create table if not exists public.storyboard_shots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id),
  storyboard_id uuid not null references public.storyboards(id) on delete cascade,
  idx integer not null default 0,                 -- order within the board
  title text not null default '',
  shot_type text,                                 -- WIDE | MED | CU | OTS | …
  description text,                               -- what happens in frame
  prompt text,                                    -- generation prompt for the frame
  image_key text,                                 -- R2 key once a frame is generated/attached
  image_bucket text not null default 'r2',
  created_at timestamptz not null default now()
);
create index if not exists storyboard_shots_board_idx on public.storyboard_shots(storyboard_id, idx);

alter table public.storyboards enable row level security;
alter table public.storyboard_shots enable row level security;
drop policy if exists storyboards_admin_all on public.storyboards;
create policy storyboards_admin_all on public.storyboards for all to authenticated
  using (public.is_admin() and organization_id = public.current_org())
  with check (public.is_admin() and organization_id = public.current_org());
drop policy if exists storyboard_shots_admin_all on public.storyboard_shots;
create policy storyboard_shots_admin_all on public.storyboard_shots for all to authenticated
  using (public.is_admin() and organization_id = public.current_org())
  with check (public.is_admin() and organization_id = public.current_org());

do $$ begin
  alter publication supabase_realtime add table public.storyboards;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.storyboard_shots;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';

commit;
