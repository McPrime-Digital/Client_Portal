-- ═══════════════════════════════════════════════════════════════════════════
-- 0080 · session recordings, and annotations that OUTLIVE the session
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── WHERE THE MARKET ACTUALLY IS, AND THE GAP BETWEEN THE TOOLS ──────────
--
-- Frame.io has frame-accurate drawn annotations and timecoded comments, and
-- **no live conferencing at all**. SyncSketch has synced sessions and drawing,
-- aimed at shot review. Evercast has both — live conferencing plus frame-to-frame
-- annotation and colour-accurate streaming — and its annotations are a property
-- of the SESSION: they are how people point at things while talking.
--
-- So the whole market makes you choose. Either your annotation is durable and
-- there is nobody to talk to, or there is a conversation and the drawing
-- evaporates when the call ends.
--
-- **This table is the join.** A mark drawn on a frame during a live review is
-- persisted, anchored to a timecode, and attached to the approval record the
-- shot already belongs to. The argument survives the call, and the editor opens
-- it tomorrow at the exact frame.
--
-- ── THE ANCHOR IS THE ONE 0038 ALREADY SETTLED ───────────────────────────
--
-- `anchor_ms` here, and `messages.anchor_kind='timecode'` with
-- `anchor_value={"ms":…}` there, are the same number in the same unit. Batch 22
-- refused `messages.timecode_ms` precisely so a timecode would have ONE
-- representation, and 0077 stored `position_ms` for the same reason. A comment
-- and an annotation that disagree about where they are is a note on the wrong
-- shot.
--
-- ── STROKES ARE NORMALISED, NOT PIXELS ───────────────────────────────────
--
-- `strokes` holds points in 0–1 of the frame, so a mark drawn on a laptop lands
-- in the same place on a 4K reference monitor. Pixel coordinates would be
-- correct exactly once, on the machine that drew them.
--
-- ── RECORDINGS ARE A ROW, NOT A GUESS ────────────────────────────────────
--
-- LiveKit Egress is asynchronous: it is requested, it runs, it finishes later.
-- Storing the egress id and status means the surface can say "recording",
-- "processing" or "ready" truthfully instead of inferring from a file's
-- existence. The finished object lands in R2 through Egress's own S3-compatible
-- output, so the bytes never pass through this application at all.
--
-- I-12: forward-only, additive.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── recordings ─────────────────────────────────────────────────────────────
alter table public.meetings
  add column if not exists recording_egress_id text,
  add column if not exists recording_status    text,
  add column if not exists recording_file_id   uuid references public.files(id) on delete set null,
  add column if not exists recording_started_at timestamptz;

comment on column public.meetings.recording_status is
  'requested | active | processing | ready | failed. Egress is asynchronous, so '
  'the surface tells the truth about which of those it is rather than inferring '
  'from whether a file exists yet.';

alter table public.meetings drop constraint if exists meetings_recording_status_check;
alter table public.meetings add constraint meetings_recording_status_check
  check (recording_status is null
         or recording_status in ('requested', 'active', 'processing', 'ready', 'failed'));

-- ── annotations ────────────────────────────────────────────────────────────
create table if not exists public.review_annotations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  meeting_id      uuid references public.meetings(id) on delete set null,
  file_id         uuid references public.files(id) on delete cascade,
  -- The approval the shot is under, when there is one. SET NULL: an annotation
  -- outlives the approval it was made during, which is the entire point.
  approval_id     uuid references public.approvals(id) on delete set null,

  -- THE anchor. Same unit as messages.anchor_value->>'ms' (0038) and
  -- meeting_sync_state.position_ms (0077). One representation, forever.
  anchor_ms integer not null,

  -- Points in 0–1 of the frame, so a mark drawn on a laptop lands in the same
  -- place on a reference monitor.
  strokes jsonb not null default '[]'::jsonb,
  note    text,
  colour  text not null default '#ff3b30',

  created_by uuid references auth.users(id) on delete set null,   -- AD-003
  created_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint review_annotations_anchor_check check (anchor_ms >= 0),
  constraint review_annotations_subject_check check (file_id is not null)
);

comment on table public.review_annotations is
  'A mark drawn on a frame during a live review, persisted. Frame.io has the '
  'annotation and no conferencing; Evercast has the conferencing and the '
  'annotation dies with the session. This is the join.';

create index if not exists review_annotations_file_idx
  on public.review_annotations (file_id, anchor_ms) where deleted_at is null;
create index if not exists review_annotations_meeting_idx
  on public.review_annotations (meeting_id) where meeting_id is not null;
create index if not exists review_annotations_approval_idx
  on public.review_annotations (approval_id) where approval_id is not null;

alter table public.review_annotations enable row level security;

drop policy if exists review_annotations_crew_all on public.review_annotations;
create policy review_annotations_crew_all on public.review_annotations
  for all to authenticated
  using (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (file_id is null or public.org_file_visible(file_id))
  )
  with check (
    organization_id = (select public.current_org())
    and (select public.is_org_member())
    and (file_id is null or public.org_file_visible(file_id))
  );

-- A client sees marks on THEIR OWN material. A review the client is in is a
-- review they can read back — hiding the note they watched somebody draw would
-- be theatre.
drop policy if exists review_annotations_client_read on public.review_annotations;
create policy review_annotations_client_read on public.review_annotations
  for select to authenticated
  using (
    deleted_at is null
    and file_id is not null
    and exists (
      select 1 from public.files f
      where f.id = file_id
        and public.is_client_member(f.client_id)
        and (f.project_id is null or public.client_project_visible(f.project_id))
    )
  );

commit;

-- ── verification ───────────────────────────────────────────────────────────
-- select count(*) from review_annotations;   -- 0
-- select policyname from pg_policies where tablename='review_annotations';
