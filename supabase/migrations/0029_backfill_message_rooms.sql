-- ============================================================================
-- 0029_backfill_message_rooms.sql — Batch 13 item 4: THE BACKFILL. The single
-- riskiest step in the S3 sequence — structure changes are revertable, a
-- botched backfill is not.
--
-- Governing: S3-core §1.2 (backfill), §6 migration 3; S3-core-A A-3 (the
-- thread_root_id walk), A-9 (the verified starting state this was printed
-- against). Runs after 0028. Forward-only, idempotent (I-12).
--
-- ── DEPLOY ORDER — THIS FILE'S APPLY IS GATED TWICE ─────────────────────────
--   1. 0027 and 0028 must be APPLIED (structure first).
--   2. The Batch 13 item-5 code must be DEPLOYED (sends write room_id) —
--      otherwise every message sent between this apply and that deploy has a
--      null room_id and migration 4's NOT NULL fails.
--   3. Per the batch brief, the item-4 counts must be APPROVED before this
--      touches production data. Printed 2026-09-01; not applied.
--
-- ── EXPECTATION, from the live read of 2026-09-01 (S3-core-A A-9) ───────────
-- The system is live, so RE-RUN the pre-count below at apply time and compare
-- the SHAPE (zeros stay zero); exact message counts may have grown.
--
--   total messages ..................... 190   (178 house org, 12 harness)
--   null project_id .................... 0
--   unresolvable (dead project/client) . 0
--   msg org ≠ project org .............. 0
--   distinct companies with messages ... 7  →  client rooms created: 7
--       DJ BOND 98 · McPrime Original Films 71 · ZZ-HARNESS Co One 8 ·
--       CHRISEL H&D 6 · ZZ-HARNESS Co Two 4 · AG SOFTWARE 2 · PKB 1
--   crew rooms created ................. 0   (no unresolvable messages)
--   messages repointed ................. 190 (every one keeps project_id as tag)
--   reply_to_id chains walked (A-3) .... 7 rows get thread_root_id
--
-- ── PRE-COUNT (run BEFORE applying; refresh the expectation) ────────────────
--   select
--     count(*)                                              as total,
--     count(*) filter (where project_id is null)            as null_project,
--     count(*) filter (where room_id is not null)           as already_roomed,
--     count(*) filter (where reply_to_id is not null
--                        and thread_root_id is null)        as chains_to_walk
--   from public.messages;
--
--   select c.company, c.organization_id, count(*)
--     from public.messages m
--     join public.projects p on p.id = m.project_id
--     join public.clients  c on c.id = p.client_id
--    where m.room_id is null
--    group by 1, 2 order by 3 desc;
--
-- ── RE-RUNNABILITY ──────────────────────────────────────────────────────────
-- Every write is predicated on its target being unset: rooms insert with
-- ON CONFLICT DO NOTHING against 0027's partial unique indexes; the two
-- repoints and the thread walk touch only rows where the column IS NULL.
-- room_id is set once and never changed here, so a second run is a no-op and
-- no message can move twice. Messages sent through the item-5 code arrive
-- with room_id already set and are untouched.
-- ============================================================================

begin;

-- ── 0. A-3 guard: refuse to walk a cycle or an over-deep chain ─────────────
-- "The walk must be bounded — if a cycle exists in the data, report it
-- rather than looping." A row surviving to the depth bound aborts the whole
-- transaction, loudly, before anything is written.
do $$
declare bad int;
begin
  with recursive walk as (
    select m.id as msg_id, m.reply_to_id as cursor_id, 0 as depth,
           array[m.id] as seen
      from public.messages m
     where m.reply_to_id is not null
       and m.thread_root_id is null
    union all
    select w.msg_id, p.reply_to_id, w.depth + 1, w.seen || w.cursor_id
      from walk w
      join public.messages p on p.id = w.cursor_id
     where p.reply_to_id is not null
       and w.depth < 50
       and not (w.cursor_id = any (w.seen))
  )
  select count(*) into bad from walk where depth >= 49;
  if bad > 0 then
    raise exception
      'reply_to_id cycle or >49-deep chain: % walk rows hit the bound. Report it; do not backfill.', bad;
  end if;
end $$;

