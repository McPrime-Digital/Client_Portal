# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## Governing documents

**Read `HANDOFF.md` (repo root) first.** It is the verified project state —
what is built, what is open (file:line), what to do next — compiled from the
code and the live database, not from memory. The spec stack below is the
*reasoning*; HANDOFF is the *state*.

**`docs/specs/` is the authoritative spec stack for this project.** Six documents, in
reading order:

| # | Document | Purpose |
|---|---|---|
| 1 | `S0-decisions-and-constraints.md` | Settled decisions and invariants |
| 2 | `S0-A-amendments.md` | **Supersedes named S0 entries** (AD-004, AD-002, AD-001 rationale) |
| 3 | `S0-conformance.md` | Where the code violates S0; input to sequencing |
| 4 | `S1-P-personas-and-segments.md` | Who signs up, and what each needs |
| 5 | `S-V-film-os.md` | Full platform architecture + the v1 cap |
| 6 | `S1-tenancy-and-entitlement.md` | Tenancy model; resolves T-1 … T-5 |

**Where S0 and S0-A disagree, S0-A wins.** S0 entries were not edited in place — the original
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
- **`react-hook-form` / `@hookform/resolvers` / `zod`** are in `package.json` but have **zero
  imports** anywhere in `app/`, `lib/`, `components/`, `hooks/`. Forms are `useState` +
  hand-rolled validation. **[VIOLATES S0 I-7 — no API boundary validates against a schema.]**
- **`resend`** is a dependency but never imported. Email goes out as a raw `fetch` to
  `https://api.resend.com/emails` (`lib/notify.ts:136`).
- **Stripe is not used for invoicing.** The Stripe SDK is used only for the AI-credit top-up
  flow: `app/api/studio/credits/checkout/route.ts` and `app/api/webhooks/stripe/route.ts`.
  Invoices are bank/wire transfer (`invoices.payment_method` defaults to `'bank_transfer'`;
  bank details live on `business_settings`). `invoices.stripe_payment_url` is a Stripe Payment
  Link an admin pastes in by hand — no API call is made.
- No AI vendor SDK is installed; every model call is a raw `fetch`
  (`app/api/studio/muse/route.ts`).

Note: dynamic-route `params` and `next/headers` `cookies()` are async (Promises) — always
`await` them.

## Commands

- `npm run dev` — Next.js dev server on :3000
- `npm run build` — production build
- `npm run lint` — ESLint flat config (`eslint.config.mjs`, extends `eslint-config-next`
  core-web-vitals + typescript)

There is no test framework configured — no test script, no runner, no test files. Do not
invent one or claim tests passed. (S0 AD-001 makes an RLS test harness a prerequisite for the
authorization migration; it does not exist yet.)

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

Two route handlers additionally construct their own service-role client inline rather than
importing `supabaseAdmin`: `app/api/admin/create-client/route.ts:28` and
`app/api/admin/resend-invite/route.ts:36`.

## Authorization — how it actually works today

**[VIOLATES S0 AD-001 and I-8 — pending remediation.]** S0 decides that RLS owns tenancy and
service-role access is an enumerated allowlist. Today the opposite is true:

- **The application reads and writes almost everything with `supabaseAdmin`.** 65 modules
  import it, including page-level Server Components on user-session paths
  (`app/(portal)/layout.tsx`, `app/(portal)/dashboard/page.tsx`, `app/studio/layout.tsx`, …)
  and 33 of the 41 route handlers. There is no allowlist and no lint rule.
- **RLS is enabled on every table**, and the policies are real — but for the app's own reads
  they are mostly bypassed. What RLS *is* load-bearing for is **Realtime**: browser
  subscriptions authenticate as the user, so a missing SELECT policy silently kills live
  updates rather than erroring. `supabase/migrations/20260603_phase7.sql` exists solely
  because of this.
- **Role and identity come from `app_metadata`, never `user_metadata`.** `lib/auth/role.ts`
  is the single trust anchor (`userRole`, `isAdmin`, `userClientId`, `userOrgId`).
  `user_metadata` is user-editable via `supabase.auth.updateUser({ data })` — trusting it is
  privilege escalation. `public.is_admin()` (migration `0000`) reads `app_metadata` only.
