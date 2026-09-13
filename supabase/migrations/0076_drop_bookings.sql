-- ═══════════════════════════════════════════════════════════════════════════
-- 0076 · bookings comes out   (owner decision, 2026-09-13)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DESTRUCTIVE, and safe: `bookings`, `booking_types` and `availability_rules`
-- hold ZERO ROWS, verified immediately before this was written. Nothing is lost
-- because nothing was ever stored.
--
-- ── WHY IT IS BEING REMOVED RATHER THAN LEFT ──────────────────────────────
--
-- The owner's judgement, and it matches the one recorded in `S-S` §6.6 when it
-- shipped: **bookings is the weakest of the three S3-b shapes.** A Cal.com-style
-- slot picker is a SaaS reflex rather than a film feature, and for a studio with
-- no contended resource there is nothing for the exclusion constraint to
-- protect.
--
-- Leaving the tables behind would be worse than removing them. This repository
-- has now paid twice for schema that exists with nothing writing to it —
-- `asset_provenance` and `rights` sat dormant from 0001 until 0064, and 0065
-- created `calendar_entries` with no writer until 0074. A dormant table is not
-- free: it is read as a promise, it accumulates policies nobody audits, and the
-- next person cannot tell "unfinished" from "abandoned".
--
-- ── WHAT IS WORTH REMEMBERING ─────────────────────────────────────────────
--
-- If a contended resource ever appears — a casting session with slots, a shared
-- grade suite, an ADR booth — the part that mattered was never the UI. It was
-- 0066's `EXCLUDE USING gist (owner_user_id WITH =, tstzrange(...) WITH &&)`,
-- which stops two people claiming one person at the same instant under a race
-- the application cannot win. That constraint, and 0066's header explaining why
-- the owner must be stamped by trigger rather than supplied, is the thing to
-- bring back. It is roughly ten lines.
--
-- ── ORDER ─────────────────────────────────────────────────────────────────
--
-- The booking→calendar projection (0075) goes first: it references `bookings`,
-- and the FK from `bookings.calendar_entry_id` means the trigger must not be
-- left pointing at a table that no longer exists. `source_kind` then loses the
-- 'booking' value it gained, since nothing can produce one.
--
-- `btree_gist` stays installed. It is harmless, other work may want it, and
-- dropping an extension to tidy up is how an unrelated migration breaks later.
--
-- I-12: forward-only.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

drop trigger if exists bookings_calendar on public.bookings;
drop function if exists public.project_booking_entry();

drop trigger if exists bookings_stamp_owner on public.bookings;
drop function if exists public.booking_stamp_owner();

-- Any entry a booking projected. There are none, but the delete is stated so a
-- re-run against a database that somehow has one still converges.
delete from public.calendar_entries where source_kind = 'booking';

drop table if exists public.bookings;
drop table if exists public.booking_types;
drop table if exists public.availability_rules;

alter table public.calendar_entries drop constraint if exists calendar_entries_source_kind_check;
alter table public.calendar_entries add constraint calendar_entries_source_kind_check
  check (
    source_kind is null
    or source_kind in ('meeting', 'approval_stage', 'invoice', 'manual')
  );

commit;

-- ── verification ───────────────────────────────────────────────────────────
-- select count(*) from information_schema.tables where table_schema='public'
--   and table_name in ('bookings','booking_types','availability_rules');  -- 0
