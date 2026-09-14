# GENRELINE — HANDOFF

**This is the first read.** It exists in the repository because its predecessor
did not: the open list was kept outside the repo, drifted from the code with
nothing able to contradict it, and four live defects fell off it entirely
(recovered by Batch 6 item 0). Everything below was verified against the code
and the live database on 2026-08-28 — nothing is quoted from memory of what a
batch was supposed to do. Last corrected after **Batch 26** (the rest of `S-R`: seat class, project roles,
the scoping default and A-3's index — migrations 0055–0059, harness 35 → 40 —
2026-09-13, with every rule proven as a real persona on the anon key and every
new assertion run RED before it was trusted); Batch 8 was the final foundation
batch.

After this, read `docs/specs/` in order: S0 → S0-A → **S0-B** → S0-conformance
→ S1-P → S-V → **S-F** → S1 → S2 → **S-C** → **S3-core** → **S3-core-A** →
**S3-b** → **S3-c** → **S-R** → **S-R-A**. **Where S0 and S0-A disagree, S0-A wins**, and the same rule binds
`S3-core` and `S3-core-A`; **S0-B supersedes the product name in all of them.**
**`S-F` (feature scope and market position) supersedes `S-V` §13 — the v1 cap
— in full**; `S-V` §1–§12 stand as the destination, and the redrawn cap is
`S-F` §7. `S3-core` is the schema for message rooms, approvals, file
versioning and retention; `S3-core-A` (settled) supersedes its named sections
— it was written from the Batch 13 item 0 audit, and two of its amendments
prevented data loss. `S3-b` is the schema for the four shapes `S-F` §9 moved
into v1, and is sequenced after `S3-core`. `S3-c` (approvals, review and live
artifacts) **supersedes `S3-core` §2 (the approvals tables), `S3-core` §9.2
and `S-F` §3.3 where they disagree** — approval is a record, not a gate:
silence auto-advances and is never written as approval — and is sequenced
after `S3-core` migrations 1–7 as migration 8 onward. `S-R` (roles,
capabilities and surfaces) is **settled**, and Batch 25 BUILT its
money-and-people half: the four axes (seat class, company role, project role,
individual grants and denials), the capability namespace, delegation limits, live
propagation, and how a dashboard composes from a capability set. It
**supersedes `S1` §5.1 and `S2` §5**, and it **amends `S0` AD-001 at its §9** —
an amendment now live as 12 policies across eleven tables (0053). **Read it with
`S-R-A` in hand — it is committed and settled:** four of S-R's statements are
false against the code, one of its design decisions was superseded during the
build, and its §10 index makes R-3 unreachable.
Seat class, project roles and the scoping default **are built** (Batch 26,
migrations 0055–0059), so a crew member no longer reads every project in the
tenant: the predicate is on 14 policies and, since 0059, in **both USING and WITH
CHECK**. `S-R-A` A-3's index widening landed with the assertion it named as owed. `S-R-A` (settled) supersedes the named sections of `S-R`, in the same
relationship `S0-A` has to `S0` and `S3-core-A` to `S3-core` — **where they
disagree, `S-R-A` wins.** It was written from the Batch 25 build: four of
`S-R`'s claims are false, its capability vocabulary shipped one granularity
coarser than specified, and **its §10 unique index makes R-3 unreachable**,
which is the one amendment carrying a migration rather than a correction. `S-F`, `S-C`
(communications and sender identity), `S3-core`, `S3-b` and `S3-c` are
**draft for approval** — the five specs in the stack that are not settled.
`CLAUDE.md` holds the working mechanics (commands, clients, route groups,
env vars).

**The product is Genreline** (S0-B PI-1). "Throughline" was the working name
through the spec phase; every batch entry below that says Throughline is left
as written, because it records what was true when it was written. The branch
is still `throughline` and is not renamed.

---

## 1. What this is

**Genreline** is a film-production OS built to sell (S0 P-1, S0-B PI-2).
McPrime Digital is tenant zero and a real dependent user — not the customer,
and with no special claim on the product. The
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

- **S0-B — product identity.** The product is **Genreline**; the production
  domain is `genreline.com` with three more planned, so the application's own
  origin is configuration read in one place (`lib/appOrigin.ts`, 9.1). And the
  rule that governs every branding decision: **the client portal wears the
  TENANT's brand, the studio wears the product's.** Replacing "McPrime Digital"
  with "Genreline" on a client-facing page swaps one wrong name for another —
  a client of McPrime bought from McPrime.
