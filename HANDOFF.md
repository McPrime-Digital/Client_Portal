# GENRELINE — HANDOFF

**This is the first read.** It exists in the repository because its predecessor
did not: the open list was kept outside the repo, drifted from the code with
nothing able to contradict it, and four live defects fell off it entirely
(recovered by Batch 6 item 0). Everything below was verified against the code
and the live database on 2026-08-28 — nothing is quoted from memory of what a
batch was supposed to do. Last compiled after **Batch 10**; Batch 8 was the
final foundation batch.

After this, read `docs/specs/` in order: S0 → S0-A → **S0-B** → S0-conformance
→ S1-P → S-V → S1 → S2 → **S-C**. **Where S0 and S0-A disagree, S0-A wins**, and
**S0-B supersedes the product name in all of them.** `S-C` (communications and
sender identity) is **draft for approval** — the only spec in the stack that is
not settled. `CLAUDE.md` holds the working mechanics (commands, clients, route
groups, env vars).

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
| I-5 | AI calls ceilinged + budget-checked | **PARTIAL, and accurate for the first time.** Fixed (7.1): `hard_stop` defaults **true** (0024, applied) and `getCreditState` treats a *missing* `org_budgets` row as gated — the column default alone changed nothing, because nothing in the app inserts that table. The house org's exemption is now a **stated row**, not a test for McPrime's id (8.5). Not fixed: the **$2 per-call ceiling is unbuilt** — no surface enforces one, so a single call is bounded only by `max_tokens` |
| I-6 | Ownership server-resolved, never from the body | **PARTIAL** — activity ledger (6.1), team routes (3A + 6.2), edit pages (6.6) fixed; display names now resolve from the roster, not user-editable `user_metadata` (7.8); `portal/actions:225` / `admin/project-actions:123` still write body attachment refs |
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
| 10.4 | Second Resend send path collapsed | 10.3's own commit message claimed `send.ts` was "extracted from notify.ts". It was not — `send.ts` was *added* and notify.ts kept its `fetch`, ending in `catch {}`. Every notification email since 10.2 went out through the copy **without** the error sink |

## 7. Current state (verified 2026-08-28 after Batch 8; Batch 9 deltas from the
code 2026-08-30, with one live read; Batch 10 deltas from the code 2026-08-31)

- **Branch:** `throughline` (main ⊆ throughline, fast-forward). Not renamed —
  S0-B §6 excludes the branch, and renaming it is a remote/CI change, not a
  code one.
- **Migrations applied: 0000–0024.** 0024 **is applied** — this was asserted
  rather than shown before, and is now proved: inserting an `org_budgets` row
  for the harness decoy org without naming `hard_stop` returns `true`, so the
  stored default is flipped. The probe row was deleted; `org_budgets` is back to
  its single row. The house org's own `false` row is consistent with 0024
  applied *or* not, so it could never have settled the question by itself.
- **Printed, NOT applied — and the order between them matters:**
  - **0025 — `client_members.last_seen_at`** (Batch 8.2). Presence is per
    person, and no per-company column can express that.
    **ADDITIVE TABLE-SHAPE CHANGE. Apply BEFORE deploying Batch 8** — the
    reverse of a drop. Deploying first fails the member SELECT in `lib/notify.ts`
    with 42703, resolving the recipient set to empty: client notifications stop
    and the heartbeat no-ops. Both errors now reach Sentry, but the order
    prevents it. Backfills each active owner from `clients.last_seen_at` so
    nobody reads as away across the deploy.
  - **0026 — drops `clients.user_id`** (Batch 8.6, renumbered from 0025 so
    filename order stays apply order). Guard blocks removed; both preconditions
    met. It also replaces `custom_access_token_hook` in the same transaction —
    see §6, 8.6. **TABLE-SHAPE CHANGE: apply 0025 and deploy the code first,
    then apply this, then reload the PostgREST schema cache.** The file carries a
    pre-apply query covering `pg_policies` **and** `pg_proc`; run it.
- **Full sequence to land Batch 8:** apply 0025 → deploy → apply 0026 → reload
  the schema cache → verify with the queries in each file's footer.
- **Access token hook:** enabled in production, verified from a live JWT. 0026
  changes its body; step 2 (verify a client's token still carries
  `organization_id`) is the check that matters after applying it.
- **Harness:** `npm run test:rls` → **10 pass / 0 fail / 0 vacuous / 0 error**;
  positive controls 3,3,2,2,2,2. Run after 8.1 and after 8.6, unchanged.
- **`tsc --noEmit`:** clean. **Lint: 352** — 353 through Batch 9, then **down
  one** in 10.3 when the old `resend-invite` and its `catch (err: any)` were
  rewritten. Verified by diffing the full finding list against committed HEAD,
  not by reading the total. Failures do not fail the build.
  **`npm run build`:** green — 7.6s at Batch 8, 8.8s at Batch 9, 9.0s at
  Batch 10. **42 route handlers** (was 41; +logo, +password-reset, and the
  earlier count was already off by one).
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
- **Live data:** 3 organizations (McPrime + 2 harness) · 8 client companies (2
  harness) · 9 `client_members` rows · 13 auth users (6 harness) · 21 files ·
  ~200 messages · `org_credits` for McPrime at **−15¢** · `org_budgets` holds
  exactly **one** row (the house org, `hard_stop = false` — its stated opt-out).
- **Every client company has an active `owner` in `client_members`**, and every
  `clients.user_id` value appears on one of those rows. That is what makes the
  0026 drop lossless, and it is now maintained by the create paths rather than
  by a one-time backfill.
- **`client_members.last_seen_at` does not exist yet** — confirmed by live
  probe. It is what 0025 adds.
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

