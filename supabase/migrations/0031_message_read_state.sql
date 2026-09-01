-- ============================================================================
-- 0031_message_read_state.sql — Batch 14 item 1: the per-user read watermark.
-- (S3-core migration 5.)
--
-- Governing: S3-core §1.4, S3-core-A A-7 (the defect this replaces: every
-- unread count is `read_at IS NULL AND sender_role = <other side>`, so one
-- teammate opening a thread marks it read for their whole company). Runs
-- after 0030. Forward-only, idempotent (I-12).
--
-- ── DEPLOY ORDER ────────────────────────────────────────────────────────────
-- ADDITIVE. Apply before deploying the Batch 14 item-3 code (which reads and
-- writes this table). read_at is still written by that code — it drops in
-- S3-core migration 12 — so Batch 13's deploy and Batch 14's are
-- independently revertable.
--
-- ── THE BACKFILL MAPPING, stated because it is lossy ────────────────────────
-- read_at is per-thread-per-role; the watermark is per-room-per-user. They do
-- not map cleanly. The translation: for each member of each room, the
-- watermark is the newest message on the OTHER side that their side marked
-- read. Where nothing was read, NO row — an absent row means everything is
-- unread, which errs older (a member sees too many unread, never too few).
-- Expected from the live pre-count (2026-09-01): 4 client-side rows +
-- 3 org-side rows = 7. Getting this wrong makes badges wrong, not data lost.
-- ============================================================================

create table if not exists public.message_read_state (
  room_id              uuid not null references public.message_rooms(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  last_read_message_id uuid references public.messages(id) on delete set null,
  last_read_at         timestamptz not null,
  primary key (room_id, user_id)
);

create index if not exists message_read_state_user_idx
  on public.message_read_state (user_id);

-- ── RLS — Class C: yours and only yours, ADMINS INCLUDED ───────────────────
-- A watermark says when a person opened a room. Letting anyone else read it
-- is a surveillance surface nobody asked for (S3-core §7 assertion 8).
alter table public.message_read_state enable row level security;

drop policy if exists message_read_state_self on public.message_read_state;
create policy message_read_state_self on public.message_read_state
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Client side: for each active member of each company room, the newest
-- admin-sent message their side marked read. (Their own sent messages never
-- count as unread anyway — unread excludes sender_id = viewer.)
insert into public.message_read_state (room_id, user_id, last_read_message_id, last_read_at)
select r.id, cm.user_id, m.id, m.created_at
  from public.message_rooms r
  join public.clients c on c.id = r.client_id
  join public.client_members cm
    on cm.client_id = c.id and cm.status = 'active' and cm.user_id is not null
  join lateral (
    select id, created_at from public.messages
     where room_id = r.id and sender_role = 'admin' and read_at is not null
     order by created_at desc limit 1
  ) m on true
 where r.kind = 'client' and r.deleted_at is null
on conflict (room_id, user_id) do nothing;

-- Org side: for each active org member, per room of their org, the newest
-- client-sent message the studio side marked read.
insert into public.message_read_state (room_id, user_id, last_read_message_id, last_read_at)
select r.id, om.user_id, m.id, m.created_at
  from public.message_rooms r
  join public.organization_members om
    on om.organization_id = r.organization_id and om.status = 'active' and om.user_id is not null
  join lateral (
    select id, created_at from public.messages
     where room_id = r.id and sender_role = 'client' and read_at is not null
     order by created_at desc limit 1
  ) m on true
 where r.deleted_at is null
on conflict (room_id, user_id) do nothing;

-- ── VERIFY (run after apply) ────────────────────────────────────────────────
-- 1) Row count matches the pre-count (7 at print time; re-run the pre-count
--    if messages were read between print and apply):
--      select count(*) from public.message_read_state;
-- 2) No watermark points at a message outside its own room:
--      select count(*) from public.message_read_state s          -- expect 0
--        join public.messages m on m.id = s.last_read_message_id
--       where m.room_id is distinct from s.room_id;
-- 3) RLS is on, one policy:
--      select policyname from pg_policies
--       where schemaname='public' and tablename='message_read_state';
