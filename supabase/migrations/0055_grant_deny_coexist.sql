-- ═══════════════════════════════════════════════════════════════════════════
-- 0055 · S-R-A A-3 — a grant and a denial may name the same capability
-- Batch 26 item 1. ADDITIVE in effect: it only WIDENS what the tables accept.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS FIXES, AND IT IS A SPEC DEFECT RATHER THAN A CODE ONE
--
-- S-R R-3 says: "deny beats grant, always. Where a grant and a denial name the
-- same capability, the denial wins, with no branch and no precedence table to
-- argue about." That sentence presupposes both rows existing at once.
--
-- S-R §10 then specified `unique (member_id, capability) where revoked_at is
-- null` — one active row per person per capability. So the two could never
-- coexist, and "deny wins" had nothing to resolve between. Both sentences were
-- written in the same document, on the same day, by the same author; the build
-- shipped both, and the harness grew an assertion for a state the tables cannot
-- hold. That is HANDOFF §12 lesson 9, and this migration is the half of the
-- amendment that is not a correction.
--
-- VERIFIED LIVE BEFORE PRINTING (Batch 26 item 0 and item 1, not assumed):
--   · org_member_cap_grants    0 rows
--   · client_member_cap_grants 0 rows
--     → the widening cannot newly permit a duplicate, because there is nothing
--       to duplicate. A-3's "cheapest before grants accumulate" is as cheap as
--       it gets.
--   · a probe inserted a grant and then a deny on the same (member, capability)
--     and the second was refused with
--       duplicate key value violates unique constraint "org_member_cap_grants_live_idx"
--     → R-3 is genuinely unreachable today, and the refusal names this index.
--
-- WHY WIDEN RATHER THAN RESTATE R-3 AS "THE LATEST ROW WINS" (A-3's argument,
-- recorded here because a migration header is where the next reader looks):
--
--   · A grant and a denial are SEPARATE ACTS, by potentially different people,
--     for different reasons, each with its own granted_by, granted_at and
--     expires_at. Letting one destroy the other loses the record of why the
--     grant existed in the table, while R-8's ledger still remembers it — so the
--     row and the ledger would disagree (§12 lesson 4's shape).
--   · It changes behaviour on REVOCATION. Under this index, revoking a denial
--     RESTORES the underlying grant, which is what "denied rates FOR NOW" means.
--     Under latest-wins the grant row was overwritten, so revoking the denial
--     leaves nothing and the person silently ends up BELOW where an admin
--     deliberately put them. That surprise removes access somebody was given.
--   · "Latest wins" is itself a precedence rule — a temporal one — which is
--     precisely what R-3 says it does not want.
--
-- NO FUNCTION CHANGES, AND THAT WAS CHECKED RATHER THAN ASSUMED. has_cap()
-- (0051) unions the baselines, extra_caps and live grants, then answers
--   `return not exists (… mode = 'deny' …)`
-- as a SEPARATE lookup keyed on (member_id, capability, mode='deny'). It never
-- relied on there being one row per capability, so deny-beats-grant resolves
-- correctly the moment both rows can exist. Same in TypeScript:
-- lib/capabilities.server.ts adds grants then DELETES denials last.
--
-- I-12: forward-only, and every index guarded. `create unique index` has no
-- IF NOT EXISTS in the form used here, so the drop precedes it — re-running this
-- file is a no-op rather than a 42P07 that aborts a batch.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── crew side ──────────────────────────────────────────────────────────────
drop index if exists public.org_member_cap_grants_live_idx;

-- One ACTIVE row per (person, capability, MODE). A grant and a denial coexist;
-- two grants of the same capability still cannot, which is what keeps the grant
-- surface from silently accumulating duplicates an admin cannot see.
create unique index org_member_cap_grants_live_idx
  on public.org_member_cap_grants (member_id, capability, mode)
  where revoked_at is null;

-- ── portal side ────────────────────────────────────────────────────────────
-- Both tables move together. The client tree is a PARALLEL entitlement tree
-- (S1 §0), not the studio's minus some, so a rule that holds on one roster and
-- not the other is a rule nobody can state.
drop index if exists public.client_member_cap_grants_live_idx;

create unique index client_member_cap_grants_live_idx
  on public.client_member_cap_grants (member_id, capability, mode)
  where revoked_at is null;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION — run these after applying. Expected results in comments.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1 · both indexes now carry `mode`:
--     select indexname, indexdef from pg_indexes
--      where indexname in ('org_member_cap_grants_live_idx',
--                          'client_member_cap_grants_live_idx');
--     → each indexdef reads `btree (member_id, capability, mode) WHERE (revoked_at IS NULL)`
--
-- 2 · the pair the old index refused now inserts, and has_cap() says NO:
--     insert a grant and a deny of one capability on one member, then
--     `select public.has_cap('<cap>')` as that member → FALSE (deny wins).
--
-- 3 · revoking the DENY restores the GRANT — the behaviour that justified
--     widening over latest-wins:
--     `update … set revoked_at = now() where mode = 'deny'` → has_cap() TRUE.
--
-- 4 · a second GRANT of the same capability is still refused:
--     → unique_violation on the same index name. The widening admits one new
--       row per capability, not unlimited rows.
--
-- Harness assertion 37 (Batch 26 item 9) is (2) and (3) as a standing test, with
-- the grant alone as its positive control. A-3 named that assertion as owed:
-- assertion 31 passes IDENTICALLY before and after this migration, so it cannot
-- witness the change — a migration whose justification no test can see is
-- indistinguishable from a migration nobody needed.
-- ═══════════════════════════════════════════════════════════════════════════
