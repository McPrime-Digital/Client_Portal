-- ═══════════════════════════════════════════════════════════════════════════
-- 0067 · meetings + meeting_participants   (S3-b migration 5)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── WHAT THIS MIGRATION DELIBERATELY DOES NOT DO ───────────────────────────
--
-- S3-b migration 5 as originally written said: add `messages.timecode_ms`,
-- "unused until the session ships". **DO NOT**, and the spec itself now carries
-- the correction (§2.2, superseded by S3-c §6 and by Batch 22's 0038).
-- `messages` already carries the anchor model — `anchor_kind`
-- (timecode|block|panel|region) with `anchor_value` jsonb, both-or-neither — and
-- a timecode IS `anchor_kind='timecode'` with `anchor_value={"ms":…}`.
--
-- Adding the column would create a SECOND representation of one anchor, and the
-- first comment written through the wrong one is a comment the viewer cannot
-- place. The requirement is already met; the column is the defect. It is named
-- here because a migration that silently omits something a spec asked for is
-- indistinguishable from one that forgot.
--
-- ── mode, provider: VALUES, NOT ASSUMPTIONS ────────────────────────────────
--
-- `mode` exists now and carries 'review_session' in its CHECK even though the
-- Review Session is v1.5 (AD-006). That is the point of shaping it early: the
-- later work becomes a value, not a migration. Same for `provider` — S-V §10's
-- reasoning applied to media, so the vendor is data rather than an assumption
-- baked into every query.
--
-- `meeting_sync_state` (§2.2 — synced playback for the Review Session) is NOT
-- created. It is v1.5, it has no reader, and 0064 has just finished paying off
-- the cost of tables that exist with nothing writing them.
--
-- ── duration_seconds IS THE METER, AND IT CANNOT BE BACKFILLED ─────────────
--
-- §2.1: meeting minutes are a consumable. Every PARTICIPANT-minute counts,
-- because that is how LiveKit bills and therefore how the studio must measure.
-- The column is recorded from day one for the reason S-V §11 gives about AI
-- tokens, and that 0061 then proved the hard way: usage you did not record is
-- usage you cannot reconstruct. `lib/billing/meters.ts` gains `meeting.minutes`
-- as a FLOW meter when the writer lands.
--
-- ── bookings.meeting_id gets its FK here ───────────────────────────────────
--
-- 0066 declared the column without a reference because `meetings` did not exist
-- yet. Adding the constraint now rather than leaving a dangling uuid: an
-- unenforced FK is a join that silently returns nothing.
--
-- I-12: forward-only, additive, every create policy preceded by a drop.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.meetings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- A meeting started from a chat room keeps its thread (S3-d).
  room_id    uuid references public.message_rooms(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  client_id  uuid references public.clients(id)  on delete set null,

  mode     text not null default 'call',
  provider text not null default 'livekit',
  provider_room_name text not null,
  status   text not null default 'scheduled',

  scheduled_for timestamptz,
  started_at    timestamptz,
  ended_at      timestamptz,

  created_by uuid references auth.users(id) on delete set null,   -- AD-003
  created_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint meetings_mode_check   check (mode in ('call', 'review_session')),
  constraint meetings_status_check check (status in ('scheduled', 'live', 'ended', 'cancelled')),
  constraint meetings_span_check   check (ended_at is null or started_at is null or ended_at >= started_at)
);

comment on table public.meetings is
  'S3-b §2.1. The Review Session (AD-006) is a MODE of this, not a different '
  'object — mode=''review_session'', v1.5. provider is recorded so the vendor '
  'is data rather than an assumption.';

-- One live room name per provider. A second meeting pointed at the same
-- provider room would put two sets of participants in one call while the
-- product believed they were separate.
create unique index if not exists meetings_provider_room_live_idx
  on public.meetings (provider, provider_room_name)
  where deleted_at is null and status in ('scheduled', 'live');

create index if not exists meetings_org_sched_idx
  on public.meetings (organization_id, scheduled_for) where deleted_at is null;
create index if not exists meetings_room_idx
  on public.meetings (room_id) where room_id is not null;
create index if not exists meetings_project_idx
  on public.meetings (project_id) where project_id is not null;

create table if not exists public.meeting_participants (
  id         uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,          -- AD-003
  role       text not null default 'participant',
  joined_at  timestamptz,
  left_at    timestamptz,
  -- The metering input. Not derived from joined_at/left_at at read time: a
  -- participant who drops and rejoins accrues two spans, and a subtraction
  -- would report the wrap rather than the sum.
  duration_seconds int not null default 0,
  created_at timestamptz not null default now(),

  constraint meeting_participants_role_check check (role in ('host', 'participant', 'observer')),
  constraint meeting_participants_duration_check check (duration_seconds >= 0)
);

comment on column public.meeting_participants.duration_seconds is
  'S3-b §2.1. Participant-minutes are how LiveKit bills, so they are how this '
  'measures. Accumulated across rejoins, never subtracted from timestamps.';

create index if not exists meeting_participants_meeting_idx
  on public.meeting_participants (meeting_id);
create index if not exists meeting_participants_user_idx
  on public.meeting_participants (user_id) where user_id is not null;

-- 0066's forward declaration, now enforceable.
alter table public.bookings drop constraint if exists bookings_meeting_id_fkey;
alter table public.bookings add constraint bookings_meeting_id_fkey
  foreign key (meeting_id) references public.meetings(id) on delete set null;

alter table public.meetings             enable row level security;
alter table public.meeting_participants enable row level security;

drop policy if exists meetings_crew_all on public.meetings;
create policy meetings_crew_all on public.meetings
  for all
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (project_id is null or public.org_project_visible(project_id))
  );

-- A client sees a meeting that names their company. NULL client_id is internal,
-- so the default fails closed.
drop policy if exists meetings_client_read on public.meetings;
create policy meetings_client_read on public.meetings
  for select
  using (
    client_id is not null
    and public.is_client_member(client_id)
    and (project_id is null or public.client_project_visible(project_id))
    and deleted_at is null
  );

-- Read THROUGH the parent — 0038's idiom. The subquery is SECURITY INVOKER, so
-- it sees only meetings the caller may already read and the child inherits
-- every predicate above without restating one of them.
drop policy if exists meeting_participants_read on public.meeting_participants;
create policy meeting_participants_read on public.meeting_participants
  for select
  using (exists (select 1 from public.meetings m where m.id = meeting_id));

drop policy if exists meeting_participants_crew_write on public.meeting_participants;
create policy meeting_participants_crew_write on public.meeting_participants
  for all
  using (
    exists (
      select 1 from public.meetings m
      where m.id = meeting_id
        and m.organization_id = (select public.current_org())
        and (select public.is_org_member())
    )
  )
  with check (
    exists (
      select 1 from public.meetings m
      where m.id = meeting_id
        and m.organization_id = (select public.current_org())
        and (select public.is_org_member())
    )
  );

commit;

-- ── verification ───────────────────────────────────────────────────────────
-- select count(*) from meetings;                                    -- 0
-- select conname from pg_constraint where conname='bookings_meeting_id_fkey';
-- select count(*) from information_schema.columns
--   where table_name='messages' and column_name='timecode_ms';      -- MUST be 0
