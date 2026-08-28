-- ============================================================================
-- 0024_hard_stop_default.sql — Batch 7 item 1: the credit hard stop is on by
-- default.
--
-- Governing: S0 §4 ("Hard-stop at zero balance: On by default, opt-out only" —
-- a DECISION), S0-A §3, S1 §7 item 7. Runs after 0023. Forward-only,
-- idempotent (I-12).
--
-- THE DEFECT. 0002:28 declared `hard_stop boolean not null default false`, so
-- the shipped default is the opposite of the decision: no gate. The gate at
-- app/api/studio/muse/route.ts:75 reads `credit.hardStop && balanceCents <= 0`,
-- so with hard_stop false an org bills past zero indefinitely. Verified live on
-- 2026-08-28: org_credits for the house org stands at -15 cents.
--
-- WHY THE COLUMN DEFAULT IS ONLY HALF THE FIX. A column DEFAULT applies when a
-- row is inserted. Nothing in the application inserts org_budgets — the only
-- rows come from charge_credits()/add_credits(), which touch org_credits, not
-- org_budgets. Live state confirms it: one org_budgets row exists (the house
-- org) against three organizations. For an org with no row at all,
-- lib/credits.ts:40 resolves `budgetRes.data?.hard_stop ?? false` — the app
-- fallback, not this default, is what a new tenant actually inherits. The
-- paired code change flips that fallback to true; this file makes the stored
-- default agree with it so the two can never disagree again.
--
-- THE HOUSE ORG IS EXCLUDED FROM THE BACKFILL, DELIBERATELY. McPrime is tenant
-- zero and a permanent house org: every money gate bypasses it, and it is
-- metered rather than charged (the same rule lib/billing/plans.ts:24-25,32
-- already encodes as PLANS.house). Its balance is negative today, so a blanket
-- backfill would take PrimeOS AI offline for the one live tenant the moment
-- this is applied — a regression on a running system (P-2). New tenants get
-- the gate; the house org keeps its explicit opt-out row.
--
-- NOT a table-shape change: no column is added, dropped or retyped, so no
-- deploy needs to be queued behind this file. The pgrst reload is belt only —
-- PostgREST caches column defaults for insert handling.
-- ============================================================================

begin;

alter table public.org_budgets
  alter column hard_stop set default true;

comment on column public.org_budgets.hard_stop is
  'Batch 7 item 1. Blocks AI execution once the balance reaches zero. ON by default (S0 §4) — opt-out is an explicit false on this row. The house org (tenant zero) carries that opt-out; see 0024.';

-- Backfill every tenant EXCEPT the house org. Idempotent: re-running matches
-- no rows the second time.
update public.org_budgets
   set hard_stop = true,
       updated_at = now()
 where hard_stop = false
   and organization_id <> '00000000-0000-0000-0000-000000000001';

-- The house org's opt-out is now a stated value rather than an inherited
-- default, so a future backfill cannot silently re-gate it. Insert-if-absent so
-- this holds on a fresh environment too.
insert into public.org_budgets (organization_id, hard_stop)
select '00000000-0000-0000-0000-000000000001', false
 where exists (select 1 from public.organizations where id = '00000000-0000-0000-0000-000000000001')
   and not exists (select 1 from public.org_budgets where organization_id = '00000000-0000-0000-0000-000000000001');

notify pgrst, 'reload schema';

commit;

-- ── verification (run after applying) ───────────────────────────────────────
-- 1. The stored default is now true:
--      select column_default from information_schema.columns
--       where table_schema='public' and table_name='org_budgets'
--         and column_name='hard_stop';
--      -- expect: true
--
-- 2. A newly created org inherits the gate. Both paths must hold:
--      -- (a) a row inserted without naming hard_stop
--      begin;
--        insert into public.organizations (id, name)
--          values ('00000000-0000-0000-0000-0000000000ff', 'default-probe');
--        insert into public.org_budgets (organization_id)
--          values ('00000000-0000-0000-0000-0000000000ff');
--        select hard_stop from public.org_budgets
--         where organization_id='00000000-0000-0000-0000-0000000000ff';  -- expect: t
--      rollback;
--      -- (b) an org with NO org_budgets row: covered by the code half
--      --     (lib/credits.ts getCreditState), not by this file.
--
-- 3. The house org is still open:
--      select hard_stop from public.org_budgets
--       where organization_id='00000000-0000-0000-0000-000000000001';
--      -- expect: f
