-- ============================================================================
-- 0009_document_last_opened.sql — true "last opened" time for the docs home
-- `updated_at` tracks edits/saves (and gets bumped by the collab sync on open),
-- so it's wrong for "Opened …". `last_opened_at` is set explicitly when a doc is
-- opened, and the home sorts/labels by it. Covered by the existing documents RLS.
-- Runs on throughline-dev (after 0008).
-- ============================================================================

begin;

alter table public.documents add column if not exists last_opened_at timestamptz;

notify pgrst, 'reload schema';

commit;