- **Capabilities** are a TypeScript matrix in `lib/permissions.ts` (client-side roles
  owner/approver/member/viewer; org-side owner/admin/producer/finance/editor/member, plus
  per-member `extra_caps`). `lib/team.ts` resolves membership server-side from the tables —
  the table is truth, the JWT only routes.

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
- `app/(admin)/` — **dead code.** The layout does enforce `role === 'admin'`
  (`app/(admin)/admin/layout.tsx:20-21`), but the proxy redirects every `/admin` URL to
  `/studio` first, so none of these 17 pages is reachable. Whether to delete or retain the
  group is an open question owned by S4 (S0 §7). Do not build on it.
- `app/studio/` — the Throughline studio shell (admin-only; `app/studio/layout.tsx` enforces
  `isAdmin`). Three spaces — Crew / Client / Workspace — declared in `lib/studio/spaces.ts`.
  Features without an implementation render a "Phase N · coming soon" card
  (`app/studio/[space]/[feature]/page.tsx:40-66`). Whether stubs stay advertised is owned by S4.
- `app/api/` — 41 route handlers (files, portal, admin, studio, cron, presence, push,
  Stripe webhook).
- `app/auth/callback/route.ts` — **implemented, not reserved.** It handles the PKCE
  `exchangeCodeForSession` flow and the `token_hash`/`verifyOtp` magic-link/invite flow, and
  marks clients onboarded. Its admin success path still redirects to `/admin/dashboard`
  (line 86), which the proxy then bounces to `/studio/client/overview` — stale but not broken.

## Uploads — direct-to-R2 (presigned)

All file and chat-attachment uploads go **straight from the browser to Cloudflare R2** via a
presigned PUT URL — the bytes never pass through a serverless function, so there is no
request-body size limit (this is what makes uploads work on Vercel, which hard-caps function
bodies at ~4.5MB).

Flow (`lib/uploadClient.ts` → two route handlers):
1. `POST /api/files/presign` — auth + authorize for the project, mint a collision-safe key
   `<clientId>/<projectId>/<rand>` and return a presigned PUT URL. The key is always
   server-generated; scope resolution is shared with commit via `lib/uploadScope.ts`.
2. Browser `PUT`s the file to R2 (Content-Type must match what was presigned).
3. `POST /api/files/commit` — re-authorize, verify the key prefix, insert the `files` row with
   `bucket: 'r2'`, and meter `storage.bytes`.

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

## Migrations

`supabase/migrations/` holds one numbering scheme (`00NN`); the retired `2026*` scheme is fenced in `_archive/`:

- `0000_baseline_schema.sql` … `0023_overdue_predicate.sql` — the current source of truth.
  `0000` is a full captured baseline that **drops and recreates** the core tables.
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
- App: `NEXT_PUBLIC_APP_URL`

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

## Error handling

There is no error sink — no Sentry, no logging service. Failures surface as `console.error`
or are swallowed. 78 `catch` blocks discard the error entirely.
**[VIOLATES S0 I-10 — pending remediation.]** New code must let errors reach a caller that can
act on them; do not add another silent `catch {}`.

## Assets & branding

- `public/mcprime-logo.jpg` — the McPrime Digital brand lockup, rendered via
  `components/McPrimeLogo.tsx`. Use it only for McPrime's own branding (auth screens, admin
  chrome) — never for a client's company logo (the client sidebar shows the client's uploaded
  avatar, falling back to their initial).
- **[VIOLATES S0 P-1 — pending remediation.]** McPrime's identity is hardcoded on 69 lines
  across 34 files — UI copy, notification sender names, activity-log actor names, the `MPD-`
  invoice number prefix, the push service worker, and the package name. S0 P-1 says McPrime is tenant
  zero, not the product, and treats hardcoded identity as a defect. **Do not add new hardcoded
  McPrime strings** — read the display name from `business_settings.business_name` /
  `organizations.name` the way `app/(portal)/layout.tsx:97-102` does, or pass it in.

## Working rules

- Verify claims against the code before writing them down — this file was previously wrong
  about Stripe, shadcn/ui, React Hook Form + Zod, `/auth/callback`, the admin route group and
  the proxy's redirect targets.
- Cite `path:line` when reporting a finding.
- Do not paper over an RLS or authorization failure by switching to `supabaseAdmin`.
- Remediation of anything marked **[VIOLATES S0]** above is sequenced in S6. Report it; do not
  fix it as a side effect of unrelated work.
