# THROUGHLINE — HANDOFF

**This is the first read.** It exists in the repository because its predecessor
did not: the open list was kept outside the repo, drifted from the code with
nothing able to contradict it, and four live defects fell off it entirely
(recovered by Batch 6 item 0). Everything below was verified against the code
and the live database on 2026-08-28 — nothing is quoted from memory of what a
batch was supposed to do.

After this, read `docs/specs/` in order: S0 → S0-A → S0-conformance → S1-P →
S-V → S1 → S2. **Where S0 and S0-A disagree, S0-A wins.** `CLAUDE.md` holds
the working mechanics (commands, clients, route groups, env vars).

---

## 1. What this is

**Throughline** is a film-production OS built to sell (S0 P-1). McPrime
Digital is tenant zero and a real dependent user — not the customer. The
client portal it grew from is live with real client traffic (S0 P-2), so every
change ships against a running system: no big-bang migrations, no coordinated
outages.

**Three spaces** (`lib/studio/spaces.ts`): **Crew** (team-only — chat, tasks,
pipeline, control tower), **Client** (the studio's window into client work),
**Workspace** (the craft floor — Script Design, Storyboard, generation,
finishing). Admin front door is `/studio`; the proxy bounces all `/admin/*`
URLs there.

**Two client-side surfaces, not one** (S1 §0 — the correction that shaped the
tenancy model):

| Surface | Route group | Whose tool | Roster |
|---|---|---|---|
| Client Management | `/studio/client/*` | The studio's | `organization_members` |
| Client Portal | `app/(portal)/` | The client company's own | `client_members` |

The portal is a mini-tenant inside a tenant: own roster, own roles
(owner/approver/member/viewer), own project scoping, own invite policy. It is
a parallel entitlement tree, never "the studio's permissions minus some."

**Stack:** Next.js 16 (App Router, RSC), React 19, TypeScript strict,
Tailwind v3 + design tokens, Supabase (Postgres/Auth/Realtime), Cloudflare R2
via presigned direct-to-R2 uploads, Zustand, BlockNote + Yjs for collaborative
docs, Sentry (errors only). Vercel. No test framework beyond
`scripts/test-rls.ts`.

## 2. Who it serves

`organizations.type` is the archetype axis (0018; S1 §4) — consulted so
enterprise later is configuration, not a rebuild:

| `type` | Config | Spaces | Approval counterparty |
|---|---|---|---|
| `client_serving` | A | Workspace + Client + Crew | External client contact |
| `internal` | B | Workspace + Crew | Internal stakeholder |
| `solo` | C | Workspace + minimal Crew | Self / investor |

Everything live today is `client_serving`. v1 target archetypes: production
companies and creative agencies (O-1/O-2, S1-P) — defining trait is a large
rotating freelance bench, which is why pricing is seats + usage credits and
why crew project scoping exists.

**v1's definition of done is not "launch." It is "studio two is live and
paying"** (S-V §13).

## 3. Settled architecture — and why

- **AD-001 — RLS owns tenancy; the capability matrix owns capability;
  service role is an enumerated allowlist.** The deciding constraint is
  Realtime: browser subscriptions authenticate as the user and are filtered
  by RLS, so correct RLS must exist regardless — app-layer-only would pay
  RLS's full cost and collect none of its protection. Done through migration
  0021: the database is now the tenancy boundary, proven by the harness.
- **AD-002(-R) — one US region; `organizations.region` exists** (0018) so a
  second region is a deployment, not a rewrite. Film has its own residency
  regime (TPN audits, studio content-security riders).
- **AD-003 — deleting a person never deletes their work.** FKs onto
  `auth.users` are `ON DELETE SET NULL` (0016). Batch 6.2 extended the
  spirit: removing a member deletes the membership, never the auth account.
  Pseudonymisation of denormalized names is still open (S3).
- **AD-004(-R) — one file pipeline.** Chat attachments already are `files`
  rows, metered and vaulted (S0's original premise was wrong — S0-A corrects
  it). The real work: attachment FK instead of `"bucket::path"` strings,
  body-trust fix, orphan cleanup, resumable multipart uploader. All open (S3).
- **AD-005 — FDX import/export is Script Design's adoption gate.** Final
  Draft interchange or professionals cannot adopt it at all. Gated on the
  document-types question.
- **AD-006 — Review Session, not generic video meetings.** Synced
  frame-accurate playback; cineSync's category at indie price. Gated on I-2
  and S5 (proxy render pipeline).
- **The access model, as built:** JWT claims route (`current_org()`), the
  roster decides (`is_org_member()` / `is_client_member()` read status from
  the tables on every query — revocation needs no token refresh). The Custom
  Access Token Hook (0022, enabled in production) guarantees the org claim at
  token issue; `app_metadata.roles` is stamped but ADVISORY — nothing may
  authorize on it without a forced-refresh design (0022 header). Multi-org
  switching (v2) must be a URL segment, never a claim.

## 4. The prime directive and the invariants — current status

> **No operation in the system may be unbounded.** Growth costs money, never
> a rewrite.

| ID | Invariant | Status 2026-08-28 |
|---|---|---|
| I-1 | Keyset pagination everywhere | **VIOLATES** — no keyset pagination anywhere; messages/files/tasks load unbounded |
| I-2 | Realtime scoped, ≤2 subs/session | **VIOLATES** — global `presence:app` channel (`components/shared/PresencePulse.tsx`), ~13 subs on a loaded session |
| I-3 | No polling where push exists | **VIOLATES** — 16 `setInterval` sites remain; de-poll is gated on per-surface RLS verification (S0-A §4.2), now unblocked by the harness |
| I-4 | >5s work runs on a queue | **NOT BUILT** — no queue exists; blocks AI generation jobs (S5) |
| I-5 | AI calls ceilinged + budget-checked | **PARTIAL** — muse gates on balance/hard-stop, but `org_budgets.hard_stop` still defaults **false** (`0002:28`) — S0 §4 says on-by-default; the flip was scheduled in S1 §7 and never landed |
| I-6 | Ownership server-resolved, never from the body | **PARTIAL** — activity ledger (6.1), team routes (3A + 6.2), edit pages (6.6) fixed; `portal/actions:225` / `admin/project-actions:123` still write body attachment refs |
| I-7 | Schema validation at API boundaries | **PARTIAL** — first zod boundary is `app/api/activity/route.ts` (the pattern to copy); 40 route handlers unvalidated |
| I-8 | No service role on user-session paths | **VIOLATES** — 71 files import `supabaseAdmin`; the allowlist + lint ratchet (S2 §7) is not built; read-path flips not started |
| I-9 | Explicit tenant filter on every query | **PARTIAL** — studio reads (3A), edit pages (6.6), heartbeat (B2) scoped; inserts still lean on column DEFAULTs — the `tenantScope()` helper (S1 §8.1) is not built |
| I-10 | No silent failure; errors reach a sink | **PARTIAL** — Sentry + `captureError()` live (6.4); ~75 empty catches remain, converted opportunistically inside feature work |
| I-11 | No module-scope env-dependent clients | **VIOLATES** — `lib/supabase/admin.ts:5`, `lib/r2.ts:16`; fix pairs with the I-8 pass (same 71 files) |
| I-12 | Idempotent, forward-only, single ordering | **CONFORMS for new work** — 0018–0023 are guarded; the `2026*` series is archived (6.9); 0000–0004 remain non-idempotent as captured history |

## 5. Capacity decisions

S0 §4 in one line each, unchanged: tenants uncapped; 1,000 soft seats;
messages unbounded but keyset-paginated at 50/page (once I-1 lands); 5 GB
attachments / 5 TiB masters (R2), 100 MB multipart threshold; 500K-char
documents; 50 concurrent editors, unlimited viewers (viewers don't broadcast
awareness); $2 AI per-call ceiling; hard-stop at zero balance **on by default
(decision — schema still says false, see I-5)**; p95 2.5s; no uptime SLA and
no copy implying one. Retention: 90-day soft-delete grace, 7-year activity
log, 30-day erasure — **no expression surface yet** (no `deleted_at`
anywhere; S3 owns the schema).

## 6. What has been built, chronologically

Batches before the spec stack (2026-05→08): portal + studio shell, Script
Design (BlockNote+Yjs, pagination via ProseMirror decorations), direct-to-R2
uploads, invoicing, notifications/presence/push, PrimeOS assistant, credit
metering + Stripe top-ups, Teams & Roles both sides, member lifecycle.

The audited era, each batch with what it *found*:

| Batch | Landed | Found while doing it |
|---|---|---|
| Spec stack (2026-08-25/26) | S0, S0-conformance, S0-A, S1-P, S-V, S1, S2 | S0's AD-004 premise false against code; T-1…T-5 make tenant two *impossible*, not leaky; `20260603/4` policies would reintroduce privilege escalation if re-run |
| 0018 + B1–B4 | Archetype+region, per-tenant email/settings, crew scoping (`scope_mode`), owner bootstrap scoped (T-4), heartbeat scoped | The "no rows = all projects" footgun → `scope_mode` stated, not inferred |
| Quick three + 0019 | Draft invoices legal; `project-tasks`/`push-subscribe` use membership; `CRON_SECRET` fails closed | — |
| S2 b.2 (harness) | `scripts/test-rls.ts` — 10 assertions, positive controls, VACUOUS tracked separately | Baseline: live cross-tenant reads (176 messages/139 tasks readable by tenant two) |
| S2 b.3A/3B | Studio reads org-scoped; pause/revoke cuts claims (`lib/memberAccess.ts`) | SDK cannot revoke sessions by user id — stale-token window documented, closed structurally by 0021 |
| 0020 (S2 b.4a) | Auth helpers (`is_org_member` …); membership policies org-scoped | First-admin bootstrap must stay service-role (0020 header) |
| 0021 (S2 b.4b) | Policy classes A/B/D/E — 50 policies replaced; `clients` column grants | Wrapped-subselect InitPlan rule; reading your own revoked roster row is correct, not a leak (assertion 6) |
| S2 b.5 | Portal gate on `getUser()` + lint ban; default-deny + `FeatureKey` typing; 0022 access-token hook (enabled, live-verified) | `getSession` legitimately needed exactly once (`set-password`); hook precedence: roster beats stored claim |
| Batch 6 item 0 | Audit of four fallen-off defects | All four open; `HANDOFF.md` never existed — this file is the fix |
| 6.1 | Activity ledger: target authorized, zod (first I-7 boundary), org stamped, roster actor-name | `ownName()` still prefers user-editable `user_metadata` for display names portal-wide |
| 6.2 | `deleteUser` removed everywhere; `client-team`/`delete-client` org-scoped | *Every* `client-team` action was cross-tenant, not just delete; `orgRolesOf` resolves a claim-admin with no roster row to `member` (T-4 fallback) — the claims cut is load-bearing |
| 6.3 | XSS: `preview` is text, sink deleted, print sandboxed | `printDoc`'s `about:blank` window inherited the app origin — a second sink the report missed |
| 6.4 | Sentry + `captureError`; usage/credits/commit converted | supabase-js returns errors, doesn't throw — try/catch around inserts was double-blind |
| 6.5 | Metering traced; single write path restored (native units) | **Nothing was broken**: no file had been committed since metering landed (2026-08-25); `void recordUsage` races the lambda freeze — commit path now awaits |
| 6.6 | Edit pages org-scoped | Project edit's dropdown listed every tenant's clients; detail-page siblings already scoped |
| 6.7 | `mark_overdue_invoices(p_org)` (0023, printed); both callers pass org | The "single call site" premise was wrong — the portal page still swept every tenant on each client view |
| 6.8 | `client_members` sole authority; double-`.single()` fixed; dead `user_id` write removed | Backfill re-verified live: 0 primary logins missing a member row |
| 6.9 | `2026*` → `_archive/` + README | No runner exists to confirm — the fence is the directory + rule 2 for whatever S6 adopts |

## 7. Current state (verified 2026-08-28)

- **Branch:** `throughline` (main ⊆ throughline, fast-forward).
- **Migrations applied:** 0000–0022. **0023 printed, NOT applied** — apply it,
  then deploy (RPC signature change; old code's bare call fails silently in
  the window, which merely pauses overdue-flipping).
- **Access token hook:** enabled in production, verified from a live JWT.
- **Harness:** `npm run test:rls` → **10 pass / 0 fail / 0 vacuous / 0
  error**; positive controls 3,3,2,2,2,2.
- **`tsc --noEmit`:** clean. **Lint:** 354 problems (baseline; failures do
  not fail the build). **`npm run build`:** green, Sentry-wrapped.
- **Live data:** 1 real org + harness org · 8 client companies (2 harness) ·
  13 auth users (6 harness) · 21 files · ~200 messages.
- **Sentry:** wired; `NEXT_PUBLIC_SENTRY_DSN` unset until a project is
  created — capture no-ops to console meanwhile.

## 8. What is open — citable only

**Live defects / security**
1. Body-trusted attachment refs: `app/api/portal/actions/route.ts:225`,
   `app/api/admin/project-actions/route.ts:123` (I-6; AD-004-R item 2).
2. Message delete orphans the file + R2 object:
   `app/api/portal/messages/delete/route.ts:43` (AD-004-R item 3).
3. `hard_stop` default false: `supabase/migrations/0002_cost_metering.sql:28`
   — one migration + backfill; highest exposure-to-cost ratio still unlanded.
4. Display names portal-wide prefer user-editable `user_metadata`:
   `lib/team.ts` `ownName()` (~line 102). The ledger route resolves from the
   roster (6.1); everything else does not.
5. Global presence discloses cross-tenant:
   `components/shared/PresencePulse.tsx:39-66` — one `presence:app` channel,
   everyone sees everyone (C-3; also the I-2 violation).
6. `app/api/admin/team/route.ts:87` and `portal/team/route.ts:124` and
   `lib/sms.ts:24` still `void recordUsage(...)` — lambda-freeze roulette
   (commit path fixed in 6.5).
7. UI copy still promises account destruction on removal:
   `components/studio/TeamManager.tsx:153,319`,
   `components/portal/ClientTeamManager.tsx:154,379`,
   `components/admin/ClientTeamPanel.tsx:196,198` (behaviour changed in 6.2).
8. `onboarded_at`/onboarding resolve clients by the deprecated column:
   `app/auth/callback/route.ts:104`, `app/onboarding/page.tsx:20` — must move
   to `app_metadata.client_id`/membership before Batch 7 drops
   `clients.user_id`. Insert-time writers to keep until then:
   `app/api/admin/create-client/route.ts:144`, `invite-client/route.ts:78`.

**Structural (sequenced, not forgotten)** — the I-8/I-11 pass (allowlist
ratchet first, 71 files); read-path flips per surface, portal dashboard first
(S2 §7 order); I-1+I-3 per surface together; `tenantScope()` insert-stamping
helper + lint (T-5, S1 §8.1); retention schema (S3); AD-004-R's resumable
uploader + FK; provenance tables have zero reads/writes
(`supabase/migrations/0003`); dead code inventory (C-6) including
`app/(admin)` group (S4), `hooks/useFileUpload.ts`, `lib/r2.ts:39-107`.

## 9. What to do next

1. **Apply 0023**, deploy the queued pair, run the harness.
2. **Batch 7 candidates, in order:** `hard_stop` flip (one migration);
   `clients.user_id` drop (0.8's reference list above must empty first);
   the I-8 allowlist ratchet + lazy accessors (the lint rule lands before
   the migration so the surface cannot regrow — S0-A §4.4).
3. **Then S3-core:** messaging schema, approval decoupling (X-2), file
   version stacking, retention columns, attachment FK — the S2 spec's exit
   note names them.

The v1 cap (S-V §13) is the boundary: nothing outside it before studio two
is live and paying.

## 10. Working agreements

- **One commit per item, independently revertable.** Commit messages record
  what was *found*, not just what changed — they are the audit trail this
  file is compiled from.
- **Batch discipline:** items in order; stop-and-report when an item is
  materially larger than described, needs an unnamed file, or a premise
  fails. Refusals and premise-corrections are wanted — they have caught real
  defects repeatedly (six before Batch 6; Batch 6 added the portal overdue
  sweep and the client-team action sweep).
- **Migrations are printed, never applied by the agent.** Applied by hand in
  the SQL editor, `00NN` order, forward-only, idempotent, every
  `create policy` preceded by `drop policy if exists`. Table-shape changes:
  queue the deploy behind the migration, reload the PostgREST schema cache.
- **`tsc --noEmit` after every commit; report the lint delta** (baseline
  354). Run the harness after anything touching policies, auth, or tenancy.
- **Verify before writing.** Claims about the code cite `path:line`; claims
  about the database come from a live read. This file drifts the moment that
  stops.
- Never paper over an RLS failure with `supabaseAdmin`. Never add hardcoded
  McPrime identity (P-1). New code must not add invariant violations even
  where the surrounding code already violates one.

## 11. Still unanswered

1. **Migration runner** — which tool, and when (S6). `_archive/README.md`
   rule 2 binds whatever is chosen.
2. **Crew project-scoping default** for a new member — all projects or none
   until scoped? (S1 §10.3; client side is permissive, freelance-bench logic
   argues restrictive.)
3. **Does the archetype axis affect billing?** (S1 §10.4 → S3.)
4. **Document types** (screenplay/treatment/bible) before FDX, or accept
   rework (S0-A §4.7 → AD-005).
5. **`(admin)` route group** — its pages are canonical modules re-exported by
   studio wrappers (6.6 confirmed), so "delete or retain" is really "where do
   canonical modules live" (S4).
6. **Whether a browser-callable activity endpoint should exist at all** —
   server-side emission as a side effect of the real action is the stronger
   shape (6.1 report → S3).

Hours per week is answered — **30** — and is not carried forward.
