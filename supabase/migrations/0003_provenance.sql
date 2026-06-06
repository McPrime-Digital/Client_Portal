-- ============================================================================
-- 0003_provenance.sql — F7: provenance & rights ledger
-- Every generated asset records its lineage (model, prompt, seed, parent version)
-- and a C2PA-style signature; rights tracks licensing / commercial clearance /
-- talent consent. This is the trust layer behind "broadcast-cleared" delivery.
-- Additive, org-scoped, admin-facing (client-scoped read added when the review
-- badge is wired). Runs on throughline-dev (after 0002).
-- ============================================================================

begin;

create table if not exists public.asset_provenance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id),
  file_id uuid references public.files(id) on delete cascade,
  parent_asset_id uuid references public.asset_provenance(id) on delete set null,
  model text,                                      -- e.g. 'kling-1.5', 'runway-gen3'
  prompt text,
  seed text,
  params jsonb not null default '{}'::jsonb,
  signature text,                                  -- C2PA-style content signature
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists asset_provenance_org_idx    on public.asset_provenance(organization_id, created_at desc);
create index if not exists asset_provenance_file_idx   on public.asset_provenance(file_id);
create index if not exists asset_provenance_parent_idx on public.asset_provenance(parent_asset_id);

create table if not exists public.rights (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id),
  file_id uuid references public.files(id) on delete cascade,
  license text,                                    -- 'commercial' | 'editorial' | ...
  commercial_ok boolean not null default false,
  talent_consent boolean not null default false,
  expires_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists rights_org_idx  on public.rights(organization_id);
create index if not exists rights_file_idx on public.rights(file_id);

-- RLS: org admins/team manage provenance + rights for their org. Writes happen
-- server-side during generation/commit (service role). Client-scoped read (the
-- "broadcast-cleared" badge on their deliverables) is added when Review is wired.
alter table public.asset_provenance enable row level security;
alter table public.rights           enable row level security;

create policy asset_provenance_admin_all on public.asset_provenance for all to authenticated
  using (public.is_admin() and organization_id = public.current_org())
  with check (public.is_admin() and organization_id = public.current_org());
create policy rights_admin_all on public.rights for all to authenticated
  using (public.is_admin() and organization_id = public.current_org())
  with check (public.is_admin() and organization_id = public.current_org());

commit;
