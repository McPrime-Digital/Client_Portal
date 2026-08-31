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
| 7 | `S1-tenancy-and-entitlement.md` | Tenancy model; resolves T-1 … T-5 |
| 8 | `S2-authorization.md` | Layered authorization; the RLS migration order |
| 9 | `S-C-communications.md` | **DRAFT** — sender identity across email/SMS/push |

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
- **`react-hook-form` / `@hookform/resolvers`** are in `package.json` with **zero imports**
  anywhere in `app/`, `lib/`, `components/`, `hooks/`. Forms are `useState` + hand-rolled
  validation. **`zod` is now used, but at exactly one site** —
  `app/api/activity/route.ts:1` (Batch 6.1, so the activity ledger stops accepting forged
  entries). **[VIOLATES S0 I-7 — one of 41 route handlers validates against a schema; the
  other 40 do not.]**
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

**One** route handler constructs its own service-role client inline rather than importing
`supabaseAdmin`: `app/api/admin/create-client/route.ts:48`. There were two until Batch
10.3 rewrote `resend-invite` onto the shared client — the first time the I-8 ratchet has
shrunk. An inline client imports nothing, so the import rule cannot see it; the
`SUPABASE_SERVICE_ROLE_KEY` selector in `eslint.config.mjs` is what catches it.

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
  updates rather than erroring. `supabase/migrations/_archive/20260603_phase7.sql` exists
  solely because of this (moved to `_archive/` in Batch 6.9 — see "Migrations" below; it is
  historical and never re-applied).
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
- `app/studio/` — the Throughline studio shell (admin-only; `app/studio/layout.tsx` enforces
  `isAdmin`). Three spaces — Crew / Client / Workspace — declared in `lib/studio/spaces.ts`.
  Features without an implementation render a "Phase N · coming soon" card
  (`app/studio/[space]/[feature]/page.tsx:40-66`). Whether stubs stay advertised is owned by S4.
- `app/api/` — **42** route handlers (files, portal, admin, studio, cron, presence, push,
  Stripe webhook, and since Batch 10: `studio/organization/logo`, `auth/password-reset`).
  This entry read 41 before Batch 10 added two, so it was already off by one — count it,
  don't quote it.
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
