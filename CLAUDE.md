# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

**The product is Genreline** (`docs/specs/S0-B-product-identity.md`, PI-1).
"Throughline" was the working name through the spec phase and is retired in
new work; the git branch, the spec prose and `_archive/` keep it deliberately.
The product name lives in `lib/product.ts` — do not write the literal again.

**Two identities, and they are not the same rename** (S0-B §2). The **client
portal wears the TENANT's brand** — read it from the database via
`lib/tenantBrand.ts`, never a constant, never a fallback naming a specific
studio. The **studio shell wears the product's**, with the tenant's logo as
context. Putting "Genreline" on a client-facing page is as wrong as leaving
"McPrime Digital" there: a client of a studio bought from that studio.

## Governing documents

**Read `HANDOFF.md` (repo root) first.** It is the verified project state —
what is built, what is open (file:line), what to do next — compiled from the
code and the live database, not from memory. The spec stack below is the
*reasoning*; HANDOFF is the *state*.

**`docs/specs/` is the authoritative spec stack for this project.** In reading
order:

| # | Document | Purpose |
|---|---|---|
| 1 | `S0-decisions-and-constraints.md` | Settled decisions and invariants |
| 2 | `S0-A-amendments.md` | **Supersedes named S0 entries** (AD-004, AD-002, AD-001 rationale) |
| 3 | `S0-B-product-identity.md` | **Supersedes the product name everywhere**; domain and attribution |
| 4 | `S0-conformance.md` | Where the code violates S0; input to sequencing |
| 5 | `S1-P-personas-and-segments.md` | Who signs up, and what each needs |
| 6 | `S-V-film-os.md` | Full platform architecture + the v1 cap |
| 7 | `S-F-feature-scope.md` | **DRAFT** — **Supersedes `S-V` §13 (the v1 cap) in full**; market baseline and per-feature scope |
| 8 | `S1-tenancy-and-entitlement.md` | Tenancy model; resolves T-1 … T-5 |
| 9 | `S2-authorization.md` | Layered authorization; the RLS migration order |
| 10 | `S-C-communications.md` | **DRAFT** — sender identity across email/SMS/push |
| 11 | `S3-core-messaging-approvals-versioning-retention.md` | **DRAFT** — schema for message rooms, approvals, file versioning, retention; ledger emission moves server-side |
| 12 | `S3-core-A-amendments.md` | **Supersedes named `S3-core` sections** (A-1 … A-6, from the Batch 13 item 0 audit; two prevented data loss) |
| 13 | `S3-b-calendar-meetings-documents-seats.md` | **FIVE OF SIX MIGRATIONS LANDED** — 1 (0056 + 0063), 2 (0065), 3 (0066), 5 (0067), 6 (0068). Migration 4 (`calendar_connections`) is the only one outstanding and is deferred by §7 answer 1, not forgotten: external calendar sync needs a token-storage decision (Vault vs encrypted column) that S3-b itself says must not be improvised. **Its migration 5 correctly did NOT add `timecode_ms`** — verified live absent; Batch 22 settled one anchor model (`anchor_kind` + `anchor_value`) instead. §5.1 records a defect in §1.5 found while building it |
| 14 | `S3-c-approvals-review-live-artifacts.md` | **DRAFT** — **Supersedes `S3-core` §2 (approvals tables), `S3-core` §9.2, and `S-F` §3.3 where they disagree**; approval is a record not a gate — auto-advance on silence, live minted artifacts, anchored review comments; sequenced after `S3-core` migrations 1–7 |
| 15 | `S3-d-messaging-rooms-groups-broadcast.md` | **LANDED (Batch 23, migrations 0043–0049)** — **Supersedes `S3-core` §1.2 (the room table) and §9.1** where they disagree. Membership is a ROW (`room_members`); channels, groups, DMs, broadcast; the message RLS runs on membership (`is_room_member` + `room_can_post` + per-seat `history_from`), with ONE recorded deviation: the project-visibility conjunct stays (a live scoped crew member made §5.2's drop an access-widening). Rooms API: `lib/rooms.ts` + `/api/rooms*`; crew Chat hub; portal DMs. Open remainder in HANDOFF §9 |

| 16 | `S-R-roles-and-capabilities.md` | Roles, capabilities, surfaces — **settled**; amends `S0` AD-001 at §9. **BUILT: Batch 25 (money + people) and Batch 26 (seat class, project roles, scoping default)** |
| 17 | `S-R-A-amendments.md` | **Supersedes named `S-R` sections.** A-1 (`organization_member_projects` already exists), A-3 (the index widening — landed as 0055), A-4 (the vocabulary is COARSE). **Batch 26 adds one more the document does not carry: `seat_class`'s values are `staff`/`contractor`, not §2's `crew`/`collaborator`, because both of those words were already taken** |

**Where S0 and S0-A disagree, S0-A wins** — and the same rule binds `S3-core`
and `S3-core-A`. S0 entries were not edited in place — the original
text stands as the record of what was believed at the time, and reading S0 alone will give you
the superseded version of AD-004, AD-002 and AD-001's rationale.

**`S-V-film-os.md` supersedes `docs/throughline-master-plan.md` and
`docs/throughline-architecture-wiring.md` in full.** Those two files are historical intent
only and **must not be used as roadmap**. `THROUGHLINE_STATE_OF_PLAY.md` (repo root) is the
audit baseline S0 was written against.

**The S0 invariants I-1 … I-12 (S0 §3) apply to all new code.** New code must not add a
violation, even where the surrounding code already violates the same invariant. The full
per-invariant audit — what conforms, what violates, and every violating site — is
`docs/specs/S0-conformance.md`. Read it before touching an area it flags.

Several things below contradict S0. They are marked **[VIOLATES S0 — pending remediation]**
and describe what the code *does today*, not what it should do. Remediation is sequenced in
S6; do not "fix" them opportunistically.

## Stack

Next.js 16.2.6 (App Router, React Server Components by default), React 19, TypeScript
(`strict: true`), Tailwind CSS v3 with CSS custom-property design tokens, Supabase
(Postgres + Auth + Realtime), Cloudflare R2 (S3-compatible) for file storage, Zustand for
client state, BlockNote + Yjs for the collaborative document editor. Package manager: npm.

Accurate notes on the dependency list — several packages are installed but not used:

- **shadcn/ui** is scaffolded (`components.json`, 11 primitives in `components/ui/`, built on
  `radix-ui`), but the app imports almost none of it: the only live usage is `Toaster` from
  `components/ui/sonner` (`app/layout.tsx:4`). `components/ui/sheet.tsx` imports
  `components/ui/button` and is itself unused. Everything else is hand-written Tailwind.
- **`react-hook-form` / `@hookform/resolvers`** are in `package.json` with **zero imports**
  anywhere in `app/`, `lib/`, `components/`, `hooks/`. Forms are `useState` + hand-rolled
  validation. **`zod` is used at exactly two sites** —
  `app/api/activity/route.ts:1` (Batch 6.1, so the activity ledger stops accepting forged
  entries) and `app/api/admin/erase-person/route.ts` (Batch 12.2). **[VIOLATES S0 I-7 — two
  of 44 route handlers validate against a schema; the rest do not.]**
- **`zod` is used at nine sites** since Batch 26 — `app/api/admin/assignments/route.ts`
  joined the eight below.
- **`zod` is used at eight sites** since Batch 22 — the six approvals routes
  joined `app/api/admin/erase-person/route.ts`. `app/api/activity/route.ts`,
  which this file used to name as the first I-7 boundary, is DELETED (Batch 22
  item 11): the ledger is written server-side as a side effect of the action it
  records, so the browser-callable endpoint and `lib/logActivity.ts` are gone.
- **`resend`** is a dependency but still never imported. Email goes out as a raw `fetch`
  to `https://api.resend.com/emails` from **one place** — `lib/email/send.ts`. There
  were briefly two (Batch 10.4); if you add a third, the second one's failures will
  vanish the way that one's did.
- **Stripe is not used for invoicing.** The Stripe SDK is used only for the AI-credit top-up
  flow: `app/api/studio/credits/checkout/route.ts` and `app/api/webhooks/stripe/route.ts`.
  Invoices are bank/wire transfer (`invoices.payment_method` defaults to `'bank_transfer'`;
  bank details live on `business_settings`). `invoices.stripe_payment_url` is a Stripe Payment
  Link an admin pastes in by hand — no API call is made.
- No AI vendor SDK is installed; every model call is a raw `fetch`
  (`app/api/studio/muse/route.ts`).
- **`culori` (MIT, zero dependencies) is used at exactly one site** —
  `lib/brandKit.ts`, for OKLCH conversion. It is the only dependency this repo
  has added in the audited era, and it was added after `evilmartians/apcach`
  was rejected for a transitive `apca-w3` dependency whose licence forbids
  commercial use. See "The brand kit" below before adding a colour library.

Note: dynamic-route `params` and `next/headers` `cookies()` are async (Promises) — always
`await` them.

## Commands

- `npm run dev` — Next.js dev server on :3000
- `npm run build` — production build
- `npm run lint` — ESLint flat config (`eslint.config.mjs`, extends `eslint-config-next`
  core-web-vitals + typescript)

There is no unit-test framework configured. There are now TWO test surfaces, and both must
be run after anything touching policies, auth, capabilities or tenancy:

- `npm run test:rls` — the RLS harness (`scripts/test-rls.ts`, **60 assertions**, numbered
  1–60 with none reserved (slot 21 was held for the retention purge and 0071 filled
  it), every one with a positive control, seeded by
  `npm run seed:harness -- --apply`). Seed, then run ONCE:
  assertion 17 is single-use and reports VACUOUS on a second run without a re-seed.
  **THE TWO TEST SURFACES REFUSE TO RUN CONCURRENTLY** (`scripts/harness-lock.ts`):
  `check:caps` phase 3 writes `extra_caps` onto the same crew member assertion 30
  asserts is empty, so a concurrent run produces a FALSE FAILURE pointing at
  whatever you just changed. Run them one after the other.
- `npm run check:caps` — the capability table vs the generated SQL vs the TS resolver, in
  three phases (`npm run gen:caps` prints the SQL to apply). It has been seen to FAIL on
  three real defects, which is the only reason its green tick means anything.

**If you change a roster row in a migration, change the seeder in the same commit.** Batch 25
learned this the hard way: the seeder would have silently reverted migration 0050 on the next
`seed:harness`, and since the harness documents a re-seed between runs, "silently" would have
meant "always".

Do not invent another runner or claim tests passed that did not run.

## Build / lint quirks

- Next 16 removed `next lint`. Linting runs via `eslint .` and is **not** run during
  `next build` — run `npm run lint` explicitly. Lint failures do not fail the build.
- `experimental.serverActions.bodySizeLimit` is `"50gb"` (`next.config.mjs:15`) — a historical
  setting from when uploads were buffered through Server Actions. Uploads now go direct
  browser→R2 (see "Uploads"), so it no longer governs them.
- `next.config.mjs` pins `turbopack.root` to the project dir — a stray `package-lock.json` in
  the home directory otherwise makes Next infer the wrong workspace root.

## Supabase clients — pick the right one

Three clients in `lib/supabase/`. **All three export a function named `createClient`** — the
import alias at the call site is what tells them apart.

- `lib/supabase/server.ts` → `createClient()` — Server Components, Route Handlers, Server
  Actions. Reads the user's session from cookies; subject to RLS as that user. `server-only`.
- `lib/supabase/client.ts` → `createClient()` — `"use client"` components only. Anon key,
  subject to RLS. This is the client every Realtime subscription uses.
- `lib/supabase/admin.ts` → `supabaseAdmin` — service-role key, **bypasses RLS**. `server-only`.

**One** route handler constructs its own service-role client inline rather than importing
`supabaseAdmin`: `app/api/admin/create-client/route.ts:48`. There were two until Batch
10.3 rewrote `resend-invite` onto the shared client — the first time the I-8 ratchet has
shrunk. An inline client imports nothing, so the import rule cannot see it; the
`SUPABASE_SERVICE_ROLE_KEY` selector in `eslint.config.mjs` is what catches it.

## Authorization — how it actually works today

**[VIOLATES S0 AD-001 and I-8 — pending remediation.]** S0 decides that RLS owns tenancy and
service-role access is an enumerated allowlist. Today the opposite is true:

- **The application reads and writes almost everything with `supabaseAdmin`.** ~70 modules
  touch it, including page-level Server Components on user-session paths
  (`app/(portal)/layout.tsx`, `app/(portal)/dashboard/page.tsx`, `app/studio/layout.tsx`, …)
  and most route handlers. **The allowlist and lint rules exist since Batch 7.9**:
  `lib/supabase/admin-allowlist.mjs` (PERMANENT + TRANSITIONAL, each entry justified) is
  consumed by `eslint.config.mjs` — a ratchet, so removing an entry is the migration and
  adding one needs a reason. This entry previously said "no allowlist and no lint rule";
  that was stale. **It has now shrunk by deletion twice**: `app/studio/client/review/page.tsx`
  came off in `S-S` Phase C, because reading `tasks` through the service role there was
  bypassing the project scoping 0057–0059 had just built (HANDOFF §8.3). That is the shape
  a removal should take — the entry goes when the surface moves to the user client, not
  before.
- **RLS is enabled on every table**, and the policies are real — but for the app's own reads
  they are mostly bypassed. What RLS *is* load-bearing for is **Realtime**: browser
  subscriptions authenticate as the user, so a missing SELECT policy silently kills live
  updates rather than erroring. `supabase/migrations/_archive/20260603_phase7.sql` exists
  solely because of this (moved to `_archive/` in Batch 6.9 — see "Migrations" below; it is
  historical and never re-applied).
- **`app_metadata.role` IS ROUTING, NOT CAPABILITY** (Batch 25). It is the two-valued
  crew/client axis `lib/auth/role.ts:26` declares, read by `proxy.ts` and 61 call sites to
  decide which shell a session belongs in. It is `'admin'` for EVERY crew member whatever
  their roster role — `app/api/admin/team/route.ts` stamps it at invite — so **nothing may
  authorize on it.** `isAdmin(user)` answers "is this a crew session", never "may they do
  this". A route that uses it as a permission admits every crew member; that shape was found
  three times in one batch (HANDOFF §8.3 item 18). The `org_role` claim is DELETED — it had
  six writers and no readers. `user_metadata` is user-editable and is never trusted for
  anything. `public.is_admin()` still exists in SQL with **zero database consumers**.
- **Capabilities resolve from the ROSTER on every request, never from a token** (S-R R-2).
  The vocabulary is `lib/capabilities.ts` — and it is the ONE source: it generates
  `public.role_baseline()`, `client_role_baseline()` and `valid_*_cap()`, with
  `npm run check:caps` failing on drift in three phases (generated SQL vs the constant; the
  TS resolver vs live `has_cap()` per persona; the legacy-alias path on a real row).
  · **What is STORED is COARSE** — 14 dot-notation caps (`work.projects`, `work.suite`,
    `client.manage`, `people.manage`, `money.invoices`, `money.costs`, `org.settings`,
    `record.approval_policy`; portal side `portal.view|message|upload|approve|invoices|team`).
    S-R §4's 38 fine keys are the vocabulary of QUESTIONS: `can(user, 'money.invoice.send')`
    resolves through `CAP_RESOLUTION` to the coarse cap that answers it. Do not add a stored
    cap casually — every one can end up in an `extra_caps` row, and renaming it strips
    granted access.
  · `lib/capabilities.server.ts` is the ONE resolver (`resolveCaps`, `can`, `capGate`,
    and `resolveCapsForMember` for the one caller that must answer about SOMEBODY
    ELSE — the R-11 cron, which has no session and passes its own client in), on
    the **USER client** — it reads only the caller's own rows, which the ungated self-read
    policies already permit. Do not give it the service role; the I-8 ratchet will refuse it
    and the refusal is correct.
  · `lib/grants.ts` is the ONE grant write path and it MUST be handed the user client:
    0054's G-1…G-4 triggers read `auth.uid()` and pass a service-role write straight
    through.
  · `extra_caps` is still written as a PROJECTION of the grant rows (S-R §10, Rule Zero),
    carrying grants only — a denial is not an absence, and `has_cap()` subtracts denials
    last so a stale projection cannot defeat one.
  · Snake_case values are accepted as READ aliases for one release, in TS *and* in SQL
    (0052). Both copies go together; `check:caps` phase 3 holds them together until then.
- **Nine tables carry a capability predicate in RLS** (0053, S-R §9's amendment to AD-001):
  `invoices`, `org_credits`, `org_budgets`, `credit_ledger`, `usage_events`, both rosters,
  both `*_member_projects`, both `*_cap_grants`. ANDed onto tenancy, never substituted.
  **Self-read is never gated** — `resolveCaps()` depends on it, so gating it would make the
  capability layer unable to resolve the capability that would ungate it.
- **`work.*` and `client.*` stay app-layer** and are filtered by PROJECT SCOPE, **which is
  now built** (Batch 26, 0057–0059): a crew member reads only the productions their
  `scope_mode` and assignments admit. `org_project_visible()` appears in **14 policies**,
  and since 0059 in **both USING and WITH CHECK** — INSERT is the one command USING cannot
  reach, and until 0059 a scoped member could insert onto a production they could not see.
- **A PROJECT ROLE CARRIES A CAPABILITY BASELINE** (S-R R-10, 0058).
  `PROJECT_ROLE_BASELINE` in `lib/capabilities.ts` generates `project_role_baseline()`, and
  `has_cap()` unions it for the caller's live, unexpired assignments. A NULL `project_role`
  and an `observer` both grant nothing, and they are different facts: the first is the
  absence of a decision, the second is a decision that somebody writes nothing.
- **SEAT CLASS CHOOSES THE SCOPE, AT INVITE TIME, AS A WRITTEN VALUE.**
  `SEAT_CLASS_SCOPE_MODE` says what to WRITE (`staff` → `all`, `contractor` → `selected`);
  it must never be consulted to decide what an EXISTING row MEANS — that is what
  `scope_mode` on the row is for, and inferring it would reintroduce B1's footgun one axis
  up. Values are `staff`/`contractor` because both of the specs' words were already taken
  (0056's header). **`lib/assignments.ts` is the ONE staffing write path**, on the user
  client, and every assignment, role change, removal, seat-class and scope change writes an
  `activity_log` row (R-8).

Before changing a query or a table's schema, check the relevant policies in
`supabase/migrations/`. When you add a *new* surface, follow AD-001 (user client + RLS), not
the surrounding pattern.

## Multi-tenancy — column exists, nothing enforces it

**[VIOLATES S0 I-9 — pending remediation.]** `organization_id` exists on 20+ tables
(migration `0001`) with a `DEFAULT` of the sentinel org
`00000000-0000-0000-0000-000000000001` ("McPrime"), and indexes for it.

- **No code path writes `organization_id` to any client-facing tenant table** — every row
  relies on the column default. The only writes are `usage_events` (`lib/usage.ts:27`,
  `lib/credits.ts:44`) and `client_members` (`app/api/portal/team/route.ts:102`).
- **No query filters by `organization_id`** except `lib/credits.ts:30-31` (`org_credits`,
  `org_budgets`).
- `public.current_org()` reads `app_metadata.organization_id`. Policies on `documents`,
  `document_versions`, `document_comments`, `storyboards`, `storyboard_shots`,
  `asset_provenance`, `rights`, `usage_events`, `org_budgets`, `org_credits`, `credit_ledger`
  require `organization_id = current_org()`. **A user whose JWT lacks that claim gets an empty
  result set, not an error** — the silent-empty-Workspace failure S0 AD-001 calls out.

The tenancy model itself (`clients` vs `organizations` vs `clients.user_id`) is unresolved and
owned by S1. Do not design around a guess; see `docs/specs/S0-conformance.md` § S1 INPUTS.

## Proxy / middleware redirects (`proxy.ts`)

Next 16 renamed the `middleware` convention to `proxy`: the logic lives in `proxy.ts` and
exports `proxy()` plus the `config` matcher. It refreshes the Supabase session on every
request and enforces role routing. Actual behaviour, in order:

- `/login`, `/reset-password`, `/set-password`, `/auth/callback` pass through unauthenticated
  (`proxy.ts:36-60`). `/set-password` is critical — redirecting it causes a password-reset
  loop.
- **Everything under `/admin` is redirected to `/studio/...`** (`proxy.ts:65-80`), before any
  auth check, via a legacy path map (`/admin/clients` → `/studio/client/companies`, etc.).
  Unmapped `/admin/*` lands on `/studio/client/overview`.
- Admin routes are `/admin` **and `/studio`**; portal routes are `/dashboard`, `/projects`,
  `/approvals`, `/team`, `/files`, `/messages`, `/invoices`.
- Unauthenticated on a protected route → `/login`.
- Admin on a portal route → **`/studio`** (not `/admin`).
- Non-admin on `/studio` → `/dashboard`.
- Logged in hitting `/login` → `/studio` (admin) or `/dashboard` (client).

Walk each of these paths mentally before saving an edit to `proxy.ts`.

## Route groups

- `app/(auth)/` — public auth flows (`/login`, `/reset-password`, `/set-password`).
- `app/(portal)/` — client-facing protected area (`/dashboard`, `/projects`, `/approvals`,
  `/team`, `/files`, `/messages`, `/invoices`). `app/(portal)/layout.tsx` resolves membership
  and redirects. Note it uses `auth.getSession()` (line 17), not `auth.getUser()`.
- `app/(admin)/` — **NOT dead, and must not be deleted. 14 of its 15 page modules are the
  canonical implementations behind the studio.** No `/admin/*` URL is reachable — the proxy
  redirects every one to `/studio` (see above) — but reachability is not the same as being
  unused: the studio routes are thin gated wrappers that *re-export these modules*. Fifteen
  files under `app/studio/` import from here, e.g. `app/studio/client/companies/page.tsx:3`
  → `@/app/(admin)/admin/clients/page`, and `admin/settings/page.tsx` backs both
  `/studio/crew/settings` and `/studio/client/settings`. **Deleting this group deletes most
  of the studio.** To change studio behaviour, edit the module here; the wrapper adds only
  `requireOrgFeature()`.
  Genuinely unreachable, and the only part that is: `admin/dashboard/page.tsx` (nothing
  re-exports it; it is the stale target of `app/auth/callback/route.ts:86`),
  `admin/layout.tsx` and `admin/loading.tsx` (the wrappers render under
  `app/studio/layout.tsx`, so the `role === 'admin'` check at `admin/layout.tsx:20-21`
  never runs for them). Whether to retire those three is owned by S4 (S0 §7).
  This entry previously read "dead code … none of these 17 pages is reachable". That was
  wrong on both counts and would have taken the studio down with a cleanup sweep.
- `app/studio/` — the Genreline studio shell (admin-only; `app/studio/layout.tsx` enforces
  `isAdmin`). Three spaces — Crew / Client / **Suite** — declared in `lib/studio/spaces.ts`.
  The Suite was "Workspace" until Batch 12.2; `proxy.ts` redirects old `/studio/workspace/*`
  URLs, and the OrgCap named `'workspace'` in `lib/permissions.ts` deliberately keeps its
  name (it is stored in `organization_members.extra_caps` rows — renaming the string strips
  granted access). CRM · Pipeline and Lead-Gen in Crew are gated to plan feature
  `internal.pipeline` (house org only) via the sidebar filter and `requireOrgFeature`.
  Features without an implementation render a "Phase N · coming soon" card
  (`app/studio/[space]/[feature]/page.tsx:40-66`). Whether stubs stay advertised is owned by S4.
- `app/api/` — route handlers for files, portal, admin, studio, rooms, cron,
  presence, push, and the Stripe webhook. This entry was off by one twice when
  it carried a number — count it (`find app/api -name route.ts | wc -l`),
  don't quote it (**69** today). `studio/scheduling` was added and then REMOVED
  with the bookings feature (0076); `sign` and `share` are the only two routes
  in the application with no session at all, and both carry the I-8
  justification written at the top of their module. `app/api/rooms*` (Batch 23) is the
  S3-d surface: room list/create (channels, groups, broadcast, DMs), seating,
  and room-addressed messages — zod-validated, and the WRITES run on the user
  client so the 0046 policies are the authorization (AD-001 as written; the
  service role there only resolves rosters, presigns R2, and stamps delivered
  on other people's rows).
- `app/auth/callback/route.ts` — **implemented, not reserved.** It handles the PKCE
  `exchangeCodeForSession` flow and the `token_hash`/`verifyOtp` magic-link/invite flow, and
  marks clients onboarded. Its admin success path still redirects to `/admin/dashboard`
  (line 86), which the proxy then bounces to `/studio/client/overview` — stale but not broken.

## Uploads — direct-to-R2 (presigned)

All file and chat-attachment uploads go **straight from the browser to Cloudflare R2** via a
presigned PUT URL — the bytes never pass through a serverless function, so there is no
request-body size limit (this is what makes uploads work on Vercel, which hard-caps function
bodies at ~4.5MB).

Flow (`lib/uploadClient.ts` → three route handlers). **Two paths, one call site**
(Batch 24) — `uploadFileToR2` picks by size:

**Under 8 MB — one presigned PUT:**
1. `POST /api/files/presign` — auth + authorize, mint a collision-safe key and return a
   presigned PUT URL. The key is always server-generated; scope resolution is shared with
   commit and multipart via `lib/uploadScope.ts`.
2. Browser `PUT`s the file to R2 (Content-Type must match what was presigned).
3. `POST /api/files/commit` — re-authorize, verify the key prefix, insert the `files` row with
   `bucket: 'r2'`, and meter `storage.bytes`.

**8 MB and over — multipart, and therefore PAUSABLE:** `POST /api/files/multipart` with
`{create|sign|complete|abort}`, then the same commit. `uploadFileToR2` returns an
`UploadHandle` (`pause`/`resume`/`cancel`/`canPause`) so the bubble carrying the file can
drive it; cancel aborts server-side, because abandoned parts are billed until they are.
**Completion never trusts browser ETags** — a cross-origin XHR can only read a header the
bucket's CORS names in `ExposeHeaders`, and ours does not, so the server calls `ListParts`
and completes with what R2 actually holds. A part PUT must send **no** `Content-Type`
header (the part URLs are signed without one). A short part list ABORTS rather than
completing: a truncated object that reports success is the worst outcome available.

**Three scopes** (`lib/uploadScope.ts`): project (`<clientId>/<projectId>`), client
(`<clientId>/_general`), and — since Batch 24 — **room**
(`<clientId>/_room/<roomId>`, or `_org/<orgId>/_room/<roomId>` for internal rooms), where a
live `room_members` seat is the authorization. The room scope is what makes attachments work
in channels/groups/DMs, and is the only scope an external collaborator can satisfy.

**Deletion is permanent and goes through one path** — `lib/fileDelete.ts`: detach references
(`message_attachments`, invoice receipt links), delete the `files` row, then destroy the R2
object. **Row before blob**, deliberately: the reverse leaves a row pointing at bytes that no
longer exist — a file that lists, previews broken, and can never be cleaned up because the
delete already "succeeded". `/api/files/[id]` DELETE is open to any admin of the file's own
organization (it had no tenant predicate before Batch 24) or to the person who uploaded it.
Deleting a chat message destroys its attachment immediately rather than waiting for the
migration-11 purge: a scrubbed body is unreadable, but a signed URL already handed out keeps
working.

Chat attachments use the same path: `handleAttachmentUpload` in each messaging component calls
`uploadFileToR2({ category: 'message' })`, so a `files` row **is** created and the file lands
in the vault's "Chat" folder (`lib/fileCategories.ts:185`). What `messages.attachment_url`
stores is a `"bucket::path"` string, not a `files.id` FK — resolved to a signed URL by
`POST /api/portal/messages/attachment`. (S0 AD-004 asserts chat attachments never become
`files` rows; that premise is inaccurate against this code. See `docs/specs/S0-conformance.md`.)

Reads branch on `bucket === 'r2'`: `getSignedDownloadUrl` (2-min download / 1-hour inline) and
`getR2ObjectStream` (the same-origin `/raw` proxy). **Do not reintroduce server-side upload
routes that buffer the file** (`req.formData()` → upload) — they break on Vercel above 4.5MB.
Direct browser→R2 needs a CORS policy on the bucket allowing `PUT` from the app origin.

Avatars/logos are the exception: small images upload through `/api/portal/avatar` (and project
images through `/api/admin/project-image`) to Supabase Storage, which can mint the long-lived
signed URL the sidebar needs (R2 presigned URLs max out at 7 days).

Dead upload code, do not revive: `lib/r2.ts` still exports `uploadToR2` and its multipart
helpers (nothing calls them), and `hooks/useFileUpload.ts` posts a `FormData` body to
`/api/files/upload`, **a route that does not exist**; nothing imports the hook.

## Realtime

Browser subscriptions use `lib/supabase/client.ts` and are filtered by RLS.
`components/shared/PresencePulse.tsx` mounts once per layout and holds a global
`presence:app` channel plus an `inbox:${userId}` `postgres_changes` subscription; sidebars,
notification bells, task boards, file vaults, message hubs and the doc editor each add their
own. **[VIOLATES S0 I-2 (max 2 subscriptions per session; channels must be tenant/room-scoped)
and I-3 (no polling where push exists) — pending remediation.]** Several surfaces run a
`setInterval` poll *alongside* a realtime channel as a "safety net". Do not copy that pattern
into new code.

`lib/collab/supabaseYjs.ts` is the Yjs provider over a Supabase broadcast channel
(`doc:${docId}`); `documents.ydoc` is the durable snapshot.

## Approvals — the record, and the three modules behind it

`S3-c` makes approval a RECORD, not a status: silence auto-advances and is never
written as approval, late objections are shown rather than hidden, and there is a
printable certificate. It is the product's strongest differentiator (`S-S` §2.1),
which means the failure mode that matters is not a crash — it is the record
quietly asserting something it cannot support.

| Module | Job |
|---|---|
| `lib/approvals.ts` | the engine — the ONE write path, plus `readApproval` / `listApprovals` / `listApprovalChains` |
| `lib/approvalTimeline.ts` | the chain, as ordered entries. **Shared on purpose** |
| `lib/approvalIntel.ts` | how well the record would hold up if it were disputed today |

Rules that are not style preferences:

- **There is ONE timeline function.** `ApprovalRecord` (the accordion) and
  `/studio/client/review/[id]` (the addressable record) both render
  `approvalTimeline()`. Two copies of a dispute document is the one duplication
  that cannot be allowed to drift.
- **`listApprovalChains` exists so the Review surface is not an N+1.** A page of
  chains costs four queries, not four per approval. Use it for any surface that
  grades more than one approval.
- **Never add a read-side filter to comments or decisions** (AP-4). Who may
  COMMENT is controlled; what is RECORDED is not. A filter here is what makes a
  review look cleaner than it was.
- **`approvalIntel` grades, it does not decide.** It never writes and never
  changes auto-advance behaviour. Where it says `broken`, the underlying
  question belongs to `S3-core` §2.4 — see HANDOFF §8.3's open ruling on
  lapsing with zero recipients.
- **The studio sees the grading; the client does not.** Both sides get the
  record and the certificate. Grading the studio's own evidence is intelligence
  for the party that has to act on it, not for the party it may one day be used
  against.
- **WHAT THE APPROVER ACTUALLY SAW is part of the grade** (`watchEvidence`).
  0085's screening links record how far a guest got; DocuSign's certificate says
  a document was viewed and never how much, and Frame.io records viewing and
  never attaches it to a decision. **Nobody joins the two.** An approval whose
  only recorded viewing reached 3% of a twelve-minute cut is genuinely thinner
  than the reminder count alone suggests, and it says so.
- **Positive evidence only, and only downward.** The portal's own player records
  nothing, so a client who watched the whole cut in the portal leaves NO rows.
  A grader that read absence as "approved without watching" would confidently
  defame the careful client while saying nothing about the careless one.
  `undefined` (nobody asked) and `[]` (asked, nothing recorded) are therefore
  different types of answer, and neither produces a finding. It never lifts a
  grade and never reaches `broken` — `broken` is a claim about a certificate
  asserting silence it cannot support, which viewing has nothing to say about.
- **The list and the record must not disagree.** Since the grade moves on
  viewing, `review/page.tsx` batches the views for the whole page
  (`listViewsForSubjects`, two queries) rather than skipping them — the same
  argument `approvalTimeline` makes about there being one chain function.

## The job queue — Postgres is the queue

`jobs` + `claim_jobs()` + `enqueue_job()` (0083, revised by 0084). Anything that
cannot finish inside one request goes here: transcodes, encoder polling,
recording ingest, contract notifications.

**Audited before building** (ideas taken, no code): graphile/worker (MIT),
pg-boss (MIT), riverqueue/river (MPL-2.0, Go), pgmq (PostgreSQL licence),
livepeer/lpms (MIT).

| Property | Where it came from |
|---|---|
| `FOR UPDATE SKIP LOCKED` claim | the mechanism all of them are built on |
| visibility timeout, not a held lock | pgmq / SQS semantics |
| job keys that **REPLACE** the pending payload | graphile/worker |
| per-tenant concurrency ceiling | pg-boss's flow control, keyed on the tenant |
| **round-robin fairness across ORGANIZATIONS** | **none of them — see below** |
| `blocked` ≠ `dead` | **none of them** |

**THE THING THAT BEATS THE MARKET.** All five make the QUEUE the unit of
fairness — per-queue concurrency, multiple queues, a pool per worker. In a
multi-tenant OS that is the wrong axis: one studio uploading two hundred clips
starves every other tenant's contract notifications, and the documented
workaround in each is a queue per customer, which turns provisioning into queue
administration. `claim_jobs` ranks each organization's backlog and interleaves —
every tenant's first job before any tenant's second — so starvation is
impossible rather than unlikely. Proven: org A with 10 queued, org B with 1
queued last, a 2-slot claim returns one of each.

**`blocked` is not `dead`.** "Nobody configured the encoder" and "we tried five
times and it broke" need different responses from a person — a settings page
versus a bug report. Every library above collapses both into failure.

Rules that are not style preferences:

- **Enqueue takes the CALLER's client** wherever one exists, so the job rides the
  same transaction and RLS as whatever caused it. A job to transcode a file
  cannot exist if the file insert rolled back — the bug a separate Redis queue
  invites and hides until the worker runs.
- **`jobs` has a crew READ policy and NO write policy.** A queue nobody can see
  cannot be debugged; a queue anybody can write to is a way to make the worker
  act for you (assertion 57).
- **The worker refuses to run without `CRON_SECRET`**, deliberately unlike
  `message-nudge`, whose unset-variable path leaves it unauthenticated.
- **Short batches per tick, never drain-until-empty.** A serverless function has
  a wall clock, and the last job in a drain loop is the one that gets killed
  half-finished.

## Media — transcode and renditions

`media.transcode` hands Cloudflare Stream a presigned R2 URL and Stream PULLS —
the bytes never pass through this application, the same shape Egress uses to
write recordings back. `media.probe` then polls until ready, because a webhook
needs a publicly reachable URL per environment and a preview deploy has a
different hostname.

**A RENDITION NEVER REPLACES THE MASTER.** `media_renditions` is a separate row
pointing at the same file: the thing an editor approves and the thing a browser
can play are not the same object, and conflating them loses the original — the
same argument `S3-core` §3.2 makes about a version being a file.

It does NOT claim colour-managed delivery. A grading review needs 10-bit
transport and a calibrated display, and no managed encoder hands you that over
HTTP; `ColourCheck` still warns where the display falls short.

## The client's calendar — dates that say what happens if you do nothing

`/dashboard/calendar` ("What's coming"), `lib/portalCalendar.ts` for the
decoration, `listClientEntries` in `lib/calendar.ts` for the read. No migration:
`calendar_entries` has had a client SELECT policy since 0065 and its writers
since 0074, and never had a client-facing surface — a deadline the studio could
see was invisible to the company it binds.

**Audited and NOT used**, with reasons: `fullcalendar/fullcalendar` (MIT core,
but the resource and timeline views are commercially licensed — the ecosystem
has a paywall a future ask walks straight into), `schedule-x/schedule-x` (MIT,
zero deps, genuinely good) and `vkurko/calendar` (MIT). All three render a grid
of events well; this repo already has `monthGrid`/`groupByDay` and the crew
calendar uses them, so a library buys a second calendar idiom and moves nothing.
What was taken is schedule-x's AGENDA view as an idea — a client on a phone
wants a list, not twelve empty Tuesdays.

**THE THING THAT BEATS THE MARKET.** Every client portal in the category offers
the same three things and Genreline already had all three: pending items with
due dates, an escalating reminder ladder, and an approval history. **And all of
them are passive** — the deadline reminds you, and if you ignore it the badge
turns red. `S3-c` made silence a decision, so this calendar can write a sentence
no other product can write truthfully: *"If nobody responds by Thursday 5:00 PM,
this is approved automatically and the production moves on."* Google Calendar
cannot say it; neither can a portal that only displays a date. It is only true
in the system that will do the thing.

Rules that are not style preferences:

- **The order is by whose move it is, not by date.** A chronological list buries
  the decision that lapses on Thursday under three shoot days in between.
- **An ACTIVE stage past its deadline is still the client's move and still sorts
  first.** It is the window between the deadline and the next daily sweep — the
  most urgent row the page can show — and filing it under "already passed" would
  put the emergency in history.
- **The tense is a correctness property.** "If you do nothing by Tuesday" about
  last Tuesday is grammatical, confident and false, and somebody acts on it.
  This is the same defect `approvalIntel` shipped once; it recurred here in a
  second module and was caught by a probe that reads the SENTENCE rather than
  the row (`scripts/ops/probe-portal-calendar.ts`).
- **An auto-advance that already happened is SHOWN**, and named as an automatic
  advance rather than a sign-off. A client must never learn from the
  consequences that something lapsed on their silence.
- **`listClientEntries` carries no `organization_id` filter, deliberately.**
  `calendar_entries_client_read` scopes by `is_client_member`, never by
  `current_org()`, and a client's JWT may carry no org claim — an `.eq()` there
  would render an EMPTY CALENDAR rather than an error.
- **`approvalIntel`'s grading is absent.** The studio sees how its own record
  would hold up; the client does not. A consequence is a different thing from a
  grade — it is a fact about what the system will do next.
- **The nav link is ungated** (`CLIENT_NAV_CAP['/dashboard/calendar'] = null`).
  Somebody who may not decide may still need to know the date, and RLS already
  scopes the rows.

## The brand kit — one colour in, an accessible ramp out

`organizations.branding` (jsonb, **no migration — it has existed since 0001
holding `{}` with zero readers and zero writers**), `lib/brandKit.ts` as the
derivation, `/api/studio/organization/brand` as the one write path,
`/studio/client/brand-kit` as the surface, and `components/TenantTheme.tsx` as
the one thing that renders it.

**Audited before building.** TAKEN: `Evercoder/culori` (MIT, **zero
dependencies**) for OKLCH conversion; `radix-ui/colors` (MIT) for the SEMANTICS
of a scale, not its hand-tuned constants; `ricokahler/color2k` (MIT) as
confirmation that WCAG contrast is five lines of spec arithmetic;
`jnsahaj/tweakcn` (Apache-2.0) as the UX reference for a live preview.

**REJECTED, and this is the find: `evilmartians/apcach`.** The package is MIT
and does exactly the right thing — generate a colour FROM a contrast target —
but it depends on `apca-w3`, which ships under the **"Limited W3 License"**:
*"Commercial use is prohibited without a written and signed commercial license
agreement"*, plus a ban on modifying the core constants. This product is
commercial SaaS. **An MIT badge on the top-level package made the obligation
invisible; it rode in on a transitive dependency.** The contrast half is
therefore implemented here against the published WCAG 2.1 formula, and apcach's
*idea* — solve for the colour that meets the contrast — is reimplemented in
`deriveOn()`, which is the only part of it that was ever free to take.

**THE THING THAT BEATS THE MARKET.** "Custom branding" in this category is four
knobs: logo, accent, hide the vendor, custom domain. Frame.io gates it behind
Enterprise. Everyone stores the hex the customer typed and interpolates it into
CSS, and the 2026 white-label architecture write-ups name the consequence in
their own words — preventing "custom CSS or branding assets from breaking core
UI components or accessibility standards" — and then do not solve it.

Here the studio picks ONE colour and everything else is derived, server-side:

- **The on-colour is CHOSEN BY MEASUREMENT.** A pale gold fill gets near-black
  type; a navy one gets near-white. There is no input that produces an
  unreadable Approve button, and a probe proves it across eleven hostile
  colours (`#FAFAFA`, `#0A0A0A`, neon yellow, pure red) in both themes.
- **Both themes from one decision.** A hex tuned for white is routinely
  invisible on the dark shell. Hue and chroma — the parts a person recognises as
  "their" colour — are held; only lightness moves, and only as far as it must.
- **The brand reaches what LEAVES THE BUILDING**: the portal, the guest
  screening page, the signing page, the transactional email, and the **sealed
  contract PDF**. A branded portal is a login screen; a branded record is the
  file an auditor still has in seven years, and no client-portal product reaches
  one because none of them has an artifact.

Rules that are not style preferences:

- **The request carries a colour; the server derives the tokens.** A browser
  that posted a hand-made `tokens` object would be writing CSS variables into
  every one of that studio's clients' browsers. The editor previews with the
  same module so the number shown is the number stored — one derivation, run
  twice, never two implementations.
- **`TenantTheme` never renders inside `/studio`** (S0-B §2). The portal wears
  the tenant; the shell wears the product. "White-label everything" is the
  market's framing and it is wrong here — a producer working in Genreline should
  see Genreline.
- **OKLCH internally, HSL triplets out.** `globals.css` defines every token as
  `--primary: 40 57% 45%` and ~400 sites read `hsl(var(--primary))`; changing
  the token format to suit this module would be the tail wagging the dog.
- **Both halves are stored.** `input` is what the studio chose, `tokens` is what
  renders. A better derivation later re-runs from the input; storing only the
  output makes every improvement a migration that has already lost what it needs.
- **`readBrandKit` never half-returns.** One token from the studio and three
  from the product reads as a bug in the studio's brand rather than in this code.
- **Branding the sealed PDF is safe, and that was checked rather than assumed.**
  `content_hash` is taken at SEND, so a colour that moved after signing would
  break the module's whole purpose. It cannot: `lib/contractFinalize.ts` renders
  ONCE when the last signature lands and stores the bytes in R2. A rebrand next
  year changes the portal and cannot touch a signed file.
- **The email CTA no longer hardcodes `#ffffff`.** That was correct for the
  product's gold and unreadable the moment a studio picked a pale accent — and
  there is no CSS layer in an email to catch it, so the derived on-colour is
  carried in. A tenant accent is only used for `voice: 'tenant'`; Genreline
  speaking to the studio it sells to must not wear the studio's colours.
- **No kit renders nothing**, and the house org has none — so nothing changes
  for anybody until a studio opts in.

## The screening room — a guest link that is also evidence

`share_links` + `share_link_views` (0085, scoped by 0087). `/s/<token>` is the
public page, `lib/shareLinks.ts` the one resolver, `/api/share` the only
endpoint a guest touches, and `/studio/client/guest-links` the studio surface.

**Audited before building** (ideas taken, no code): `cloakshare` (MIT — the
sanity check on the feature set), `papermark` (**AGPL-3.0, studied and
deliberately not used**), `facebookresearch/videoseal` (MIT, and the right tool
for invisible forensic marking — but Python and GPU-bound, so it belongs in the
job queue as a worker, not here). Commercial bar: Dropbox Replay ships dynamic
watermarking on every paid plan, **Frame.io gates it behind Enterprise**,
MediaSilo goes furthest with session-based watermarked streams plus audit logs.

**THE THING THAT BEATS THE MARKET: none of them connects the view to the
DECISION.** Every one records views for an engagement chart. In a production the
interesting fact is different — somebody who opened a cut for four seconds and
then approved it is not the same record as somebody who watched ninety-two
percent and then approved it. `share_link_views.furthest_ms` and
`seconds_watched` sit against the same asset an approval is about, which is why
`approvalIntel` can one day say "approved without watching" and why the studio
surface leads with a watched bar rather than a view count.

Rules that are not style preferences:

- **The token is never stored, only its SHA-256** (0078's rule). So the mint
  response is the ONLY time the working URL exists, and the surface says so
  rather than letting somebody discover it by closing a dialog.
- **ONE ANSWER FOR EVERY FAILURE.** Unknown token, expired, revoked, limit
  reached, wrong passcode — the same 404 sentence. A distinct "wrong passcode"
  confirms the token is real, which is half the work of guessing one.
- **The playback URL is minted AFTER the gate, never rendered into the page.**
  Otherwise the gate is a curtain and the asset is one inspection away.
- **`furthest_ms` is a HIGH-WATER MARK.** Scrubbing back must not erase having
  reached the end.
- **The watermark is not removable by a preference.** Under
  `prefers-reduced-motion` the drift stops and the mark STAYS — it is not
  decoration.
- **`share_link_views` has a crew READ policy and no write policy at all**
  (assertion 58). A studio that can edit "watched 4 seconds" into "watched it
  through" holds evidence worth nothing; same reasoning as `contract_events`.
- **What it is NOT**: invisible forensic watermarking. The mark is rendered in
  the player, bearing the viewer's own identity, and it moves — aimed at the
  actual leak vector, which is a screen recorder. Claiming forensic protection
  we do not have would be worse than claiming none.
- **`work.file.share` is its own question** even though it resolves to the same
  coarse cap as the rest of `work.file.*` today. "May see the cut" and "may send
  the cut outside the building" are not the same decision, and separating them
  later is then one line in `CAP_RESOLUTION`.

## Soft delete — and the obligation it puts on crew queries

`deleted_at` is on nine tables (`S3-core` §4.1). **RLS hides soft-deleted rows
from CLIENTS only.** Crew policies are deliberately unfiltered, because a crew
policy that filtered them could not perform the soft delete at all (see the
0073 rules above) and could not restore one either.

**So every crew-side read must exclude them in the query**: `.is('deleted_at',
null)`. This is a real obligation on application code and the reason it is worth
the trade is that a trash view and an undelete are now ordinary queries rather
than service-role work.

`purge_deleted_rows(p_org, p_grace_days)` (0071) hard-deletes past the grace
window, one organization at a time, and **returns the R2 objects the caller must
then destroy** — SQL cannot reach the bucket, and row-before-blob is the order
`lib/fileDelete.ts` already uses. It never touches `activity_log`, and could
not: `activity_log_retention()` refuses any delete inside 7 years, including a
CASCADE. That guard closed a live defect — `activity_log.project_id` and
`.client_id` were `ON DELETE CASCADE`, so deleting a client company destroyed
its ledger silently. Both are `SET NULL` now.

## Meetings — four doors, one room

| Surface | Who | What is absent |
|---|---|---|
| `crew/meetings` | studio, internal floor | — |
| `client/meetings` | studio, addressed to a company | — |
| `dashboard/meetings` | the client's own portal | create, end, cancel, record, file picker |
| `/meet/[id]` | ANYONE who can read the row — including a roster-less collaborator | same as the portal |

**`/api/meet` is the one participant endpoint and it has NO capability gate.**
That is deliberate: three different kinds of person join legitimately (client
member, external collaborator, crew-as-participant) and they are admitted by
three different POLICIES. A capability check above that would have to enumerate
all three and would go stale on the fourth — which is exactly what happened
before 0082. The only question that generalises is `S3-b` §2.3's: **can you read
this meeting row?** No read, no token, no way in.

`/meet/[id]` exists outside both shells because a collaborator belongs to
neither: the studio shell rejects them on `isAdmin`, the portal shell resolves no
membership. It is NOT a public link — a session is still required and the URL
carries no authority.

**`client_id` IS THE BOUNDARY.** Null means the studio's internal floor; set
means a client company is party to it. Batch 24 settled this for rooms after the
crew hub filtered on the wrong column and put a conversation with a client's
person on the internal floor — the same rule applies here, and a client walking
into an internal CALL is a worse version of that bug. Assertion 55 holds it.

`MeetingScreen` is ONE component rendered by both studio spaces; the portal has
its own thinner page. `MeetingRoom` takes an `endpoint`, so the two routes differ
only in what they REFUSE — a client has no create, end or record, and those
actions do not exist on `/api/portal/meetings` rather than being disabled in the
UI (R-6).

**THERE IS NO INVITE STEP.** A meeting opened against a company is joinable by
its team immediately, because `meetings_client_read` already admits them. A
second mechanism would be a second thing to keep in step.

## Meetings — what makes it not a Zoom link

`review_session` is the mode that justifies building rather than pasting a link.
Three things sit on top of LiveKit's prebuilt `VideoConference`:

- **A shared playhead with latency compensation.** Syncplay's insight (studied,
  not copied — it is GPL): a play command arriving 180ms late lands 180ms behind.
  On top of it, a **clock-offset handshake** over the data channel (two browsers
  do not share a clock, and Syncplay gets this from a central server it has and
  we do not), and **rate nudging instead of seeking** — drift under 250ms is
  closed at 0.97×–1.03× because a few frames a second is imperceptible and a
  seek is not.
- **Annotations that outlive the session** (`review_annotations`, 0080). Frame.io
  has frame-accurate drawing and no conferencing; Evercast has conferencing and
  its annotations die with the call. Drawing pauses the shared playhead, which
  parks the whole room on the frame being discussed, and the mark is stored in
  NORMALISED coordinates at an `anchor_ms` — the same unit as
  `messages.anchor_value->>'ms'` and `meeting_sync_state.position_ms`. One
  representation of a timecode, forever.
- **Recording via Egress straight to R2.** The bytes never pass through this
  application, which is AD-004-R's argument applied to a two-hour dailies
  session.

`MediaEnhancements` adds background blur and Krisp noise suppression as LOCAL
track processors — the raw camera frame never leaves the machine, and both are
dynamically imported because they ship megabytes of WASM.

**Colour: what is built and what is NOT.** Evercast sells on colour-accurate
streaming and closing that properly needs a transcode pipeline this repo does not
have (10-bit HEVC/AV1, calibrated transforms, a job queue). That half is
**outstanding, not faked**. What 0082 + `ColourCheck` do is the half that is real:
the asset DECLARES its colour space, the browser reports what the display can do
(`color-gamut`, `dynamic-range`), and where they disagree the reviewer is warned
BEFORE giving a note. **A note given on a wrongly-displayed image is worse than
no note** — "warmer in the midtones", from an SDR laptop, about a Rec.2020 PQ
master, is an instruction somebody will follow. `ColourCheck` uses
`useSyncExternalStore` rather than an effect, so the warning follows the window
onto a second monitor.

**`AnnotationTimeline` is the notes after the room empties** — every mark on an
asset in timecode order, and clicking one seeks the player AND repaints the
strokes. It renders on the meeting page and beside the approval record, which is
the point: the argument and the decision in one place.

## The release → rights chain (0079) — the hybrid-film join

`rights.talent_consent` used to be a boolean somebody typed. 0079 makes it a
CONSEQUENCE of a signature: a contract carries `release_kind`
(appearance | ai_likeness | location | music), `subject_file_id` and
`ai_training` (CAWG's `allowed | notAllowed | constrained`), and when the last
signer signs, a trigger writes the asset's `rights` row.

**An e-signature product cannot do this** — to DocuSign a talent release is an
opaque PDF, with no concept of an asset, a likeness or a training permission.
**A review tool cannot do it either** — Frame.io will not tell you whether the
face in shot 47 agreed to be modelled. It only works because both halves are the
same system.

Rules that are load-bearing:

- **Only `appearance` and `ai_likeness` may set `talent_consent`.** A location
  agreement carries no person's likeness and must never assert one — that is the
  difference between a record and a rubber stamp, and it has an assertion.
- **A voided or declined release resets consent to false.** A withdrawn release
  is not a quiet one.
- **`ai_training` defaults to `notAllowed`.** A release silent about AI training
  did not grant it. The enum exists precisely because prose is ambiguous.

## Contracts and signatures — what carries enforceability

`lib/contracts.ts` is the one write path; `/api/studio/contracts` drafts, staffs
and sends; `/api/portal/contracts` consents, signs and declines. The signing
record (`contract_events`) is append-only by TRIGGER for everyone including the
service role.

Three things carry ESIGN/UETA and all three are mechanical, not cosmetic:

- **Consent BEFORE signature.** `sign()` refuses without a `consented` event for
  that signer, and the exact wording is stored ON the event — "they consented"
  is worth nothing in a dispute without "to this text". `CONSENT_TEXT` is
  server-owned so the studio and the portal cannot show two different sentences.
- **`content_hash` is taken at SEND and never recomputed.** A hash that moved
  with the document would prove the opposite of what it is for. After send, the
  body is not editable through this module.
- **Identity, not capability.** A client owner holding every portal capability
  still cannot sign for a colleague: the signer row is resolved from
  `auth.uid()` and never from the request body, and
  `contract_signers_self_update` enforces it on the row (assertion 53).

**THE SIGNED ARTIFACT (0079-era, `lib/contractPdf.ts`).** Documenso and DocuSeal
were studied and are **both AGPL-3.0**, so no code from either is here — a
network-served derivative would oblige this product to publish its source. What
was taken is the BAR: they produce a cryptographically signed PDF (PKCS#12,
PAdES), not merely an audit table. The crypto stack here is `@signpdf/*` and
`pdf-lib`, both MIT.

**Built on top of that bar:** the certificate of completion is rendered INTO the
PDF before it is sealed, so the signature covers the evidence as well as the
agreement and the artifact proves itself to anybody holding the file. Documenso
and DocuSeal keep the trail on their own side, which is fine until the day you
need it and the vendor is gone. Without a certificate configured the PDF is still
produced and still carries the certificate page — and `signContractPdf` SAYS it
is unsealed rather than downgrading silently.

**SINGLE-USE SIGNING LINKS (0078)** are built, because in a hybrid production the
most common signature comes from somebody who will never hold an account — a
background actor signing an AI-likeness release. `/sign/<token>` is the only
route with no session; `lib/signingLinks.ts` and `app/api/sign/route.ts` carry
the I-8 justification. Every failure returns one answer so a probe cannot
enumerate, and the request has exactly one degree of freedom: the body carries a
token and nothing else.

**PDF FIELD PLACEMENT IS BUILT.** A contract can point at a PDF already in the
vault (`source_file_id`) rather than a typed body — deliberately NOT a second
upload path, because uploads already have presigning, multipart, scope
resolution and metering, and a contract-only uploader would be a fourth copy of
all of it. `FieldPlacer` drags boxes onto a pdf.js canvas; `FieldFiller` lets a
signer fill only their own; `stampFieldsIntoPdf` burns the values in before the
seal.

Two rules that are not style preferences:
- **Positions are FRACTIONS of the page with a top-left origin.** A field at
  x=0.62 is 62% across on a phone, a 4K monitor and a 595pt A4 page. Pixels
  would be correct exactly once. PDF's own origin is bottom-left, and the flip
  happens in ONE place — `stampFieldsIntoPdf` — not at every call site.
- **Fields are frozen once sent.** Moving one afterwards changes the document
  without changing its hash, which is the single edit a signed record cannot
  survive. `replaceFields` refuses it and the editor is draft-only.

A signature field is a TYPED NAME, and there is no drawing canvas on purpose:
what carries enforceability is intent, consent and association with the record,
none of which is a picture. A squiggle would imply the drawing is the legally
operative part.

## Provenance — the disclosure a studio can be asked for

`asset_provenance` (0001, dormant until 0064) records **accepted** AI
generations. `lib/provenance.ts` is the one write path and
`/api/studio/provenance` the one route, both on the user client.

- **The APPLY is the event, not the generation.** Text a writer read and
  discarded is a draft nobody kept; text inserted into the screenplay is a fact
  about the screenplay. Nothing is written when the assistant answers — a row
  lands in `applyAndRecord` in `PrimeOSAssistant` and nowhere else.
- **Proportion, not presence.** `disclosure()` returns a SHARE, because a model
  that fixed one line and a model that wrote every scene are not the same
  declaration. A boolean would be the wrong answer shaped like the right one.
- **A failed record is never silent** (I-10). The text is already in the
  document, so the writer is told the disclosure did not save. A clean-looking
  script is the dangerous outcome.
- **The vocabulary is C2PA's, verbatim.** Do not invent action names or source
  types; 0064's CHECKs hold the action set and the IPTC namespace.

## Migrations

`supabase/migrations/` holds one numbering scheme (`00NN`); the retired `2026*` scheme is fenced in `_archive/`:

- `0000_baseline_schema.sql` … `0087_share_link_scope.sql` — the current
  source of truth, **all applied** (verified live 2026-09-14).
  **0085–0087 are the screening room** — a cut shown to somebody with no
  account, and a record of what they actually watched. See the section below.
  **0087 corrects 0085 before it had a second row**: 0085's crew policy was
  the Class B shape MINUS its project conjunct, so a contractor scoped to one
  production could list every link the studio had ever minted. Fixed in USING
  **and** WITH CHECK together (0059's rule), and the views are reached THROUGH
  the link (0038's idiom) so they cannot drift apart.
  **0083–0084 are the job queue and the media pipeline** —
  `reference_infra-gaps-jobqueue-transcode` recorded both as missing since the
  first architecture audit, and three loops were open because of it: a recording
  that never became a file, colour metadata nothing could probe, and no
  transcode at all. See the queue section below.
  **0082 closes a real gap and adds the honest half of a hard one.**
  `S3-d` MD-4's external collaborator is a ROSTER-LESS seat — a `room_members`
  row and nothing else — so every meeting policy missed them: the VFX artist in
  a project room could read the conversation about a shot and NOT join the
  review session about it. `meetings_room_member_read` admits them through
  `meetings.room_id`, the column `S3-b` §2.1 had always specified and nobody had
  used. **The seat is the invite**: remove them from the room and they lose the
  meeting in the same instant, one revocation rather than two.
  It also adds `files.colour_space | transfer | bit_depth`, all NULLABLE — see
  the colour note below.
  **0081** lets a client DRAW on their own company's material. 0080 gave them
  SELECT only, which makes a review session half a feature: the client watches
  the studio draw and then describes what they mean in words. INSERT plus a
  narrow UPDATE (`created_by = auth.uid()`) and no DELETE — a retracted note
  leaves a row, because a review where notes vanish without trace is one
  somebody can rewrite afterwards.
  **0080** adds session recording (`meetings.recording_*` — an Egress id and a
  STATUS, because Egress is asynchronous and "processing" is not "ready") and
  `review_annotations`: a mark drawn on a frame during a live review, persisted
  against the asset at a timecode.
  **0076 DROPS bookings** (`bookings`, `booking_types`, `availability_rules`) on
  the owner's decision — all three held zero rows, so nothing was lost. If a
  contended resource ever appears, the part worth bringing back is 0066's
  `EXCLUDE USING gist` constraint, not the UI.
  **0077** adds `meeting_sync_state` — the review session's shared playhead. It
  stores `position_ms` where `S3-b` §2.2 sketched `frame`, deliberately: a frame
  number is not a position without a rate, and 0038 already settled that a
  timecode is `{ms}`. A second representation is how a comment lands on the
  wrong shot.
  **0078** adds `contract_signing_links` — RLS enabled with **no policy at all**,
  because the only legitimate readers are server-side. The token is never
  stored, only its SHA-256.
  **0079 is the join nobody else can make**: a completed release WRITES the
  `rights` row it proves. See below.
  **0075 closes the edge between bookings and the calendar** — `S3-b` §1.1:
  "Bookings produce calendar entries." A confirmed booking projects onto the
  calendar and a cancelled one is REMOVED, because a calendar holding cancelled
  bookings shows time as busy when it is free. `source_kind` gains `'booking'`;
  reusing `'meeting'` would make the two indistinguishable the day meetings get
  their own projection.
  **0074 gives `calendar_entries` its writers**, which 0065 created without.
  Approval-stage deadlines and invoice due dates project onto the calendar
  through TRIGGERS rather than call sites — 0041's precedent, and the reason is
  the same: `lib/approvals.ts` alone sets a deadline in four places, and the
  first one somebody forgets is a deadline that silently never reaches the
  calendar. **A projection is deleted as well as written** (a stage that
  advances, an invoice that is paid), and a UNIQUE index on
  `(source_kind, source_id)` is what stops a re-save adding a duplicate.
  **A projected entry is read-only to people**: `calendar_entry_projection_guard`
  refuses a hand edit or delete when `current_user = 'authenticated'`, which works
  because the projection functions are SECURITY DEFINER and run as the owner.
  **0069–0073 finish the specified engines.** 0069 is `S3-core` migration 9
  (file version stacking — `parent_file_id`, `version_no`, `is_current`, one
  current per stack via a partial unique index on `coalesce(parent_file_id, id)`,
  and a trigger keeping stacks exactly two deep). 0070 is migration 10 (soft
  delete on the remaining six tables). 0071 is migration 11 (the purge, plus the
  7-year ledger guard). 0072 is `S3-b` migration 4 (`calendar_connections`).
  0073 corrects 0070 — see the two rules below, both of which cost a red harness
  to find.
  · **A `FOR ALL` POLICY'S `USING` IS APPLIED TO THE NEW ROW.** So
    `deleted_at is null` in a FOR ALL policy's USING refuses the very UPDATE
    that performs a soft delete. A RESTRICTIVE `FOR SELECT` policy does the same
    thing on PG 17; a PERMISSIVE SELECT policy does not. This is HANDOFF §12
    lesson 11, learned in Batch 26 and contradicted by 0070's own header.
  · **`create policy` with no roles clause is `TO PUBLIC`, not `TO authenticated`.**
    Every policy written in 0063–0072 landed as PUBLIC, which made anonymous
    reads return `401 permission denied for function is_org_member` instead of
    an empty set (anon holds no EXECUTE on the scoping helpers). Harness
    assertion 9 caught it. **Always write `to authenticated`.**
  **0065–0068 are `S3-b` migrations 2, 3, 5 and 6** — the calendar, bookings,
  meetings and the signing record. Migration 4 (`calendar_connections`) is
  deliberately NOT built: it needs a credential-storage decision the spec itself
  says to stop and make. Three things in this group are load-bearing and easy to
  undo by accident:
  · **`bookings.owner_user_id` is stamped by a TRIGGER, never written by the
    app.** It exists because S3-b §1.5's exclusion constraint is specified "per
    owner_user_id" against a table that has no such column (§5.1). Constraining
    per `booking_type_id` instead would let one person be booked twice at once.
    The trigger fires on EVERY insert and update — a narrower `update of
    booking_type_id` form was defeated by probe in one statement.
  · **`contract_events` is append-only by TRIGGER, not by absent policy.** The
    service role bypasses RLS, and this table is the certificate of completion.
    UPDATE and DELETE raise `restrict_violation` for everyone; `occurred_at` is
    stamped over whatever the caller sends, because a client-supplied timestamp
    on a legal record is a backdating facility. Proven against a superuser
    connection.
  · **`btree_gist` lives in the `extensions` schema**, so 0066 sets
    `search_path` explicitly; without it the `uuid` gist opclass does not
    resolve and the error blames the data type.
  **0064 wakes two tables that had been asleep since 0001.** `asset_provenance`
  and `rights` existed with **zero code references anywhere in the repo** and
  zero rows. It aligns them to **C2PA** (the Content Authenticity standard,
  spec 2.4) and the **CAWG `cawg.training-mining` assertion**: `action`
  (`c2pa.placed`/`c2pa.created`), `digital_source_type` (an IPTC
  `digitalsourcetype` URL), `chars`, and `document_id` — because every AI call
  this product makes produces TEXT, so a file-only table would have stayed
  empty. `rights` gains the permission TRIPLE (`data_mining`, `ai_inference`,
  `ai_generative_training`, each `allowed|notAllowed|constrained`), defaulting
  to `notAllowed`: consent is granted, never assumed. Both policies gain project
  scope via `org_document_visible()` (0060) and a new `org_file_visible()`.
  **The CAI SDKs are deliberately NOT a dependency** — they embed manifests into
  binary assets and there is no binary asset to sign; what was adopted is the
  data model, so emitting a real manifest later is serialization, not migration.
  **0061–0063 are the metering half of the S-S surfaces work.** 0061 backfilled
  `usage_events.created_by` — every row that had cost money was unattributed and
  every free row was attributed, which is the inversion of what a cost surface
  needs; 18/18 billed rows recovered from `ref->>'user'`, 0 unresolvable. 0062
  adds `usage_events.project_id` (FK, `on delete set null`) so spend is
  chargeable to a production — **a real column, not a `ref` key, because JSONB
  cannot be indexed, grouped or joined**, which is the same argument 0061 made
  about the actor. 0063 adds `member_budgets` + `org_seat_budgets`: per-person
  and per-seat-class AI spend limits, day/week/month. They are keyed on
  GRANULARITY, not on `period_start` — one row saying "500¢ per week" with the
  window computed at read time, so there is no rollover job that can one day
  fail to run. **Self-read is ungated on purpose** (`user_id = auth.uid()`): a
  refused AI call must be explicable to the person refused. `lib/budgets.ts` is
  the one resolver and the route gate is a single `checkSpendAllowed()`.
  **0060** takes the
  scoping predicate to the three tables that carry no `project_id` of their own —
  `document_versions`, `document_comments`, `storyboard_shots` — through their
  PARENT, via `org_document_visible()` / `org_storyboard_visible()`. A child of an
  UNTAGGED document stays org-visible, exactly as 0059's `project_id is null`
  branch works one level up. **0055–0059 are Batch 26**, completing S-R's four axes: 0055 widens both grant tables' live
  index to `(member_id, capability, mode)` so a grant and a deny can COEXIST
  (S-R-A A-3 — R-3 was unreachable in the schema written for it); 0056
  `organization_members.seat_class` (`staff`/`contractor` — NOT the specs'
  `crew`/`collaborator`, both of which were already taken: `collaborator` is
  S3-d MD-4's roster-less room seat and `crew` is a value of this table's own
  `role`); 0057 `project_role` + `expires_at` on `organization_member_projects`
  as an **ALTER** (the table already existed — S-R-A A-1) plus expiry in
  `org_project_visible()`; 0058 `project_role_baseline()` and `has_cap()`
  unioning it; 0059 the scoping predicate in **USING and WITH CHECK together**
  across eleven policies — INSERT is the one command USING cannot reach, and it
  was open. Earlier verification (2026-09-12; 0048 included —
  the "gated" claim was stale in both this file and HANDOFF §7). 0038–0041 are
  the approvals engine; 0043–0047 + 0049 are S3-d; **0050–0054 are the
  capability layer (S-R)**: the role vocabulary and
  `approval_stages.blocked_on_permission` (0050), the two grant tables +
  `has_cap()` + the 1→1 capability rename (0051), the legacy read aliases in SQL
  (0052), capability predicates on nine tables (0053), and G-1…G-4 as triggers
  (0054). `0000` is a full captured baseline that **drops and recreates** the
  core tables.
- `_archive/20260531_*.sql` … `_archive/20260606_*.sql` (phase1–12 + invoicing) — historical,
  already baked into `0000`, moved to `supabase/migrations/_archive/` (Batch 6.9). Read
  `_archive/README.md` before touching them; nothing in that directory is ever applied.

Lexicographically `0000…` sorts **before** `2026…`, which is why the retired series lives in
`_archive/` (a filename-ordered runner pointed at `migrations/` would have applied it **last**):
`_archive/20260603_phase7.sql:44-52` and `_archive/20260604_phase8.sql:69-75` create policies
that read the role from `user_metadata` first — user-editable — which would reintroduce a
privilege-escalation hole that `0000` was captured specifically to close.
`_archive/20260531_reseed_phases.sql` also deletes and re-seeds every project's phases. Any
future runner must exclude `_archive/` (see `_archive/README.md` rule 2).

There is no migration runner in the repo; migrations are applied by hand, in `00NN` filename
order. Which runner to adopt is owned by S6 (S0 §7); the `2026*` archival question is resolved
(Batch 6.9).

**[VIOLATES S0 I-12 — pending remediation.]** `0000`, `0002`, `0003` and `0004` create
policies without a preceding `drop policy if exists`; `create policy` has no `IF NOT EXISTS`,
so re-running them throws `42710` and aborts the batch. New migrations must guard every
`create policy` with a `drop policy if exists`, and must be forward-only.

## Required env vars

Loaded from `.env.local` (gitignored). Names only — never write a value into this repo.

**Required for the app to boot / core paths to work**

- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`
- Cloudflare R2: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
- App: `NEXT_PUBLIC_APP_URL` — **read it only through `lib/appOrigin.ts`.**
  `appOrigin()` / `appUrl()` throw when it is unset or carries no scheme;
  `appOriginOrNull()` exists for the single caller (push deep links) where an
  origin-relative URL is genuinely correct. Reading `process.env` directly is
  an ESLint error. See the standing rule below.

`lib/supabase/admin.ts:5` and `lib/r2.ts:16` construct their clients at **module scope** from
these vars. **[VIOLATES S0 I-11 — pending remediation.]** `lib/stripe.ts` shows the correct
lazy-accessor pattern; use that for anything new.

**Feature-scoped — the feature degrades or no-ops without them**

- Email (Resend): `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL` — both required or
  `lib/notify.ts:131-134` returns silently.
- Web Push (VAPID): `VAPID_PUBLIC_KEY` (or `NEXT_PUBLIC_VAPID_PUBLIC_KEY`),
  `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; the browser needs
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (`lib/pushClient.ts:7`).
- SMS (Twilio): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`.
- Stripe (credit top-ups only): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- AI providers (`app/api/studio/muse/route.ts`): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
  `GEMINI_API_KEY` (or `GOOGLE_API_KEY`). Server-side and company-owned — never per-user.
- Cron auth: `CRON_SECRET`. **[VIOLATES S0 I-8 / fails open — pending remediation.]**
  `app/api/cron/message-nudge/route.ts:74-80` only checks the bearer token *if* the variable is
  set; with it unset the `GET` endpoint is unauthenticated.
- Vault quota display: `NEXT_PUBLIC_STORAGE_QUOTA_GB`.

`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` appears in `.env.example` and the local env files but is
**not referenced anywhere in the code**.

`vercel.json` schedules one cron: `GET /api/cron/message-nudge` daily at 09:00.

## Capabilities — one vocabulary, and where each half lives

`lib/capabilities.ts` is the only place a capability or a role is DECLARED. If you find
yourself writing a role list or a cap list anywhere else, you are creating the fifth copy:
this batch deleted four (two `OrgRole` types that disagreed on their value count, two
`OrgCap` types, and three untyped `const CAPS = [...]` write allowlists that tsc could not
see go stale).

| Question | Answer lives in |
|---|---|
| what capabilities exist, what each role holds | `lib/capabilities.ts` (generates the SQL) |
| does THIS caller hold one | `lib/capabilities.server.ts` — `can()` / `capGate()` |
| does a POLICY permit this row | `public.has_cap('coarse.cap')` (0051/0052) |
| may this grant be made at all | 0054's G-1…G-4 triggers, not a route |
| who granted what, when, until when | `org_member_cap_grants` / `client_member_cap_grants` |
| what a person may SEE | `lib/permissions.ts` — a consumer now, not a source |

Two rules that are not style preferences:

- **A route returns the message; the row is the control.** Routes assert with `capGate()` and
  return a 403 naming the required capability, because a silent empty set leaves the caller
  unable to tell "nothing here" from "not allowed". But the policy and the trigger are what
  actually stop a direct PostgREST write.
- **Grants are written on the USER client.** `lib/grants.ts` says so at the top. The
  delegation triggers read `auth.uid()`, so a service-role write disables every one of them
  while looking identical at the call site.

## The application's own origin — one accessor, no literals

**S0-B PI-3/§5.** Four domains are planned (`genreline.com` today, plus
`.studio`, `.io`, `.ai`), so the hostname is configuration. There is exactly
one place that reads it, `lib/appOrigin.ts`, and `no-restricted-syntax` makes
reading `process.env.NEXT_PUBLIC_APP_URL` anywhere else an error.

Why a ban rather than a convention: the failure is silent. Six invite routes
wrote `` `${process.env.NEXT_PUBLIC_APP_URL}/set-password` ``, which with the
variable unset interpolates to the string `undefined/set-password` and ships
it to Supabase as a redirect target. The invite sends, the email arrives, and
the link is dead — visible only to the person who cannot use it.

- Absolute link that must work → `appUrl('/path')` or `appOrigin()`. Both throw.
- Never a second source. `req.nextUrl.origin` is the *deployment* URL on
  Vercel, so a preview or an alias silently produces a different host.
- **The half that is not in code:** Supabase Auth holds its own Site URL and
  Redirect URL allowlist as project configuration. Changing domain without
  updating them breaks every invite and reset link, silently, for everyone.
  No migration or build can catch it — it is a deploy-time checklist item.

## Email — one system, one sender, one layout

**Nothing uses Supabase's mailer.** As of Batch 10.3 there are zero callers of
`inviteUserByEmail` and `resetPasswordForEmail`. The reason is structural: Supabase Auth's
templates are **global per project**, so a message sent through that mailer can never carry
the sending studio's name — not with better copy, not with more configuration. Invites and
resets are minted with `auth.admin.generateLink()` and delivered by the application.

Keep Supabase SMTP pointed at Resend anyway, so a misconfiguration produces a plain email
rather than silence.

The four modules, in the order a message passes through them:

| Module | Job |
|---|---|
| `lib/tenantBrand.ts` | who the tenant is — name, logo, Reply-To, attribution flag |
| `lib/mailSender.ts` | `senderForTenant()` / `senderForProduct()` → the `From` header |
| `lib/email/messages.ts` | the catalogue — invite (×3 audiences), reset, notification, product |
| `lib/email/layout.ts` | the one HTML layout, rendered per tenant |
| `lib/email/send.ts` | **the only place a message reaches Resend** |

**Rules that are not style preferences:**

- **Two voices** (S-C CM-1). `voice: 'tenant'` is the studio speaking to its clients and
  crew. `voice: 'product'` is Genreline speaking to the studio it sells to. A studio's
  clients must never receive mail branded Genreline — that is S0-B §2's trap one layer out.
- **The sender is resolved, never configured** (CM-3). `NOTIFY_FROM_EMAIL` supplies the
  *address*; the display name comes from the tenant. Do not put an identity in an env var.
- **Reply-To is omitted when absent, never sent empty** — `business_settings.business_email`
  is `''` for the house org today.
- **Escape everything.** The studio's name, project titles and message previews all reach
  these templates and all three are user-supplied. `esc()` in `layout.ts`.
- **Tables and inline styles, deliberately.** Outlook renders with Word's engine; flexbox,
  grid and `<style>` blocks are unreliable. The file will look like 2005 HTML forever.
- **`generateLink()` changed a failure mode.** The auth user is created *before* the send,
  so a delivery failure leaves a correct account and roster row with an undelivered
  message. `sendTenantInvite` returns `delivered` rather than throwing — do not tear down
  an account over a failed send; `resend-invite` is the recovery path.
- **An existing auth account is not a duplicate.** `generateLink` type `invite` returns
  422 `email_exists` for a **confirmed** account and 200 for an unconfirmed one, so
  `sendTenantInvite` falls back to a `recovery` link. A deleted company keeps its auth user
  (AD-003), and S1 §2 allows a person in both trees — the in-tenant check against `clients`
  / the rosters is what refuses a real duplicate, never the auth layer.
- **Never set a password on an existing account from an admin path.** `updateUserById` there
  is account takeover: an admin could claim another studio's client by "creating a client"
  at that address. Send them to the invite flow, which mints a link only the mailbox owner
  can open.
- **SMS brands in the body**, and has to: the US and Canada do not allow alphanumeric
  sender IDs, so the number cannot say who is writing.

Templates exist only for flows that exist. There is no signup, email-change or phone-change
flow in this app — do not add templates for them before the flows. Phone verification is
SMS OTP through Supabase→Twilio, has no `generateLink` type, and is not part of this system.

## Error handling

There is no error sink — no Sentry, no logging service. Failures surface as `console.error`
or are swallowed. 78 `catch` blocks discard the error entirely.
**[VIOLATES S0 I-10 — pending remediation.]** New code must let errors reach a caller that can
act on them; do not add another silent `catch {}`.

## Assets & branding

- `public/mcprime-logo.jpg` — one tenant's brand lockup (McPrime Digital),
  rendered via `components/McPrimeLogo.tsx`. **This entry previously said "admin
  chrome" was a legitimate place for it. That is no longer true** — Batch 9.4
  moved the admin sidebar onto `TenantLogo`, so the only remaining callers are
  the three pre-auth pages. Never use it for a client's company logo (the
  client sidebar shows the client's uploaded avatar, falling back to their
  initial), and never for a studio's.
- **Remediated in Batch 9.** McPrime's identity was hardcoded on 69 lines across
  34 files. **Zero remain in rendered code** — every surviving mention is an
  explanatory comment, plus five dead `mcprime-*` Tailwind aliases with no
  usages (`tailwind.config.ts:59-63`, C-6).
  **Do not add new hardcoded tenant strings, and never "fix" a client-facing
  one by substituting Genreline** — S0-B §2 calls that swapping one wrong name
  for another. Resolve tenant identity through `lib/tenantBrand.ts`
  (`tenantBrand(orgId)` / `tenantBrandForClient(clientId)`), which returns the
  name, the logo and the PI-4 attribution flag from one read. It degrades to a
  neutral stand-in, never to a specific studio.
- **Three marks, three jobs.** `components/TenantLogo.tsx` — the studio's own
  logo, for client-facing surfaces; falls back to their initial, never to a
  brand asset. `components/ProductMark.tsx` — Genreline's mark, for the studio
  shell and the pre-auth pages, which have no tenant to resolve.
  The client's own avatar stays the portal sidebar's identity.
  `components/McPrimeLogo.tsx` and `public/mcprime-logo.jpg` are both
  **deleted** — a live read confirmed nothing referenced the path, and it was
  being served publicly at `<origin>/mcprime-logo.jpg` to every tenant.
- **The studio's logo has a writer now** (Batch 10.1):
  `POST/DELETE /api/studio/organization/logo`, surfaced in Settings → Business
  Profile. `organizations.logo_url` had existed since migration 0001 with
  nothing writing it, which is why every row was null. That route also shows
  the shape a NEW surface should take: the `organizations` row is written with
  the **user client** so RLS is the tenant boundary, and the service role
  touches **storage only** — the one reason it is on the I-8 allowlist.
- **The pre-auth pages are deliberately tenant-neutral** (`/login`,
  `/reset-password`, `/set-password`). They run before a session exists, so no
  membership, claim or company row is available to resolve a studio from.
  Do not add a tenant name, logo or copyright line to them.

## Working rules

- Verify claims against the code before writing them down — this file was previously wrong
  about Stripe, shadcn/ui, React Hook Form + Zod, `/auth/callback`, the admin route group,
  the proxy's redirect targets, and its own route-handler count.
- **A commit message is a claim, and the next document inherits it.** Batch 10.3's message
  said `lib/email/send.ts` was "extracted from `notify.ts`". It was not — two send paths ran
  for two commits, and only one reported failures. Before quoting a previous batch, run the
  grep that would falsify it (HANDOFF §12.4).
- Cite `path:line` when reporting a finding.
- Do not paper over an RLS or authorization failure by switching to `supabaseAdmin`.
- Remediation of anything marked **[VIOLATES S0]** above is sequenced in S6. Report it; do not
  fix it as a side effect of unrelated work.
