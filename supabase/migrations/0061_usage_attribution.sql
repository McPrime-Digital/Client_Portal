-- ═══════════════════════════════════════════════════════════════════════════
-- 0061 · usage_events.created_by — recover the actor on BILLED rows
-- Phase B. Data repair + one index. No policy changes.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── THE HOLE, AND IT WAS EXACTLY BACKWARDS ─────────────────────────────────
--
-- Verified live before writing this:
--
--   kind              rows   created_by
--   ai.text.tokens       3          0     ← costs money
--   primeos             15          0     ← costs money
--   seat.invited         9          9     ← costs nothing
--   storage.bytes       22         22     ← costs nothing
--
-- EVERY row that cost money was unattributed. Every row that cost nothing
-- carried an actor. That is the precise inverse of what cost governance needs,
-- and it makes the first question any organisation asks of an AI spend surface —
-- "who is spending this" — unanswerable.
--
-- ── THE ACTOR WAS NEVER LOST, ONLY MISPLACED ───────────────────────────────
--
-- `app/api/studio/muse/route.ts` has always passed `{ user: user.id }` inside
-- the `ref` JSONB. `chargeCredits()` then called `recordUsage()` WITHOUT its
-- sixth argument, so the value landed in a blob that cannot be indexed, grouped
-- or joined instead of in the column the schema already provides for it.
--
-- All 18 billed rows carry `ref->>'user'`, and it resolves to a real auth user.
-- So this is a recovery, not an invention — which is the difference between a
-- backfill and asserting an intent nobody recorded (§12 lesson 1).
--
-- The WRITER is fixed in the same commit (`chargeCredits` gains `actorId`,
-- the muse route passes `user.id`). A backfill without the writer is a one-time
-- repair that reads as a permanent one — §12 lesson 1's exact shape, and the
-- reason this file and that change ship together.
--
-- ── ONLY WHERE ref HOLDS A REAL USER ───────────────────────────────────────
--
-- The UPDATE is guarded three ways: `created_by is null` (never overwrite a
-- recorded actor), a uuid-shaped `ref->>'user'`, and an EXISTS against
-- auth.users. A backfill that writes an id nothing resolves to would turn a
-- missing actor into a WRONG one, which is worse — a name on a spend report is
-- read as authority.
--
-- I-12: forward-only, idempotent (the null guard makes a re-run a no-op).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

update public.usage_events u
   set created_by = (u.ref->>'user')::uuid
 where u.created_by is null
   and u.ref->>'user' is not null
   and u.ref->>'user' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and exists (select 1 from auth.users a where a.id = (u.ref->>'user')::uuid);

-- Attribution is the surface's hot path: "spend by member, this month" groups by
-- (organization_id, created_by) over a date range on every Control Tower load.
-- Partial on the rows that can actually be attributed.
create index if not exists usage_events_actor_idx
  on public.usage_events (organization_id, created_by, created_at desc)
  where created_by is not null;

-- And the range scan the burn-rate/sparkline computation makes, which filters by
-- org + created_at and never by actor.
create index if not exists usage_events_org_time_idx
  on public.usage_events (organization_id, created_at desc);

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION
--
-- 1 · every BILLED row is now attributed:
--     select kind, count(*), count(created_by) from usage_events
--      where cost_cents > 0 group by kind;
--     → attributed = total for ai.text.tokens and primeos
--
-- 2 · nothing was invented — every backfilled id resolves to a real user:
--     select count(*) from usage_events u
--      where u.created_by is not null
--        and not exists (select 1 from auth.users a where a.id = u.created_by);
--     → 0
--
-- 3 · the indexes exist and are used by the attribution group-by.
-- ═══════════════════════════════════════════════════════════════════════════
