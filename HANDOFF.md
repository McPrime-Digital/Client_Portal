# THROUGHLINE — HANDOFF

**This is the first read.** It exists in the repository because its predecessor
did not: the open list was kept outside the repo, drifted from the code with
nothing able to contradict it, and four live defects fell off it entirely
(recovered by Batch 6 item 0). Everything below was verified against the code
and the live database on 2026-08-28 — nothing is quoted from memory of what a
batch was supposed to do. Last compiled after **Batch 7**.

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
`scripts/test-rls.ts`. Operator scripts: `npm run test:rls`,
`npm run seed:harness`, `npm run provision:tenant` (creates a tenant and its
first owner — the only way a second studio can exist).

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
| I-2 | Realtime scoped, ≤2 subs/session | **VIOLATES** — the *disclosure* half is closed: presence is `presence:org:${orgId}`, per tenant (7.2). The *budget* half is untouched — ~13 subs on a loaded session, and eight other globally-named channels (sidebars, bells, rosters). S0-A §6 routes it to S2.5 |
| I-3 | No polling where push exists | **VIOLATES** — 16 `setInterval` sites remain; de-poll is gated on per-surface RLS verification (S0-A §4.2), now unblocked by the harness |
| I-4 | >5s work runs on a queue | **NOT BUILT** — no queue exists; blocks AI generation jobs (S5) |
| I-5 | AI calls ceilinged + budget-checked | **PARTIAL, and accurate for the first time.** Fixed (7.1): `hard_stop` defaults **true** (0024) and `getCreditState` treats a *missing* `org_budgets` row as gated — the column default alone changed nothing, because nothing in the app inserts that table. The house org is explicitly exempt. Not fixed: the **$2 per-call ceiling is unbuilt** — no surface enforces one, so a single call is bounded only by `max_tokens` |
| I-6 | Ownership server-resolved, never from the body | **PARTIAL** — activity ledger (6.1), team routes (3A + 6.2), edit pages (6.6) fixed; display names now resolve from the roster, not user-editable `user_metadata` (7.8); `portal/actions:225` / `admin/project-actions:123` still write body attachment refs |
| I-7 | Schema validation at API boundaries | **PARTIAL** — first zod boundary is `app/api/activity/route.ts` (the pattern to copy); 40 route handlers unvalidated |
| I-8 | No service role on user-session paths | **VIOLATES — but ratcheted (7.9).** 71 modules touch the service role (69 importers + 2 inline constructors), all allowlisted in `lib/supabase/admin-allowlist.mjs` and split PERMANENT / TRANSITIONAL. Two ESLint rules hold the line: the import, and naming `SUPABASE_SERVICE_ROLE_KEY` inline. **No file has migrated yet** — that is S2 §7 steps 4-6 |
| I-9 | Explicit tenant filter on every query | **PARTIAL** — studio reads (3A), edit pages (6.6), heartbeat (B2), `orgRolesOf` (7.5) scoped; inserts still lean on column DEFAULTs — the `tenantScope()` helper (S1 §8.1) is not built. `lib/sms.ts:24` still meters every tenant's SMS against `DEFAULT_ORG_ID` |
| I-10 | No silent failure; errors reach a sink | **PARTIAL** — Sentry + `captureError()` live (6.4); metering writes are awaited rather than `void`ed (7.3, 7.4) and the invite's claim-stamp error surfaces (7.5); ~75 empty catches remain, converted opportunistically inside feature work |
| I-11 | No module-scope env-dependent clients | **VIOLATES** — `lib/supabase/admin.ts:5`, `lib/r2.ts:16`; fix pairs with the I-8 pass (same 71 files) |
| I-12 | Idempotent, forward-only, single ordering | **CONFORMS for new work** — 0018–0025 are guarded; the `2026*` series is archived (6.9); 0000–0004 remain non-idempotent as captured history |

## 5. Capacity decisions

