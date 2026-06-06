-- ============================================================================
-- 0001_multitenancy.sql — F2: multi-tenancy foundation
-- Adds the organizations table, organization_id to every tenant table, a default
-- org ("McPrime"), and current_org(). Runs on top of 0000_baseline against
-- throughline-dev.
--
-- DELIBERATELY SCOPED: existing-table RLS is UNCHANGED here. The org-aware
-- predicate (organization_id = current_org()) is a no-op in single-tenant and is
-- switched on — as pure policy edits, no data migration — when the SaaS flag goes
-- live. This migration lands only the irreversible column-from-birth + scaffolding.
--
-- Default org uses a fixed sentinel id so column DEFAULTs can reference it:
--   00000000-0000-0000-0000-000000000001  ("McPrime")
-- ============================================================================

begin;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subdomain text unique,
  logo_url text,
  branding jsonb not null default '{}'::jsonb,
  plan text not null default 'agency',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- default org (sentinel id; "McPrime" while single-tenant)
insert into public.organizations (id, name)
values ('00000000-0000-0000-0000-000000000001', 'McPrime')
on conflict (id) do nothing;

-- the caller's org, from tamper-proof app_metadata (consumed by org-aware RLS later)
create or replace function public.current_org()
returns uuid language sql stable set search_path = ''
as $$ select nullif(auth.jwt() -> 'app_metadata' ->> 'organization_id', '')::uuid $$;

-- organization_id on every tenant table (DEFAULT = McPrime so existing + new rows are stamped)
alter table public.activity_log       add column if not exists organization_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id);
alter table public.business_settings  add column if not exists organization_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id);
alter table public.clients            add column if not exists organization_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id);
alter table public.files              add column if not exists organization_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id);
alter table public.invoices           add column if not exists organization_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id);
alter table public.messages           add column if not exists organization_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id);
alter table public.notifications      add column if not exists organization_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id);
alter table public.project_phases     add column if not exists organization_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id);
alter table public.projects           add column if not exists organization_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id);
alter table public.push_subscriptions add column if not exists organization_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id);
alter table public.tasks              add column if not exists organization_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id);

-- indexes for tenant-scoped queries
create index if not exists activity_log_org_idx       on public.activity_log(organization_id);
create index if not exists business_settings_org_idx  on public.business_settings(organization_id);
create index if not exists clients_org_idx            on public.clients(organization_id);
create index if not exists files_org_idx              on public.files(organization_id);
create index if not exists invoices_org_idx           on public.invoices(organization_id);
create index if not exists messages_org_idx           on public.messages(organization_id);
create index if not exists notifications_org_idx      on public.notifications(organization_id);
create index if not exists project_phases_org_idx     on public.project_phases(organization_id);
create index if not exists projects_org_idx           on public.projects(organization_id);
create index if not exists push_subscriptions_org_idx on public.push_subscriptions(organization_id);
create index if not exists tasks_org_idx              on public.tasks(organization_id);

-- RLS on the organizations table itself (members read their org; org-admins manage it)
alter table public.organizations enable row level security;
drop policy if exists org_select_own on public.organizations;
create policy org_select_own on public.organizations for select to authenticated
  using (id = public.current_org());
drop policy if exists org_admin_manage on public.organizations;
create policy org_admin_manage on public.organizations for all to authenticated
  using (public.is_admin() and id = public.current_org())
  with check (public.is_admin() and id = public.current_org());

commit;
