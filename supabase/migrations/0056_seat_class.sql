-- ═══════════════════════════════════════════════════════════════════════════
-- 0056 · organization_members.seat_class — S3-b §4.1, S-R §2's first axis
-- Batch 26 item 2. ADDITIVE. Nothing reads this column yet; item 4 does.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- THE AXIS, AND WHY IT IS THE LOAD-BEARING ONE FOR THIS PRODUCT
--
-- S-R §2: `S1-P`'s O-1 and O-2 archetypes are DEFINED by a large rotating
-- freelance bench — that is the archetype, not a detail of it. A permanent
-- producer joining should see the studio. A freelance colorist joining should
-- see the one job they were hired for. Those are opposite defaults, and today
-- there is one default: everything.
--
-- ── THE VALUES ARE 'staff' AND 'contractor', NOT 'crew' AND 'collaborator' ──
--
-- Owner ruling, Batch 26, superseding `S-R` §2 and `S3-b` §4.1's naming. Both
-- specs say `crew` / `collaborator`, and BOTH of those words are already taken
-- in this codebase, in ways that would produce two different collisions:
--
--   · `collaborator` already means something LIVE and DIFFERENT. S3-d's MD-4
--     external collaborator is a person with a `room_members` seat and NO ROSTER
--     ROW ANYWHERE — harness persona `harness-collab`, assertion 23, and
--     app/api/rooms/route.ts's internal directory. That is the opposite shape
--     from a seat class, which is a property OF a roster row. Two unrelated
--     things called collaborator, one with no roster row and one with a scoped
--     roster row, is how the next reader conflates "seat a collaborator"
--     (item 7) with "invite a collaborator" (S3-d's unbuilt MD-4 flow).
--
--   · `crew` is already a company ROLE (S-R §3.1, admitted by
--     organization_members_role_check since 0050). `seat_class = 'crew'` and
--     `role = 'crew'` meaning different things ON THE SAME ROW is a trap on its
--     own, and the kind that survives review because both readings look right.
--
-- `contractor` is also what a production company actually calls a freelance crew
-- member, so it reads correctly in the invite UI item 4 builds. The semantics are
-- exactly S-R §2's and S3-b §4.1's — permanent bench vs freelance — with words
-- that are free. Recorded for the next amendment rather than edited into S-R,
-- which is settled at b8cf4aa and is never edited in place.
--
-- ── THE DEFAULT IS 'staff', AND THAT IS THE CONSERVATIVE CHOICE HERE ────────
--
-- Note this is the opposite of item 4's INVITE default, which is `contractor`
-- (the safer default is the one that grants less, and the freelance bench is the
-- common case for O-1/O-2). The COLUMN default is `staff` because of what a
-- column default does to rows that already exist: it backfills them. Every live
-- member predates this axis and every one of them is permanent staff with
-- `scope_mode = 'all'`. Defaulting the column to `contractor` would relabel six
-- real people as freelancers — and once item 4 teaches the app to derive scope
-- from seat class, a later reader could reasonably "repair" their scope to match
-- the label and lock them out of their own studio.
--
-- So: the column default describes WHAT IS TRUE OF EXISTING ROWS; the invite
-- default describes WHAT IS LIKELY OF NEW ONES. They differ because those are
-- different questions, and collapsing them is the §12 lesson 5 shape — asking
-- "what is the default" instead of "which write path decides the value."
--
-- ── BACKFILL: NONE, DELIBERATELY ───────────────────────────────────────────
--
-- The brief says "verify by count rather than writing an UPDATE — the column
-- default gives it." Correct: `add column ... not null default 'staff'` fills
-- every existing row with 'staff' as part of the DDL. An UPDATE afterwards would
-- be a no-op that reads like a backfill, which is worse than nothing: the next
-- reader would believe the rows were repaired by a statement rather than by the
-- column, and §12 lesson 5's whole point is that those are different facts.
--
-- Verified live before printing: 6 organization_members rows exist (2 production
-- in McPrime, 4 harness fixtures). Expect 6 rows reading 'staff' after this.
--
-- ── SCOPE: CREW ROSTER ONLY ────────────────────────────────────────────────
--
-- `client_members` does NOT get this column. S-R §2 and S3-b §4.1 both put the
-- axis on the crew roster alone, and the reason is substantive rather than
-- economical: a client company's people are not staffed per production the way a
-- crew is (S-R §14 q4 recommends no client-side project roles for the same
-- reason). A seat class there would be a column with no question behind it.
--
-- I-12: forward-only. No policies, so no `drop policy if exists` is owed. The
-- column add is guarded so a re-run is a no-op rather than a 42701 that aborts
-- a batch.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.organization_members
  add column if not exists seat_class text not null default 'staff';

-- Dropped first so a re-run replaces rather than 42710s, and so the constraint
-- can be tightened later without a second name.
alter table public.organization_members
  drop constraint if exists organization_members_seat_class_check;

alter table public.organization_members
  add constraint organization_members_seat_class_check
  check (seat_class in ('staff', 'contractor'));

comment on column public.organization_members.seat_class is
  'S-R §2 axis 1 / S3-b §4.1. staff = permanent bench, contractor = freelance. '
  'Values are staff/contractor rather than the specs'' crew/collaborator: '
  '`collaborator` already names S3-d MD-4''s roster-less room seat, and `crew` is '
  'already a value of this table''s own `role` column. Chooses the scope_mode '
  'STATED at invite time (item 4) — never inferred, and never re-derived for an '
  'existing row.';

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION — run after applying. Expected results in comments.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1 · the column, its default and its NOT NULL:
--     select column_name, data_type, is_nullable, column_default
--       from information_schema.columns
--      where table_schema='public' and table_name='organization_members'
--        and column_name='seat_class';
--     → text · NO · 'staff'::text
--
-- 2 · THE BACKFILL, by count rather than by UPDATE:
--     select seat_class, count(*) from organization_members group by 1;
--     → staff | 6      (and no other row)
--
-- 3 · the CHECK refuses the specs' retired words, which is the point of
--     recording the rename here:
--     update organization_members set seat_class='collaborator' where false;
--     → a real attempt raises 23514 organization_members_seat_class_check
--
-- 4 · client_members did NOT gain the column:
--     select count(*) from information_schema.columns
--      where table_name='client_members' and column_name='seat_class';
--     → 0
-- ═══════════════════════════════════════════════════════════════════════════