S0 §4 in one line each, unchanged: tenants uncapped; 1,000 soft seats;
messages unbounded but keyset-paginated at 50/page (once I-1 lands); 5 GB
attachments / 5 TiB masters (R2), 100 MB multipart threshold; 500K-char
documents; 50 concurrent editors, unlimited viewers (viewers don't broadcast
awareness); $2 AI per-call ceiling **(still unbuilt — nothing enforces one)**;
hard-stop at zero balance **on by default — implemented 7.1, house org exempt**;
p95 2.5s; no uptime SLA and no copy implying one. Retention: 90-day soft-delete grace, 7-year activity
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
| 7.1 | `hard_stop` default true (0024, printed) + missing-row fallback flipped | The column default alone changes nothing — **nothing in the app inserts `org_budgets`**, so the app-side `?? false` was the real default. And a blanket backfill would have taken the live tenant offline: McPrime's balance is −15¢, so gating it blocks PrimeOS AI. House org excluded |
| 7.2 | Presence scoped `presence:app` → `presence:org:${orgId}` | Behaviour inside a tenant is unchanged — both selectors already discarded what the scoping removes. A third mount site exists in the dead `(admin)` group |
| 7.3 | Three `void recordUsage` → awaited | `lib/sms.ts:24` meters against `DEFAULT_ORG_ID`, so every tenant's SMS bills to tenant zero (T-5) |
| 7.4 | Provider-reported tokens; kind `primeos` → `ai.text.tokens` | OpenAI omits `usage` from a stream unless `stream_options.include_usage` is sent — it never was, which is why estimating looked unavoidable. The charge was also `void`ed inside the stream; it is awaited **before** `controller.close()` now |
| 7.5 | `scripts/provision-tenant.ts`; invite writes roster→claims; all four `['member']` sources removed | The old bootstrap was **self-destructing**: its count had no status filter, so a bootstrap owner's first invite demoted them from `owner` to `member`, out of their own team management. And the fallback had three downstream copies — removing only `lib/team.ts` would have closed nothing |
| 7.6 | Two `clients.user_id` readers moved; **drop BLOCKED** | The brief named 2 readers; there are **5**. And neither `create-client` nor `invite-client` creates the paired `client_members` row — so a client company created today has **no membership at all**. Live now, not just a drop blocker |
| 7.7 | Removal copy tells the truth | `TeamManager.tsx:153` never interpolated `${name}` — the crew confirm dialog never said who was being removed |
| 7.8 | `ownName()` prefers the roster over `user_metadata` | The output is persisted into `messages.sender_name` and `activity_log.actor_name`, so it was the 6.1 ledger forgery through a second door. Display change for real users: **zero** — all six have identical roster and metadata names |
| 7.9 | I-8 allowlist + two lint rules (ratchet only) | The rule found two importers a grep could not — multi-line import specifiers. HANDOFF's count of 71 was right; the grep-based 67 was wrong |

## 7. Current state (verified 2026-08-28, after Batch 7)

- **Branch:** `throughline` (main ⊆ throughline, fast-forward).
- **Migrations applied: 0000–0023.** 0023 **is applied** — verified by probing
  for the named `p_org` parameter, which only resolves against the new
  signature. The prior "0023 printed, NOT applied" line was stale.
- **Printed, NOT applied:**
  - **0024** — `org_budgets.hard_stop` default → true, backfill excluding the
    house org. Not a table-shape change; no deploy queued behind it. Verification
    queries are in the file footer.
  - **0025** — drops `clients.user_id`. **BLOCKED, and the file refuses to run**:
    two guard blocks abort if any client company lacks an active owner in
    `client_members`, or if any live policy still reads the column. Both
    preconditions in §8.1 must clear first. **TABLE-SHAPE CHANGE** when it lands
    — ship code, apply, reload the PostgREST schema cache.
- **Access token hook:** enabled in production, verified from a live JWT.
- **Harness:** `npm run test:rls` → **10 pass / 0 fail / 0 vacuous / 0
  error**; positive controls 3,3,2,2,2,2.
