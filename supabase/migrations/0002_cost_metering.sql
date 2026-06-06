-- ============================================================================
-- 0002_cost_metering.sql — F6: cost / credit metering substrate (Control Tower base)
-- Every metered action (AI generation, transcode, LiveKit minute, remaster) writes a
-- usage_event at the worker boundary; Control Tower aggregates them live. Org budgets
-- gate expensive runs; org_credits backs usage-based billing later.
-- Additive, org-scoped, policy-complete. Runs on throughline-dev (after 0001).
-- ============================================================================

begin;

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id),
  kind text not null,                              -- 'generation' | 'transcode' | 'livekit' | 'remaster' | ...
  units numeric not null default 0,                -- seconds / tokens / count, by kind
  cost_cents integer not null default 0,
  ref jsonb not null default '{}'::jsonb,           -- { model, project_id, asset_id, run_id, ... }
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists usage_events_org_idx  on public.usage_events(organization_id, created_at desc);
create index if not exists usage_events_kind_idx on public.usage_events(organization_id, kind, created_at desc);

create table if not exists public.org_budgets (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  monthly_cap_cents integer,                       -- null = uncapped
  alert_pct integer not null default 80,
  hard_stop boolean not null default false,        -- block runs once the cap is hit
  updated_at timestamptz not null default now()
);

create table if not exists public.org_credits (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  balance_cents integer not null default 0,
  updated_at timestamptz not null default now()
);

-- seed the default org so Control Tower has rows to read
insert into public.org_budgets (organization_id) values ('00000000-0000-0000-0000-000000000001') on conflict do nothing;
insert into public.org_credits (organization_id) values ('00000000-0000-0000-0000-000000000001') on conflict do nothing;

-- RLS: org admins read/manage their org's metering. Writes to usage_events are
-- service-role only (metered at the worker boundary) → no insert policy for authenticated.
alter table public.usage_events enable row level security;
alter table public.org_budgets  enable row level security;
alter table public.org_credits  enable row level security;

create policy usage_events_admin_read on public.usage_events for select to authenticated
  using (public.is_admin() and organization_id = public.current_org());
create policy org_budgets_admin_all on public.org_budgets for all to authenticated
  using (public.is_admin() and organization_id = public.current_org())
  with check (public.is_admin() and organization_id = public.current_org());
create policy org_credits_admin_read on public.org_credits for select to authenticated
  using (public.is_admin() and organization_id = public.current_org());

commit;