1. Body-trusted attachment refs: `app/api/portal/actions/route.ts:225`,
   `app/api/admin/project-actions/route.ts:123` (I-6; AD-004-R item 2). **S3.**
2. Message delete orphans the file + R2 object:
   `app/api/portal/messages/delete/route.ts:43` (AD-004-R item 3). **S3.**
3. The `$2` per-call AI ceiling (S0 §4) is **unbuilt**. 7.1 fixed the *budget*
   half of I-5; nothing bounds a single call but `max_tokens: 2000` in
   `app/api/studio/muse/route.ts:141`.
4. The cron route's **POST** half (`app/api/cron/message-nudge/route.ts:90-99`)
   is a user-session path — `PresencePulse` calls it on every page load —
   running a service-role scan of every unread message. Allowlisted as PERMANENT
   for its GET half only; the POST half is not.
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
   arrives From one tenant. `S-V` §13.1 forbids exactly this, and the interim
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
9. **Two ledger actor names still prefer `user_metadata`, and this is the
   ledger — the thing S0 §1 says settles disputes.**
   `app/api/admin/invoice-actions/route.ts:253` and
   `app/api/files/commit/route.ts:161` both read
   `user.user_metadata?.name ?? <studio name>`. 9.3 replaced only the hardcoded
   tenant *fallback*; the primary is user-editable via
   `supabase.auth.updateUser({ data })`, so a signed-in user can choose the
   name that lands in `activity_log.actor_name` — invoice issued, receipt
   verified, file delivered.

   This is the same defect 7.8 closed for `ownName()`, surviving at two sites
   the 7.8 sweep did not cover because they write through `log_activity`
   directly rather than through the display-name helper. The fix is the 7.8
   fix: resolve the actor from the roster (`orgRolesOf` / `lib/team.ts`), not
   from the token's metadata. Small, self-contained, and it does not need a
   migration.

   **I-6, with the other write-path sites — but worth pulling forward rather
   than waiting for the full S2 §7 write pass**, because unlike the read-path
   work it changes one expression per site. Batch 10 did not touch either site;
   it is still two expressions.
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
12. **THE HOUSE ORG HAS NO EXEMPTION AT ALL, and Batch 9.5's commit message
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
13. **Opened by Batch 10 — the untested paths.** Every Batch 10 change is
   verified by `tsc`, the build, and reading; **none of it has been executed.**
   There is no test framework and the agent does not run the app, so the
   following are correct-by-inspection only and should be exercised once
   deployed: a studio logo upload and its signed URL rendering in the portal
   sidebar; an invite arriving branded; a password reset arriving; and the
   `delivered: false` path, which no one has seen fire.

14. **`generateLink()` changed a failure mode, and nothing has hit it yet.**
   `inviteUserByEmail` created the user and sent the mail as one operation — no
   mail meant no user. Now the link is minted first, so a delivery failure
   leaves a **correct account and a correct roster row with an undelivered
   message**. That is deliberate (tearing down a valid account over an SMTP
   hiccup is worse, and `resend-invite` is the recovery path), and `delivered`
   is returned rather than thrown. `resend-invite` surfaces it; the other five
   callers currently ignore it. Whether they should show a soft warning is a UX
   decision nobody has made.

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

**The foundation is complete.** Nothing on this page blocks S3-core, and nothing
found in Batch 8 forces S3-core work to be redone.

Two operator steps stand between the code and the running system, and they are
sequencing, not design:

1. **Apply 0025, deploy Batch 8, apply 0026, reload the schema cache.** §7 has
   the full sequence and each file's footer has its verification queries. Until
   0025 is applied, the deployed presence and notification code is ahead of the
   database.
2. Nothing else. The three items that blocked previous batches — client
   onboarding, the `clients.user_id` readers, and the `hard_stop` default — are
   all closed.

**Then S3-core, and it is the next artifact — a spec, not code:**

- **Messaging schema** — `messages` carries the denormalized `sender_name` that
  AD-003's pseudonymisation must rewrite, no `deleted_at`, and no pagination
  cursor (I-1's first surface).
- **Approval decoupling (X-2)** — approvals are welded to the Client space;
  S1 §9 needs them free of it before archetype `internal` (P-9) is expressible.
- **File version stacking** — one `files` row per upload today, no lineage.
- **Retention columns** — S0 §5's 90-day grace, 7-year activity log and 30-day
  erasure have **no expression surface at all**: no table has `deleted_at`, no
  purge job exists, no export path exists (S0-A §3).
- **Attachment FK** — `messages.attachment_file_id → files(id)`, replacing the
  `"bucket::path"` string, plus the body-trust fix and orphan cleanup
  (AD-004-R items 1–3, §8.3 items 1–2).

Independent of S3-core and available any time: the `$2` per-call ceiling
(§8.3 item 3 — the other half of I-5, and the one that matters once generation
exists), and the I-8 read-path migration proper (portal dashboard first, paired
with I-11, shrinking `admin-allowlist.mjs` one surface at a time).

The v1 cap (S-V §13) is the boundary: nothing outside it before studio two is
live and paying. Studio two is *possible* — `npm run provision:tenant` creates an
organization and a working owner (7.5) — and as of 8.1 the client companies that
studio creates work too, which they would not have.

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
  `create policy` preceded by `drop policy if exists`. Renumber an unapplied
  file rather than telling an operator to apply out of order (8.2).
  Table-shape changes go in **opposite** orders and both matter: a **drop**
  ships the code first and applies second; an **additive** column applies first
  and deploys second. Reload the PostgREST schema cache either way.
- **`tsc --noEmit` after every commit; report the lint delta** (baseline
  **353**). Run the harness after anything touching policies, auth, or tenancy.
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