- **`tsc --noEmit`:** clean. **Lint: 353** problems (was 354 — 7.7 removed an
  unused-parameter warning; failures do not fail the build). **`npm run build`:**
  green, compiled in 16s, Sentry-wrapped.
- **Live data:** 3 organizations (McPrime + 2 harness) · 8 client companies (2
  harness) · 13 auth users (6 harness) · 21 files · ~200 messages · 15
  `usage_events` rows with kind `primeos` · `org_credits` for McPrime at
  **−15¢** (it billed past zero because `hard_stop` was false — the exposure 7.1
  closes for every tenant but the house org).
- **Storage metering works.** A real upload wrote `storage.bytes` = 65,035,931 at
  2026-08-28 10:53Z. The Batch 6.5 question is answered.
- **Every admin's claim org matches their roster row** (verified across all 13
  auth users), and no admin claim exists without a roster row — which is what
  made 7.5's org-scoped `orgRolesOf` safe to ship.
- **Sentry:** wired, but `NEXT_PUBLIC_SENTRY_DSN` is **not present in
  `.env.local`** — capture no-ops to console locally. The batch brief listed
  "Sentry DSN set" as a precondition; if it is set in Vercel's environment that
  is not visible from the repo, and it is not set for local runs.

## 8. What is open — citable only

### 8.1 BLOCKING — client onboarding is broken right now

**Neither client-creation route creates a `client_members` row.**
`app/api/admin/create-client/route.ts:143-155` and
`app/api/admin/invite-client/route.ts:77-89` insert `clients` (with `user_id`)
and stamp `app_metadata.client_id`, and stop there. No trigger fills the gap;
migration `0012`'s backfill covered only the rows that existed then.

Since Batch 6.8 made `client_members` the sole authority, a client company
created **today** produces a login with no membership: `clientMembershipOf()`
returns null, `portalAccess()` returns null, and the person lands in an empty
portal shell. Every existing company is fine — all 8 have an active owner row —
but only because the last real one was created 2026-06-02, before the backfill,
and the two harness companies were seeded with explicit rows. **The next client
created breaks.**

