-- ============================================================================
-- 0028_messages_room_columns.sql — Batch 13 item 2: the additive half of the
-- message-room move.
--
-- Governing: S3-core §1.3 as amended by S3-core-A — A-1 (edited_at ALREADY
-- EXISTS in 0000 and is written by portal/messages/edit; it is NOT added
-- here), A-2 (deleted_at + the two-row backfill), A-6 part 1 (sender_role
-- CHECK widened for crew rooms). Runs after 0027. Forward-only, idempotent
-- (I-12).
--
-- ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
--   · read_at is UNTOUCHED. It is dropped in S3-core migration 12, after the
--     message_read_state watermark backfill is verified. Leaving it means
--     every deployed read path keeps working through the transition.
--   · is_deleted is UNTOUCHED for the same reason — both it and deleted_at
--     are written until migration 12 retires the boolean (A-2).
--   · The thread CHECK and the tag-inheritance trigger land in migration 4
--     (Batch 13 item 6) — both assume room_id is populated, and here it is
--     nullable and empty.
--   · thread_root_id's backfill from the seven live reply_to_id chains (A-3)
--     is DATA, so it rides in 0029 with the room repoint.
--   · The keyset index (§1.7) lands with the NOT NULL in migration 4.
--
-- ── DEPLOY ORDER ────────────────────────────────────────────────────────────
-- ADDITIVE TABLE-SHAPE CHANGE. Apply AFTER 0027 and BEFORE deploying the
-- Batch 13 item-5 code (which writes room_id and deleted_at — deployed first
-- it fails every send with 42703). Reload the PostgREST schema cache after
-- applying, or the new columns are invisible to the API.
-- ============================================================================

-- The room the message lives in. Nullable NOW so existing rows stay legal;
-- migration 4 (0030) sets NOT NULL after 0029 backfills. CASCADE completes
-- the chain documented in 0027: clients → message_rooms → messages.
alter table public.messages
  add column if not exists room_id uuid references public.message_rooms(id) on delete cascade;

-- The root of the thread this message replies into. Null = a root message.
-- reply_to_id STAYS and means something else — the specific message being
-- quoted (A-3). SET NULL: if a root is ever hard-deleted (purge), its
-- replies become roots rather than dangling.
alter table public.messages
  add column if not exists thread_root_id uuid references public.messages(id) on delete set null;

-- §1.3: full-text over the body. STORED because the table is small (190
-- rows at print time) and reads dominate writes; 'english' is the config
-- the product's UI language justifies today.
alter table public.messages
  add column if not exists body_tsv tsvector
  generated always as (to_tsvector('english'::regconfig, coalesce(body, ''))) stored;

create index if not exists messages_body_tsv_gin
  on public.messages using gin (body_tsv);

-- §4.1 soft delete, per A-2. NOT edited_at — it exists since 0000 (A-1).
alter table public.messages
  add column if not exists deleted_at timestamptz;

-- A-2 backfill: the rows soft-deleted under the boolean regime get a
-- timestamp so the §4.2 purge has something to key on. Their bodies were
-- blanked at delete time by the old route and CANNOT be recovered — the
-- timestamp is created_at because the true deletion time was never recorded.
-- Two rows at print time; the predicate makes it any-N and re-runnable.
update public.messages
   set deleted_at = created_at
 where is_deleted = true
   and deleted_at is null;

-- A-6 part 1: sender_role was CHECK-constrained to admin|client (0000:259),
-- which no crew-room message can satisfy. Widened, not dropped — the column
-- itself is marked for retirement in migration 12 (it is a denormalised
-- roster fact), but until message_read_state replaces the role-watermark
-- unread model, every deployed count still reads it.
alter table public.messages drop constraint if exists messages_sender_role_check;
alter table public.messages add constraint messages_sender_role_check
  check (sender_role = any (array['admin'::text, 'client'::text, 'crew'::text, 'collaborator'::text]));

-- ── VERIFY (run after apply) ────────────────────────────────────────────────
-- 1) Columns exist:
--      select column_name from information_schema.columns
--       where table_schema = 'public' and table_name = 'messages'
--         and column_name in ('room_id','thread_root_id','body_tsv','deleted_at');
--      -- expect 4 rows
-- 2) The boolean-era rows carry a timestamp:
--      select count(*) from public.messages
--       where is_deleted = true and deleted_at is null;   -- expect 0
-- 3) Search works:
--      select count(*) from public.messages
--       where body_tsv @@ plainto_tsquery('english', 'approval');
-- 4) The widened CHECK took:
--      select pg_get_constraintdef(oid) from pg_constraint
--       where conname = 'messages_sender_role_check';
