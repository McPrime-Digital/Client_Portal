-- ============================================================================
-- 0025_drop_clients_user_id.sql — Batch 7 item 6: retire the deprecated
-- primary-login pointer.
--
-- Governing: S1 §5.2 (client_members is the sole authority), S1 §10 q2,
-- S2 §11 q4. Runs after 0024. Forward-only, idempotent (I-12).
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  DO NOT APPLY YET. Two of this batch's preconditions are NOT met.        ║
-- ║  The file is printed so the work is visible and reviewable; the guard    ║
-- ║  block below will REFUSE to run it until they are. See PRECONDITIONS.    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- WHAT IS ALREADY DONE
--   · 0020 dropped the `or clients.user_id = auth.uid()` branch from
--     is_client_member() (0020:110), and 0021 replaced every client-side policy
--     that keyed on the column (0021:120, :431-437).
--   · 0021:474 deliberately REFUSED the column an UPDATE grant, so no
--     `authenticated` session can write it.
--   · Batch 6.8 removed lib/team.ts's primary-login branches.
--   · Batch 7.6 moved the two application readers off it:
--       app/auth/callback/route.ts   → app_metadata.client_id
--       app/onboarding/page.tsx      → portalClientId() (client_members)
--
-- PRECONDITIONS — BOTH MUST HOLD BEFORE THIS FILE IS APPLIED
--
--   P1. Three further readers must move first. The Batch 7 brief named two;
--       a re-grep found five. These three are still live and are NOT in this
--       batch's authorized file list:
--         app/api/presence/heartbeat/route.ts:27
--           update(clients).eq('user_id', …) every 30s per client session.
--           After the drop: PostgREST 42703, swallowed by the route's catch →
--           last_seen_at stops updating → every client reads as "away" → the
--           away-escalation path emails and texts people who are in the app.
--           Silent.
--         app/api/admin/delete-client/route.ts:34
--           select('id, user_id, …') → 42703 → fetchError → the route returns
--           404 "Client not found." Deleting a client company stops working
--           entirely. Loud.
--         lib/notify.ts:196
--           select('user_id, email, …') → 42703 → data null → recipient
--           resolves to all-nulls → device push and email for clients stop
--           targeting anyone. Silent.
--
--   P2. Both insert-time writers must create the paired client_members row.
--       They do not — see the guard below, which enforces this rather than
--       trusting it. app/api/admin/create-client/route.ts:143-155 and
--       app/api/admin/invite-client/route.ts:77-89 insert `clients` with
--       user_id and NEVER insert client_members. Since Batch 6.8 made
--       client_members the sole authority, a company created today yields a
--       login with no membership at all: clientMembershipOf() → null,
--       portalAccess() → null, an empty portal. Dropping the column removes the
--       last trace of who that login belongs to.
--
-- scripts/seed-harness-tenant.ts:273-281 also writes the column; it must lose
-- that step in the same change (the harness personas already get explicit
-- client_members rows, so nothing else there depends on it).
-- ============================================================================

begin;

-- ── structural refusal, in the style of 0020:146 ────────────────────────────
-- A comment cannot stop an apply; this can. If any live client company has no
-- active owner in client_members, dropping the column destroys the only record
-- of who its login is — so refuse, loudly, with the count.
do $$
declare orphans int;
begin
  select count(*) into orphans
  from public.clients c
  where not exists (
    select 1 from public.client_members m
     where m.client_id = c.id
       and m.role      = 'owner'
       and m.status    = 'active'
  );
  if orphans > 0 then
    raise exception
      '0025: % client company(ies) have no ACTIVE owner in client_members. Dropping clients.user_id would leave them with no resolvable login. Backfill them AND fix create-client/invite-client to insert the membership row before applying — STOP.', orphans;
  end if;
end $$;

-- Any live policy still reading the column would break on the drop. 0021
-- replaced them all, but this is verified rather than assumed — the policy set
-- is live state, and this file is the last chance to catch a stray.
do $$
declare refs int;
begin
  select count(*) into refs
  from pg_policies
  where schemaname = 'public'
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ 'clients[^;]*user_id'
    and policyname not in ('users_manage_own_push');   -- push_subscriptions.user_id, unrelated
  if refs > 0 then
    raise exception
      '0025: % live polic(ies) still reference clients.user_id. Replace them before applying — STOP.', refs;
  end if;
end $$;

alter table public.clients drop column if exists user_id;

notify pgrst, 'reload schema';

commit;

-- ── TABLE-SHAPE CHANGE — deploy discipline (the Batch 2 lesson) ─────────────
-- Dropping a column changes the table shape, so:
--   1. Ship the code that no longer reads the column FIRST, and let it settle.
--   2. Apply this migration.
--   3. Reload the PostgREST schema cache immediately (`notify pgrst` above
--      does it in-transaction; confirm in the dashboard) — a stale cache keeps
--      advertising the dropped column and every insert naming it fails.
-- Between (2) and (3) any surviving reader gets 42703. That is why P1 is a
-- precondition and not a follow-up.
