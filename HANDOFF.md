# GENRELINE — HANDOFF

**This is the first read.** It exists in the repository because its predecessor
did not: the open list was kept outside the repo, drifted from the code with
nothing able to contradict it, and four live defects fell off it entirely
(recovered by Batch 6 item 0). Everything below was verified against the code
and the live database on 2026-08-28 — nothing is quoted from memory of what a
batch was supposed to do. Last corrected after **Batch 22** (the approvals
engine, 2026-09-02, with fresh live reads); Batch 8 was the final foundation
batch.

After this, read `docs/specs/` in order: S0 → S0-A → **S0-B** → S0-conformance
→ S1-P → S-V → **S-F** → S1 → S2 → **S-C** → **S3-core** → **S3-core-A** →
**S3-b** → **S3-c**. **Where S0 and S0-A disagree, S0-A wins**, and the same rule binds
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
after `S3-core` migrations 1–7 as migration 8 onward. `S-F`, `S-C`
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
| 14 | **Unread becomes a question about a person, and the message layer grows up.** `message_read_state` (0031, backfilled 7 rows exactly as pre-counted), six supporting tables (0032), the attachment FK + 11-row backfill (0033 — 11 in, 11 out, 0 unresolved, 0 tenant mismatches) — **all applied and verified live**. All twelve unread sites read `lib/messageRead.ts`; the watermark routes advance per-user state while still writing `read_at` (drops in migration 12); the nudge cron regroups by room and only nudges what someone actually hasn't read; every read path scrubs deleted bodies server-side (item 5); `verifyAttachment` makes a forged attachment ref fail at send (closes §8.3.1). Harness 15/15. **Owner items shipped in the same batch:** the General thread (`room:<clientId>` understood by every route; rooms minted at onboarding; project-less sends both sides), the thread-bus realtime unification (pages broadcast sends + typing on `thread:<id>`; hubs gain filtered replication fallbacks with id-dedupe), the subtle WebAudio chime with device mute, and the premium MessageThread pass (grouping, tails, glass composer, gold rail) | The click-test's "3-minute delay" was NOT replication — a live probe delivered in 1.8s under the new policies to both personas. It was wiring: project pages never broadcast their sends, the hubs had no replication subscription (built when "RLS-starved for admins" was true — it no longer is), and typing rode a different channel name on pages than hubs. Also: MessageThread filtered deleted messages entirely (the "tombstone" never rendered), and General-thread attachments are deliberately disabled — the presign scope requires a project, and widening `lib/uploadScope` deserves review, not a side door ||
| 15 | **The room-first hub, complete.** RoomThread is THE conversation engine — hub All-view, General thread and both project pages are one code path over one room; the studio hub lists client COMPANIES with presence, previews and gold pills; keyset pagination on `messages_room_keyset_idx` (lib/keyset.ts is the helper files/tasks/activity copy); threads one-level-deep with the 0030 trigger as sole authority; reactions/pins/saves UI on the 0032 tables (user-client RLS writes — AD-001); mentions server-parsed/tenant-validated/per-viewer-resolved (I-6); per-room notification prefs enforced in pushMessageAlert; the roster surfaced in-room; General-thread attachments via the EXISTING `_general` client scope. Founder items folded in: instant rail badges over `badges:*` topics, list movement only on new latest-message id, WebAudio priming (the chime was silent for want of a user gesture), focus mode | Item 0's census: hub sessions ran ~13 (portal) / ~21 (studio) channels; the room model collapsed them to ~6 each (fixed four + active topic + one filtered fallback) — I-2 still violated but halved. The `room:<clientId>` synthetic id coexists with `message_rooms.id`, normalized at five route boundaries — managed drift, recorded. `(admin)/admin/projects/page.tsx:28` remains the one unbounded message read (reported, >1 line). The project pages lost ~800 lines of duplicated message machinery; lint fell 355 → 319 |
| 16 (owner-directed, no formal brief) | **The messaging polish round.** App-wide chime (PresencePulse — the "can't hear anything off the messages page" fix), typing/recording presence in the studio ROOM LIST and headers, the four utility icons collapsed into ONE ⋯ menu at the top bar's extreme right, **search-in-conversation** (body_tsv's first consumer, scoped like the list), mention trigger configurable (@ · / · both), **project colour-bonding** (lib/projectColor.ts — dot on chip, inset stripe on bubble, ringed tag pill), horizontal message action bar with a ⋯ menu (Pin/Save/Copy/Edit/Delete), composer emoji picker + jumbo emoji, hover-play video previews, and the recorder's scrolling RMS waveform | Two found defects: the studio hub REMOUNTED the whole engine on every chip click (the key is gone — chips respond instantly now), and 15.4 had duplicated the react/pin/save controls in the received-side hover stack (both stacks replaced wholesale). Rule zero note: the owner explicitly overrode parts of the 14.10 renderer this round (action layout, emoji, media) — their call to make |
| 17 (owner-directed) | **The bug round with a smoking gun.** THE upload failure (files, recordings, vault — every portal) was NOT code: the R2 bucket's CORS allowed localhost but not `https://genreline.com` — proven by preflight probe (403/no-allow-origin vs 204 for localhost); broken since the Aug-31 domain switch. **FIXED — the owner added the dashboard rule and uploads work (verified before Batch 21); this row carried the defect as open after it closed, which is exactly the re-investigation cost §12 warns about.** Shipped: instant voice send (optimistic blob bubble, upload rides behind), app-wide WebAudio priming in PresencePulse (the real reason "global sound" wasn't), General chip removed (All + projects only), sticky composer project-tag (additive until changed, per room per device), 360°-hue collision-free project colours, theme-aware wallpaper in three patterns + intensity in chat settings (16.8's gray tile vanished on light portals — the "only in the org" bug was a theme bug), mentions show @Name in the input with token substitution at submit, ~170 emoji + a Stickers tab with pop-and-sway jumbo sends | Upload errors now surface their reason instead of a mute "failed". The A-8-style discipline paid again: probe first, then code |
| 18 (owner-directed) | **Two more single-cause "selective" bugs, named and killed.** The wallpaper was painted on the SCROLLING element — it scrolled away with content, so long threads (which 17.7 opens at the bottom) never showed it: "renders in some places" was one bug. It now lives on a fixed wrapper. Read receipts died because the RoomThread consolidation dropped the project pages' UPDATE listeners — receipts/edits/deletes now ride the same replication fallbacks as inserts (op-marked), patching rows in place including your own ticks. Also: every spinner purged from messaging (instant render, silent prepends, static placeholders), hover actions scoped to the bubble itself, AudioPlayer error state with an Open fallback, one-project rooms auto-tag sends, "Chat settings & wallpaper" labeling, and Forward + bulk select (projects, no-project, and cross-room for the studio; attachments cross by verified file id) | The R2 CORS gate this row recorded is CLOSED (see the Batch 17 row) — audio, uploads, GIF and per-type preview all unblocked with it |
| 19 (owner) | **Voice speaks WAV everywhere.** The sender's browser transcodes every voice note to 16 kHz mono WAV before upload (`lib/audioWav.ts`) — Chrome records webm/opus, Safari cannot play it, so an org note arrived Apple-side as a dead 0:00 by physics. Also: per-view render cache (chip/room switches at 0ms, network merge behind), uncropped studio logo chip in the portal hub, Aurora + Waves wallpapers | Server-verified while debugging "All doesn't show project chats": the room query composition was correct at HEAD — the running deploy was behind |
| 20 (owner rounds 20.1–20.3) | 20.1: the portal messages GET's 400 guard predated `?scope=room` and `?mention_candidates` and ran FIRST — it starved the All view and the composer roster; guards now run after the requests they must not strangle. 20.2: a live project tag was a render-time TypeError that unmounted BOTH portals (map present, id absent fell through to `card.label` with `card` undefined); the guard is airtight by construction now. 20.3: chat settings move to `user_prefs` (0034, one jsonb row per auth user, Class C RLS, `/api/prefs` on the USER client per AD-001) with localStorage as the zero-latency cache | The admin route's equivalent guard sat AFTER its candidates branch, which is why only the portal broke — the asymmetry was the bug report |
| 21 (the "Batch 19" brief, renumbered — the repo was at 20.3) | **Closeout: messages fully bounded, the Suite unblocked, the dual-write ended.** 21.1: thread-panel replies keyset-cursored (both routes + panel load-older); admin hub preview one limit-1 query per room; unread scans carry the watermark predicate in-query under an explicit saturating cap; the projects page counts via `messages(count)` + `orgUnread` (the last unbounded message read, reported three times, closed). 21.2: 0036 settles `documents.kind` (screenplay/treatment/bible/breakdown/document; 'script' renamed, default → 'document'). 21.3: sender_role/attachment_url/is_deleted/read_at writes stopped everywhere; sides derive from the ROSTER, read ticks from the other side's watermark, attachment URLs from the FK (`roomSides`/`deriveWire` in lib/messageRead.ts); 0035 applied (NOT NULL relaxed + 13 of 16 null senders recovered). 21.4: 0037 printed + gated on deploy; seven catalogs searched clean. Harness 15/15 | Three premise failures: `documents.kind` had existed since 0004 with four live 'script' sites (the "additive" item was a reconciliation); `sender_role` was NOT NULL/no-default (the brief's stop-write-then-drop order would have 23502'd every send in the window — 0035 is the migration the brief didn't know it needed); the nudge cron's oldest-first window only worked BECAUSE of the legacy read_at prefilter (flipped newest-first or it would silt up). Lint baseline was 318 at start, not the brief's 319 |

