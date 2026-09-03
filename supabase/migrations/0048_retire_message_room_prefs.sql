-- ============================================================================
-- 0048_retire_message_room_prefs.sql — S3-d migration 7: the per-room
-- notification level lives on the MEMBERSHIP row (room_members.notify);
-- message_room_prefs retires (S3-d §4.1, §8 step 7).
--
-- ── GATED ON DEPLOY — do not apply until the Batch 23 code is LIVE ──────────
-- The running deploy reads and writes message_room_prefs from two places:
-- RoomThread's settings panel (browser, user client) and pushMessageAlert
-- (lib/notify.ts, server). Dropping the table under them breaks both. Apply
-- ONLY after the deploy whose code reads room_members.notify — the 0036/0037
-- lesson: the migration was fine, the unpushed code was the outage.
--
-- Live row count at print time: 0 (probed 2026-09-03). The copy below is
-- therefore expected to move zero rows; it exists so this file is correct
-- even if a pref lands between print and apply.
-- ============================================================================

begin;

update public.room_members m
   set notify = p.level
  from public.message_room_prefs p
 where p.room_id = m.room_id
   and p.user_id = m.user_id
   and p.level in ('all', 'mentions', 'muted')
   and m.notify = 'all';  -- never overwrite an explicit new-model choice

drop table if exists public.message_room_prefs;

commit;

-- VERIFY: select to_regclass('public.message_room_prefs');  -- expect null