-- ── 1. One room per distinct client company that has messages ──────────────
-- Org comes from the CLIENT row (its company's tenant). A-9: message org,
-- project org and client org agree on every live row; step 2's join makes
-- that an enforced condition rather than an assumption.
insert into public.message_rooms (organization_id, kind, client_id)
select distinct c.organization_id, 'client', c.id
  from public.messages m
  join public.projects p on p.id = m.project_id
  join public.clients  c on c.id = p.client_id
 where m.room_id is null
on conflict (organization_id, client_id) where kind = 'client' and deleted_at is null
do nothing;

-- ── 2. Repoint every resolvable message to its company's room ──────────────
-- project_id is NOT written: the message keeps it as its tag (§1.1).
-- The r.organization_id = m.organization_id clause means a message whose org
-- disagreed with its company's org would stay NULL and fail verification
-- loudly, rather than silently crossing a tenant boundary. Expected to move
-- every message (190 at print time).
update public.messages m
   set room_id = r.id
  from public.projects p
  join public.clients  c on c.id = p.client_id
  join public.message_rooms r
    on r.client_id = c.id
   and r.kind = 'client'
   and r.deleted_at is null
 where p.id = m.project_id
   and r.organization_id = m.organization_id
   and m.room_id is null;

-- ── 3. Unresolvable messages land in their org's crew room ─────────────────
-- Expected to create NOTHING and move NOTHING (A-9: zero unresolvable rows).
-- Both statements are guarded so they stay correct if a row appears between
-- the pre-count and the apply. The NOT EXISTS repeats the resolvability
-- predicate inverted: a message that resolves but was skipped by step 2 for
-- an org mismatch is NOT swept into crew — it stays NULL for verification
-- to catch.
insert into public.message_rooms (organization_id, kind, name)
select distinct m.organization_id, 'crew', 'General'
  from public.messages m
 where m.room_id is null
   and not exists (
     select 1
       from public.projects p
       join public.clients c on c.id = p.client_id
      where p.id = m.project_id
   )
on conflict (organization_id) where kind = 'crew' and deleted_at is null
do nothing;

update public.messages m
   set room_id = r.id
  from public.message_rooms r
 where r.kind = 'crew'
   and r.deleted_at is null
   and r.organization_id = m.organization_id
   and m.room_id is null
   and not exists (
     select 1
       from public.projects p
       join public.clients c on c.id = p.client_id
      where p.id = m.project_id
   );

-- ── 4. A-3: thread_root_id from the existing reply_to_id chains ────────────
-- reply_to_id stays untouched — it means "the message being quoted";
-- thread_root_id means "the root of this thread". Seven rows at print time.
-- Dangling parents cannot occur: the reply_to_id FK is ON DELETE SET NULL,
-- so a deleted parent nulls the pointer rather than leaving it hanging.
with recursive walk as (
  select m.id as msg_id, m.reply_to_id as cursor_id, 0 as depth,
         array[m.id] as seen
    from public.messages m
   where m.reply_to_id is not null
     and m.thread_root_id is null
  union all
  select w.msg_id, p.reply_to_id, w.depth + 1, w.seen || w.cursor_id
    from walk w
    join public.messages p on p.id = w.cursor_id
   where p.reply_to_id is not null
     and w.depth < 50
     and not (w.cursor_id = any (w.seen))
),
roots as (
  -- the deepest row's cursor is the chain's root (its own reply_to_id is null)
  select distinct on (msg_id) msg_id, cursor_id as root_id
    from walk
   order by msg_id, depth desc
)
update public.messages m
   set thread_root_id = r.root_id
  from roots r
 where m.id = r.msg_id
   and m.thread_root_id is null;

commit;

-- ── VERIFY (run after apply; every "expect 0" is a hard stop if not) ────────
-- V1  every message has a room:
--       select count(*) from public.messages where room_id is null;  -- expect 0
-- V2  no message changed org:
--       select count(*) from public.messages m
--         join public.message_rooms r on r.id = m.room_id
--        where r.organization_id is distinct from m.organization_id; -- expect 0
-- V3  rooms created (print-time expectation: client 7, crew 0):
--       select kind, count(*) from public.message_rooms
--        where deleted_at is null group by 1;
-- V4  the per-room distribution matches the pre-count per-company table:
--       select c.company, count(*) from public.messages m
--         join public.message_rooms r on r.id = m.room_id
--         join public.clients c on c.id = r.client_id
--        group by 1 order by 2 desc;
-- V5  tags untouched — same null_project count as the pre-count (0 at print):
--       select count(*) from public.messages where project_id is null;
-- V6  threads: chains_to_walk rows now carry a root, and every root is a root:
--       select count(*) from public.messages where thread_root_id is not null;
--       select count(*) from public.messages m                       -- expect 0
--         join public.messages r on r.id = m.thread_root_id
--        where r.thread_root_id is not null;
