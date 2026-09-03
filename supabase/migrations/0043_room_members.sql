-- ============================================================================
-- 0043_room_members.sql — S3-d migration 1: membership becomes a ROW (MD-1).
--
-- Governing: S3-d §3 (MD-1..MD-5), §4.1 (this table), §5.1 (the helper).
-- Sequenced after 0042. Forward-only, idempotent (I-12). ADDITIVE — nothing
-- deployed reads this table until the S3-d code ships, and the message
-- policies do not move until 0046 (the flip), so this file is safe against
-- the running deploy.
--
-- ── WHY A ROW ────────────────────────────────────────────────────────────────
-- Access today is DERIVED: is_client_member(room.client_id) says "everyone in
-- the company reads the company's room". A group — these six people and not
-- the rest — is inexpressible in that model, and deriving membership is the
-- O(n) permission computation that broke the systems this design was
-- researched against (S3-d §2). From 0046 onward, room_members is the single
-- authority on who may read a room; company and crew membership become
-- SEEDING rules (how rows get created), never the access rule itself.
--
-- ── WRITE POLICIES LIVE IN 0046, DELIBERATELY ───────────────────────────────
-- The self-join and creator-seat policies reference message_rooms.is_private
-- and room creation flows that 0045/0046 introduce. Until the flip, every
-- writer is server-side (service role, BYPASSRLS): the 0044 backfill and the
-- seeding hooks. What lands here is the table, the read policies, the
-- self-service policy, and the helpers every later policy calls.
-- ============================================================================

begin;

create table if not exists public.room_members (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.message_rooms(id) on delete cascade,
  -- ON DELETE CASCADE here is AD-003-consistent: erasure deletes the auth
  -- user LAST (lib/erasure.ts), and a membership row is a fact about access,
  -- not authored work — unlike messages, whose sender_id is SET NULL.
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member'
               constraint room_members_role_check
               check (role in ('owner', 'admin', 'member', 'viewer')),
  -- MD-5: broadcast is a MEMBERSHIP property, not a room type. An
  -- announcements channel is a room where most members carry can_post=false;
  -- the INSERT policy stays singular because of this column.
  can_post     boolean not null default true,
  joined_at    timestamptz not null default now(),
  added_by     uuid references auth.users(id) on delete set null, -- AD-003
  -- Soft, so history keeps its author (assertion 25): a person who left
  -- reads nothing new, and their historical messages still render.
  left_at      timestamptz,
  -- What they may read back to. Moves here from the per-tenant roster
  -- columns: joining a room mid-project should not hand someone eight months
  -- of backlog, and that decision is per-person-PER-ROOM (S3-d §4.1).
  history_from timestamptz,
  -- Per-room notification level. Retires message_room_prefs (S3-d §8 step 7).
  notify       text not null default 'all'
               constraint room_members_notify_check
               check (notify in ('all', 'mentions', 'muted')),
  constraint room_members_room_user_key unique (room_id, user_id)
);

create index if not exists room_members_user_live_idx
  on public.room_members (user_id) where left_at is null;
create index if not exists room_members_room_live_idx
  on public.room_members (room_id) where left_at is null;

-- ── Helpers — the S3-d §5.1 quartet, in the 0020 house style ────────────────
-- SECURITY DEFINER: the function owner's read bypasses the table's own RLS,
-- which is what breaks the recursion of room_members policies that ask about
-- room membership. Same pattern as is_org_member()/is_client_member().

create or replace function public.is_room_member(rid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_members m
     where m.room_id = rid
       and m.user_id = auth.uid()
       and m.left_at is null
  )
$$;

-- Room management: the room's own owner/admin seats. Org-level oversight is
-- granted where 0046's policies decide, not silently here.
create or replace function public.is_room_manager(rid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_members m
     where m.room_id = rid
       and m.user_id = auth.uid()
       and m.left_at is null
       and m.role in ('owner', 'admin')
  )
$$;

-- MD-5's read of the column. False for non-members, so INSERT policies may
-- call it alone without restating membership.
create or replace function public.room_can_post(rid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select m.can_post and m.role <> 'viewer'
       from public.room_members m
      where m.room_id = rid
        and m.user_id = auth.uid()
        and m.left_at is null),
    false)
$$;

-- The caller's own history cutoff for a room; null = no cutoff. Mirrors
-- member_history_from() one level down — per-person-per-room (S3-d §4.1).
create or replace function public.room_history_from(rid uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select m.history_from
    from public.room_members m
   where m.room_id = rid
     and m.user_id = auth.uid()
     and m.left_at is null
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.room_members enable row level security;

-- MD-4's visibility rule, verbatim: you can see someone iff you share a room
-- with them. A member reads the room's roster; everyone always reads their
-- own rows (left ones included — "what am I still in" is their question).
drop policy if exists room_members_member_read on public.room_members;
create policy room_members_member_read on public.room_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_room_member(room_id))
  );

-- Self-service: your own notify level, and leaving (stamping your own
-- left_at). The 0043 trigger below is what CONFINES this policy to those two
-- writes — RLS is row-level, and role/can_post/history_from must not be
-- self-served.
drop policy if exists room_members_self_update on public.room_members;
create policy room_members_self_update on public.room_members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ── The column guard the self policy needs ─────────────────────────────────
-- A member may change their notify level and may LEAVE (left_at null → set).
-- They may not promote themselves, grant themselves posting rights, clear
-- their history cutoff, or rejoin by nulling left_at. Managers (0046 policy)
-- and the service role pass untouched.
create or replace function public.guard_room_member_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new; -- service role / server-side paths
  end if;
  if new.user_id = auth.uid() and not public.is_room_manager(new.room_id) then
    if new.role is distinct from old.role
       or new.can_post is distinct from old.can_post
       or new.history_from is distinct from old.history_from
       or new.room_id is distinct from old.room_id
       or new.user_id is distinct from old.user_id
       or (old.left_at is not null and new.left_at is distinct from old.left_at)
    then
      raise exception 'members may change only their notification level or leave';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists room_members_guard_self_update on public.room_members;
create trigger room_members_guard_self_update
  before update on public.room_members
  for each row
  execute function public.guard_room_member_self_update();

commit;

-- ── VERIFY (run after apply) ────────────────────────────────────────────────
-- 1) select count(*) from public.room_members;                    -- expect 0
-- 2) select proname from pg_proc where proname in
--      ('is_room_member','is_room_manager','room_can_post','room_history_from');
--    -- expect all four
-- 3) select policyname from pg_policies where tablename='room_members';
--    -- expect room_members_member_read, room_members_self_update
-- 4) select tgname from pg_trigger where tgrelid='public.room_members'::regclass
--     and not tgisinternal;                -- expect room_members_guard_self_update
