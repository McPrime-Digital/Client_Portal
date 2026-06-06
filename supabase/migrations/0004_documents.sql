-- ============================================================================
-- 0004_documents.sql — P1: Script Design documents
-- Collaborative concept/script docs. `ydoc` holds the Yjs CRDT snapshot (base64);
-- live edits sync peer-to-peer over Supabase Realtime broadcast, this row is the
-- durable snapshot. Internal/team-facing for now (admins); client review later.
-- Runs on throughline-dev (after 0001).
-- ============================================================================

begin;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id),
  project_id uuid references public.projects(id) on delete cascade,
  kind text not null default 'script',          -- 'script' | 'concept' | ...
  title text not null default 'Untitled',
  ydoc text,                                     -- base64 Yjs snapshot
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists documents_org_idx     on public.documents(organization_id, kind, updated_at desc);
create index if not exists documents_project_idx on public.documents(project_id);

alter table public.documents enable row level security;
create policy documents_admin_all on public.documents for all to authenticated
  using (public.is_admin() and organization_id = public.current_org())
  with check (public.is_admin() and organization_id = public.current_org());

commit;
