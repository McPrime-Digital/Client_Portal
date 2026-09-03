-- ============================================================================
-- 0047_many_crew_rooms.sql — S3-d migration 6: drop the one-live-crew-room
-- index. Many crew rooms is the entire point (S3-d §4.2, §8 step 6).
--
-- 0027 §9.1 said it exactly: "when channels ship, dropping this index is the
-- whole migration." This is that migration. The client-room index stays —
-- exactly one primary room per client company remains correct.
--
-- lib/messageRooms.ensureCrewRoom loses its race-freedom guarantee with the
-- index gone; the paired code change re-points it at a named-room lookup
-- (name = 'General') so the org's default room stays get-or-create by name
-- while channels create freely beside it.
-- ============================================================================

drop index if exists public.message_rooms_one_live_crew_room;

-- Replacement: ONE live room named 'General' per org among crew rooms, so the
-- default-room helper keeps its race-free get-or-create without capping the
-- kind. Channels carry their own names and never collide with it.
create unique index if not exists message_rooms_one_live_crew_general
  on public.message_rooms (organization_id)
  where kind = 'crew' and name = 'General' and deleted_at is null;

-- VERIFY: select indexname from pg_indexes where tablename='message_rooms';
--   expect message_rooms_one_live_crew_general present, _one_live_crew_room gone