- **S-C — communications (draft).** Two voices: Genreline speaks to the studio
  it sells to; the studio speaks to everyone downstream of it. A studio's
  clients never receive mail branded Genreline. Sender identity is **resolved
  from the tenant, never read from configuration** — an environment variable
  may supply the sending ADDRESS, it may never supply the IDENTITY. Layer 1
  (display name + Reply-To + branded body on the product's verified domain)
  serves every tenant with no per-tenant DNS; Layer 2 (a studio's own sending
  domain) is a lookup on the same code path, built when a studio asks.

- **AD-001 — RLS owns tenancy; the capability matrix owns capability;
  service role is an enumerated allowlist.** The deciding constraint is
  Realtime: browser subscriptions authenticate as the user and are filtered
  by RLS, so correct RLS must exist regardless — app-layer-only would pay
  RLS's full cost and collect none of its protection. Done through migration
  0021: the database is now the tenancy boundary, proven by the harness.
  **AMENDED by `S-R` §9 and BUILT in Batch 25 (0053).** 12 policies now carry a
  `public.has_cap()` predicate ANDed onto their tenancy one, on **eleven tables —
  wider than §9's nine** (`S-R-A` A-10): §9's nine plus
  `organization_member_projects` and `client_member_projects`, because the scope
  of a membership is part of the membership record, and leaving them out would
  let a granted `people.manage` change a role but not the project scope attached
  to it. The nine §9 names:
  `invoices` (money.invoices) · `org_credits`, `org_budgets`, `credit_ledger`,
  `usage_events` (money.costs) · both rosters, both `*_member_projects` and both
  `*_cap_grants` (people.manage). Nothing was substituted — every tenancy
  predicate stands, because S-R §0 forbids loosening tenancy to add capability.
  Proven live as personas, in both directions: a roster `crew` member went from
  reading the company's invoices, credits, budgets, ledger and usage to reading
  none of them, while a `money.costs` GRANT on that same member kept the cost
  family readable and revoking the grant closed it again. Self-read was verified
  intact at every step — since Batch 25 item 3 `resolveCaps()` reads the caller's
  own roster row on the USER client, so gating self-read would make the
  capability layer unable to resolve the capability that would ungate it.
  **`has_cap()` is SECURITY DEFINER and that is load-bearing, not stylistic:**
  the policies on `organization_members` call it and it reads
  `organization_members`.
  **The honest scope, recorded because it is easy to overstate.** All 23 of the
  application's money paths run on the SERVICE ROLE, so 0053 changed no
  application behaviour — it closed the PostgREST door, which is the door the
  item-0 probe actually walked. The ROUTE gates (item 5) are what affect the app.
  For money, in this batch, R-5 inverts: the route is not merely the message, it
  is the only control the application sees, and the policy is the only control
  PostgREST sees. Neither is decorative.
  **`is_admin()` has ZERO database consumers** — no policy and no function body,
  since 0021 replaced all ~40. So `app_metadata.role` grants nothing in the
  database and is purely the application's crew/client routing axis. `S2` §3's
  "used by ~40 existing policies" and `scripts/harness-constants.ts`'s comment
  justifying the personas' `'admin'` claim are both STALE and corrected in place.
- **AD-002(-R) — one US region; `organizations.region` exists** (0018) so a
  second region is a deployment, not a rewrite. Film has its own residency
  regime (TPN audits, studio content-security riders).
- **AD-003 — deleting a person never deletes their work.** FKs onto
  `auth.users` are `ON DELETE SET NULL` (0016). Batch 6.2 extended the
  spirit: removing a member deletes the membership, never the auth account.
  Batch 12.2 built the tombstone half as an on-demand erasure
  (`lib/erasure.ts`, `POST /api/admin/erase-person`, Settings → Data &
  Privacy): stable pseudonym across the five name columns, address scrubbed
  from notifications and activity meta, auth account deleted last. Gated to
  an owner on the plan carrying `platform.erasure` (house only) because the
  rewrite crosses tenants. Still S3's: automatic tombstone on removal,
  `deleted_at`/grace, purge jobs, export.
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
| I-1 | Keyset pagination everywhere | **PARTIAL — messages are now FULLY bounded (21.1).** Messages paginate on `messages_room_keyset_idx` through `lib/keyset.ts` (50/page, opaque validated cursor, never OFFSET, jump-via-`around`); thread-panel replies ride the same cursor; the admin hub preview is one limit-1 query per room; unread scans carry the per-room watermark predicate in-query under an explicit saturating cap; the projects page counts via an embedded aggregate. Files, tasks and activity still do NOT — they copy the helper later, and that is the whole remaining distance. Known residue: the reply-meta count fetch (`.in('thread_root_id', …)`, both message routes) saturates at PostgREST's row limit for pathological reply volumes |
| I-2 | Realtime scoped, ≤2 subs/session | **VIOLATES, but halved by 15.1.** Census (item 0): before 14.9, ~12 channels on a loaded portal hub session and ~20 on a studio hub session (one broadcast topic per thread); 14.9 added one filtered fallback each. The room-first hub subscribes ONE active topic + ONE filtered replication fallback + the fixed four (presence:org, inbox, badges topic, notifications) ≈ **6 per hub session**. Project pages ≈ 10. The remaining budget work (globally-named sidebar/roster channels, PresencePulse inbox) stays S2.5 |
| I-3 | No polling where push exists | **VIOLATES** — 16 `setInterval` sites remain; de-poll is gated on per-surface RLS verification (S0-A §4.2), now unblocked by the harness |
| I-4 | >5s work runs on a queue | **NOT BUILT** — no queue exists; blocks AI generation jobs (S5) |
| I-5 | AI calls ceilinged + budget-checked | **PARTIAL, and accurate for the first time.** Fixed (7.1): `hard_stop` defaults **true** (0024, applied) and `getCreditState` treats a *missing* `org_budgets` row as gated — the column default alone changed nothing, because nothing in the app inserts that table. The house org's exemption is now a **stated row**, not a test for McPrime's id (8.5). Not fixed: the **$2 per-call ceiling is unbuilt** — no surface enforces one, so a single call is bounded only by `max_tokens` |
| I-6 | Ownership server-resolved, never from the body | **PARTIAL, improved again by 15.5** — ledger (6.1), team routes, edit pages, roster names (7.8), attachment refs (14.4, `lib/messageAttachments.ts`), and now **mentions**: `lib/messageMentions.ts` parses the BODY server-side, validates every target against the room's tenant, writes the rows itself, and resolves display per VIEWER at read time — a scoped member sees "a restricted item", never the name. Still body-trusted: `attachment_file_id` into `activity_log.meta` (display-only) and the unvalidated route bodies (I-7) |
| I-7 | Schema validation at API boundaries | **PARTIAL** — first zod boundary is `app/api/activity/route.ts` (the pattern to copy); 40 route handlers unvalidated |
| I-8 | No service role on user-session paths | **VIOLATES — but ratcheted (7.9).** 71 modules touch the service role (69 importers + 2 inline constructors), all allowlisted in `lib/supabase/admin-allowlist.mjs` and split PERMANENT / TRANSITIONAL. Two ESLint rules hold the line: the import, and naming `SUPABASE_SERVICE_ROLE_KEY` inline. **No file has migrated yet** — that is S2 §7 steps 4-6 |
| I-9 | Explicit tenant filter on every query | **PARTIAL** — studio reads (3A), edit pages (6.6), heartbeat (B2), `orgRolesOf` (7.5) scoped; `lib/sms.ts` now takes the org from its caller (8.4) and both client-creation paths stamp it (8.1). Other inserts still lean on column DEFAULTs — the `tenantScope()` helper (S1 §8.1) is not built |
| I-10 | No silent failure; errors reach a sink | **PARTIAL** — Sentry + `captureError()` live (6.4); metering writes are awaited rather than `void`ed (7.3, 7.4) and the invite's claim-stamp error surfaces (7.5); the heartbeat write, the notification recipient read and an unattributable SMS now surface too (8.2, 8.4). **77** empty catches remain, converted opportunistically inside feature work |
| I-11 | No module-scope env-dependent clients | **VIOLATES** — `lib/supabase/admin.ts:5`, `lib/r2.ts:16`; fix pairs with the I-8 pass (same 71 files) |
| I-12 | Idempotent, forward-only, single ordering | **CONFORMS for new work** — 0018–0026 are guarded; the `2026*` series is archived (6.9); 0000–0004 remain non-idempotent as captured history. The unapplied `clients.user_id` drop was renumbered 0025→0026 (8.2) so filename order stays apply order |

## 5. Capacity decisions

S0 §4 in one line each, unchanged: tenants uncapped; 1,000 soft seats;
messages unbounded but keyset-paginated at 50/page (once I-1 lands); 5 GB
attachments / 5 TiB masters (R2), 100 MB multipart threshold; 500K-char
documents; 50 concurrent editors, unlimited viewers (viewers don't broadcast
awareness); $2 AI per-call ceiling **(still unbuilt — nothing enforces one)**;
hard-stop at zero balance **on by default — implemented 7.1 (0024 applied); the
house org's exemption is a stated `org_budgets` row, not a code branch (8.5)**;
p95 2.5s; no uptime SLA and no copy implying one. Retention: 90-day soft-delete grace, 7-year activity
log, 30-day erasure — expressed so far only on `messages.deleted_at` (0028;
this entry said "no `deleted_at` anywhere", stale since Batch 13),
`message_rooms.deleted_at` and now `approvals.deleted_at` (0038); the purge
itself (S3-core migrations 10–11) is unbuilt.
**THE APPROVALS CARVE-OUT, recorded here so it is not lost between batches:**
approvals, stages, decisions, their comments and their ledger rows are
**7-year records and the purge function must REFUSE them** (S3-c §3.2).
Without the exemption, "permanent" is a word in a spec that a cron job quietly
disagrees with. S3-c §7 assertion 4 — the purge refuses an approval row,
control: it accepts an ordinary soft-deleted message — is **deferred to the
retention batch as harness assertion 21**, because it cannot be asserted
against a function that does not exist yet. It is the assertion that makes
"permanent" true rather than intended.

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
| 8.1 | Both client-creation paths write the owner `client_members` row, before the claim; `organization_id` stamped on both `clients` inserts | The **spec gap** behind §8.1: S1 §5.2 specified the 0012 backfill and never specified the create path, so a one-time fix read as a permanent one. Same failure mode as AD-004's inherited premise |
| 8.2 | Presence + away-escalation fan out to every active `client_members` row, project scope respected; 0025 printed | Presence could not be answered per member **at all** — `client_members` has no `last_seen_at`, and a per-company column cannot say who is present. Also: `phone` is the COMPANY's one number on every member's state, so an unguarded SMS fan-out texts one handset once per teammate |
| 8.3 | `delete-client` cuts every member's claims; `ProjectDetail` off the column | The brief's list was stale — two of its three sites closed in 7.6. The re-grep found a **fourth** it did not have: `ProjectDetail.tsx:399`, reached via `select('*')`, so no named-column grep could see it. And `delete-client` is a fan-out, not a lookup: teammates of a deleted company kept a `client_id` claim pointing at nothing |
| 8.4 | `sendSms` takes the caller's org; `DEFAULT_ORG_ID` no longer imported there | One caller, and the org was already resolved on the recipient state — no session threading needed. Required parameter, not an optional with a fallback: there is no constant left to default to |
| 8.5 | House-org hard-stop opt-out is the stated `org_budgets` row; the `orgId === DEFAULT_ORG_ID` branch is gone | 0024 **is** applied — proved by a reversible probe (insert an `org_budgets` row for the decoy org without naming `hard_stop`, read `true`, delete). The house org's own `false` row is consistent with either state, so the row alone could not tell them apart. `lib/billing/plans.ts` is still dead — zero importers |
| 8.6 | `clients.user_id` retired; 0026 printed, guards removed, hook fixed in the same transaction | **0022's live access-token hook read the column** (`0022:111-118`). No guard would have caught it: Postgres tracks no column dependency inside a PL/pgSQL body, and the printed guard scanned `pg_policies`, a different catalog. Worse, the hook's own `exception when others` would have absorbed the 42703 and returned every user's token unenriched — a silently empty app for everyone, which is the exact failure AD-001 and 0022 exist to prevent |
| 9.1 | One origin accessor (`lib/appOrigin.ts`) + eslint ratchet; 8 sites converted | The audit expected literal hostnames and found **none**. The defect was the opposite shape: six routes interpolated `process.env.NEXT_PUBLIC_APP_URL` raw, so an unset variable sent `undefined/set-password` as an invite redirect — a dead link that looks like a link, invisible except to whoever cannot use it |
| 9.2 | Portal reads the tenant's name, logo, title and copy from the database | S0-B §3's "wiring gap, one table" is **two**: `business_settings` has no logo column and never has — the logo is only on `organizations.logo_url`. And nine sites already read the DB and merely *fell back* to McPrime, so the defect fired exactly when a tenant was unresolved, which is when naming another tenant is worst |
| 9.3 | Sender identity per tenant: 11 sites, plus the push icon | The nudge **cron** was the worst and no list ranked it: its GET half sweeps every tenant by design, so one hardcoded name signed the whole product's alerts. Also `sw.js` hardcoded one studio's logo as the push icon for every tenant — sender identity is the picture, not just the name |
| 9.4 | Product renamed to Genreline; `lib/product.ts`; studio + admin chrome | `app/studio/layout.tsx` read the studio's own name with `.from('organizations').select('name').limit(1).single()` — **no predicate**, so the header rendered an arbitrary tenant's name. Three orgs exist; this was live. Found under a comment being renamed |
| 9.5 | "Powered by Genreline" gated on a plan feature key | The badge already existed and shipped unconditionally to every client. Paid HANDOFF §8.3 item 5's price: `orgId === DEFAULT_ORG_ID` is gone from `lib/billing/plans.ts`, and the `orgId` parameter with it |
| 9.6 | HANDOFF + CLAUDE.md recompiled | — |
| 9.7 | Pre-auth pages tenant-neutral; `McPrimeLogo.tsx` deleted | The owner chose neutral-then-brand over subdomain / route segment / email lookup. The `mailto` and the © line were REMOVED rather than repointed: no correct value exists for either (S0-B §7's legal entity) |
| 9.8 | Verified against the live database | **9.5's commit message overstated its own fix.** All three orgs read `plan = 'agency'` and nothing writes the column, so the house org's exemption — which 9.5 said "is now stated" — was never written. And `NOTIFY_FROM_EMAIL` held a McPrime address: every email the product sent, to every tenant's clients, arrived From one tenant |
| 10.1 | Studio logo upload (`organizations.logo_url` gets its first writer); sender resolved from the tenant | The column had existed since 0001 with **no writer**, which is why 9.8's live read found all three rows null — 9.2 had wired the portal to read a logo no studio could set |
| 10.2 | One email layout, ported from the studio's Supabase template, rendered per tenant | The ask included email-change, phone-change and confirm-signup templates. **None of those flows exist** — no `updateUser({email})`, no `updateUser({phone})`, no `signUp(`. They would have been templates for buttons nobody can press |
| 10.3 | Six invite paths + password reset off Supabase's mailer onto `generateLink()` | `resend-invite` was **cross-tenant on both halves**: its `clients` read and write were keyed on email alone, and `clients.email` is org-scoped since 0018. Also the **first time the I-8 ratchet ever shrank** — its inline service-role client is gone |
| 11.1 | Re-invite unblocked; the portal's duplicated per-request work memoized; send bounded; mailer banned in lint | The site "getting stuck" was **a regression from 9.2**: `generateMetadata` plus the layout meant two `auth.getUser()` round trips, two roster lookups and up to four brand queries on every portal page, none memoized. `getCurrentUser()` already existed for exactly this and 9.2 did not use it |
| 11.2 | One `AuthShell` for all three pre-auth screens; email logo centred at 48px | `/login` had the card; `/set-password` and `/reset-password` did not — an invited client's first screen looked like a different product from the one they signed into. Drift, not neglect: three near-identical layouts |
| 11.3 | Flow B's refusal explained; `invite-client`'s duplicate check org-scoped | **The confirmation state is the variable, and an intermediate probe got it backwards.** `generateLink` type `invite` returns 422 `email_exists` for a CONFIRMED account and 200 for an unconfirmed one — so a probe on the wrong account "disproved" a fix that was correct. Verified by running the real `sendTenantInvite` against production auth |
| 10.4 | Second Resend send path collapsed | 10.3's own commit message claimed `send.ts` was "extracted from notify.ts". It was not — `send.ts` was *added* and notify.ts kept its `fetch`, ending in `catch {}`. Every notification email since 10.2 went out through the copy **without** the error sink |
| 12.1 | Shell overhaul, both portals: liquid-glass squircle chrome (`--glow` token + glass utilities in `globals.css`), Geist + Schibsted Grotesk, `/studio` lands on **crew**, space landings become animated stages (`SpaceShowcase.tsx`) instead of feature grids, premium icon swaps, studio mobile drawer, route-level loading skeletons | The studio had **no mobile navigation at all** — `StudioSidebar` rendered unconditionally and squeezed every page on a phone; only the portal had a drawer. And "4-second navigation" is two problems, not one: dev-mode compile dominates (prefetch is disabled in dev), but the studio layout also serialized three independent round trips, and the space landings paid auth + roster queries to draw a grid duplicating the rail |
| 12.2 | **Workspace → Suite** (slug + label; proxy redirect for old URLs; the `workspace` OrgCap keeps its name — it lives in `extra_caps` rows); CRM · Pipeline / Lead-Gen gated to plan feature `internal.pipeline` (house only, sidebar + `requireOrgFeature`); rail badges are live counts only (unread client messages, `changes_requested` gates, overdue invoices — ★ markers gone); active space tile double-bevel + gold type; **erasure built** (`lib/erasure.ts` + `erase-person` route + Settings → Data & Privacy, plan feature `platform.erasure`); `update-client` org-scoped (the last unscoped admin write); `delete-client` deletes the R2/storage blobs before the rows; crew re-invite returns a clean 409 instead of a raw 23505 (pre-check before the invite email fires); AD-003/deleteUser doc drift corrected in S0-conformance + S0-A | The conformance and amendment docs still asserted four live `deleteUser` call sites that Batch 6.2 had removed — anyone designing from those docs was designing against dead code. `tenantBrand` already read `organizations.plan` and threw it away; exposing it made every plan gate free. And the crew-invite 23505 fired **after** `sendTenantInvite` — the person got a working invite email while the roster insert died |
| 13 (the brief was titled "Batch 10" — renumbered, the repo already had one) | **The message room moves to the client company.** S3-core + S3-core-A committed; `message_rooms` (0027); room columns on `messages` (0028); the 190-row backfill (0029); NOT NULL + thread trigger + room-scoped RLS + A-4's FK defusal (0030) — **all four applied to production**, 0027–0029 by the owner, 0030 by the agent under the new Management-API grant. All six send sites resolve their room via `lib/messageRooms.ts` and stamp `organization_id` (five had leaned on the column DEFAULT — A-7/T-5); the delete route stops blanking bodies (A-2); harness grows 10 → **14 assertions, 0 vacuous** | Item 0's audit became **S3-core-A** before any migration was printed: `edited_at` and `reply_to_id` already existed; soft delete existed as a body-blanking boolean (**data loss** — a 90-day grace restoring nothing); `project_id` was ON DELETE CASCADE (**data loss** once it became a tag); `sender_role`'s CHECK blocked crew rooms. The backfill matched its printed prediction exactly — 7 rooms, 190 messages, 0 unresolvable, 0 org changes, 7 reply chains walked. The seeder was silently incompatible with the NOT NULL (its message upserts carried no `room_id`) — found by running it, fixed in 13.7 |
| 14 | **Unread becomes a question about a person, and the message layer grows up.** `message_read_state` (0031, backfilled 7 rows exactly as pre-counted), six supporting tables (0032), the attachment FK + 11-row backfill (0033 — 11 in, 11 out, 0 unresolved, 0 tenant mismatches) — **all applied and verified live**. All twelve unread sites read `lib/messageRead.ts`; the watermark routes advance per-user state while still writing `read_at` (drops in migration 12); the nudge cron regroups by room and only nudges what someone actually hasn't read; every read path scrubs deleted bodies server-side (item 5); `verifyAttachment` makes a forged attachment ref fail at send (closes §8.3.1). Harness 15/15. **Owner items shipped in the same batch:** the General thread (`room:<clientId>` understood by every route; rooms minted at onboarding; project-less sends both sides), the thread-bus realtime unification (pages broadcast sends + typing on `thread:<id>`; hubs gain filtered replication fallbacks with id-dedupe), the subtle WebAudio chime with device mute, and the premium MessageThread pass (grouping, tails, glass composer, gold rail) | The click-test's "3-minute delay" was NOT replication — a live probe delivered in 1.8s under the new policies to both personas. It was wiring: project pages never broadcast their sends, the hubs had no replication subscription (built when "RLS-starved for admins" was true — it no longer is), and typing rode a different channel name on pages than hubs. Also: MessageThread filtered deleted messages entirely (the "tombstone" never rendered), and General-thread attachments are deliberately disabled — the presign scope requires a project, and widening `lib/uploadScope` deserves review, not a side door |
| 15 | **The room-first hub, complete.** RoomThread is THE conversation engine — hub All-view, General thread and both project pages are one code path over one room; the studio hub lists client COMPANIES with presence, previews and gold pills; keyset pagination on `messages_room_keyset_idx` (lib/keyset.ts is the helper files/tasks/activity copy); threads one-level-deep with the 0030 trigger as sole authority; reactions/pins/saves UI on the 0032 tables (user-client RLS writes — AD-001); mentions server-parsed/tenant-validated/per-viewer-resolved (I-6); per-room notification prefs enforced in pushMessageAlert; the roster surfaced in-room; General-thread attachments via the EXISTING `_general` client scope. Founder items folded in: instant rail badges over `badges:*` topics, list movement only on new latest-message id, WebAudio priming (the chime was silent for want of a user gesture), focus mode | Item 0's census: hub sessions ran ~13 (portal) / ~21 (studio) channels; the room model collapsed them to ~6 each (fixed four + active topic + one filtered fallback) — I-2 still violated but halved. The `room:<clientId>` synthetic id coexists with `message_rooms.id`, normalized at five route boundaries — managed drift, recorded. `(admin)/admin/projects/page.tsx:28` remains the one unbounded message read (reported, >1 line). The project pages lost ~800 lines of duplicated message machinery; lint fell 355 → 319 |
| 16 (owner-directed, no formal brief) | **The messaging polish round.** App-wide chime (PresencePulse — the "can't hear anything off the messages page" fix), typing/recording presence in the studio ROOM LIST and headers, the four utility icons collapsed into ONE ⋯ menu at the top bar's extreme right, **search-in-conversation** (body_tsv's first consumer, scoped like the list), mention trigger configurable (@ · / · both), **project colour-bonding** (lib/projectColor.ts — dot on chip, inset stripe on bubble, ringed tag pill), horizontal message action bar with a ⋯ menu (Pin/Save/Copy/Edit/Delete), composer emoji picker + jumbo emoji, hover-play video previews, and the recorder's scrolling RMS waveform | Two found defects: the studio hub REMOUNTED the whole engine on every chip click (the key is gone — chips respond instantly now), and 15.4 had duplicated the react/pin/save controls in the received-side hover stack (both stacks replaced wholesale). Rule zero note: the owner explicitly overrode parts of the 14.10 renderer this round (action layout, emoji, media) — their call to make |
| 17 (owner-directed) | **The bug round with a smoking gun.** THE upload failure (files, recordings, vault — every portal) was NOT code: the R2 bucket's CORS allowed localhost but not `https://genreline.com` — proven by preflight probe (403/no-allow-origin vs 204 for localhost); broken since the Aug-31 domain switch. **FIXED — the owner added the dashboard rule and uploads work (verified before Batch 21); this row carried the defect as open after it closed, which is exactly the re-investigation cost §12 warns about.** Shipped: instant voice send (optimistic blob bubble, upload rides behind), app-wide WebAudio priming in PresencePulse (the real reason "global sound" wasn't), General chip removed (All + projects only), sticky composer project-tag (additive until changed, per room per device), 360°-hue collision-free project colours, theme-aware wallpaper in three patterns + intensity in chat settings (16.8's gray tile vanished on light portals — the "only in the org" bug was a theme bug), mentions show @Name in the input with token substitution at submit, ~170 emoji + a Stickers tab with pop-and-sway jumbo sends | Upload errors now surface their reason instead of a mute "failed". The A-8-style discipline paid again: probe first, then code |
| 18 (owner-directed) | **Two more single-cause "selective" bugs, named and killed.** The wallpaper was painted on the SCROLLING element — it scrolled away with content, so long threads (which 17.7 opens at the bottom) never showed it: "renders in some places" was one bug. It now lives on a fixed wrapper. Read receipts died because the RoomThread consolidation dropped the project pages' UPDATE listeners — receipts/edits/deletes now ride the same replication fallbacks as inserts (op-marked), patching rows in place including your own ticks. Also: every spinner purged from messaging (instant render, silent prepends, static placeholders), hover actions scoped to the bubble itself, AudioPlayer error state with an Open fallback, one-project rooms auto-tag sends, "Chat settings & wallpaper" labeling, and Forward + bulk select (projects, no-project, and cross-room for the studio; attachments cross by verified file id) | The R2 CORS gate this row recorded is CLOSED (see the Batch 17 row) — audio, uploads, GIF and per-type preview all unblocked with it |
| 19 (owner) | **Voice speaks WAV everywhere.** The sender's browser transcodes every voice note to 16 kHz mono WAV before upload (`lib/audioWav.ts`) — Chrome records webm/opus, Safari cannot play it, so an org note arrived Apple-side as a dead 0:00 by physics. Also: per-view render cache (chip/room switches at 0ms, network merge behind), uncropped studio logo chip in the portal hub, Aurora + Waves wallpapers | Server-verified while debugging "All doesn't show project chats": the room query composition was correct at HEAD — the running deploy was behind |
| 20 (owner rounds 20.1–20.3) | 20.1: the portal messages GET's 400 guard predated `?scope=room` and `?mention_candidates` and ran FIRST — it starved the All view and the composer roster; guards now run after the requests they must not strangle. 20.2: a live project tag was a render-time TypeError that unmounted BOTH portals (map present, id absent fell through to `card.label` with `card` undefined); the guard is airtight by construction now. 20.3: chat settings move to `user_prefs` (0034, one jsonb row per auth user, Class C RLS, `/api/prefs` on the USER client per AD-001) with localStorage as the zero-latency cache | The admin route's equivalent guard sat AFTER its candidates branch, which is why only the portal broke — the asymmetry was the bug report |
| 21 (the "Batch 19" brief, renumbered — the repo was at 20.3) | **Closeout: messages fully bounded, the Suite unblocked, the dual-write ended.** 21.1: thread-panel replies keyset-cursored (both routes + panel load-older); admin hub preview one limit-1 query per room; unread scans carry the watermark predicate in-query under an explicit saturating cap; the projects page counts via `messages(count)` + `orgUnread` (the last unbounded message read, reported three times, closed). 21.2: 0036 settles `documents.kind` (screenplay/treatment/bible/breakdown/document; 'script' renamed, default → 'document'). 21.3: sender_role/attachment_url/is_deleted/read_at writes stopped everywhere; sides derive from the ROSTER, read ticks from the other side's watermark, attachment URLs from the FK (`roomSides`/`deriveWire` in lib/messageRead.ts); 0035 applied (NOT NULL relaxed + 13 of 16 null senders recovered). 21.4: 0037 printed + gated on deploy; seven catalogs searched clean. Harness 15/15 | Three premise failures: `documents.kind` had existed since 0004 with four live 'script' sites (the "additive" item was a reconciliation); `sender_role` was NOT NULL/no-default (the brief's stop-write-then-drop order would have 23502'd every send in the window — 0035 is the migration the brief didn't know it needed); the nudge cron's oldest-first window only worked BECAUSE of the legacy read_at prefilter (flipped newest-first or it would silt up). Lint baseline was 318 at start, not the brief's 319 |
| 22 (the approvals engine, S3-c) | **Approval becomes a record, not a gate.** 0038 (five tables + the anchor model on `messages` + `organizations.approval_window_hours`, Class B RLS); 0039 + 0040 + 0041 (three triggers, each written because a defect was PROVEN first); `lib/approvals.ts` — the single write path; five approval capabilities on both rosters behind one new cap; six routes (45 → 51 handlers) with **zero new service-role importers**; the per-org auto-advance sweep + reminder ladder (`/api/cron/approval-sweep`, daily 08:00); harness **15 → 20**; the card in the room, the record on both review pages, the printable certificate; and the browser ledger path DELETED (`lib/logActivity.ts` + `/api/activity` + its allowlist entry) | **Seven premise failures, and three defects found by probing rather than reading.** The brief's `is_org_member(organization_id)` does not exist (no-arg). `messages` has no crew INSERT policy to extend — `messages_crew_all` is an ALL policy, so the comment gate became a RESTRICTIVE policy that touches neither existing one. `messages.timecode_ms` was NEVER created, so S3-c §5.1's premise is false and there is one anchor model, not two (S3-b migration 5 must drop its line). Rule Zero named three legacy columns; **six** are live, and `approved_at` — which the brief does not name — is what both approval pages actually gate on. `deadline-check` was a SECOND, unrecorded instance of HANDOFF §8.3 item 4's page-load-cron defect, and it wrote `approval_status='auto_approved'` while `studio/client/review/page.tsx:131` counted that among the APPROVED — the studio's own page was already reporting timeouts as client sign-offs. **The three probe-found defects:** a client could record a decision and the stage would silently never advance (crew-only UPDATE + PostgREST returning no error on zero rows) — which would have had the record claim "no response received" about a client who responded; a decision with a null `actor_id` could never satisfy a user assignee, so the same silent stall one layer down; and a client assignee could **forge who signed off**, naming a colleague as `actor_id` and anything as `actor_name`, because 0038 permits direct assignee inserts and the routes being careful is not a control. Also: the reminder ladder counted ledger EVENTS, and there is one per RECIPIENT — a three-assignee stage would have gone permanently silent while the record still claimed the window was honoured |
| 23 (S3-d, 2026-09-03) | **Membership becomes a ROW, and the crew space gets its chat.** 0043 `room_members` + the helper quartet + a trigger confining self-service to notify/leave; 0044 backfill (printed prediction matched exactly: 11 crew + 9 client, 0 overlap, 20 rows, zero parity gaps both directions); 0045 kind widens to channel/group/dm/broadcast with topic/is_private/archived_at/project_id, dm_key + partial unique index (race-free DM find-or-create, the 0027 shape one level down), `last_message_at` WITH its trigger; 0046 **THE FLIP** — message and room policies move off tenant identity onto `is_room_member()`/`room_can_post()`/`room_history_from()`, sender and org pinned in the INSERT policy; 0047 drops the one-crew-room index (0027 §9.1's promised migration); 0048 printed, GATED on deploy (prefs onto the seat); 0049 person avatars + collaborator display_name. Harness 20 → **28** (21 stays reserved for the retention purge), run RED pre-flip — 25 and 27 genuinely FAILED (a left member kept reading; the org owner could read a DM) — then 28/28 green post-flip. `lib/rooms.ts` (creation with creator-first-seat under RLS, DM dedup, seating with explicit-rejoin semantics, §5.3 seeding + `healDerivableMemberships` self-heal), four `/api/rooms*` routes (zod at every boundary; creation/seating/sends on the USER client — 0046 IS the authorization), group receipts (blue = every other member's watermark covers it), member-scoped `orgUnread`, `pushRoomMessageAlert`, pause/revoke stamps every seat + restore re-derives, Crew › Chat hub (was a phase-4 stub), portal DM chips in the notch, avatar bubble heads. 13-probe persona smoke run: 13/13 | **The pause hole found before it shipped**: under MD-1 the seat reads the room, so cutting claims alone would have left a paused member reading everything with a live session — the cut now stamps seats. **The RLS recursion trap in the bootstrap**: the creator-first-seat policy's subquery runs under the CALLER's RLS, and the creator could not yet SEE the private room they had just created — member_read gained a created_by clause before it shipped. **§5.2's own instruction was wrong against its own gate**: dropping the project-visibility conjunct would have widened a live scoped crew member's access, so the conjunct stays, recorded as a deviation. Earlier the same day (owner rounds): the Film wallpaper restored as redrawn artifacts (the ask was improve, not replace), and five reported defects each traced to a mechanism — stale closures/responses contaminating the per-view cache (and then PERSISTING), a hidden tab forging READ ticks and silencing the away push, media without reserved boxes bouncing the open, unsupported Unicode rendering as invisible emoji, the chips band consuming chat height (now a floating notch) |
| 24 (owner-directed, 2026-09-03) | **The spaces separate, and files stop being one-way.** SPACE SCOPING: the crew hub filtered `kind !== 'client'`, so a DM or channel with a client company's person landed on the studio's INTERNAL floor — the COMPANY COLUMN is the boundary now, everywhere. Crew · Chat = rooms with no company (directory: crew + seated collaborators). Client · Messages = rooms WITH a company, as chips beside the project chips, with a `+` scoped to that company. Portal = DMs and groups only, owner-initiated (tightened from owner-or-approver; RLS still admits an approver, so the route is the narrower gate and says so). A DM is stamped with the counterparty's company at creation, so routing is a column lookup. UPLOADS: real multipart above 8 MB (`/api/files/multipart` + four `lib/r2` helpers) — pause, resume, cancel, with the server aborting so abandoned parts are not billed. DELETION: `lib/fileDelete` — detach, row, then blob; `/api/files/[id]` widened from admin-only to "any admin of the file's own org, or its uploader"; a deleted chat message destroys its attachment NOW. Plus: the hover action bar stops eating neighbouring clicks, delete-during-upload cancels, pending captions are editable, Audio joins the attach menu, Save to device, attachments work in the new room kinds (`resolveUploadScope` grows a ROOM scope gated on membership), thread/search/pins pre-sign like the main list, and projects mint their chat on creation | **Four bugs whose cause was not where the symptom was.** (1) "Files cannot be deleted permanently" was true because the route was `isAdmin`-only — and while fixing it, that same route turned out to have NO TENANT PREDICATE, so an admin of studio B could delete studio A's file by id. (2) "The actions hide behind rather than in front" was `opacity-0`, which hides an element and keeps it CLICKABLE — the invisible bar at `-top-4` was swallowing the neighbouring message's clicks. (3) "I deleted a file that was still loading and it didn't work" — the delete route was being called with a `temp-` id, which 404s. (4) The obvious multipart design would have read ETags off each PUT response, which a cross-origin XHR cannot do unless the bucket's CORS names `ExposeHeaders` — a fourth silent CORS dependency of exactly the Batch 17 kind; completion asks R2 what it stored instead. Also found: `create-project` never stamped `organization_id`, so a second studio's project (and now its chat room) would have been minted in tenant zero |
| 25 (the "Batch 24" brief, renumbered — the repo already had a 24; the COMMITS and code comments say 24, so a grep for either finds it) | **The capability layer: money and people.** 0050 (role vocabulary + `blocked_on_permission`), 0051 (grant tables + `has_cap()` + the 1→1 dot rename), 0052 (legacy aliases in SQL), 0053 (capability predicates on the nine S-R §9 tables), 0054 (G-1…G-4 as triggers) — **all applied and verified live as personas**. `lib/capabilities.ts` is the one vocabulary, generating `role_baseline()`/`valid_*_cap()` with `npm run check:caps` failing on drift in THREE phases; `lib/capabilities.server.ts` is the one resolver, on the USER client; `lib/grants.ts` the one grant write path; `components/shared/CapabilityGrants.tsx` the one surface, on all three team panels. Route gates on money and people, the claim-shaped grep across all 56 handlers (1 → 0), R-11 in the sweep, harness **28 → 35**. Two live holes closed first (item 1a) and the `org_role` claim deleted (item 1b) | **The brief over-warned once and under-warned four times.** Item 1 was called "the most dangerous item in this batch" and changed NO production row: the role column was already honest, because it HAS A WRITER. What it missed: (1) the seeder would have silently reverted 0050 on every re-seed, and the harness documents a re-seed between runs, so "silently" meant "always"; (2) making `coordinator`/`crew` invitable before `lib/permissions.ts` knew them would have sent an invited coordinator to an EMPTY STUDIO — `ORG_CAPS[r]?.includes()` returns false for an unknown role, with no error; (3) 0051's rename left `has_cap()` blind to the legacy aliases the TS resolver honoured, so the route said yes and the policy said no — a silent empty set, found by probe and fixed in 0052, and the parity check had gone GREEN through it because every harness persona has empty `extra_caps`; (4) the roster routes still gated on `canManageOrg` (role ∈ owner/admin) after 0053 widened the ROW to `has_cap('people.manage')`, so a *granted* people.manage was admitted by the database and refused by the route. Also: R-11's first implementation called `clientCanApproval()`, which ORs the role baseline, so a DENIED assignee still read as able to decide and the stage lapsed — the exact wrong record R-11 exists to prevent, produced by the code meant to prevent it. Ruling 1 itself was wrong and was superseded mid-batch: snake_case→dot is a GRANULARITY change, not a spelling one |

