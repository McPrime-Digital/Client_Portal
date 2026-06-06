-- ============================================================================
-- 0005_document_versions.sql — P1: Script Design version history
-- Named/auto snapshots of a document tab's content (block JSON), so a doc can be
-- previewed and restored to any earlier point. Scoped per tab (`tab_key` maps to
-- a Yjs fragment; the main tab is 'blocknote'). Restore replaces the live tab's
-- blocks. Internal/team-facing for now (admins), mirroring documents.
-- Runs on throughline-dev (after 0004).
-- ============================================================================

begin;

create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id),
  document_id uuid not null references public.documents(id) on delete cascade,
  tab_key text not null default 'blocknote',     -- which Yjs fragment / tab this snapshot is of
  label text,                                     -- optional name ("First cut", …)
  content jsonb not null,                         -- BlockNote block array snapshot
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists document_versions_doc_idx
  on public.document_versions(document_id, tab_key, created_at desc);

alter table public.document_versions enable row level security;
create policy document_versions_admin_all on public.document_versions for all to authenticated
  using (public.is_admin() and organization_id = public.current_org())
  with check (public.is_admin() and organization_id = public.current_org());

notify pgrst, 'reload schema';

commit;
