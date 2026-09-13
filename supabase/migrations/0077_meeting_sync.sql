-- ═══════════════════════════════════════════════════════════════════════════
-- 0077 · the review session's synced playback + meetings reach the calendar
-- S3-b §2.2 (AD-006). The hybrid-film half of "meetings".
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A meeting in this product is not a call with a film company's logo on it.
-- `S3-b` §2.1 says the Review Session is a MODE of a meeting rather than a
-- different object, and §2.2 says what it needs: **everyone on the same frame.**
-- That is the thing Zoom cannot do and the thing a hybrid production actually
-- meets about — a director, a client and a VFX lead arguing about one shot, half
-- of which came out of a model.
--
-- ── ONE POSITION, IN MILLISECONDS, AND THE SPEC SAYS "frame" ──────────────
--
-- §2.2 sketches `frame`. This stores `position_ms`, and the deviation is
-- deliberate rather than sloppy.
--
-- A frame number is not a position until you also know the frame rate, so
-- `frame` is really two columns of which one is missing — and the rate lives on
-- an asset this table does not reference. Worse, it would be a SECOND
-- representation of a timecode: 0038 already settled that a timecode is
-- `anchor_kind='timecode'` with `anchor_value = {"ms": …}`, and Batch 22
-- explicitly refused `messages.timecode_ms` to avoid exactly this. A comment
-- anchored at 4500ms and a playhead at frame 108 describing the same instant is
-- the drift that makes a comment land on the wrong shot.
--
-- Film people think in frames, and they still should — `ms = round(frame / fps *
-- 1000)` at the edge, where the fps is known. The STORED value is one thing.
--
-- ── THE SYNC IS A ROW, NOT A BROADCAST ────────────────────────────────────
--
-- Realtime carries the change, but the row is the truth. Somebody who joins
-- late, or whose tab was backgrounded through three seeks, reads the row and is
-- immediately on the same frame as everyone else. A broadcast-only design leaves
-- them on frame zero looking at a different shot from the person talking.
--
-- ONE ROW PER MEETING, by primary key. A second row is a second playhead.
--
-- ── MEETINGS REACH THE CALENDAR ───────────────────────────────────────────
--
-- `calendar_entries.source_kind` has allowed 'meeting' since 0065 with nothing
-- producing one. Same projection discipline as 0074: a trigger so every writer
-- projects, and the entry is REMOVED when the meeting is cancelled or ends,
-- because a calendar holding finished meetings shows time as busy when it is
-- free.
--
-- I-12: forward-only, additive.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.meeting_sync_state (
  meeting_id  uuid primary key references public.meetings(id) on delete cascade,
  file_id     uuid references public.files(id) on delete set null,
  -- See the header: ONE representation of a position, matching 0038's anchor
  -- model so a comment and a playhead cannot disagree.
  position_ms integer not null default 0,
  playing     boolean not null default false,
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now(),

  constraint meeting_sync_position_check check (position_ms >= 0)
);

comment on table public.meeting_sync_state is
  'S3-b §2.2 (AD-006). The review session playhead: one row per meeting, so a '
  'late joiner reads the row and lands on the same frame as everyone else. '
  'position_ms rather than `frame` — see 0077''s header.';

alter table public.meeting_sync_state enable row level security;

-- Read and write follow the MEETING. The subquery is SECURITY INVOKER, so it
-- sees only meetings the caller may already read and the child inherits every
-- predicate on the parent without restating one of them (0038's idiom).
drop policy if exists meeting_sync_read on public.meeting_sync_state;
create policy meeting_sync_read on public.meeting_sync_state
  for select to authenticated
  using (exists (select 1 from public.meetings m where m.id = meeting_id));

-- ANY participant may drive. A review session where only the host can scrub is
-- a screenshare, and the reason to build this instead of sharing a screen is
-- that the client can say "go back four frames" by doing it.
drop policy if exists meeting_sync_write on public.meeting_sync_state;
create policy meeting_sync_write on public.meeting_sync_state
  for all to authenticated
  using (
    exists (
      select 1 from public.meetings m
      where m.id = meeting_id
        and m.deleted_at is null
        and m.status in ('scheduled', 'live')
    )
  )
  with check (
    exists (
      select 1 from public.meetings m
      where m.id = meeting_id
        and m.deleted_at is null
        and m.status in ('scheduled', 'live')
    )
  );

-- ── meetings project onto the calendar ─────────────────────────────────────
create or replace function public.project_meeting_entry()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_title text;
begin
  if new.deleted_at is null
     and new.status in ('scheduled', 'live')
     and coalesce(new.scheduled_for, new.started_at) is not null
  then
    v_title := case when new.mode = 'review_session'
                 then 'Review session' else 'Meeting' end;

    insert into public.calendar_entries (
      organization_id, kind, source_kind, source_id,
      project_id, client_id, title, starts_at, ends_at, all_day
    )
    values (
      new.organization_id, 'meeting', 'meeting', new.id,
      new.project_id, new.client_id, v_title,
      coalesce(new.scheduled_for, new.started_at),
      coalesce(new.ended_at, coalesce(new.scheduled_for, new.started_at) + interval '1 hour'),
      false
    )
    on conflict (source_kind, source_id) where source_id is not null
    do update set
      title      = excluded.title,
      starts_at  = excluded.starts_at,
      ends_at    = excluded.ends_at,
      project_id = excluded.project_id,
      client_id  = excluded.client_id,
      deleted_at = null;
  else
    delete from public.calendar_entries
     where source_kind = 'meeting' and source_id = new.id;
  end if;

  return null;
end
$function$;

drop trigger if exists meetings_calendar on public.meetings;
create trigger meetings_calendar
  after insert or update of status, scheduled_for, started_at, ended_at,
                            mode, project_id, client_id, deleted_at
  on public.meetings
  for each row execute function public.project_meeting_entry();

commit;

-- ── verification ───────────────────────────────────────────────────────────
-- -- a scheduled meeting appears on the calendar; ending it removes the entry.
-- select count(*) from meeting_sync_state;   -- 0