Fix: insert the owner `client_members` row on both paths, in the order
`clients` → `client_members` → claims (7.5's ordering rule). It also unblocks
half of §8.2.

### 8.2 `clients.user_id` — three readers still to move

Batch 7.6 moved the two the brief named (`auth/callback`, `onboarding/page`). A
re-grep found five. These three are live, and 0025 will not run until they and
§8.1 clear:

| Site | Failure after the drop |
|---|---|
| `app/api/presence/heartbeat/route.ts:27` | **Silent.** `last_seen_at` stops updating, so every client reads "away" and the escalation path emails/texts people who are in the app |
| `app/api/admin/delete-client/route.ts:34` | **Loud.** 42703 → `fetchError` → 404 "Client not found." Deleting a client company stops working |
| `lib/notify.ts:196` | **Silent.** Recipient resolves to all-nulls; client push and email stop targeting anyone |

Two are decisions, not moves: `delete-client` cuts claims for the primary login
only and `notify` pushes to the primary login only. Post-6.8 the authority is
`client_members`, so both need an answer to "every member of the company, or
just one?" — a fan-out change. `scripts/seed-harness-tenant.ts:273-281` writes
the column too and loses that step in the same change.

### 8.3 Live defects / security

1. Body-trusted attachment refs: `app/api/portal/actions/route.ts:225`,
   `app/api/admin/project-actions/route.ts:123` (I-6; AD-004-R item 2). **S3.**
2. Message delete orphans the file + R2 object:
   `app/api/portal/messages/delete/route.ts:43` (AD-004-R item 3). **S3.**
3. The `$2` per-call AI ceiling (S0 §4) is **unbuilt**. 7.1 fixed the *budget*
   half of I-5; nothing bounds a single call but `max_tokens: 2000` in
   `app/api/studio/muse/route.ts:141`.
4. `lib/sms.ts:24` meters every tenant's SMS against `DEFAULT_ORG_ID` (T-5).
5. The cron route's **POST** half (`app/api/cron/message-nudge/route.ts:90-99`)
   is a user-session path — `PresencePulse` calls it on every page load — running
   a service-role scan of every unread message. Allowlisted as PERMANENT for its
   GET half only; the POST half is not.

Closed in Batch 7 and **not** to be re-opened: `hard_stop` default (7.1) ·
global presence disclosure (7.2) · the three `void recordUsage` sites (7.3) ·
estimated AI cost and the `primeos` kind (7.4) · the tenant bootstrap and all
four `['member']` sources (7.5) · account-destruction copy (7.7) ·
`user_metadata` display names (7.8) · the missing I-8 ratchet (7.9).

### 8.4 Structural (sequenced, not forgotten)

The I-8 **migration** — the ratchet exists (7.9), no file has moved; read-path
flips per surface, portal dashboard first (S2 §7 order), paired with I-11's
`getSupabaseAdmin()` accessor in one pass (S0-A §4.3) · I-1 + I-3 per surface
together · I-2's subscription budget: eight globally-named channels and ~13
subs/session (S2.5) · `tenantScope()` insert-stamping helper + lint (T-5,
S1 §8.1) · retention schema (S3) · AD-004-R's resumable uploader + attachment FK
· provenance tables have zero reads/writes (`supabase/migrations/0003`) · dead
code inventory (C-6) including `app/(admin)` (S4), `hooks/useFileUpload.ts`,
`lib/r2.ts:39-107`.

## 9. What to do next

The foundation is **not** clear. Two things block, in this order:

1. **§8.1 — the `client_members` insert.** This is not sequencing, it is a live
   break: onboarding a new client today produces an unusable login. Smallest and
   most urgent item on this page.
2. **§8.2 — the three remaining `clients.user_id` readers**, then apply 0025.
   Its guard blocks will refuse the drop until §8.1 is fixed anyway.

Then, in any order:

3. **Apply 0024** and confirm with the queries in its footer.
4. **Decide the `$2` per-call ceiling** (§8.3 item 3) — the other half of I-5,
   and the one that matters once generation exists (S-V §10: budget check →
   per-call ceiling → route → queue → meter → provenance).
5. **Start the I-8 migration proper**: portal dashboard off `supabaseAdmin`,
   paired with I-11, shrinking `admin-allowlist.mjs` one surface at a time.

**Then S3-core:** messaging schema, approval decoupling (X-2), file version
stacking, retention columns, attachment FK. Nothing found in Batch 7 forces any
of those to be redone — see the closing note of the Batch 7 report.

The v1 cap (S-V §13) is the boundary: nothing outside it before studio two is
live and paying. Note that studio two is now *possible* — `npm run provision:tenant`
creates an organization and a working owner, proven end to end (7.5) — which it
was not before this batch.

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
   canonical modules live" (S4). 13 of the 71 service-role modules are in it.
6. **Whether a browser-callable activity endpoint should exist at all** —
   server-side emission as a side effect of the real action is the stronger
   shape (6.1 report → S3).
7. **Claim-cut fan-out on the client side** (new, from 7.6) — `delete-client`
   and `lib/notify.ts` each act on the primary login alone. With `client_members`
   as the authority, should they act on every member of the company? Gates §8.2.
8. **The `$2` per-call AI ceiling** (new, from 7.1) — where it is enforced, and
   what "confirm above" means in a streaming UI. S0 §4 fixes the number; nothing
   fixes the mechanism.

Hours per week is answered — **30** — and is not carried forward.

**Two questions the Batch 7 brief asked to remove, and why they are still here.**
The brief said "§11: remove question 2 (answered). Remove question 6 if item 6
landed." §11 question 2 is *crew project-scoping default for a new member*, and
question 6 is *whether a browser-callable activity endpoint should exist* —
neither is what those instructions describe. The brief's "question 2" is storage
metering, which is answered (§7) but was never a §11 entry; and item 6 is the
`clients.user_id` retirement, which resolves **S1 §10 q2 / S2 §11 q4**, not this
list's q6 — and did not land in any case. Both entries are left open.
