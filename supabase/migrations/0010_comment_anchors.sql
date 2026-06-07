-- ============================================================================
-- 0010_comment_anchors.sql — P1: anchored comments
-- A comment can now be tied to a specific text range via `anchor_id`, which
-- matches a custom `comment` inline style applied to the highlighted text in the
-- doc (Google-Docs style). Comments with no anchor remain general (tab-level).
-- Runs on throughline-dev (after 0009).
-- ============================================================================

begin;

alter table public.document_comments add column if not exists anchor_id text;

notify pgrst, 'reload schema';

commit;