| 27.3 (same push) | **The client's calendar — dates that say what happens if you do nothing.** No migration: `calendar_entries` has had a client policy since 0065 and writers since 0074 with no client surface. `/dashboard/calendar`, `lib/portalCalendar.ts`, `listClientEntries`. Ordered by WHOSE MOVE IT IS, not by date. Audited and rejected with reasons: fullcalendar (MIT core, commercially-licensed resource/timeline views), schedule-x (MIT, zero deps), vkurko/calendar (MIT) — all three render a grid this repo already has, so the agenda IDEA was taken and the dependency was not. `scripts/ops/probe-portal-calendar.ts` signs in as three real client personas | **THE TENSE BUG CAME BACK IN A SECOND MODULE.** `approvalIntel` once said "if it lapses" about an already-lapsed stage; §12 recorded it. Written months later by somebody who had read that lesson, `clientAgenda` said *"If you do nothing by Tuesday"* about last Tuesday — the state between a passed deadline and the next daily sweep, which is common rather than rare. The probe found it because it reads the SENTENCE and compares it to the date, not because anybody re-read the code. The fix also moved the row: an overdue decision that is still the client's move now sorts FIRST rather than into "already passed", which is where the original ordering put the only row still worth acting on. And the constructed case is built by the probe (move the deadline back, read as the client, restore in a `finally`) rather than waited for — §12 lesson 9 |
| 27.2 (same push) | **The brand kit — one colour in, an accessible ramp out.** NO MIGRATION: `organizations.branding` has held `{}` with zero readers and zero writers since 0001. `lib/brandKit.ts` derives both themes in OKLCH and emits HSL triplets; the on-colour is chosen by MEASURED contrast; `components/TenantTheme.tsx` renders it on the portal, `/s/<token>`, `/sign/<token>`; the email CTA and the **sealed contract PDF** carry it too. Harness **59 → 60**. Audited: culori (MIT, zero deps) TAKEN, radix-ui/colors (MIT) semantics only, color2k (MIT) as confirmation, tweakcn (Apache-2.0) as UX reference | **A TRANSITIVE LICENCE TRAP, and it was one `npm install` away.** `evilmartians/apcach` is MIT and does precisely the right thing — solve for the colour that meets a contrast target. It depends on `apca-w3`, which ships under the **"Limited W3 License"**: *"Commercial use is prohibited without a written and signed commercial license agreement."* This product is commercial SaaS. The MIT badge on the top-level package made the obligation invisible; only reading the dependency list and then the dependency's LICENCE found it. Also found: **the email CTA hardcoded `color:#ffffff` on the accent background** — correct for the product's gold, unreadable the moment a studio picks a pale one, and there is no CSS layer in an email to catch it. And a premise that turned out FINE, checked rather than assumed: branding the contract PDF looked unsafe because `content_hash` is taken at send — but `contractFinalize` renders once at the last signature and stores the bytes, so a rebrand cannot touch a signed file |
| 27 (the client-space push, owner-directed 2026-09-14) | **The screening room.** 0085 `share_links` + `share_link_views`; 0086 the atomic view counter; **0087 the scope correction**. `lib/shareLinks.ts` (the one resolver — token never stored, only its SHA-256, and ONE null for every failure), `/api/share` (the second and last route in the app with no session), `/s/<token>` wearing the STUDIO's brand, `components/portal/ScreeningRoom.tsx` (moving watermark + a heartbeat that also fires on `pagehide`), `/studio/client/guest-links` with the watched bar as the loudest thing on the page. `work.file.share` joins `CAP_RESOLUTION` as its own question. Harness **57 → 59**, 0 vacuous. Audited before building: cloakshare (MIT), papermark (**AGPL-3.0 — studied, not used**), videoseal (MIT, but GPU/Python → a queue worker) | **0085 shipped a leak and 0087 is the correction, found by asking the question the batch had just spent a week on.** The crew policy was the Class B shape MINUS its project conjunct, so a contractor scoped to one production could list every screening link the studio had ever minted — R-6's leak with the production's schedule attached — AND mint one against a production they could not read, because INSERT is what USING cannot reach (0059's exact lesson, one table later). Also: **`'/s'` in `proxy.ts`'s public-route list is a `startsWith` match, so it would have made `/studio`, `/settings`, `/set-password` and `/sign` all public** — the entire studio shell skipping this file's auth gates and its client→/dashboard redirect. Written `'/s/'`. Both were caught before commit; neither would have failed loudly |
| 26 (S-R's last three axes + S-R-A A-3) | **Seat class, project roles, and the scoping default — the decision that was missing rather than the mechanism.** 0055 (A-3's index widening), 0056 (`seat_class`), 0057 (`project_role` + `expires_at`, and `org_project_visible` learns expiry), 0058 (`project_role_baseline()` + `has_cap()` unions it), 0059 (the scoping gaps close in BOTH clauses across eleven policies) — **all applied and verified live as personas**. Item 8 came FIRST by owner ruling and deleted the four deny-blind oracles; `lib/assignments.ts` is the one staffing write path; harness **36 → 40** with a mutual-exclusion lock; invites now STATE seat class and the scope it implies | **THE ORACLES ERRED IN BOTH DIRECTIONS, and "deny-blindness" names only half of it.** `orgCan`/`clientCan`/`orgCanApproval`/`clientCanApproval` each answered `baseline(role) OR extra_caps`, and extra_caps carries GRANTS only — so a DENIAL was invisible at 28 call sites (every studio page guard, both rails, seven portal page guards, fourteen routes), while `organization/logo` passed NO extras at all and therefore REFUSED a granted `org.settings`. Proven both ways as personas: with money.invoices denied, the old answer said ALLOWED in all three states while the policy said 2 rows → 0 → 2. **Item 0's own audit was wrong about item 6**, and probing before writing the migration is what found it: both UPDATE paths it reported are already refused — a targeted UPDATE must FIND its row and the SELECT policy gates that, and a `FOR ALL` policy's USING applies to the NEW row (proven by control: moving to `project_id = NULL` succeeds). What is genuinely open is **INSERT**, and only INSERT, where USING cannot reach — a scoped member inserted a task onto a sibling production with no error and the row landed. **The probe advice itself has a trap:** §12 lesson 6 says ask for rows back, but `.select()` adds RETURNING, RETURNING needs SELECT, and where SELECT is narrower than the write a SUCCESSFUL write reads as a refusal. Also: `TeamManager` defaulted invites to the deprecated `member` and the route's `crew` default never fired because the form always sends a value — the select showed "Admin" while the state said `member`; and the two test surfaces MUTATE THE SAME ROW, which cost one false failure blamed on a migration |

## 7. Current state

- **Branch:** `throughline` (main ⊆ throughline, fast-forward). Not renamed —
  S0-B §6 excludes the branch, and renaming it is a remote/CI change, not a
  code one.
- **The brand kit needs NO migration, and that is the finding.**
  `organizations.branding` (jsonb) has existed since migration 0001 holding
  `{}` in every row, with **zero readers and zero writers anywhere in the
  repo** — the third dormant engine this project has found, after
  `asset_provenance`/`rights` (woken by 0064) and `calendar_entries` (given its
  writers by 0074). `organizations.subdomain` is the fourth and is still
  asleep; waking it is DNS and Vercel wildcard configuration, not code, so it
  is recorded rather than attempted.
