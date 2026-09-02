-- ─────────────────────────────────────────────────────────────────────────────
-- 0037 — S3-core migration 12: the destructive drops (Batch 21 item 4).
--
-- Drops the four columns the per-person model replaced:
--   read_at         → message_read_state (0031); the wire's read tick is
--                     derived from the other side's watermark
--   is_deleted      → deleted_at (0028) is the sole delete marker
--   sender_role     → the roster (organization_members / client_members)
--                     via sender_id; 0035 relaxed NOT NULL and recovered
--                     recoverable null senders first
--   attachment_url  → message_attachments (0032/0033) through the verified
--                     files row
--
-- ORDER (rule 6 — opposite of additive): the Batch 21.3 code DEPLOYS
-- FIRST and is verified live; only then does this file apply; then the
-- schema cache reloads. Applied against the pre-21.3 deploy this breaks
-- every send (its inserts name sender_role/attachment_url → 42703).
--
-- PRE-APPLY CHECK (HANDOFF §12 lesson 2 — a guard proves what it looks at;
-- the 0026 near-miss was a function BODY reading a dropped column while the
-- guard scanned pg_policies). Re-run ALL of these immediately before
-- applying; every one must return zero rows:
--
--   -- function bodies, every non-system schema
--   select n.nspname, p.proname from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname not in ('pg_catalog','information_schema')
--      and (p.prosrc ilike '%sender_role%' or p.prosrc ilike '%is_deleted%'
--           or p.prosrc ilike '%attachment_url%'
--           or (p.prosrc ilike '%read_at%'
--               and replace(p.prosrc,'last_read_at','') ilike '%read_at%'));
--   -- policies, every table
--   select tablename, policyname from pg_policies
--    where coalesce(qual,'') ilike any(array['%sender_role%','%is_deleted%','%attachment_url%','%read_at%'])
--       or coalesce(with_check,'') ilike any(array['%sender_role%','%is_deleted%','%attachment_url%','%read_at%']);
--   -- views + matviews
--   select viewname from pg_views where definition ilike any(array['%sender_role%','%is_deleted%','%attachment_url%','%read_at%'])
--   union all
--   select matviewname from pg_matviews where definition ilike any(array['%sender_role%','%is_deleted%','%attachment_url%','%read_at%']);
--   -- generated columns / defaults
--   select a.attname from pg_attrdef d
--     join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
--    where pg_get_expr(d.adbin, d.adrelid) ilike any(array['%sender_role%','%is_deleted%','%attachment_url%','%read_at%']);
--   -- triggers on messages (WHEN clauses)
--   select pg_get_triggerdef(oid) from pg_trigger
--    where tgrelid = 'public.messages'::regclass and not tgisinternal;
--
-- All six ran clean on 2026-09-02 (pre-authoring sweep). The only dependent
-- object is messages_sender_role_check, which drops with its column.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

alter table public.messages drop column if exists read_at;
alter table public.messages drop column if exists is_deleted;
alter table public.messages drop column if exists sender_role;
alter table public.messages drop column if exists attachment_url;

commit;

-- Reload the PostgREST schema cache in the same session.
notify pgrst, 'reload schema';

-- ── VERIFY (run after apply) ────────────────────────────────────────────────
-- 1) select column_name from information_schema.columns
--      where table_schema='public' and table_name='messages'
--        and column_name in ('read_at','is_deleted','sender_role','attachment_url');
--      expect: zero rows.
-- 2) messages_sender_role_check is gone:
--      select conname from pg_constraint
--       where conrelid='public.messages'::regclass and conname='messages_sender_role_check';
--      expect: zero rows.
-- 3) npm run seed:harness && npm run test:rls — 15/15, and the seeder's
--    upserts now stamp sender_id on its previously null-sender rows.