| 22 (the approvals engine, S3-c) | **Approval becomes a record, not a gate.** 0038 (five tables + the anchor model on `messages` + `organizations.approval_window_hours`, Class B RLS); 0039 + 0040 + 0041 (three triggers, each written because a defect was PROVEN first); `lib/approvals.ts` — the single write path; five approval capabilities on both rosters behind one new cap; six routes (45 → 51 handlers) with **zero new service-role importers**; the per-org auto-advance sweep + reminder ladder (`/api/cron/approval-sweep`, daily 08:00); harness **15 → 20**; the card in the room, the record on both review pages, the printable certificate; and the browser ledger path DELETED (`lib/logActivity.ts` + `/api/activity` + its allowlist entry) | **Seven premise failures, and three defects found by probing rather than reading.** The brief's `is_org_member(organization_id)` does not exist (no-arg). `messages` has no crew INSERT policy to extend — `messages_crew_all` is an ALL policy, so the comment gate became a RESTRICTIVE policy that touches neither existing one. `messages.timecode_ms` was NEVER created, so S3-c §5.1's premise is false and there is one anchor model, not two (S3-b migration 5 must drop its line). Rule Zero named three legacy columns; **six** are live, and `approved_at` — which the brief does not name — is what both approval pages actually gate on. `deadline-check` was a SECOND, unrecorded instance of HANDOFF §8.3 item 4's page-load-cron defect, and it wrote `approval_status='auto_approved'` while `studio/client/review/page.tsx:131` counted that among the APPROVED — the studio's own page was already reporting timeouts as client sign-offs. **The three probe-found defects:** a client could record a decision and the stage would silently never advance (crew-only UPDATE + PostgREST returning no error on zero rows) — which would have had the record claim "no response received" about a client who responded; a decision with a null `actor_id` could never satisfy a user assignee, so the same silent stall one layer down; and a client assignee could **forge who signed off**, naming a colleague as `actor_id` and anything as `actor_name`, because 0038 permits direct assignee inserts and the routes being careful is not a control. Also: the reminder ladder counted ledger EVENTS, and there is one per RECIPIENT — a three-assignee stage would have gone permanently silent while the record still claimed the window was honoured |

## 7. Current state (verified 2026-08-28 after Batch 8; Batch 9 deltas from the
code 2026-08-30, with one live read; Batch 10 deltas from the code 2026-08-31)

- **Branch:** `throughline` (main ⊆ throughline, fast-forward). Not renamed —
  S0-B §6 excludes the branch, and renaming it is a remote/CI change, not a
  code one.
- **Migrations applied: 0000–0041.** 0036 (documents.kind) and 0037 (the
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
- **Harness:** `npm run test:rls` → **20 pass / 0 fail / 0 vacuous / 0 error**
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
- **`tsc --noEmit`:** clean. **Lint: 317** (counted at Batch 22's end; 318 at
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

## 9. What to do next

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