- **Migrations applied: 0000–0087, every one of them.** Verified live
  2026-09-14. **0085–0087 are the screening room** — the first surface of the
  client-space push, and the first thing this product has that connects a VIEW
  to a DECISION. A no-signup review link is table stakes (Frame.io, Dropbox
  Replay, Filestage, MediaSilo all have one); watermarking is not (**Frame.io
  gates it behind Enterprise**; it is ON by default here); and *none* of them
  records what the approver actually saw, which is the fact a production needs
  when a sign-off is disputed. `share_link_views.furthest_ms` is a high-water
  mark against the same asset an approval is about.
  **0087 corrects 0085 before it had a second row.** 0085 shipped the Class B
  policy MINUS its project conjunct, so a contractor scoped to one production
  could list every screening link the studio had ever minted — R-6's leak
  wearing a UI convention, with the production's schedule attached. Closed in
  USING **and** WITH CHECK together (0059's rule: INSERT is the one command
  USING cannot reach, and a scoped member could otherwise mint a screener
  against a production they may not read and then watch it through the guest
  page). The views are reached THROUGH the link (0038's idiom), so the two
  cannot drift. Harness **57 → 59**, 0 vacuous.
  The pre-0085 line, kept because it is what this file claimed:
  **Migrations applied: 0000–0084, every one of them.** Verified live
  2026-09-13. **0083–0084 close the oldest recorded gap in the architecture**
  (`reference_infra-gaps-jobqueue-transcode`): a job queue in Postgres and a
  media pipeline. Three loops this repository had left open are now closed — a
  recording that was started, stopped, written to R2 and never became a file; a
  contract whose "Send" meant the studio copied a link by hand; and video with
  no rendition anybody could scrub. 0084 revises 0083 against an audit of five
  queue projects and adds the thing none of them has: **round-robin fairness
  across TENANTS**. Harness **56 → 57**.
  The pre-0083 line, kept because it is what this file claimed:
  **Migrations applied: 0000–0082, every one of them.** Verified live
  2026-09-13. **0082** admits `S3-d` MD-4's roster-less collaborator to the
  meeting on their own room — they had a seat in the conversation about a shot
  and no way into the review session about it — and adds nullable colour
  metadata to `files`. Harness **55 → 56**.
  The pre-0082 line, kept because it is what this file claimed:
  **Migrations applied: 0000–0081, every one of them.** Verified live
  2026-09-13. **0081** lets a client draw on their own company's material —
  0080 gave them SELECT only, which makes a review session half a feature.
  Meetings now exist in three places (crew floor, Client space, client portal)
  over ONE room, with `client_id` as the boundary. Harness **54 → 55**.
  The pre-0081 line, kept because it is what this file claimed:
  **Migrations applied: 0000–0080, every one of them.** Verified live
  2026-09-13. **0080** adds session recording (an Egress id plus a STATUS,
  because Egress is asynchronous and "processing" is not "ready") and
  `review_annotations` — a mark drawn on a frame during a live review, persisted
  against the asset at a timecode. That table is the join the market does not
  make: Frame.io has frame-accurate annotation and no conferencing, Evercast has
  conferencing and annotations that die with the session.
  The pre-0080 line, kept because it is what this file claimed:
  **Migrations applied: 0000–0079, every one of them.** Verified live
  2026-09-13. **0076 REMOVES bookings** on the owner's decision (zero rows in
  all three tables, so nothing was lost); **0077** is the review session's shared
  playhead and the meeting→calendar projection; **0078** is single-use signing
  links for a signer with no account; **0079 makes a signed release WRITE the
  `rights` record it proves** — the join between the provenance engine (0064)
  and the signature engine (0068) that no single-purpose product can make.
  Harness **53 → 54**.
  The pre-0076 line, kept because it is what this file claimed:
  **Migrations applied: 0000–0075, every one of them.** Verified live
  2026-09-13. **0075 is the last projection edge** — `S3-b` §1.1's "bookings
  produce calendar entries", which neither 0066 nor 0074 could own alone.
  Cancelling removes the entry and nulls the link, because a calendar holding
  cancelled bookings shows time as busy when it is free. Harness **52 → 53**.
  The pre-0075 line, kept because it is what this file claimed:
  **Migrations applied: 0000–0074, every one of them.** Verified live
  2026-09-13. **0074 is the calendar's writers** — 0065 created
  `calendar_entries` and nothing wrote to it, which is the dormant-engine trap
  0064 had just closed one table over. Approval-stage deadlines and invoice due
  dates now project through triggers (0041's precedent), are REMOVED when they
  stop being obligations, and cannot be edited by hand because they belong to
  their source. Harness **51 → 52**.
  The pre-0074 line, kept because it is what this file claimed:
  **Migrations applied: 0000–0073, every one of them.** Verified live
  2026-09-13. **0069–0073 finish every specified engine that was still
  unbuilt**: `S3-core` migration 9 (file version stacking, 0069), migration 10
  (soft delete on the remaining six tables, 0070), migration 11 (the purge and
  the 7-year ledger guard, 0071), and `S3-b` migration 4
  (`calendar_connections`, 0072 — the token question answered with Supabase
  Vault, which is already installed, so no key-management scheme had to be
  invented). 0073 corrects 0070, which was wrong twice and turned the harness
  red both times. Harness **48 → 51**, and slot 21 — reserved since the
  retention engine was specified — is filled.
  The pre-0069 line, kept because it is what this file claimed:
  **Migrations applied: 0000–0068, every one of them.** Verified live
  2026-09-13. **0065–0068 are `S3-b` migrations 2, 3, 5 and 6** — calendar
  entries and attendees (0065), availability/booking types/bookings with the
  double-booking exclusion constraint (0066), meetings and participants (0067),
  and contracts/fields/signers/events (0068). **`S3-b` migration 4
  (`calendar_connections`) is NOT built and that is the spec's own call** (§7
  answer 1): external calendar sync needs a token-storage decision — Vault vs an
  encrypted column — that S3-b says explicitly must not be improvised. Migration
  5 correctly did NOT add `messages.timecode_ms`; verified absent live.
  Harness **44 → 48**. Three properties in this group were proven by probe
  before the migrations were trusted, because none of them fails loudly:
  the booking exclusion constraint refuses an overlap (`23P01`) while accepting
  an **adjacent** slot and a **cancelled** one; the owner column is re-derived
  when forged; and `contract_events` refuses UPDATE and DELETE **on a superuser
  connection**, with `occurred_at` stamped over a 1999 backdate attempt.
  The pre-S3-b line, kept because it is what this file claimed:
  **Migrations applied: 0000–0064, every one of them.** Verified live
  2026-09-13. **0064 is `S-S` Phase D** and it wakes two tables that had been
  asleep since migration 0001: `asset_provenance` and `rights` existed with
  **zero code references anywhere in the repo** and zero rows — the dormant
  engine `S-S` §2.1 called "an engine away". It aligns both to **C2PA** (spec
  2.4) and the **CAWG `cawg.training-mining` assertion**, adds `document_id`
  (every AI call this product makes produces TEXT, so a file-only table would
  have stayed empty for the same reason it already had), and gives both policies
  the project scope 0059/0060 built — via `org_document_visible()` and a new
  `org_file_visible()` cut to the same SECURITY DEFINER pattern. `rights` gains
  the permission triple defaulting to `notAllowed`, because consent is granted
  and never assumed. Harness **42 → 44**: a disclosure can only be written by
  somebody who can see the script it is about.
  The pre-0064 line, kept because it is what this file claimed:
  **Migrations applied: 0000–0063, every one of them.** Verified live
  2026-09-13. **0060–0063 are the S-S surfaces work**, and each one exists
  because building the surface found the engine underneath it incomplete:
  0060 gives the three parentless tables (`document_versions`,
  `document_comments`, `storyboard_shots`) their own `org_document_visible()` /
  `org_storyboard_visible()` helpers, because a child row cannot be scoped by a
  `project_id` it does not have; 0061 backfills `usage_events.created_by` from
  `ref->>'user'` — **every row that cost money was unattributed and every free
  row was attributed**, 18/18 billed rows recovered with 0 unresolvable; 0062
  adds `usage_events.project_id` so AI spend is chargeable to a production
  (backfilled via `ref->>'file_id'` → `files.project_id`, 18 of 22, on a
  tenant-guarded join); 0063 adds `member_budgets` + `org_seat_budgets` — the
  per-person and per-seat-class AI spend limits, keyed on GRANULARITY rather
  than period_start so a day/week/month cap is one row that never accumulates.
  **Self-read on `member_budgets` is deliberately ungated** (`user_id =
  auth.uid()`): a refused AI call has to be explicable to the person it
  refused, or it reads as a bug. The admin half is gated on
  `has_cap('money.costs')`, and harness 42–43 prove both halves — the capped
  person SEES their cap and CANNOT raise it, each with a positive control.
  The pre-S-S line, kept because it is what this file claimed:
  **Migrations applied: 0000–0059, every one of them.** Verified live
  2026-09-13. **0055–0059 are Batch 26's** and complete `S-R`'s four axes:
  0055 widens both grant tables' live index to `(member_id, capability, mode)`
  so a grant and a denial can coexist (`S-R-A` A-3 — R-3 was unreachable in the
  schema written to implement it, confirmed by probe before the swap: the second
  insert was refused by `org_member_cap_grants_live_idx` by name); 0056 adds
  `organization_members.seat_class`; 0057 adds `project_role` + `expires_at` to
  `organization_member_projects` **as an ALTER, because the table already
  existed** (`S-R-A` A-1) and teaches `org_project_visible()` that an expired
  assignment does not resolve; 0058 generates `project_role_baseline()` and has
  `has_cap()` union it; 0059 closes the project-scoping gaps in **USING and WITH
  CHECK together** across eleven policies.
  **Live counts, read rather than quoted: 14 policies carry
  `org_project_visible()`, 12 carry `has_cap()`, and both grant tables hold 0
  rows.** Three functions matter to this batch — `has_cap`, `org_project_visible`
  and the new `project_role_baseline`.
  The pre-Batch-26 line, kept because it is what this file claimed:
  **Migrations applied: 0000–0054, every one of them.** Verified live
  2026-09-12: the two grant tables exist with RLS; ten new functions
  (`has_cap`, `role_baseline`, `client_role_baseline`, `valid_org_cap`,
  `valid_client_cap`, `normalize_cap{,_org,_client}`, `actor_is_org_owner`,
  `actor_is_client_owner`); five `*_guard` triggers; **12 policies across ELEVEN
  tables carry a `has_cap()` predicate** — two more than `S-R` §9 names, and
  `S-R-A` A-10 records which and why. 0050–0054 are Batch 25's.
  **CORRECTION — 0048 IS APPLIED.** The line below said it was "printed and
  GATED on the Batch 23 deploy" while §9's own remainder list said it was
  applied 2026-09-03. The two halves of this file disagreed; a live read settles
  it for §9 — `message_room_prefs` is gone. This is HANDOFF contradicting
  itself, which is the failure mode §12 exists to catch, and it survived one
  recompile.
  The superseded line, kept because it is what this file claimed:
  **Migrations applied: 0000–0047, plus 0049. 0048 is printed and GATED on
  the Batch 23 deploy** (it drops `message_room_prefs`, which the RUNNING
  deploy still reads — the 0036/0037 lesson applied in advance). Verified
  live 2026-09-03: `room_members` holds the 20 backfilled seats plus the
  harness fixtures; the four helper functions exist; messages carry
  member-based policies (`messages_member_read` / `_member_insert` /
  `_sender_update` + the untouched approval RESTRICTIVE gate); the
  one-crew-room index is replaced by the General-name index; `message_rooms`
  carries topic/is_private/archived_at/last_message_at/project_id/dm_key.
  The superseded line, kept because it is what was true until this batch:
  **Migrations applied: 0000–0041.** 0036 (documents.kind) and 0037 (the
  migration-12 drops) were applied in Batch 22 after the Batch 21 code
  finally reached a deploy — they had been committed but NEVER PUSHED, which
  is why the "gated" state below persisted; the push was the missing step,
  not the migration. 0038–0041 are the approvals engine. Verified live
  2026-09-02: five `approval*` tables exist and are empty of production rows,
  three triggers are installed (`approval_decisions_stamp_actor`,
  `approval_decisions_advance`, `approvals_project_to_task`), `messages`
  carries `approval_id`/`anchor_kind`/`anchor_value` and NO LONGER carries
  `read_at`/`is_deleted`/`sender_role`/`attachment_url`, every organization
  reads `approval_window_hours = 120`, and `documents` reads
  `kind = 'screenplay'` on its one row.
  The superseded line, kept because it is what was true until this batch:
  **Migrations applied: 0000–0035. Printed and GATED (not merely pending):
  0036 and 0037.** Verified by live probe 2026-09-01 (0025–0033) and
  2026-09-02 (0034 `user_prefs`, 0035 `sender_role` nullable + null-sender
  recovery): `client_members.last_seen_at` exists (0025), `clients.user_id`
  is gone (0026), `message_rooms` exists with room-scoped policies (0027,
  0030), `messages` carries `room_id NOT NULL`, `thread_root_id`,
  `body_tsv`, `deleted_at` (0028–0030). The owner applied 0025/0026 and
  0027–0029; **0030–0035 were applied by the agent** under the
  Management-API grant (below). 0036 (documents.kind vocabulary) and 0037
  (the migration-12 drops) are DROP-shaped: they apply only AFTER the
  Batch 21 code deploys — sequence in §9. The 0029 backfill's
  verification matched its printed prediction exactly: 7 client rooms, 0 crew,
  190 messages repointed, 0 unresolvable, 0 org changes, 7 reply chains.
- **The agent can now apply migrations.** The owner added
  `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` to `.env.local`
  (2026-09-01) and said so explicitly; `scripts/ops/db-query.ts` posts SQL to
  the Management API. This supersedes "printed, never applied" — each apply is
  still followed by the migration file's own verification queries, run live.
- **Access token hook:** enabled in production, verified from a live JWT. 0026
  changes its body; step 2 (verify a client's token still carries
  `organization_id`) is the check that matters after applying it.
- **Harness:** `npm run test:rls` → **40 pass / 0 fail / 0 vacuous / 0 error**,
  numbered 1–41 with **21 RESERVED** for the retention-purge assertion. 37 is
  `S-R-A` A-3's owed one (a grant and a deny held at once, deny wins, with the
  grant alone as control — reached by REVOKING the deny, so the control asserts
  the reason the index is shaped that way rather than merely making the zero
  mean something). 38–41 are the scoped seat: a contractor with no assignments
  reads nothing, a scoped member cannot reach a sibling production, an expired
  assignment stops resolving **without being deleted**, and a project role grants
  its baseline while widening no rows.
  **All five were run RED before being trusted.** 37 fails under the narrow index
  while 31 passes identically in both states — which is A-3's argument
  demonstrated rather than asserted. 38 fails when the contractor is given
  `scope_mode='all'`; 39, 40 and 41 all fail when the scoped member is
  additionally assigned to the sibling production, which was not planned and is
  the more useful result: it shows all three are coupled to the scoping predicate
  rather than passing incidentally.
  **THE TWO TEST SURFACES NOW REFUSE TO RUN CONCURRENTLY**
  (`scripts/harness-lock.ts`). `check:caps` phase 3 writes
  `extra_caps = ['client_money']` onto the harness CREW member and reverts it in
  a `finally`; that normalizes to `money.invoices`, which is exactly what
  assertion 30 asserts the member does not hold. Run together, assertion 30 FAILS
  **pointing at whatever was just changed**, with the `finally` erasing the
  evidence. It cost one false suspicion of migration 0056 in this batch. The lock
  names the other surface rather than saying "busy", and releases on the crash
  path too — a lock that survives a crash turns a guard into an outage.
  The pre-Batch-26 line:
  `npm run test:rls` → **35 pass / 0 fail / 0 vacuous / 0 error**
  (30–36 added in Batch 25 from S-R §11: the money boundary, a denial beating a
  role baseline, and the four delegation rules that no route test can prove.
  A new `finance` persona exists so assertion 30's positive control is a role
  that holds money and nothing else — an owner control would have proved only
  that invoices are readable by somebody. Both grant tables join the every-table
  sweeps. **None of the seven is single-use**: run twice without re-seeding, only
  the pre-existing 17 goes vacuous.)
  **`npm run check:caps`** is the second test surface now — three phases:
  generated SQL vs the TS constant, TS resolver vs live `has_cap()` per persona,
  and the legacy-alias path on a real row. Each phase has been seen to FAIL on a
  real defect, which is the only thing that makes a green tick mean anything.
  The pre-Batch-25 line:
  `npm run test:rls` → **28 pass / 0 fail / 0 vacuous / 0 error**
  (22–29 added in Batch 23 from S3-d §7; 21 stays RESERVED for the retention
  purge assertion; the collab persona joins the roster — an auth user with NO
  roster row anywhere, whose entire tenancy is one `room_members` seat).
  Assertions 17 and 24 both write through single-use/pruned fixtures — re-seed
  between runs. The pre-Batch-23 line:
  `npm run test:rls` → **20 pass / 0 fail / 0 vacuous / 0 error**
  (16–20 added in Batch 22 item 6 from S3-c §7: internal approvals invisible to
  clients, decision forgery, comment permission, comment visibility, and the
  one that stops a lapse ever reading as approval). All five approval tables
  are in the every-table sweeps. **Assertion 17 is SINGLE-USE** — its positive
  control inserts a real decision and `approval_decisions` is append-only for
  everyone, so re-run without re-seeding and it reports VACUOUS naming the fix,
  never FAIL. The pre-Batch-22 line: **15 pass / 0 fail / 0 vacuous / 0 error**
  (10 from S2 §6; 11–14 from Batch 13.7; 15 from Batch 14.6 — a member cannot
  read a colleague's `message_read_state`, and neither can the ORG OWNER; the
  probe checks both doors because the surveillance surface §7.8 worries about
  is precisely the boss reading when you opened a message). `message_rooms`
  is in the every-table sweeps; the seeder get-or-creates rooms, stamps
  `room_id` on every message, and writes two watermark rows for assertion 15.
- **The A-8 click-test is DONE** (owner, 2026-09-01) — it surfaced the
  wiring gaps recorded in the Batch 14 row above, and a scripted probe
  cleared replication itself (1.8s delivery, both policy doors). Owed now
  instead: a fresh click-test after the Batch 21 deploy — send both ways in
  a project thread AND in a General thread, hub and project page, expecting
  ~1–2s delivery, live typing, the chime, the rail badge moving without
  a refresh, and read ticks turning blue when the other side opens the
  thread (receipts now derive from watermarks — Batch 21.3). (A sentence
  here was truncated mid-word — "The 0030 policy" — since Batch 14; its
  intent is unrecoverable and it is removed rather than guessed at.)
- **`tsc --noEmit`:** clean. **Lint: 313** (unchanged across Batch 25 —
  counted at its start and after every one of its eleven commits; the I-8
  ratchet refused a new service-role importer mid-batch and the fix was to stop
  needing one, so the number never moved).
  **Route handlers: 56** — Batch 24 added `/api/files/multipart`, zod-validated
  like the four `/api/rooms*` routes Batch 23 added (I-7 holds for all new
  surfaces). The pre-Batch-24 line: **Lint: 313** (counted at Batch 23's end; 315
  at its start). **Route handlers: 55**. The pre-Batch-23 line: **Lint: 317** (counted at Batch 22's end; 318 at
  its start). **Route handlers: 51** — and the count went DOWN for the first
  time in this project's history, because Batch 22 item 11 deleted
  `/api/activity`. The superseded line: **Lint: 318** — 355 at Batch 15's start, 319
  after its project-page excisions, and 318 since the owner rounds (this
  entry said 352, stale since Batch 15; §10's 319 was right until it
  wasn't — count it, don't quote it). Failures do not fail the build.
  **`npm run build`:** green — 7.6s at Batch 8, 9.0s at Batch 10, **7.7s at
  Batch 22** (after `rm -rf .next`, which was needed because Next's generated
  route validators still named the deleted `/api/activity`). Count the routes,
  do not quote them: `find app/api -name route.ts | wc -l`. This figure has
  been corrected four times.
- **Nothing in the application uses Supabase's mailer** (10.3). Zero callers of
  `inviteUserByEmail` or `resetPasswordForEmail`. Supabase SMTP stays pointed
  at Resend so a misconfiguration produces a plain email rather than silence.
- **One place a message reaches Resend:** `lib/email/send.ts` (10.4). There
  were two for the length of 10.2–10.3.
- **The three sender configs are done** (owner, 2026-08-31): `genreline.com`
  verified in Resend, `NOTIFY_FROM_EMAIL` switched in Vercel and `.env.local`,
  Supabase SMTP pointed at Resend. The McPrime Resend domain is deliberately
  retained — it is McPrime's Layer 2 domain, already verified, and costs
  nothing idle.
- **Neither Batch 9 nor Batch 10 touched the database.** No migration was
  written and none was needed. Batch 9 ended with a live read (§8.3 items 7 and
  12); Batch 10 needed none — `organizations.logo_url` already existed, and
  `organizations.brand_color` was **deliberately not added**, because an
  additive column must be applied before the code deploys (the 0025 ordering
  lesson) and nobody asked for per-studio colour.
- **After Batch 9, the ONLY hardcoded tenant identity left in the application
  is on the three pre-auth pages** — `app/(auth)/login`, `/reset-password`,
  `/set-password`. That is item 2's stop-and-report, not an oversight (§8.3
  item 7). Everything behind a session reads the tenant from the database.
- **No literal application hostname exists in any code path.** Two occurrences
  of `https://genreline.com` remain in `lib/appOrigin.ts` — one in a doc
  comment, one inside the error message that tells an operator the expected
  format. Neither is used to build a URL.
