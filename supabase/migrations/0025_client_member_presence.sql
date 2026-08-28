-- ============================================================================
-- 0025_client_member_presence.sql — Batch 8 item 2: presence is per PERSON,
-- not per client company.
--
-- Governing: S1 §5.2 (client_members is the roster), S-V §X-6 (escalation
-- gated on presence), S0 P-2 (ships against a running system). Runs after
-- 0024. Forward-only, idempotent (I-12).
--
-- ── RENUMBERING NOTE ────────────────────────────────────────────────────────
-- The clients.user_id drop was printed as 0025 in Batch 7 and never applied.
-- It is now 0026, because this file must be applied BEFORE it and the working
-- agreement is "applied by hand, in 00NN filename order" (I-12, one ordering
-- scheme). Renumbering an unapplied file is free; telling an operator to apply
-- 0026 before 0025 is not.
--
-- ── THE DEFECT ──────────────────────────────────────────────────────────────
-- clients.last_seen_at is written by app/api/presence/heartbeat/route.ts keyed
-- on `clients.user_id = auth.uid()`, so ONLY a company's primary login ever
-- updates it. Since Batch 6.8 a company is a roster (S1 §5.2), and every other
-- member of it is invisible to presence:
--
--   · lib/notify.ts's awayFrom() treats a null/stale last_seen as away, so an
--     invited teammate reads as away while they are looking at the screen —
--     and the X-6 ladder emails and texts them anyway.
--   · The same teammate receives no push and no email of their own, because
--     the recipient resolved through clients.user_id is one person.
--
-- Presence cannot be answered per member from a per-company column, so the
-- column moves onto the roster row. clients.last_seen_at is left in place but
-- becomes unread — its only two touchpoints (the heartbeat write and the
-- notify read) both move in this batch. Retiring it is a separate change.
--
-- ── DEPLOY ORDER — ADDITIVE TABLE-SHAPE CHANGE ──────────────────────────────
-- The reverse of a drop. APPLY THIS FIRST, THEN DEPLOY.
--   1. Apply this migration and let the PostgREST schema cache reload.
--   2. Deploy the code that reads and writes the column.
-- Deploying first means the member SELECT in lib/notify.ts fails 42703, which
-- resolves the recipient set to empty: client notifications stop entirely and
-- the heartbeat silently no-ops. The read error is reported to Sentry rather
-- than swallowed (I-10), so the mistake is visible — but the order above
-- prevents it.
-- ============================================================================

begin;

alter table public.client_members
  add column if not exists last_seen_at timestamptz;

comment on column public.client_members.last_seen_at is
  'Batch 8 item 2. Heartbeat timestamp for THIS member. Presence and the X-6 away-escalation ladder read it per person; clients.last_seen_at answered only for the primary login.';

-- Carry the primary login's existing presence onto their roster row so nobody
-- reads as away across the deploy. Only active owners, only where the roster
-- row has nothing yet, and only where the company actually has a value —
-- idempotent: a second run matches no rows.
update public.client_members m
   set last_seen_at = c.last_seen_at
  from public.clients c
 where c.id = m.client_id
   and m.status = 'active'
   and m.role   = 'owner'
   and m.last_seen_at is null
   and c.last_seen_at is not null;

notify pgrst, 'reload schema';

commit;

-- ── verification (run after applying) ───────────────────────────────────────
-- 1. The column exists and is nullable:
--      select column_name, data_type, is_nullable
--        from information_schema.columns
--       where table_schema='public' and table_name='client_members'
--         and column_name='last_seen_at';
--
-- 2. The backfill carried the live primary logins over:
--      select count(*) from public.client_members where last_seen_at is not null;
--      -- expect: one row per company whose clients.last_seen_at was set
--
-- 3. After deploying, open the portal as an INVITED TEAMMATE (not the primary
--    login) and confirm their roster row starts moving — this is the half that
--    has never worked:
--      select email, last_seen_at from public.client_members
--       where client_id = '<company>' order by last_seen_at desc nulls last;
--
-- No index is added: the heartbeat updates by user_id (client_members_user_idx,
-- 0012:47) and the notify fan-out reads by client_id + status
-- (client_members_client_idx, 0012:46). Both are already covered.
