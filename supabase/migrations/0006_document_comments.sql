-- ============================================================================
-- 0006_document_comments.sql — P1: Script Design comments + @mentions
-- Threaded comments per document tab (`tab_key` → Yjs fragment). Not anchored to
-- a text range yet (margin thread, like a review panel); @mentions are parsed
-- from the body into `mentions[]` for later notification wiring. Realtime via
-- Postgres changes (table added to the supabase_realtime publication).
-- Internal/team-facing for now (admins), mirroring documents.
-- Runs on throughline-dev (after 0005).
-- ============================================================================

begin;

create table if not exists public.document_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organizations(id),
  document_id uuid not null references public.documents(id) on delete cascade,
  tab_key text not null default 'blocknote',
  body text not null,
  author_id uuid,
  author_name text,
  mentions text[] not null default '{}',
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists document_comments_doc_idx
  on public.document_comments(document_id, tab_key, created_at);

alter table public.document_comments enable row level security;
create policy document_comments_admin_all on public.document_comments for all to authenticated
  using (public.is_admin() and organization_id = public.current_org())
  with check (public.is_admin() and organization_id = public.current_org());

-- live updates for the comments panel
do $$ begin
  alter publication supabase_realtime add table public.document_comments;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';

commit;
