-- ============================================================================
-- 0045_message_rooms_expand.sql — S3-d migration 3: the room table learns to
-- describe many kinds of room without any of them deciding access (MD-3).
--
-- Governing: S3-d §4.2, §4.3, §10 q4 (the trigger lands WITH the column).
-- Runs after 0044. Forward-only, idempotent. ADDITIVE against the running
-- deploy: every new column is nullable or defaulted, the widened CHECK
-- accepts every existing row, and no policy moves here (0046 owns the flip).
--
-- ── WHAT kind MEANS FROM HERE ON ────────────────────────────────────────────
-- kind affects how a room is NAMED and PRESENTED — nothing else. It never
-- appears in an access predicate (MD-3; Slack's C/G-prefix lesson, S3-d §2).
-- 'broadcast' exists as a PRESENTATION kind (an announcements surface); the
-- write restriction it implies is carried per-member by
-- room_members.can_post (MD-5), never by a policy branching on kind.
--
-- ── THE DM KEY ──────────────────────────────────────────────────────────────
-- A DM is a room with exactly two members (S3-d §4.3) and must be UNIQUE per
-- pair. Membership rows cannot express that constraint, so the pair is
-- denormalised into dm_key = least(uidA,uidB)||':'||greatest(uidA,uidB) and
-- a partial unique index makes find-or-create race-free — the same shape,
-- for the same reason, as message_rooms_one_live_client_room (0027).
-- ============================================================================

begin;

-- ── 1. Columns ──────────────────────────────────────────────────────────────
alter table public.message_rooms add column if not exists topic           text;
alter table public.message_rooms add column if not exists is_private      boolean not null default true;
alter table public.message_rooms add column if not exists archived_at     timestamptz;
alter table public.message_rooms add column if not exists last_message_at timestamptz;
-- Optional binding for project channels — presentation and navigation only,
-- never consulted for access (MD-3 applies to it exactly as to kind).
alter table public.message_rooms add column if not exists project_id      uuid references public.projects(id) on delete set null;
alter table public.message_rooms add column if not exists dm_key          text;

-- ── 2. kind widens; the subject rule stops encoding two cases as the only
--       cases (S3-d §1.1 item 3) ────────────────────────────────────────────
alter table public.message_rooms drop constraint if exists message_rooms_kind_check;
alter table public.message_rooms add constraint message_rooms_kind_check
  check (kind in ('client', 'crew', 'channel', 'group', 'dm', 'broadcast'));

alter table public.message_rooms drop constraint if exists message_rooms_kind_subject_check;
alter table public.message_rooms add constraint message_rooms_kind_subject_check
  check (
    (kind = 'client' and client_id is not null)
    or (kind = 'crew' and client_id is null)
    -- channel/group/dm/broadcast: client_id is an OPTIONAL counterparty tag,
    -- same role it plays on approvals (S3-d §4.2).
    or kind in ('channel', 'group', 'dm', 'broadcast')
  );

-- dm_key exists exactly on DMs.
alter table public.message_rooms drop constraint if exists message_rooms_dm_key_check;
alter table public.message_rooms add constraint message_rooms_dm_key_check
  check ((kind = 'dm') = (dm_key is not null));

create unique index if not exists message_rooms_one_live_dm
  on public.message_rooms (organization_id, dm_key)
  where kind = 'dm' and deleted_at is null;

-- ── 3. The crew General room becomes discoverable ───────────────────────────
-- Every crew member is seeded into it anyway (0044); is_private=false is what
-- lets 0046's discovery clause list it to crew who somehow lack a row, and is
-- the honest description of an all-hands room. Client rooms stay private:
-- their membership is the company roster, not a directory.
update public.message_rooms set is_private = false where kind = 'crew';

-- ── 4. last_message_at: backfilled, then maintained by trigger ──────────────
-- The trigger ships in the SAME migration as the column (S3-d §10 q4) —
-- a denormalised column without its maintainer is drift with a start date.
update public.message_rooms r
   set last_message_at = sub.newest
  from (select room_id, max(created_at) as newest
          from public.messages group by room_id) sub
 where sub.room_id = r.id
   and (r.last_message_at is null or r.last_message_at < sub.newest);

create or replace function public.stamp_room_last_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.message_rooms
     set last_message_at = new.created_at
   where id = new.room_id
     and (last_message_at is null or last_message_at < new.created_at);
  return new;
end;
$$;

drop trigger if exists messages_stamp_room_last_message on public.messages;
create trigger messages_stamp_room_last_message
  after insert on public.messages
  for each row
  execute function public.stamp_room_last_message();

-- Room-list ordering at scale (S3-d §10 q4): newest-active-first per org.
create index if not exists message_rooms_org_last_msg_idx
  on public.message_rooms (organization_id, last_message_at desc nulls last)
  where deleted_at is null;

commit;

-- ── VERIFY (run after apply) ────────────────────────────────────────────────
-- 1) select column_name from information_schema.columns
--     where table_name='message_rooms' and column_name in
--     ('topic','is_private','archived_at','last_message_at','project_id','dm_key');
--    -- expect all six
-- 2) select kind, is_private, count(*) from public.message_rooms
--     where deleted_at is null group by 1,2;
--    -- expect client/true/7 and crew/false/1
-- 3) select count(*) from public.message_rooms r
--     where deleted_at is null and last_message_at is null
--       and exists (select 1 from public.messages m where m.room_id = r.id);
--    -- expect 0 (every room with messages got its stamp)
-- 4) insert a probe message and confirm the room's last_message_at moves
--    (covered by harness assertion runs; no manual probe required here)