- **Live data (2026-09-02, after Batch 22):** 3 organizations (McPrime + 2
  harness) · 8 client companies (2 harness) · 122 tasks · **261 messages**
  (259 production + 2 harness approval fixtures; the seeder prunes
  approval-carrying messages each run) · 4 `approvals`, all of them harness
  fixtures — **zero production approvals exist yet** · `documents` holds one
  row, `kind = 'screenplay'` · `org_credits` for McPrime at **−15¢** ·
  `org_budgets` holds exactly **one** row (the house org, `hard_stop = false`)
  · **`organizations.plan` = 'house' for McPrime** — §8.3 item 12's printed
  statement HAS been applied, contradicting that entry, which said it was
  printed and not applied.
- **Every client company has an active `owner` in `client_members`**, and every
  `clients.user_id` value appears on one of those rows. That is what makes the
  0026 drop lossless, and it is now maintained by the create paths rather than
  by a one-time backfill.
- **`client_members.last_seen_at` EXISTS** (0025, applied 2026-08-31; this
  entry said it did not, contradicting the migrations line four bullets up
  — the probe that wrote it predated the apply).
- **Sentry:** wired. `NEXT_PUBLIC_SENTRY_DSN` is set in Vercel per the Batch 8
  brief; it is still **absent from `.env.local`**, so `captureError` no-ops to
  console on local runs. Not visible from the repo either way.

## 8. What is open — citable only

### 8.1 CLOSED — client onboarding

Batch 8.1. Both creation paths write the owner `client_members` row before the
claim, and fail the route (deleting the company row) if that insert fails. The
next client created works. Do not re-open.

### 8.2 CLOSED — `clients.user_id`

Batch 8.2/8.3/8.6. Zero references in application code; the column drops with
0026, which also removes the access-token hook's read of it. S1 §10 q2 and
S2 §11 q4 close with it.

### 8.3 Live defects / security

1. **CLOSED in 14.4 — structurally.** Migration 0033 backfilled
   `message_attachments` (11 in, 11 out, 0 unresolved, 0 tenant mismatches)
   and `lib/messageAttachments.ts` now resolves every send's reference to a
   `files` row server-side, refuses one outside the caller's tenant, and
   stores fields derived from the verified row — the body's strings are never
   echoed. A forged reference 400s. `attachment_url` keeps being written
   (derived, verified) until migration 12 drops it. Do not re-open.
2. Message delete orphans the file + R2 object (AD-004-R item 3). **Half
   remains: the purge.** The payload half CLOSED in 14.3/14.5 —
   `scrubDeleted()` strips body + attachment fields from every server read
   that ships message rows (both thread GETs, both project pages, both hub
   previews), so deleted content no longer travels while the row awaits the
   §4.2 purge. What still does not exist: the purge itself (migration 11) —
   the R2 object has no destruction path, and RLS still shows deleted rows to
   authenticated sessions until migration 10's sweep (replication payloads of
   the delete UPDATE included, which only reach prior readers).
3. The `$2` per-call AI ceiling (S0 §4) is **unbuilt**. 7.1 fixed the *budget*
   half of I-5; nothing bounds a single call but `max_tokens: 2000` in
   `app/api/studio/muse/route.ts:141`.
4. The cron route's **POST** half (`app/api/cron/message-nudge/route.ts:90-99`)
   is a user-session path — `PresencePulse` calls it on every page load —
   running a service-role scan of every unread message. Allowlisted as PERMANENT
   for its GET half only; the POST half is not. **Still open.**

   **A SECOND INSTANCE EXISTED AND THIS LIST DID NOT HAVE IT** (found by the
   Batch 22 item-0 audit): `app/api/admin/deadline-check/route.ts` POST, also
   fired on every admin page load, ran a service-role scan that COMPLETED
   tasks, posted into client chats and sent notifications — and wrote
   `approval_status = 'auto_approved'`, recording silence as approval, which
   `app/studio/client/review/page.tsx:131` then counted among the APPROVED.
   **CLOSED in Batch 22 item 5**: the auto-proceed half is deleted and replaced
   by `/api/cron/approval-sweep` (GET only, no POST half, per-organization,
   explicitly capped). The deadline-notification half remains and is
   notification-only. Nothing had ever run the old path in production —
   `auto_proceeded` was false on all 122 live task rows — so there was no
   historical data to reconcile. The lesson this leaves: when a defect is
   recorded against ONE route, grep for the shape, not the filename.
5. **CLOSED in 9.5.** `lib/billing/plans.ts` no longer tests
   `orgId === DEFAULT_ORG_ID`; the parameter is gone and the house org's
   exemption is its `organizations.plan` value. The file now has one importer
   (`lib/tenantBrand.ts`), so the condition this entry set was met before it
   got one. Do not re-open.
6. `clients.last_seen_at` is now written by nothing and read by nothing (8.2).
   Retiring it is a column drop nobody has scheduled.

**Opened by Batch 9 — what it found and did not fix:**

7. **CLOSED in 9.7 — the pre-auth pages are tenant-neutral.** They ran before
   any session exists, so there was no tenant to resolve; the owner chose
   "neutral, brand after sign-in" over subdomain, route segment or email
   lookup. `/login`, `/reset-password` and `/set-password` now carry the
   product mark and no studio name. Branding begins at `/dashboard`, which
   already resolves it. `components/McPrimeLogo.tsx` is deleted.
   **RESOLVED by live read 2026-08-30:** every `organizations.logo_url` is
   `null`, and no `clients.avatar_url` or `projects.image_url` references the
   path either. Nothing pointed at it, so `public/mcprime-logo.jpg` is
   deleted — it was also being served publicly at `<origin>/mcprime-logo.jpg`
   to every tenant. McPrime uploads a logo the way any tenant does, into
   `organizations.logo_url`. The pre-auth pages now carry
   **no copyright line at all**: "© McPrime Digital" was wrong for every
   tenant, and the correct replacement is not knowable until S0-B §7's legal
   entity is settled. An unowned © claim is worse than none.
8. **PARTLY CLOSED in Batch 10. The interim defect is fixed; the envelope is
   still S5.**

   **Closed:** `NOTIFY_FROM_EMAIL` no longer supplies an identity at all — it
   supplies the ADDRESS, and `lib/mailSender.ts` composes the display name from
   the sending tenant (S-C CM-3). A client of Studio Two now sees "Studio Two"
   in their inbox list, with Reply-To pointing at that studio's own address.
   SMS carries its sender in the body, which it must: the US and Canada do not
   permit alphanumeric sender IDs, so the number cannot say who is writing.

   **Still open, and genuinely S5:** the sending DOMAIN is `genreline.com` for
   every tenant (Layer 1). A studio's own `notifications@studiotwo.com` needs
   that studio to publish DNS records — Resend's domains API makes it a
   self-serve flow, and `senderFor()` is already the single branch it plugs
   into. No tenant has asked; there is one production studio.

   The original entry, kept because it is what the code did until 2026-08-31:
   `lib/notify.ts:143` sends from a single `NOTIFY_FROM_EMAIL`; `lib/sms.ts:23`
   from a single `TWILIO_FROM`; the SMS body carries no sender prefix at all.
   Message *content* names the sending studio everywhere since 9.3; the
   envelope cannot be per-tenant until per-tenant Resend domain verification
   and a Twilio Messaging Service exist. **That part is S5.**

   **What is live now (checked 2026-08-30, `.env.local`):**
   `NOTIFY_FROM_EMAIL` = `"McPrime Digital <notifications@mcprimedigital.com>"`.
   So every notification email the product sends — to every tenant's clients —
   arrives From one tenant. `S-F` §6 forbids exactly this, and the interim
   fix is one variable, not a project: a neutral Genreline sender until
   per-tenant sending exists.

   **Prerequisite, and skipping it breaks all email:** Resend will only send
   from a domain verified in the Resend account. `genreline.com` must be added
   and its DNS records published there BEFORE the variable changes, or every
   send fails. Change it in Vercel (Production, Preview) and in `.env.local`.

   `TWILIO_*` is absent from `.env.local`, so SMS is inert locally; the Vercel
   value was not visible from this machine and needs the same check — if
   `TWILIO_FROM` is a McPrime-branded number or Messaging Service, it carries
   the same defect.

   `VAPID_SUBJECT` is also unset, so push falls back to
   `lib/product.ts`'s `notifications@genreline.com`. That is a contact URI for
   push services rather than a deliverable address, so it is correct as a
   product value — but the mailbox does not necessarily exist.
9. **CLOSED in 11.5 — and the count in this entry was wrong.** It said two
   ledger sites still read `user.user_metadata?.name`. A grep after fixing
   those two found **four**: `invoice-actions:268`, `files/commit:166`,
   `files/[id]:61` and `invite-client:159`. The entry was compiled from the
   sweep that fixed the first two rather than from a search, which is HANDOFF
   §12.2 again — *a guard proves what it looks at, and nothing else.*

   All four now resolve through `rosterName(user)` (`lib/team.ts`), which reads
   the roster that owns the person — `organization_members` for crew,
   `client_members` for portal users — and returns null rather than a fallback,
   so each site keeps the attribution it had. The forgeable primary is gone
   from every ledger write path in the codebase; the remaining
   `user_metadata?.name` reads are DISPLAY only (studio chrome, an onboarding
   form prefill, `ownName`'s own fallback chain), where a person renaming
   themselves changes what they see and forges no record.

10. **DECIDED, not merely skipped: `lib/stores/session-store.ts:31` keeps the
   key `'throughline-session'`.** It is a localStorage key already written in
   every existing user's browser, so renaming it does not migrate that state —
   it orphans it, and the store silently rehydrates empty. What is lost today
   is small (the docked session's title, view and mode; real session content is
   Phase 2), but it is live client data, not a string, and the product name is
   not visible through it to anyone.
   **The decision: leave it until something else forces a version bump**, then
   rename with Zustand's `migrate`/`version` options in the same change so the
   old key is read once and rewritten. Renaming it alone buys nothing and
   costs state. Revisit when the store gains real content.
11. `tailwind.config.ts:59-63` — five `mcprime-*` colour aliases, hardcoded
   tenant identity in config with **zero usages anywhere**. Dead config, not a
   rename. Belongs to the C-6 dead-code inventory with `McPrimeLogo.tsx` and
   `public/mcprime-logo.jpg`, both of which become dead the moment §8.3 item 7
   is resolved.
12. **CLOSED — the statement was applied.** Live read 2026-09-02:
   `organizations.plan = 'house'` for `00000000-…-0001`. This entry said the
   fix was "printed, not applied" and that was true when written; the owner
   has since run it. The wider point below still stands and is §11 q9: nothing
   in the APPLICATION writes `plan`, so it remains a value set by hand.

   The original entry, kept because it is what was true until 2026-09-02:
   **THE HOUSE ORG HAS NO EXEMPTION AT ALL, and Batch 9.5's commit message
   overstated this.** Live read 2026-08-30: **all three organizations carry
   `plan = 'agency'`** — the `0001:23` column default. Nothing in the
   application writes that column.

   9.5 removed `orgId === DEFAULT_ORG_ID` from `lib/billing/plans.ts`, which
   was correct (P-1), and said the exemption "is now stated" as the plan
   column. **The row was never written.** So the branch is gone and the stated
   replacement does not exist: the house org's carve-out is currently recorded
   nowhere. This is HANDOFF §12 lesson 1 exactly — a repair that did not state
   the invariant — committed by the batch that quotes that lesson.

   **Consequences today: none.** No gate reads `planLimits()`, and the one
   live consumer, `planAllows('agency', 'attribution.hide')`, correctly
   resolves false so the badge shows. **Consequences the first time a plan
   gate ships: McPrime is gated like a paying agency** — 5 seats, 25 client
   companies, 500 GB — which contradicts the standing house-org rule that
   every money gate bypasses tenant zero while still metering it.

   **The fix is one statement, not a migration.** Printed, not applied:

   ```sql
   -- State the house org's plan. Batch 9.5 removed the id-test that used to
   -- imply it; this is the stated replacement, same shape as the org_budgets
   -- hard_stop opt-out row (8.5) and scope_mode (0018 A5).
   update public.organizations
      set plan = 'house', updated_at = now()
    where id = '00000000-0000-0000-0000-000000000001'
      and plan is distinct from 'house';

   -- verify: expect exactly one row, plan = 'house'
   select id, name, plan from public.organizations
    where id = '00000000-0000-0000-0000-000000000001';
   ```

   **The wider point, which outlives this row.** `plan` is one of the three
   entitlement axes in `S-V` §8, and nothing writes it — not the create paths,
   not `provision-tenant.ts` (it takes `--plan`, defaulting to `agency`).
   Every plan-gated feature added from here resolves against whatever the
   default happens to be. Deciding which write path owns `plan` belongs with
   the billing work, and is now §11 question 9.
13. **MOSTLY CLOSED by live use (2026-08-31).** The owner exercised the logo
   upload (McPrime's `organizations.logo_url` is now SET — confirmed by live
   read), branded invites arriving, and the re-invite of a deleted company.
   **Still unexercised:** the `delivered: false` path — nothing has seen a
   send fail — and the crew/teammate invite variants. Forcing `delivered:false`
   is a five-minute check: point `RESEND_API_KEY` at a bad value on Preview,
   run a resend-invite, confirm the response says "regenerated, but the email
   could not be sent" and Sentry captures it.

14. **`generateLink()` changed a failure mode, and nothing has hit it yet.**
   `inviteUserByEmail` created the user and sent the mail as one operation — no
   mail meant no user. Now the link is minted first, so a delivery failure
   leaves a **correct account and a correct roster row with an undelivered
   message**. That is deliberate (tearing down a valid account over an SMTP
   hiccup is worse, and `resend-invite` is the recovery path), and `delivered`
   is returned rather than thrown. `resend-invite` surfaces it; the other five
   callers currently ignore it. Whether they should show a soft warning is a UX
   decision nobody has made. **Still open after Batch 11.**

   Related, and settled in 11.3: the manual-password flow (`create-client`
   FLOW B) still refuses an address that already has an account, deliberately.
   The obvious fix — `updateUserById` to set the password — is **account
   takeover**: any admin could claim an existing account, including another
   studio's client, by "creating a client" at that address with a password they
   chose. Flow A is safe because the link goes to the mailbox and the admin
   never learns the password. The error now points at the invite option.

15. **The email catalogue covers only flows that exist.** No signup, no
   email-change, no phone-change — verified by grep, not assumed. `generateLink`
   supports `signup`, `email_change_current` and `email_change_new`, so the
   email side is a few lines whenever those features are built. **Phone is not
   email at all**: it is SMS OTP through Supabase→Twilio, has no `generateLink`
   type, and its only template lives in the Supabase dashboard.
   **Dashboard task, now owned:** the six Supabase Auth email templates carried
   McPrime branding. Genreline-voiced replacements are in `docs/email/`, one
   file per template, matching `lib/email/layout.ts` so a fallback is
   indistinguishable from a real message. They are **product-voiced, not
   tenant-voiced, and that is forced rather than chosen** — Supabase templates
   are global per project, so a studio's name cannot appear in one without
   appearing in all of them; same conclusion as the pre-auth pages (9.7).
   **Remaining step is pasting them into the dashboard**, which no code change
   can do.

   **THE SMTP TRADE-OFF, and the first version of this note had it backwards.**
   It was suggested in conversation that deleting Supabase's custom SMTP once
   real invites are verified would make a bypassed path "fail loudly". **It
   would not.** Supabase Auth always has a mailer: custom SMTP *replaces* the
   built-in sender, it does not gate it. Remove the SMTP config and auth email
   reverts to Supabase's own service — unbranded, from a `supabase.io` address,
   and severely rate-limited. That is strictly worse than the fallback it was
   meant to prevent.

   | | Keep SMTP → Resend | Delete SMTP |
   |---|---|---|
   | A bypassed path sends | the `docs/email/` template, Genreline-voiced, from `genreline.com` | Supabase's default, from `supabase.io`, rate-limited |
   | Fails loudly | no | no |

   **So keep the SMTP config pointed at Resend.** The thing that actually
   prevents a bypass is a lint ratchet, not a missing mailer: nothing in the
   application calls `inviteUserByEmail` or `resetPasswordForEmail` any more
   (10.3), so the only way one returns is somebody adding a call. Banning those
   two identifiers in `eslint.config.mjs` is the same shape as `NO_GET_SESSION`,
   `NO_SERVICE_ROLE_KEY` and `NO_RAW_APP_URL`, and it is the mechanism CM-5
   currently lacks. **Not built** — offered and not yet asked for.

16. **`organizations.brand_color` does not exist**, so every tenant's email
   renders the product accent (`#c8a24a`, `--primary`). Deliberate: an additive
   column must be applied before the code deploys (0025's ordering lesson), and
   per-studio colour was not asked for. `safeColor()` in `lib/email/layout.ts`
   is the validated entry point when it lands — one argument changes.

17. **The Supabase Auth domain checklist is not in code and cannot be.**
   Changing domain requires updating Auth's Site URL and its Redirect URL
   allowlist in the Supabase dashboard. Miss them and every invite link and
   every password-reset link breaks silently, for everyone — the code half is
   done (9.1), this half is a deploy-time step. Recorded in `.env.example`
   beside the variable.

18. **CLOSED in Batch 25 item 1a — and the SHAPE is the entry, not the two
   routes.** Both were found by the item-0 audit, neither was in the brief.

   **THE GENERAL FORM: a route whose GET gates on the ROUTING CLAIM while its
   mutations gate on a capability.** `app/api/admin/team/route.ts` stamps
   `app_metadata.role = 'admin'` on EVERY crew invite at every roster role
   (:129 before item 1b), and `isAdmin()` reads that claim — so any handler
   using it as authorization admits every crew member. Three instances in one
   batch:
   · `/api/studio/credits` + `/checkout` gated on `if (!user)` alone. Every
     client-portal user carries the STUDIO's `organization_id` claim, so a
     CLIENT read the studio's balance and hard-stop state (200, proven over
     HTTP) and reached Stripe with the studio's org id stamped on the session.
   · `/api/admin/invoice-actions` gated on `isAdmin()`, so a roster `member`
     created, sent, marked paid and DELETED invoices — and read
     `business_settings`, i.e. the studio's BANK DETAILS, via its three
     settings actions.
   · `GET /api/admin/team` returned the entire crew roster to a roster
     `member` while its own mutations required `canManageOrg`.
   All three closed. **Batch 22's lesson applied, and it paid:** the fix was a
   grep for the SHAPE across all 56 handlers, not for the filename. It went
   1 → 0 for the literal shape; 17 handlers remain claim-only throughout and
   are listed in §8.4, all of them `work.*` surfaces S-R §9 leaves app-layer.

   The two roster GETs return a REDUCED PAYLOAD rather than a 403, because
   `RoomThread.tsx:930-931` fetches both for the IN-ROOM ROSTER and needs only
   `{ name, role }`. A 403 there would have blanked a live messaging surface for
   coordinator and crew — the roles this batch exists to make usable.

19. **CORRECTED 2026-09-12, and the correction is the entry.** One `auth.users`
   row carries a typo'd address (`.con`) with no membership on either roster and
   no `client_id` claim — so it authenticates and then resolves to nothing:
   `resolveCaps()` returns denied and the portal layout finds no membership. The
   Norton Slims member is at the correct `.com` address and receives mail
   normally. Recorded because the two defects are different and the wrong one was
   filed first: "a member who can never be reached" is an address to correct, "a
   sign-in that resolves to nothing" is an orphan auth row, and they have
   different fixes.

   The superseded text, kept because it is what this file claimed and because
   `S-R-A` was written from it:
   **`slim.slims0241@gmail.con` — a live `member` on Norton Slims whose address
   is typo'd.** They hold a `client_members` row, so they can sign in and be
   scoped and notified, and **can never receive mail**.
   That was wrong on the load-bearing half. It was a compression of the Batch 25
   audit's own q3 output — which had the right answer (`om_role: null`,
   `cm_role: null`) — and it reached a SETTLED spec as a premise before a live
   read caught it. §12 lesson 4, with one author on both ends.

