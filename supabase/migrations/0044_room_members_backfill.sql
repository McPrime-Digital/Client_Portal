-- ============================================================================
-- 0044_room_members_backfill.sql — S3-d migration 2: every derivable
-- membership becomes a row, so the 0046 flip changes THE AUTHORITY, not
-- anyone's access (assertion 29).
--
-- Governing: S3-d §5.3 (the seeding rule), §8 step 2. Runs after 0043.
-- Forward-only, idempotent (ON CONFLICT DO NOTHING throughout — a re-run
-- inserts zero rows).
--
-- ── PRINTED PREDICTION (live query, 2026-09-03, before apply) ───────────────
--   crew rows   (active org members × their org's live rooms).... 11
--   client rows (active client members × their company's room).... 9
--   overlap (same room+user derivable both ways)................... 0
--   TOTAL room_members rows expected .............................. 20
-- The verification block at the bottom must report exactly these, and the
-- 0029 rule applies: a mismatch is a STOP, not a shrug.
--
-- ── ORDER: crew pass FIRST ──────────────────────────────────────────────────
-- S1 §2 allows one person in both trees. deriveWire classifies a both-trees
-- sender as studio-side, so the crew seat is the one that should win the
-- (room_id, user_id) conflict — seeded first, the client pass's ON CONFLICT
-- DO NOTHING yields to it. (Live overlap today is 0; the order is for the
-- day that stops being true.)
--
-- ── ROLE MAP ────────────────────────────────────────────────────────────────
-- crew  : owner→owner · admin→admin (role OR roles[]) · else member; can_post
-- client: owner→owner · approver→admin · member→member · viewer→viewer with
--         can_post=false — the one role whose ClientCap set has no 'message'
--         (lib/permissions.ts CLIENT_CAPS), stated here as a column fact.
-- history_from copies from the roster row — A-5's one-definition rule moves
-- WITH the authority: after 0046 the room row is the definition.
-- ============================================================================

begin;

-- ── Crew: every active org member into every live room of their org ─────────
insert into public.room_members
  (room_id, user_id, role, can_post, history_from, joined_at)
select
  r.id,
  m.user_id,
  case
    when m.role = 'owner' or m.roles && array['owner']::text[] then 'owner'
    when m.role = 'admin' or m.roles && array['admin']::text[] then 'admin'
    else 'member'
  end,
  true,
  m.history_from,
  now()
from public.message_rooms r
join public.organization_members m
  on m.organization_id = r.organization_id
where r.deleted_at is null
  and m.status = 'active'
  and m.user_id is not null
on conflict (room_id, user_id) do nothing;

-- ── Clients: every active company member into their company's room ──────────
insert into public.room_members
  (room_id, user_id, role, can_post, history_from, joined_at)
select
  r.id,
  m.user_id,
  case m.role
    when 'owner'    then 'owner'
    when 'approver' then 'admin'
    when 'viewer'   then 'viewer'
    else 'member'
  end,
  m.role <> 'viewer',
  m.history_from,
  now()
from public.message_rooms r
join public.client_members m
  on m.client_id = r.client_id
where r.deleted_at is null
  and r.kind = 'client'
  and m.status = 'active'
  and m.user_id is not null
on conflict (room_id, user_id) do nothing;

commit;

-- ── VERIFY (run after apply; expected values from the printed prediction) ───
-- select count(*) from public.room_members;                       -- expect 20
-- select count(*) from public.room_members where left_at is not null; -- 0
-- select count(*) from public.room_members m                      -- expect 0:
--   left join public.message_rooms r on r.id = m.room_id          -- every row
--  where r.id is null or r.deleted_at is not null;                -- a live room
-- -- Parity spot-probe (assertion 29's shape): every active client member of a
-- -- roomed company holds a membership:
-- select count(*) from public.client_members cm
--   join public.message_rooms r on r.client_id = cm.client_id and r.deleted_at is null
--  where cm.status = 'active' and cm.user_id is not null
--    and not exists (select 1 from public.room_members m
--                     where m.room_id = r.id and m.user_id = cm.user_id); -- 0
