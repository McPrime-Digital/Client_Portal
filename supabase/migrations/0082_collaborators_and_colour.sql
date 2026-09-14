-- ═══════════════════════════════════════════════════════════════════════════
-- 0082 · collaborators can be in the room, and an asset states its colour
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── PART ONE: THE COLLABORATOR CANNOT GET IN, AND THAT IS A REAL GAP ─────
--
-- `S3-d` MD-4's external collaborator is a ROSTER-LESS seat: a `room_members`
-- row and nothing else. No `organization_members`, no `client_members`. There is
-- one live today.
--
-- Every meeting policy so far misses them. `meetings_crew_all` needs
-- `is_org_member()`; `meetings_client_read` needs `is_client_member()`. So the
-- VFX artist you added to a project room — the person the whole collaborator
-- concept exists for — can read the conversation about a shot and cannot join
-- the review session about it.
--
-- `S3-b` §2.1 already carries the answer in a column nobody had used:
-- `meetings.room_id`, "a meeting started from a chat room". A meeting attached
-- to a room is readable by that room's SEATS, which is exactly the membership
-- model S3-d built and 0046 flipped the message policies onto. No new concept,
-- no invite list, no fourth kind of person.
--
-- THE SEAT IS THE INVITE. That is the same sentence as `meetings_client_read`'s
-- "the row is the permission", and it means a collaborator removed from the room
-- loses the meeting at the same instant they lose the conversation — one
-- revocation, not two.
--
-- AND BECAUSE THE MEDIA TOKEN FOLLOWS THE ROW (§2.3 — no read, no token, no way
-- in), these three policies are also the access control on the video.
--
-- ── PART TWO: AN ASSET SHOULD SAY WHAT COLOUR SPACE IT IS IN ─────────────
--
-- Evercast sells on colour-accurate streaming and it is a genuine gap. Closing
-- it PROPERLY needs a transcode pipeline this repo does not have — 10-bit
-- HEVC/AV1, calibrated transforms, a job queue — and that is recorded as
-- outstanding rather than faked.
--
-- What is built is the half that is real and that the pipeline will need anyway:
-- the asset DECLARES its colour space, transfer and bit depth, so a review
-- surface can tell a viewer when their display cannot represent what they are
-- being asked to approve. **A note given on a wrongly-displayed image is worse
-- than no note**, because it is confidently wrong and nobody knows.
--
-- Nullable throughout: unknown is an honest state, and guessing Rec.709 for
-- every file would produce a confident claim about assets nobody has inspected.
--
-- I-12: forward-only, additive, every create policy preceded by a drop.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── the collaborator's seat reaches the room's meeting ─────────────────────
drop policy if exists meetings_room_member_read on public.meetings;
create policy meetings_room_member_read on public.meetings
  for select to authenticated
  using (
    room_id is not null
    and deleted_at is null
    and public.is_room_member(room_id)
  );

-- Their own participant row, and only their own. Without this they can read the
-- meeting and cannot record that they attended — which loses the minute the
-- studio is billed for.
drop policy if exists meeting_participants_self on public.meeting_participants;
create policy meeting_participants_self on public.meeting_participants
  for all to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from public.meetings m where m.id = meeting_id)
  )
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.meetings m where m.id = meeting_id)
  );

-- A collaborator in the review session may DRAW. They are usually the person
-- who made the shot; a review where the artist can watch and not point is the
-- same half-feature 0081 closed for clients.
--
-- Scoped through the MEETING rather than through the file: a collaborator's file
-- visibility runs on room scope, and restating that here would be a second copy
-- of a rule that already exists one table over.
drop policy if exists review_annotations_room_member_write on public.review_annotations;
create policy review_annotations_room_member_write on public.review_annotations
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and meeting_id is not null
    and exists (
      select 1 from public.meetings m
      where m.id = meeting_id
        and m.room_id is not null
        and public.is_room_member(m.room_id)
    )
  );

drop policy if exists review_annotations_room_member_read on public.review_annotations;
create policy review_annotations_room_member_read on public.review_annotations
  for select to authenticated
  using (
    deleted_at is null
    and meeting_id is not null
    and exists (
      select 1 from public.meetings m
      where m.id = meeting_id
        and m.room_id is not null
        and public.is_room_member(m.room_id)
    )
  );

create index if not exists meetings_room_member_idx
  on public.meetings (room_id) where room_id is not null and deleted_at is null;

-- ── an asset declares its colour ───────────────────────────────────────────
alter table public.files
  add column if not exists colour_space text,
  add column if not exists transfer     text,
  add column if not exists bit_depth    int;

comment on column public.files.colour_space is
  'rec709 | rec2020 | p3 | srgb. NULL is honest: unknown, not assumed. Guessing '
  'rec709 for everything would be a confident claim about assets nobody looked at.';
comment on column public.files.transfer is
  'sdr | pq | hlg. What a display has to do to show it correctly.';

alter table public.files drop constraint if exists files_colour_space_check;
alter table public.files add constraint files_colour_space_check
  check (colour_space is null or colour_space in ('rec709', 'rec2020', 'p3', 'srgb'));

alter table public.files drop constraint if exists files_transfer_check;
alter table public.files add constraint files_transfer_check
  check (transfer is null or transfer in ('sdr', 'pq', 'hlg'));

alter table public.files drop constraint if exists files_bit_depth_check;
alter table public.files add constraint files_bit_depth_check
  check (bit_depth is null or bit_depth between 8 and 16);

commit;

-- ── verification ───────────────────────────────────────────────────────────
-- select policyname from pg_policies where tablename='meetings';
-- -- a room member with NO roster row must read a meeting on their room.