20. **KNOWN COARSENESS in the capability vocabulary, recorded rather than
   discovered later.** Batch 25 chose coarse stored capabilities over S-R §4's
   38 fine keys (option A — expanding one stored grant into ten asserts an
   intent nobody recorded). Two consequences:
   · `record.ledger.read` and `record.certificate.export` both resolve to
     `work.projects`. So **anyone who can touch a project can export the
     certificate that proves what a client signed off** — the dispute surface
     (S3-c §3.2) has no grant of its own and cannot be withheld independently of
     the work. Defensible for a producer; wrong for a studio that wants a
     coordinator to run jobs without exporting sign-offs. Splitting it needs a
     real case.
   · `client.message.send` also resolves to `work.projects`. Milder, and it
     produces S-R §3.1's coordinator exactly — talk to a client, never create or
     delete the company.
   Both share a cause: **`work.projects` is by a distance the broadest coarse
   cap and the one most likely to need splitting first.**

21. **The legacy snake_case capability aliases are OWED FOR DELETION**, and they
   exist in TWO places on purpose — `LEGACY_ORG_CAP`/`LEGACY_CLIENT_CAP` in
   `lib/capabilities.ts` and `normalize_cap{,_org,_client}()` in 0052. A single
   copy was the original plan and it produced a real divergence: the TS resolver
   honoured the alias and `has_cap()` did not, so the route said yes and the
   policy said no. Until they go, `check:caps` phase 3 is what holds the two
   copies together. Deleting them is a migration plus one TS constant.

Item 4 of this list in the Batch 7 compilation — `lib/sms.ts:24` metering every
tenant against `DEFAULT_ORG_ID` — **closed in 8.4**.

Closed in Batch 7 and **not** to be re-opened: `hard_stop` default (7.1) ·
global presence disclosure (7.2) · the three `void recordUsage` sites (7.3) ·
estimated AI cost and the `primeos` kind (7.4) · the tenant bootstrap and all
four `['member']` sources (7.5) · account-destruction copy (7.7) ·
`user_metadata` display names (7.8) · the missing I-8 ratchet (7.9).
Closed in Batch 8: client onboarding (8.1) · client-side presence and
notification fan-out (8.2) · the last `clients.user_id` readers (8.3) · SMS
metering (8.4) · the house-org identity test (8.5) · the column itself (8.6).

#### CLOSED (S-S Phase C) — the review queue bypassed project scoping

`app/studio/client/review/page.tsx` read `tasks` through `supabaseAdmin`.
Service role bypasses RLS, and RLS is where 0057–0059 put the project scoping —
so a crew member with `scope_mode='selected'` would have been handed **every**
production's review queue from this page, while `crew/tasks` (which reads on the
user client) correctly showed them only their own.

Nothing leaked: both live crew rows are `scope_mode='all'`, so the two paths
returned the same rows. The gap was ARMED, not firing, and it would have fired
on the first scoped seat — which is the entire capability Batch 26 was built to
deliver. It reads on the user client now, and the I-8 allowlist SHRANK by one
entry rather than growing.

