-- ============================================================================
-- 0008_document_preview.sql — first-page snapshot for the docs-home thumbnails
-- `preview` holds a short plain-text snapshot of the main tab's first page,
-- written on autosave, so the Google-Docs-style home can render page thumbnails
-- instantly without decoding each Yjs doc. Covered by the existing documents RLS.
-- Runs on throughline-dev (after 0007).
-- ============================================================================

begin;

alter table public.documents add column if not exists preview text;

-- live docs-home: reflect new docs / title / preview changes instantly
do $$ begin
  alter publication supabase_realtime add table public.documents;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';

commit;