The harness already proves the fixed path: assertion 39 (*a scoped member reads
zero of a sibling production's tasks*) is exactly this predicate.

#### OPEN — auto-advance can proceed on silence from NOBODY (needs a ruling)

`approval_assignees.client_id` is `on delete cascade`
(`0038_approvals_schema.sql:199`). Deleting a client company therefore deletes
the assignee rows that pointed at it. The sweep's `anyAssigneeCanDecide()`
deliberately returns `any: true` when a stage has zero recipients
(`app/api/cron/approval-sweep/route.ts:172`), citing `S3-core` §2.4 — "a
departed member neither blocks nor receives".

That reasoning is right for ONE departed assignee among several. Where it
empties the stage, the window still lapses, `advanceOnSilence` still writes
`auto_advanced`, and `ApprovalCertificate` still prints its load-bearing
sentence — *No response was received by the agreed review date* — about a review
**nobody was able to receive**. That is the false record the whole of `S3-c`
exists to prevent, produced by the engine built to prevent it.

It is reachable through a supported operation (deleting a client company), and a
live harness fixture is already in that state: `Harness · lapsed on silence`,
status `auto_advanced`, zero assignees.

**Not fixed, deliberately.** Auto-advance semantics belong to `S3-core` §2.4 and
the decision is the owner's. `S-S` §6.3 lists the three options. What Phase C
did do is refuse to let it be invisible: `approvalIntel()` grades any such
record `broken` and says so in plain words on the Review surface.

#### CLOSED (0071) — deleting a client company destroyed its activity ledger

`activity_log.project_id` and `activity_log.client_id` were both **ON DELETE
CASCADE** (migration 0001). `delete-client` is a live route that hard-deletes a
`clients` row, so every ledger entry about that company went with it — silently,
because a cascade is not an error. S0 §4's seven-year retention has been
contradicted by a foreign key since the beginning.

Both are `SET NULL` now. The ledger row survives with its `organization_id`
intact (NOT NULL on all 59 live rows, checked before the change) and becomes an
org-level entry, which `activity_log_crew_all` already renders correctly through
its `project_id is null` branch.

The guard is a BEFORE DELETE trigger rather than an omission from the purge's
table list, and this defect is exactly why: nobody wrote `delete from
activity_log`, and rows disappeared anyway. Proven by probe — deleting a project
now spares its ledger; assertion 21 holds the rule.

#### OWED — `files.version` and `files.version_no` now both exist

0069 added `version_no` per `S3-core` §3.1. `files` already carried a dormant
`version` column from migration 0001: value 1 on all 43 rows, **zero readers and
zero writers anywhere in the repo**. Two columns meaning the same thing is drift
and the next person will pick the wrong one.

Not dropped here, deliberately: dropping a column is destructive and belongs in
its own migration with a deploy gate (`S3-core` migration 12's shape), not as a
side effect of an additive one. Recorded so it is a decision rather than a
discovery.

#### REMOVED (0076) — bookings, on the owner's call

`bookings`, `booking_types` and `availability_rules` are dropped. All three held
zero rows. The owner's judgement, and it matches what `S-S` §6.6 recorded when
it shipped: a Cal.com-style slot picker is a SaaS reflex rather than a film
feature, and for a studio with no contended resource there is nothing for the
exclusion constraint to protect.

**What is worth remembering if a contended resource ever appears** — a casting
session with slots, a shared grade suite, an ADR booth — is not the UI. It is
0066's `EXCLUDE USING gist (owner_user_id WITH =, tstzrange(…) WITH &&)`, which
stops two people claiming one person under a race the application cannot win,
plus its header explaining why the owner must be stamped by trigger rather than
supplied. Roughly ten lines.

#### NEW ENV — LiveKit and the contract seal

Both optional; both degrade with a stated reason rather than silently.

- `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `NEXT_PUBLIC_LIVEKIT_URL` — without
  them Meetings renders the reason and no Join button.
- `CONTRACT_SIGNING_P12_BASE64`, `CONTRACT_SIGNING_P12_PASSPHRASE` — a PKCS#12
  bundle. Without it a completed contract still produces its PDF and its
  certificate page; it is simply not cryptographically sealed, and the result
  says so. **A silent downgrade from sealed to unsealed on a legal document
  would be the worst failure available**, so it is reported.

#### FIXED — two harness ids meant two things

`DOC_P1_ID` was byte-identical to `ROOM_GROUP_A_ID`, and `CAL_C1_ID` to
`GA_MSG_OLD_ID`: prefixes `000d` and `000e` were already in use when the document
and calendar fixtures were added. Different tables, so nothing broke — but an
assertion failure naming an id that means two things is an hour lost, and a join
written across them later would have been silently wrong. Moved to `0014`/`0015`,
with the seeder deleting the old rows so the harness tenant does not carry two
generations of the same fixture.

#### OPEN — colour-accurate streaming is half built, on purpose

0082 lets an asset DECLARE its colour space, transfer and bit depth, and
`ColourCheck` warns a reviewer whose display cannot represent it. That is the
half that is real today.

The other half — actually delivering a colour-managed stream — needs a transcode
pipeline that does not exist: 10-bit HEVC/AV1, calibrated transforms, and the job
queue `reference_infra-gaps-jobqueue-transcode` already records as missing. It is
NOT claimed anywhere in the UI, because a viewer told "this is colour accurate"
when it is not is worse off than one told nothing.

#### CLOSED (0083–0084) — three loops this repo had left open

1. **A recording never became a file.** Egress was started and stopped and
   `recording_file_id` was never set, `recording_status` never left
   `processing`. It finishes minutes later, in a webhook — which needs a queue.
   `/api/webhooks/livekit` verifies the signature and enqueues; the worker
   creates the `files` row and queues a transcode.
2. **Sending a contract emailed nobody.** The studio copied the link by hand.
   `contract.notify` now queues on send — queued rather than sent inline, so a
   slow mail provider cannot make "Send" appear to fail on a document that HAS
   been sent.
3. **Video had no rendition.** `files/commit` queues a transcode for any
   `video/*` upload, at the same boundary storage is metered.

#### NEW ENV — the encoder

`CLOUDFLARE_STREAM_TOKEN` (and `CLOUDFLARE_ACCOUNT_ID` if it differs from
`R2_ACCOUNT_ID`). Without it a transcode job is `blocked` with a stated reason
rather than retried five times and buried as `dead`.

`CRON_SECRET` becomes load-bearing for a second route: `/api/cron/jobs` runs
every five minutes (`vercel.json`) and REFUSES to run when it is unset.

### 8.4 Structural (sequenced, not forgotten)

The I-8 **migration** — the ratchet exists (7.9), no file has moved; read-path
flips per surface, portal dashboard first (S2 §7 order), paired with I-11's
`getSupabaseAdmin()` accessor in one pass (S0-A §4.3) · I-1 + I-3 per surface
together (16 `setInterval` sites) · I-2's subscription budget: eight
globally-named channels and ~13 subs/session (S2.5) · `tenantScope()`
insert-stamping helper + lint (T-5, S1 §8.1) — 8.1 and 8.4 closed three sites by
hand, the remaining inserts still lean on column DEFAULTs · retention schema
(S3) · AD-004-R's resumable uploader + attachment FK · per-member `phone` and
`notification_prefs` on `client_members` (8.2 falls back to the company's, which
is why SMS dedupes by number) · provenance tables have zero reads/writes
(`supabase/migrations/0003`) · dead code inventory (C-6) including `app/(admin)`
(S4), `hooks/useFileUpload.ts`, `lib/r2.ts:39-107`, `lib/billing/plans.ts`.

**The 17 claim-only route handlers** (Batch 25 item 5's grep; every method gates
on `isAdmin`/`userRole` and no capability appears in the file). All are `work.*`
or `client.*` surfaces, which S-R §9 deliberately leaves app-layer and filters by
PROJECT SCOPE — so they are the next batch's, not a hole this one skipped:
`admin/deadline-check` · `admin/invite-client` · `admin/messages` ·
`admin/notifications` · `admin/project-actions` · `admin/project-image` ·
`admin/resend-invite` · `admin/update-client` · `auth/welcome-context` ·
`files/[id]/download` · `files/[id]/raw` · `files/[id]` (DELETE) ·
`files/signed-url` · `portal/messages/attachment` · `presence/heartbeat` ·
`rooms` · `studio/approvals/[id]`.
Re-run the grep, do not quote this list: the script is
`scripts/`-less by design (it lived in the batch's scratch) and the shape is
`CLAIM` beside `CAP` per exported method.

## 9. What to do next

### 9.0 The client-space push (current, owner-directed 2026-09-14)

**"Hold on the Suite for now. The focus is on the client portal, client space
and crew space."** The Suite's nine AI features are ON HOLD at the owner's
instruction and need S5 anyway; do not pick them up.

The audit found FOUR surfaces in those three spaces that are declared in
`lib/studio/spaces.ts`, gated in `ORG_FEATURE_CAP`, and have no route:

| Surface | State | Note |
|---|---|---|
| `client/guest-links` | **BUILT** (0085–0087) | the screening room — see §7 |
| `client/brand-kit` | **BUILT** (no migration) | one colour in, an accessible ramp out — see §7 and CLAUDE.md |
| portal calendar | **BUILT** (no migration) | `/dashboard/calendar` — dates that say what happens if you do nothing; see CLAUDE.md |
| `crew/crm`, `crew/leads` | open, DEPRIORITISED | house-only (`internal.pipeline`). Lowest value of the four and flagged as such |

One more that is not a surface but is owed, and is cheap now that the evidence
exists: **wire watch-evidence into the approval record.** `listViewsForSubject`
in `lib/shareLinks.ts` already returns every view of a file across every link;
`approvalIntel` grades how well a record would hold up and has never been able
to see whether the approver watched the thing. "Approved after four seconds" is
exactly the signal it exists to surface.


**`S-R` IS BUILT. All four axes exist, are enforced at the row, and are
asserted.** Batch 26 landed seat class, project roles, individual grants-and-
denials (the index that makes them coexist), and the scoping default — on top of
Batch 25's company-role half. What that means concretely:

- **A crew member no longer reads every project in the tenant.** The predicate is
  on 14 policies and, since 0059, in **both USING and WITH CHECK** — which
  matters because INSERT is the one command USING cannot reach, and it was open:
  a scoped member could insert a task onto a production they could not see.
- **`scope_mode` is STATED at invite time**, derived once from seat class through
  `SEAT_CLASS_SCOPE_MODE` and never re-derived. The invite default is
  `contractor`; the COLUMN default is `staff`, and the difference is deliberate —
  a column default backfills rows that already exist.
- **Capability is answered in exactly one place.** `orgCan`, `clientCan`,
  `orgCanApproval` and `clientCanApproval` are DELETED, and
  `NO_BASELINE_AS_ORACLE` in `eslint.config.mjs` bans importing a role baseline
  outside three named readers.

**NOTHING IS OPEN ON ACCESS AND PERMISSIONS.** The list below is exhaustive as of
2026-09-13 and every entry is either CLOSED by code or DECIDED with its reason.
Three were closed after the batch (items 1, 3, 4); three are decisions that
should not be "fixed" and are written so the next reader finds an argument rather
than a TODO.

1. **CLOSED (0060).** The three parentless tables — `document_versions`,
   `document_comments`, `storyboard_shots` — reach their project through their
   PARENT now, via `org_document_visible()` / `org_storyboard_visible()`, in
   USING **and** WITH CHECK. A child of an untagged document stays org-visible,
   the same rule 0059 applies one level up. Applied while all three held zero
   rows. Proven on a seeded case, because the one live `documents` row is in the
   production org and a probe against it read zero for every persona — a
   confident zero that proved nothing.
2. **`message_rooms` keeps its policy, and this is a DECISION, not a gap.**
   `org_project_visible()` is false by construction for an MD-4 external
   collaborator — roster-less by definition — so adding the predicate to
   `message_rooms_member_read` would hide a project-tagged room from the very
   person invited into it. `is_room_member()` is already the right authority: a
   room's membership is STATED, not derived from project scope.
   `messages_member_read` carries the predicate at the MESSAGE level, which is
   the right layer. Owner ruling 4. **Do not "fix" this.**
3. **CLOSED (2026-09-13).** The `access &&` precondition on the portal page
   guards: a session with no `client_members` row used to SKIP them entirely.
   Five pages fixed (`invoices`, `dashboard/invoices`, `approvals`, `files`,
   `dashboard/settings`); `team` and the approvals certificate already refused
   correctly. Nothing leaked while it was open — `portalClientId()` returns the
   `NO_CLIENT` sentinel, which matches no rows, so those sessions reached an
   EMPTY page. But "we never asked" is not "we asked and the answer was no".
   Two live identities were affected and both are documented orphans that
   already resolve to nothing: the MD-4 external collaborator (roster-less by
   design) and the `.con` typo'd address in §8.3 item 19. Verified by probe
   before and after — three lockout risks checked first and all zero (claim/row
   org mismatch, two active rows in one org, and the orphan list itself), and
   `c1own`/`c1mate` answer exactly their role baselines, unchanged.
4. **CLOSED.** The sweep's hand-rolled resolution is deleted;
   `resolveCapsForMember()` in `lib/capabilities.server.ts` is the one
   implementation for "resolve for somebody else", and it takes an INJECTED
   client so the service role stays with the cron that legitimately holds it.
   **The copy had drifted three ways** — no alias normalization, no project-role
   baselines (that one introduced by Batch 26 item 5 itself), no assignment
   expiry — and the second would have had the sweep report a stage blocked on a
   permission change that never happened, which is the wrong record R-11 exists
   to prevent. `NO_BASELINE_AS_ORACLE`'s exemption list shrank from three files
   to two.
5. **DECIDED — the data is right and `S-R` §10's wording is not.** One live row
   holds `extra_caps` with no grant rows behind it: Gabby, four dot-form caps.
   §10 calls `extra_caps` "a derived projection of the grant rows", which is
   false of that row.
   **The fix is NOT to force the data to match the sentence.** All four of those
   caps are already inside her `admin` role baseline (verified: nothing is beyond
   it), so they grant her nothing today — backfilling grant rows would fabricate
   four ledger entries asserting a deliberate grant that never happened, which is
   `HANDOFF` §12 lesson 1's shape written into the audit trail. And CLEARING them
   would be worse: they are precisely what she would RETAIN if her role were ever
   lowered, so deleting them destroys a real fact about her intended access that
   nothing else records.
   So: leave the row, and treat §10's sentence as describing what the grant
   surface WRITES rather than an invariant over pre-ledger rows. **The one thing
   this binds:** whenever `extra_caps` is finally dropped, pre-ledger extras must
   be migrated to grant rows FIRST or their holders silently lose whatever their
   role no longer carries.
6. **DECIDED — not doing it, and this is the reason rather than an omission.**
   Neither grant table is in `supabase_realtime`, so a DENY is not broadcast (a
   GRANT is, incidentally, via the roster row's `extra_caps` UPDATE). Adding them
   to the publication is one line — and with no subscriber it buys nothing and
   costs replication on every grant write.
   The subscriber is what would need building, and the owner **accepted
   navigation-based reshape** (2026-09-12): capability resolves from the roster
   per request (R-2), so every navigation already re-resolves. `S-R` §7's live
   reshape is a courtesy, and its own text says a seventh channel is a
   stop-and-report rather than a trade. Build it when there is a reason beyond
   symmetry; until then this is a decision, not a debt.
7. **Client-side project roles do not exist and should not**, per `S-R` §14 q4 —
   recorded so the asymmetry reads as a decision.

**NOT COMPLETE, and the honest boundary:** `S-R`'s axes are built and asserted;
the **surfaces** half of §8 is not. A dashboard is still a set of pages that check
capabilities, not `S-1`'s "projection of a capability set". And the client-side
capability ceiling (§8's "one ceiling lower") is still untouched —
`client_members_team_read` is ungated by design and remains so.

**`S-R-A` IS COMMITTED AND SETTLED** (it was the item below until 2026-09-12;
kept as an entry because its A-3 amendment is owed as a migration) (S-R is settled at `b8cf4aa` and is
amended by a superseding entry, never edited). Three errors and one deviation:
1. §2 and §10 both say `organization_member_projects` does not exist. It does.
2. §4's paragraph claiming Batch 22 "created five approval capabilities on both
   rosters" is false — Batch 22 created an ApprovalAction TYPE mapping onto
   EXISTING caps, and exactly one new stored cap (`approval_policy`). There is
   no `record.approval.decide` and never was.
3. §10's `unique (member_id, capability) where revoked_at is null` makes R-3's
   "a grant and a denial naming the same capability" UNREACHABLE. The index is
   right; R-3's wording describes a state the schema forbids. The semantic that
   matters — and R-3's own Producer/rates example — is a denial beating the ROLE
   BASELINE, which is what harness assertion 31 asserts.
4. The vocabulary that shipped is COARSE, and §4's 38 fine keys are the
   vocabulary of QUESTIONS rather than of storage. §4 also has two gaps the
   shipped table fills: `org.settings` (no business-settings key existed, and
   folding it into `platform.billing` would be wrong twice — billing is
   owner-only and ungrantable, business settings are legitimately an admin's)
   and `portal.*` (§4 enumerates the crew side only; `client.*` was already
   taken for the STUDIO's authority OVER client companies).

**Then:** the client-side capability ceiling (S-R §8's "one ceiling lower",
Batch 26) — `client_members_team_read` is untouched today, deliberately.

---

**S3-core migrations 1–7 are live** (0027–0033), 0034–0037 on top, and
**S3-c's engine is live** (0038–0041). Approval is a record, not a gate:
silence auto-advances as `auto_advanced` with no actor and no decision row,
and is never written as approval. One row, three surfaces — the card in the
room, the record on both review pages, the printable certificate.

**Immediate — the Batch 22 deploy, which has NOT happened:**

1. **Push and deploy.** Every migration through 0041 is applied to the live
   database, but the Batch 22 CODE is committed and unpushed at the time of
   writing. All of 0038–0041 is ADDITIVE (new tables, new nullable columns,
   new triggers), so the running deploy is unaffected until it lands — this is
   the opposite ordering from 0036/0037 and it is why it is safe to sit.
2. **Click-test the approvals path once deployed**: send a task gate for
   approval, confirm a card appears in the room with a visible countdown,
   decide from the card as the client, confirm the studio's review page shows
   the chain and the certificate prints with the right studio's brand.
3. **Set `CRON_SECRET` if it is not set on the deployment.** The sweep FAILS
   CLOSED without it and logs why — it will simply never run, silently to
   everyone but the logs.

**Then, in order:**

- **`S3-d` — LANDED (Batch 23, 2026-09-03).** Schema (0043–0047, 0049),
  harness 22–29 (RED first, then 28/28), the flip, `lib/rooms.ts`, the four
  `/api/rooms*` routes, the crew Chat hub, portal DMs, bubble heads. What
  REMAINS of it, in order of value:
  1. **DONE (Batch 23 deployed; 0048 applied 2026-09-03).**
     `message_room_prefs` is dropped; the level lives on the seat.
  2. **Click-test DONE by the owner**, which produced the Batch 24
     corrections. Owed now: a fresh pass over Batch 24 — pause/resume a large
     upload, cancel mid-flight, delete a file and confirm it is gone from R2,
     Save to device, an Audio send, and the space boundaries (no client
     contacts in Crew · Chat; the `+` in Client · Messages).
  3. **DONE (Batch 24)** — attachments work in the new room kinds via a ROOM
     upload scope gated on membership, which is also the only scope an
     external collaborator could ever satisfy.
  4. **The MD-4 collaborator INVITE path** — the schema, policies and
     harness assertion 23 are live; what does not exist is the flow that
     mints the auth account and sends tenant-voiced mail
     (`sendTenantInvite` audience #4). Until it lands, collaborators can be
     seated only by hand.
  5. **Public-channel discovery UI** — the RLS discovery clause exists
     (`is_private = false` + org member); the hub lists only rooms you sit
     in. A browse-and-join surface makes public channels mean something.
  6. **The legacy client/project message routes onto the room endpoint** —
     one engine, two doors today; recorded drift, not a defect.
  7. A pure collaborator reads only UNTAGGED messages (the recorded §5.2
     deviation): fine while collaborators live in channels/groups, wrong the
     day one is seated in a client room. Revisit when project channels move
     traffic out of tags.
- **File version stacking (migration 9)**, with the live artifact viewer
  (S3-c §4.3, script first per its §8.3) on top. `approvals.subject_version_id`
  already exists and is unwritten, waiting for it — minting is the snapshot
  (AP-5), so the viewer and the version stack are one piece of work.
- **Migrations 10–11** — the `deleted_at` policy sweep (closes §8.3.2's RLS
  half), then purge + tombstone (closes its R2 half). **THE PURGE MUST REFUSE
  APPROVAL ROWS** — approvals, stages, decisions, their comments and their
  ledger rows are 7-year records carved out of the 90-day grace (S3-c §3.2).
  S3-c §7 assertion 4 is deferred to that batch and is **assertion 21**: the
  purge refuses an approval row, with an ordinary soft-deleted message as its
  positive control. It could not be written in Batch 22 because it cannot be
  asserted against a function that does not exist — and it is the assertion
  that makes "permanent" true rather than intended.
- Still owed from Batch 15: copying `lib/keyset.ts` to files/tasks/activity.
  Batch 22 proved it generalises — `listApprovals` uses it unchanged.
- The legacy task approval columns drop once the engine has been live and
  verified. Six of them: `requires_approval`, `approval_status`,
  `visible_to_client`, `approved_at`, `approval_note`, `auto_proceeded`. The
  0041 trigger is what keeps them correct until then, and it is the thing to
  delete first.

Independent of S3-core and available any time: the `$2` per-call ceiling
(§8.3 item 3), and the I-8 read-path migration proper (portal dashboard first,
paired with I-11, shrinking `admin-allowlist.mjs` one surface at a time — it
shrank by one in Batch 22 when `/api/activity` was deleted).

The v1 cap (S-F §7) is the boundary: nothing outside it before studio two is
live and paying.

## 10. Working agreements

- **One commit per item, independently revertable.** Commit messages record
  what was *found*, not just what changed — they are the audit trail this
  file is compiled from.
- **Batch discipline:** items in order; stop-and-report when an item is
  materially larger than described, needs an unnamed file, or a premise
  fails. Refusals and premise-corrections are wanted — they have caught real
  defects repeatedly (six before Batch 6; Batch 6 added the portal overdue
  sweep and the client-team action sweep).
- **Migrations: printed AND applied by the agent since Batch 13.6** — the
  owner granted Management-API access explicitly (§7). Still `00NN` order,
  forward-only, idempotent, every `create policy` preceded by
  `drop policy if exists`, and every apply immediately followed by the file's
  own verification queries against the live database. Renumber an unapplied
  file rather than applying out of order (8.2).
  Table-shape changes go in **opposite** orders and both matter: a **drop**
  ships the code first and applies second; an **additive** column applies first
  and deploys second. Reload the PostgREST schema cache either way.
- **`tsc --noEmit` after every commit; report the lint delta** (baseline
  **318** since the owner rounds; 319 after Batch 15, 353/355 before it —
  the number drifts during owner rounds, so count it at batch start rather
  than quoting this line). Run the harness after anything touching policies, auth, or tenancy.
- **Verify before writing.** Claims about the code cite `path:line`; claims
  about the database come from a live read. This file drifts the moment that
  stops.
- Never paper over an RLS failure with `supabaseAdmin`. Never add hardcoded
  McPrime identity (P-1). New code must not add invariant violations even
  where the surrounding code already violates one.

## 11. Still unanswered

1. **Migration runner** — which tool, and when (S6). `_archive/README.md`
   rule 2 binds whatever is chosen.
2. **ANSWERED by `S3-b` §4.1 (Batch 14 item 7):** crew members default
   `scope_mode='all'`, collaborators default scoped — written as a stated
   value at invite time. The tension §11 worried about was a missing
   DISTINCTION (employee vs collaborator), not a real trade-off. Closes with
   the seat-class work that builds it.
3. **Does the archetype axis affect billing?** (S1 §10.4 → S3.)
4. **ANSWERED by `S-F` §8 decision 1 (Batch 14 item 7):** distinct document
   types before FDX. `documents.kind` is additive and cheap; S3-core §9.3
   flags it so Script Design's batch does not forget it.
5. **`(admin)` route group** — its pages are canonical modules re-exported by
   studio wrappers (6.6 confirmed), so "delete or retain" is really "where do
   canonical modules live" (S4). 13 of the 71 service-role modules are in it.
6. **CLOSED IN BATCH 22 — the deletion happened.** `lib/logActivity.ts` and
   `app/api/activity/route.ts` are gone, and the allowlist entry with them.
   Ledger rows are written server-side as a side effect of the action they
   record. One correction to the plan as written: the module could not simply
   be deleted, because two SERVER modules imported `EVENT_TYPES` and
   `ActivityParams` from it — those moved into `lib/logActivity.server.ts`,
   which is `server-only`, and is the better home anyway. Nothing failed to
   move server-side. Do not re-open.
7. **The `$2` per-call AI ceiling** (new, from 7.1) — where it is enforced, and
   what "confirm above" means in a streaming UI. S0 §4 fixes the number; nothing
   fixes the mechanism.

8. **ANSWERED in Batch 9 — pre-auth pages are neutral, branding starts after
   sign-in.** Kept here only for the seam it leaves: `organizations.subdomain`
   exists, is `UNIQUE`, and is still read by nothing
   (`lib/types/database.ts:4` is its only mention in the codebase). It is what
   a future `studio-two.genreline.com` login would resolve against, and S0-B §5
   already routes per-tenant custom domains to v2. Not carried forward as a
   question.

9. **Which write path owns `organizations.plan`?** New, from the 2026-08-30
   read: all three orgs are `'agency'` because that is the column default and
   nothing writes it — not the client-creation paths, not
   `scripts/provision-tenant.ts` (which takes `--plan` but defaults to
   `agency`). `plan` is one of `S-V` §8's three entitlement axes, so until
   something owns it, every plan-gated feature resolves against a default
   nobody chose. Related to §10.4 (does the archetype axis affect billing?) and
   blocks nothing until the first real gate ships.

10. **Does `mode` on an approval stage mean anything?** New, from Batch 22.
   `approval_stages.mode` is stored as 'sequential' | 'parallel' and does NOT
   yet change behaviour: a stage completes when every REQUIRED assignee is
   satisfied, both ways. The difference between the two modes is an ordering
   AMONG assignees, and `approval_assignees` has no ordering column — so the
   distinction is not expressible today. Requiring all is the safe direction
   (the alternative UNDER-requires approvals), and it is recorded as a known
   gap rather than left as a silent no-op. Resolving it is either an ordering
   column or dropping `mode`; nobody has asked for either.

11. **What is the reminder ladder's real resolution?** New, from Batch 22.
   The sweep is a daily Vercel cron (Hobby-plan ceiling), so a 120-hour window
   with rungs at 50/20/5 percent has 24-hour granularity on a 6-hour final
   rung. The ladder is POSITION-based to compensate — it computes the highest
   rung a stage has reached, so crossing two rungs between runs sends one
   reminder at the higher rung rather than falling behind. Whether that is
   good enough is a product question that only a real client missing a
   deadline will answer.

12. **Which approval subjects get a viewer first, and what is a `file_version`
   until migration 9?** New, from Batch 22. `SUBJECT_TABLE` in
   `lib/approvals.ts` maps `file_version` → `files` and `milestone` → `tasks`
   (a milestone is a task with `category='milestone'`; there is no milestones
   table). Both are deliberately approximate and both are marked in the code.
   Migration 9 settles the first; S-F settles whether the second ever needs a
   table of its own.

13. **Should a mention or chat push name the PERSON or the STUDIO?** New, from
   Batch 25's attribution fix. The message row and the ledger row now name the
   person (they must — they are the record). The notification ENVELOPE still
   names the studio, which S-C CM-1/CM-3 require and Batch 9.3 set deliberately.
   But "You were mentioned by McPrime Digital" is a worse sentence than "by
   Gabby", and `notifyMentions`/`pushMessageAlert` are where it would change.
   A product decision, not a defect; left as the studio because changing what
   clients receive is not a side effect of a bug fix.

14. **Does `money.rates.read` ever get a coarse cap?** New, from Batch 25. It is
   the one S-R §4 key deliberately left UNMAPPED, so it denies for everyone —
   correct while no rates table and no surface exist, and it must not fold into
   `money.costs` because a `producer` holds that and S-R §3.1 gives a producer
   "budget on their own productions, not the company's books". Resolving it is
   the same product question S-R §14 q5 asks: whether crew rates live in
   Genreline at all.

15. **Who owns `seat_class` at invite time?** New, and it is the whole reason the
   next batch exists. `scope_mode` machinery has worked since B1–B4; nothing
   STATES the value, so every crew member gets the permissive default. S3-b §4.1
   specifies it. Answering it is a line in the invite route, not a project — and
   until it is answered, "crew project scoping" is a column nobody sets.

Hours per week is answered — **30** — and is not carried forward.

**Answered and removed in Batch 8:** the old question 7 — *claim-cut fan-out on
the client side*. `lib/notify.ts` and `delete-client` both act on **every active
member of the company** now (8.2, 8.3), because `client_members` is the roster
and a company's people are its members. Project-scoped notifications additionally
respect `scope_mode` + `client_member_projects`.

Still standing from Batch 7's compilation, for the same reason: §11 questions 2
and 6 are *crew project-scoping default* and *whether a browser-callable activity
endpoint should exist*. The Batch 7 brief asked for their removal while
describing two different things (storage metering, which was never a §11 entry,
and the `clients.user_id` retirement, which resolves S1 §10 q2 / S2 §11 q4). Both
remain open.

---

## 12. Lessons on the record

Not questions. Failure modes that have each cost a batch, kept here so the next
one is recognised rather than rediscovered.

1. **A spec that specifies a backfill has not specified the invariant.**
   S1 §5.2 made `client_members` the sole authority and said "verify every
   `clients.user_id` has a matching `client_members` row (the 0012 backfill did
   this)." True of every row that existed, silent about the path that creates
   new ones. So the create path never wrote one, and a one-time fix read as a
   permanent one — for two months, invisibly, because no client company was
   created in that window (Batch 8.1). **When a spec repairs existing state, ask
   in the same breath what keeps the state repaired.**

   This is the same shape as **AD-004's wrong premise** (S0-A §1): a plausible
   claim inherited from a prior document and promoted to settled fact without
   being checked against the code. Both are recorded because a spec is only as
   good as the thing that would have contradicted it.

2. **A guard proves what it looks at, and nothing else.** 0026's predecessor
   refused to run while any policy still read `clients.user_id`, and was written
   as though that were the whole question. The live access-token hook read the
   column from a function body — a different catalog, and one Postgres tracks no
   dependency for, so the drop would have succeeded and the breakage would have
   surfaced at the next login as a silently empty app for every user (Batch 8.6).
   **Enumerate the kinds of live object that can hold a reference, then write the
   check.**

3. **A fallback is not a smaller version of the bug — it is the bug at its
   worst moment.** Nine of the portal's McPrime strings were not literals in
   the naive sense: the code already read `business_settings.business_name`
   and only *fell back* to `'McPrime Digital'` when the lookup missed. That
   reads as defence-in-depth and is the opposite. A fallback fires exactly
   when the tenant could not be resolved, which is precisely the moment
   naming a *specific* tenant is most wrong (Batch 9.2). The same shape sat in
   `AdminSidebar`'s default prop, `app/studio/layout.tsx`'s `let orgName =
   'McPrime'`, and `lib/billing/plans.ts`'s id test. **Ask what a default
   asserts when it fires, not what it prevents.** Where the answer is "a
   specific tenant," the correct fallback is neutral — or no name at all, and
   a sentence rewritten to not need one.

   **NAMED INSTANCE — REACT PROP DEFAULTS (Batch 26 item 8).** This lesson was
   written about fallbacks in SQL and app config. It reaches PROP DEFAULTS, where
   nobody greps for it: `StudioSidebar({ orgRoles = ['owner'] })` and
   `Sidebar({ memberRole = 'owner' })` asserted the most powerful role in the
   tenant whenever the prop was omitted — precisely the moment identity could not
   be resolved. Four `access?.role ?? 'owner'` fallbacks in the portal pages did
   the same. All are now `caps = []` or an explicit resolve. A default in a
   component signature reads as a convenience and is a policy.

4. **A commit message is a claim, and the next document inherits it.**
   Batch 10.3's message said `lib/email/send.ts` was "the single place a message
   reaches Resend, extracted from `notify.ts`." It was not extracted — `send.ts`
   was *added* and `notify.ts` kept its own `fetch`, ending in `catch {}`. So
   every notification email for two commits went out through the copy **without**
   the error sink, while the commit log said otherwise. It was caught by
   grepping `api.resend.com` while gathering counts for this file — one query
   away from being written into HANDOFF as fact.

   This is the same shape as lesson 1 and as AD-004's wrong premise (S0-A §1):
   a plausible claim, inherited rather than checked. The difference is that this
   one was authored *in this repo, by the batch that quotes the lesson*.
   **Verify the claim against the code before the next document quotes it** —
   and prefer a grep that would falsify it over a re-read of the diff that
   produced it.

5. **The column default is not the default.** `org_budgets.hard_stop` shipped
   `default false`, but nothing in the application inserts that table, so the
   real default was the app-side `?? false` (Batch 7.1). Two batches later the
   same table taught the converse: the McPrime row's value could not distinguish
   "0024 applied" from "0024 not applied", because the backfill excludes it — the
   stored **default** had to be probed instead (Batch 8.5). **Ask which write
   path actually decides the value.**

6. **A route being careful is not a control when the table accepts direct
   writes.** 0038 deliberately lets an approval ASSIGNEE insert a decision
   straight through PostgREST — that is the policy doing its job. But it means
   every rule that lived only in the route was optional: the stage advance
   (0039), the actor stamp (0039), and the attribution itself (0040), where a
   client could name a colleague as the approver of their own decision. Each
   was found by PROBING as a real persona, not by reading the code, and each is
   now a trigger. The general form: **when a policy permits a direct write,
   every invariant about that row has to live at or below the row.** Ask what a
   caller could send that the handler never would.

   This is also why the item-2 probe passed while the defect was live — it ran
   as the service role, which bypasses RLS. **A probe that does not run as the
   persona proves nothing about the persona.**

   **Batch 25 added the other half of this lesson: a probe that cannot tell
   "refused" from "did nothing" is just as dangerous in reverse.** An UPDATE that
   RLS refuses matches ZERO ROWS and PostgREST returns NO ERROR. Item 7's first
   delegation probe read that as "the write was accepted" and reported four
   WORKING triggers as broken; two of its four "failures" were the policy
   correctly refusing before the trigger could run, and the other two were the
   probe aiming at the wrong target so a different rule fired first. Every write
   probe must ask for rows back and treat an empty result as refused —
   distinctly from a named refusal, so a refusal *for the wrong reason* fails
   rather than passes.

7. **A column with a writer tells the truth. A column with only a default tells
   you its default.** Batch 25 item 1 was briefed as "the most dangerous item in
   this batch — every later item assumes the role column tells the truth, and
   today it probably does not." It did. Both production crew rows and all eight
   production `client_members` rows carried a deliberate, correct, non-default
   role; the `'member'` default had fired on exactly two synthetic rows. It is
   honest because `organization_members.role` HAS A WRITER
   (`admin/team/route.ts`) and `client_members.role` has one too (the create
   paths, since 8.1).

   This is the other face of lesson 5's coin. Together they explain the whole
   pattern: **`organizations.plan` is wrong because nothing writes it** (§11 q9 —
   all three orgs sat on the column default for months); **`role` is right
   because something does.** Before trusting or distrusting a column, find its
   writer. If there isn't one, you are reading a default that nobody chose.

   The corollary, and it is the expensive half: **the real danger was one layer
   up.** The rows were right and NOTHING READ THEM — `orgCan()` had exactly one
   consumer in the entire codebase. A brief that over-warns about the data while
   the defect is in the reader sends the batch looking in the wrong place, and it
   is worth recording next to the briefs that got their facts wrong.

8. **A brief can specify the wrong SHAPE, not just the wrong facts.** Batch 25's
   ruling 1 ordered the capability vocabulary migrated from snake_case to S-R
   §4's dot notation, treating it as a rename. It is not: §4 is FINE-GRAINED (38
   keys) and the stored vocabulary is COARSE (14), so "migrating" it would have
   expanded one stored grant into ten — asserting an intent nobody recorded,
   which is lesson 1's shape in a migration. Caught at a checkpoint rather than
   in a migration, and the ruling was superseded mid-batch.

   The general form: **when a document says "rename", check whether the two
   vocabularies have the same GRANULARITY.** If they do not, it is a
   re-modelling, and the cost is not in the strings.

9. **A spec can be unreachable in its own schema, and nothing will say so.**
   (Briefed as lesson 7; appended here as 9 because the Batch 25 recompile had
   already taken 7 and 8.)

   `S-R` R-3 says deny beats grant, which presupposes both rows existing at once.
   `S-R` §10's unique index permits one active row per person per capability, so
   the two could never coexist and the decision had nothing to resolve between.
   Both sentences were written in the same document, on the same day, by the same
   author. The build shipped both, the harness grew an assertion for the state
   the tables cannot hold, and it passed — because a negative control that can
   never be constructed does not fail, it reports nothing. **When a decision
   describes two things being true at once, check that the schema can hold both.**
   The general form is the harness's own VACUOUS category, one level up: an
   assertion whose precondition is unconstructible proves nothing and looks like
   a pass.

10. **A guard whose failure mode is silence is not a guard.** (Batch 26 item 8.)

    `eslint.config.mjs`'s exemption blocks RE-LISTED the rules they keep, so
    every new rule was a four-place edit whose failure mode was silence: omit one
    line and the rule is simply OFF for 69 files, with lint fully green. The
    `getSession` comment on the allowlist block already warned about that hazard
    in prose, which is not the same as preventing it.

    Distinct from lesson 2 — "a guard proves what it looks at" — because the
    failure here is not that the guard looked at the wrong thing. It is that the
    guard **was not running and nothing said so**. `except()` is the fix: subtract
    what you exempt, never re-list what you keep. The lesson is the shape.

    **The corollary, and it is the expensive half (Batch 26 item 2).** A guard
    that produces a CONFIDENT WRONG ANSWER is worse than one that is merely off.
    `npm run check:caps` and `npm run test:rls` mutate the same harness row —
    phase 3 writes `extra_caps = ['client_money']` onto the crew member that
    assertion 30 asserts is empty — so a concurrent run fails assertion 30
    **pointing at whatever was just changed**, and the `finally` erases the
    evidence before the row can be inspected. It cost one false suspicion of a
    migration that was correct. They now hold a mutual-exclusion lock
    (`scripts/harness-lock.ts`) that names the other surface. **When two checks
    share mutable fixtures, make them refuse to overlap; a shared fixture turns
    one test's green into another's lie.**

11. **"Ask for rows back" has a caveat, and it fires exactly where you are
    probing.** (Batch 26 item 6.)

    Lesson 6's second half says a write probe must ask for rows back, because RLS
    refuses by matching zero rows and PostgREST returns no error. But `.select()`
    adds `RETURNING`, `RETURNING` requires SELECT, and on a table where **SELECT
    is narrower than the write** a SUCCESSFUL write comes back as zero rows and
    reads as a refusal.

    That is the advice defeated by the very asymmetry being probed. The first
    `approvals` probe in item 6 reported "refused" for this reason, and taken at
    face value it would have had the batch close a hole it had never found. **The
    only trustworthy witness is the ROW, read back through a client that can see
    it.**

    The same item produced the other half of the correction: a `FOR ALL` policy's
    USING expression is applied to the NEW row as well as the old, so USING
    already governs where a row may MOVE — proven by control, not by reading the
    docs, because `project_id = NULL` succeeded where a sibling production
    failed. **INSERT is the one command USING cannot reach**, which is why WITH
    CHECK is not a redundant copy of it. An audit that reads policies without
    probing them gets this backwards in both directions, as item 0 did.

    **AND THE LESSON ABOUT THE LESSON.** This entry's second half — "a `FOR ALL`
    policy's USING expression is applied to the NEW row as well as the old" —
    was proven in Batch 26, written down here, and then **contradicted by
    migration 0070's own header**, which states flatly that "USING is evaluated
    against the OLD row." That error refused every soft delete in the product:
    the new row has `deleted_at` set, so a FOR ALL policy carrying
    `deleted_at is null` in USING rejects the very update that performs one.

    The harness caught it (assertion 50), and the obvious repair — one
    RESTRICTIVE `FOR SELECT` policy per table — failed IDENTICALLY on PG 17,
    which applies a restrictive SELECT policy to the new row of an UPDATE too.
    A PERMISSIVE SELECT policy does not. All three behaviours were established
    by running them as a real `authenticated` session, not by reading the docs.

    **A lesson in a file is not a lesson in the head.** The cost of this one was
    two wrong migrations and two red assertions, on a rule this repository had
    already paid to learn once.

    **A FOURTH form, and it bit while writing harness 49 — after the third
    was already written down.** `contract_events` has no UPDATE policy and no
    DELETE policy by design, so RLS refuses by matching zero rows and PostgREST
    returns NO ERROR. The assertion tested `error` and reported a table working
    exactly as designed as a breach by an org owner. Lesson 6 says ask for rows
    back; the failure each time is asking and then not LOOKING at them. The
    fixed assertion reads the row back and checks it still says what it said,
    which is the property anyway — "the write was refused" and "the record is
    intact" are not the same claim, and only the second one matters.

    **A third form of the same trap, found writing harness 42–43:** the shared
    write helpers ask for `id` back, and `member_budgets` is keyed on
    `(organization_id, user_id)` with **no `id` column at all**. `.select('id')`
    there does not return zero rows — it ERRORS — and the helper turns an error
    into `{ ok: false }`, i.e. into "RLS refused". A brand-new table would have
    been reported as locked down when nothing had been tested. The rule
    generalises past RLS: **when a probe's verdict comes from the shape of what
    it asked for, the ask is part of the assertion** — so the column you read
    back has to be one the table actually has.

12. **A prefix match is not a route, and `startsWith` will happily eat your
    whole shell.** (Batch 27.)

    `proxy.ts` decides what is public with
    `publicRoutes.some((r) => pathname.startsWith(r))`. The screening page lives
    at `/s/<token>`, and adding the obvious `'/s'` to that list makes `/studio`,
    `/settings`, `/set-password` and `/sign` **all public** — the entire studio
    shell skipping this file's auth check and its client→`/dashboard` redirect,
    with no error anywhere. `app/studio/layout.tsx` would still have refused a
    non-crew session, so the symptom would have been a client landing on a
    studio URL and being bounced by a different file, months later, with nobody
    able to say why.

    Written `'/s/'` it matches the screening pages and nothing else.

    **The general rule:** every entry in that list is a prefix, so the shorter
    it is the more it claims. Before adding one, spell out what else in the app
    begins with those characters — and prefer the trailing slash, which costs
    nothing and makes the claim exact.

13. **A new table inherits the tenant predicate and forgets the scope one.**
    (Batch 27, migration 0087.)

    0085's crew policy was `organization_id = current_org() and is_org_member()`
    — the Class B shape, correct as far as it goes, and MISSING the project
    conjunct that Batch 26 spent five migrations putting on fourteen policies.
    So a contractor scoped to one production could list every screening link the
    studio had minted, titles and view counts included, and could MINT one
    against a production RLS hides from them — INSERT being the one command
    USING cannot reach, which is 0059's lesson arriving one table late.

    The tenant half is the half you remember, because it is the half that has
    been true since 0021. **Scope is now the second half of Class B and belongs
    in the same breath**, in USING and WITH CHECK together — and where the new
    table's subject is polymorphic, in a function, so the branch is written once
    and cannot fail open on a value added later.

14. **An MIT badge is a claim about one package, not about what you install.**
    (Batch 27.2.)

    `evilmartians/apcach` solves exactly the right problem — state the contrast
    you need, get the colour that meets it — and its own licence is MIT. It
    depends on `apca-w3`, which ships under the **"Limited W3 License"**:

    > "Commercial use is prohibited without a written and signed commercial
    > license agreement, except as provided by the W3 cooperative agreement for
    > web content only."

    …plus a ban on modifying the core constants and a restriction to
    web-accessibility use cases. This product is commercial SaaS. One
    `npm install` would have put an obligation into the dependency tree that
    **nothing in the repository would ever have surfaced again** — no lint rule
    reads transitive licences, and the package page says MIT.

    The audits this project already runs look at the REPOSITORY (is it MIT, is
    it maintained, is it AGPL). That was enough to reject Documenso, DocuSeal and
    papermark, because their licence is their own. It is not enough for a
    package with dependencies.

    **So the check has two halves now:** the package's licence, and then
    `dependencies` resolved one level down with each of those licences read.
    `culori` was taken over `color.js` partly on this: **zero dependencies** is
    a licence property before it is a bundle-size property.

15. **A colour is not a preference; it is a contrast ratio with a colour
    attached.** (Batch 27.2.)

    Every white-label product in this category stores the hex the customer typed
    and interpolates it into CSS, and the 2026 architecture write-ups name the
    result — branding that breaks "core UI components or accessibility
    standards" — as a known hazard rather than a solved problem.

    The failure is invisible to the person who causes it. A studio picks its
    brand gold on a calibrated monitor, saves, and never opens its own client
    portal; the client cannot read the Approve button and does not report it,
    because a button that is hard to read looks like a design choice.

    **The fix is that the readable answer is COMPUTED, not offered.** One
    decision in, an on-colour chosen by measurement, a light ramp and a dark
    ramp, and the measured figure shown to the studio while it chooses. And the
    generalisation past colour: **where a tenant's input reaches other people's
    screens, the product owes those people a floor the tenant cannot lower.**

16. **A probe that reads the ROW cannot catch a sentence that lies.**
    (Batch 27.3.)

    Every probe discipline in this file so far is about rows: ask for them back,
    look at them, make sure the control can fail. All of it is necessary and
    none of it would have caught this.

    `clientAgenda` produced, for an ACTIVE approval stage whose deadline was two
    days in the past: *"If you do nothing by Saturday 19 September, this is
    approved automatically."* Every row it read was correct. The stage was
    active, the deadline was real, the client was the assignee, RLS scoped it
    exactly right. **The sentence was false**, and it was the kind of false a
    client acts on — they read a future deadline and go back to work while the
    next sweep decides for them.

    It is also the SECOND time. `approvalIntel` shipped "if it lapses" about an
    already-lapsed stage, and the correction is written down in this file. The
    module that repeated it was written afterwards, by somebody who had read it.
    **A lesson about a specific function does not generalise itself.**

    The probe that caught it (`scripts/ops/probe-portal-calendar.ts`) signs in
    as three real client personas, reads what each would be shown, and asserts
    the SENTENCE against its own date in both directions: future tense on a past
    date, past tense on a live one, and a row claiming to be your move with no
    reason attached. **Where the product's output is prose, the prose is the
    thing under test.**

    And the other half: it CONSTRUCTS the state rather than waiting for it —
    moves the deadline back, reads as the client, restores in a `finally`. The
    overdue-but-active window is between a deadline and a daily sweep, so it
    almost never exists when somebody happens to run a probe, and §12 lesson 9
    already says what an unconstructible control is worth.
