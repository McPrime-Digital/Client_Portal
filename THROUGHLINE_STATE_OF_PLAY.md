# Throughline — State of Play

**Audit date:** 2026-08-25
**Repo:** `/Users/mcnortons/McPrime_ClientsPortal`
**Branch audited:** `throughline` @ `a7d207e` (identical to `main`, working tree clean)
**Scale:** 92 commits · 39,610 lines TypeScript/TSX · 1,673 lines SQL · 31 migrations · 26 tables · 41 route handlers

**Evidence tags used throughout:**
`[VERIFIED]` = read directly in this repo during this audit, with a path/line cited.
`[INFERRED]` = reasoned from stated evidence; the evidence is named.
`[UNKNOWN]` = cannot be determined from the repository.

---

## 1. ONE-PARAGRAPH SUMMARY

Throughline is a web application that began as **McPrime Digital's single-tenant client portal** — a place for a small video/creative agency to give clients projects, files, messages, approvals and invoices — and is mid-pivot into a **multi-tenant "studio OS" for AI-native film and media production**. `[VERIFIED — docs/throughline-master-plan.md:1-7: "A creative production & automation workspace ('studio OS')… Pivoted from the McPrime single-tenant client portal"]` The audience is two-sided: an internal **Crew** working in a studio shell at `/studio`, and external **Clients** in a separate portal at `/dashboard`. `[VERIFIED — lib/studio/spaces.ts:19-78; proxy.ts:47-56]` The problem it solves *today* is agency↔client coordination: brief, deliver, review, approve, get paid. The problem it *intends* to solve is the whole AI filmmaking pipeline — script, storyboard, generation, finishing, provenance — on one canvas. `[VERIFIED — docs/throughline-architecture-wiring.md:9-11]` The repo contains no customer-facing description, landing page, or pitch: `app/page.tsx` is a seven-line redirect to `/login` whose own comment says "Root has no landing content yet." `[VERIFIED]` The honest version: **the client-portal half is finished, production-grade software; the Throughline half is a well-designed shell around mostly-empty rooms; and the authorization model that keeps tenants apart lives in application code rather than in the database.**

---

## 2. ORIGIN & HISTORY

All dates from `git log --date=short`. `[VERIFIED]`

### Timeline

| Date | Commits | What happened |
|---|---|---|
| 2026-05-01 | 1 | `fd3248c` "Initial commit from Create Next App" — bare scaffold, then nothing for a month. |
| 2026-05-30 | 4 | `5394dd9` "Build out McPrime Digital client portal (admin + client) for deploy" — **131 files, 32,697 insertions in one commit.** The entire portal arrives at once. Three same-day fixes to invite links and password-setting follow. |
| 2026-05-31 | 6 | Feature waves labelled "Phase 4", then "Phase A/B/C/D": invoicing, task processes, File Vault taxonomy, deadline alerts. |
| 2026-06-02 → 06-05 | 6 | Realtime messaging, presence, in-app file viewer, multi-channel alerts. Ends with `f782197` "Security: source role/client_id from app_metadata, not user_metadata". |
| **2026-06-06** | **53** | **The pivot day.** `7e7cef9` "Throughline Phase 0: multi-tenancy, 3-space studio shell, page-in-view, cost/provenance substrates" introduces the name, both planning docs, and migrations 0001–0003. The other 52 commits are an all-day sprint on Script Design and PrimeOS. |
| 2026-06-07 | 4 | Last Script Design / PrimeOS commits. |
| **2026-06-08 → 2026-08-23** | **0** | **A 78-day gap with no commits at all.** |
| 2026-08-24 | 7 | Work resumes with the production cutover: `032ffbf` server-only guards, `fe5a8c5` lazy Stripe client, `4dc7f53` "Throughline is the admin front door", `970804a` "Client space move-in". |
| 2026-08-25 | 11 | Teams, roles, member lifecycle, custom access. Ends at `a7d207e`. |

### Original intent and how it changed

The first real commit message states it: *"Build out McPrime Digital client portal (admin + client) for deploy."* `[VERIFIED — 5394dd9]` It was a bespoke tool for one agency. `package.json:2` is still `mcprime-clients-portal` and `app/layout.tsx:22` still sets `title: 'McPrime Digital — Client Portal'`. `[VERIFIED]`

The pivot is dated precisely to 2026-06-06 by `7e7cef9`, which added both planning documents in the same commit that began implementing them. `[VERIFIED — git log --diff-filter=A]` Notably `docs/throughline-master-plan.md:6` says *"**Status:** planning. No build started."* — already false at commit time, since that commit shipped migrations 0001–0003 and the studio shell. **The master plan has never been revised since.** `[VERIFIED — it appears once in `--diff-filter=A` and no later commit touches it]`

### Pivots, rewrites and abandoned directions

1. **Server-buffered uploads → direct-to-R2.** `fcb85b6` deleted `app/api/admin/upload/route.ts`, `app/api/files/upload/route.ts` and `app/api/portal/upload/route.ts`. `[VERIFIED — git log --diff-filter=D]`

2. **Server-side ffmpeg transcoding — abandoned.** The same commit deleted `lib/transcode.ts`, 112 lines shelling out to `ffmpeg-static` to convert Chrome's `audio/webm` voice notes to `.m4a` because "Safari can't play [webm] at all". `[VERIFIED — git show fcb85b6^:lib/transcode.ts]` Replaced by client-side MIME negotiation preferring `audio/mp4`. `[VERIFIED — components/shared/VoiceRecorder.tsx:70-75]` `ffmpeg-static` is gone from `package.json`.

3. **"Muse" → "PrimeOS".** `ca8bac7` "Rename Muse → PrimeOS AI everywhere". The rename never reached the API route, still `app/api/studio/muse/route.ts`. `[VERIFIED]`

4. **Editor rewrites.** `components/studio/CollabEditor.tsx` deleted in `7f8c2d1`; `lib/studio/pagination.ts` deleted in `b7da827` and later reintroduced. `[VERIFIED]` Six consecutive commits on 2026-06-06 are variants of "Script Design: pagination that actually works" — a legible record of a hard problem solved by repeated attempts.

5. **`/admin` chrome retired.** `4dc7f53` made `/studio` the admin front door; `970804a` moved the legacy admin pages under `/studio/client/*`. `/admin` is now a pure redirect table. `[VERIFIED — proxy.ts:62-79]`

6. **Renamed concepts.** "Deliverables" → "Files Vault" (`spaces.ts:45`); "Clients" → "Companies" (`spaces.ts:42`); "Muse" → "PrimeOS"; McPrime Portal → Throughline.

### Branches

`main` and `throughline` both point at `a7d207e` and match their remotes. **No stale, unmerged or divergent branches.** Working tree clean. `[VERIFIED — git branch -a -vv; git status]`

---

## 3. TECH STACK & ARCHITECTURE

### Languages and framework

- **TypeScript 5**, `strict: true` `[VERIFIED — tsconfig.json]`, target ES2017, `moduleResolution: bundler`, alias `@/*` → `./*`.
- **Next.js 16.2.6**, App Router, RSC by default. `[VERIFIED — package.json:25]`
- **React 19**. `[VERIFIED]`
- Node version **unpinned** — no `engines`, no `.nvmrc`. `[VERIFIED]`

### Major dependencies (exact versions)

| Package | Version | Used for |
|---|---|---|
| `next` | 16.2.6 | Framework |
| `react` / `react-dom` | ^19 | UI |
| `@supabase/supabase-js` | ^2.105.1 | Postgres, Auth, Realtime, Storage |
| `@supabase/ssr` | ^0.10.2 | Cookie-bound clients |
| `@aws-sdk/client-s3` | ^3.1054.0 | Cloudflare R2 |
| `@aws-sdk/s3-request-presigner` | ^3.1054.0 | Presigned PUT/GET |
| `stripe` | ^22.1.0 | Credit top-up checkout + webhook only |
| `resend` | ^6.12.2 | **Installed, never imported** |
| `web-push` | ^3.6.7 | VAPID push |
| `@blocknote/core` / `-react` / `-mantine` | ^0.51.4 | Script Design editor |
| `yjs` / `y-protocols` | ^13.6.31 / ^1.0.7 | CRDT collaboration |
| `zustand` | ^5.0.12 | Client state (4 stores) |
| `radix-ui` | ^1.4.3 | Behind shadcn (unused) |
| `lucide-react` | ^1.14.0 | Icons |
| `next-themes` | ^0.4.6 | Light/dark |
| `sonner` | ^2.0.7 | Toasts — **mounted, never called** |
| `zod` | ^4.4.1 | **Zero imports** |
| `react-hook-form` / `@hookform/resolvers` | ^7.74.0 / ^5.2.2 | **Zero imports** |
| `mammoth` / `xlsx` / `fflate` | ^1.12.0 / CDN tarball / ^0.8.3 | .docx / .xlsx / .zip preview |
| `tailwindcss` (dev) | ^3.4.1 | Styling — v3, not v4 |
| `shadcn` | ^4.6.0 | A CLI, in `dependencies` |

`[VERIFIED — package.json read in full]`

**Imported but NOT declared in `package.json`:** `@tiptap/pm/state` and `@tiptap/pm/view` (`lib/studio/pagination.ts:17-18`, `lib/studio/suggesting.ts:1`) and `y-prosemirror` (`lib/studio/suggesting.ts:2`). `grep -c "tiptap\|y-prosemirror" package.json` returns **0**. `[VERIFIED]` They resolve only as hoisted transitive dependencies of `@blocknote/*`. See §9.

**No AI vendor SDK is installed** — no `@anthropic-ai/sdk`, no `openai`, no Google SDK. Every model call is a raw `fetch`. **No LiveKit, no React Flow, no job-queue library, no Sentry, no analytics.** `[VERIFIED]`

### Services

| Service | Status | Where |
|---|---|---|
| **Supabase** | Core, complete | `lib/supabase/{server,client,admin}.ts` |
| **Cloudflare R2** | Core, complete | `lib/r2.ts` (221 L) |
| **Stripe** | Credit top-up only | `lib/stripe.ts`, `app/api/studio/credits/checkout/route.ts`, `app/api/webhooks/stripe/route.ts` |
| **Resend** | Works via raw `fetch`; SDK unused | `lib/notify.ts` |
| **Twilio** | Code complete, raw REST, **no credentials in any env file** | `lib/sms.ts` (27 L) |
| **Web Push / VAPID** | Complete | `lib/push.ts`, `lib/pushClient.ts`, `public/sw.js` |
| **Anthropic / OpenAI / Gemini** | 3 providers, SSE streaming | `app/api/studio/muse/route.ts` — the only AI route |
| **picsum.photos** | Third-party placeholder art in product chrome | `components/studio/ScriptHome.tsx:100` |

`[VERIFIED]`

### Auth model

Identity is a Supabase Auth user. Authorization reads **`app_metadata`**, never `user_metadata`, because only the service-role key can write it — `lib/auth/role.ts:1-8` documents this as a privilege-escalation fix. `[VERIFIED]` The role vocabulary is binary: `type Role = 'admin' | 'client'`, defaulting to `'client'`. `[VERIFIED — lib/auth/role.ts:18,25-27]`

On top, **the tables are the real source of truth** for fine-grained permissions — `lib/team.ts:7-9`: "THE TABLE IS TRUTH: every gate that protects an action reads these, never the JWT." `[VERIFIED]` Two membership tables carry roles, multi-roles, custom grants and custom titles.

### Request flow, end to end

1. **Edge.** Every request matching the matcher (all but `_next/static`, `_next/image`, `favicon.ico`, image extensions) hits `proxy()`. `[VERIFIED — proxy.ts:126-130]` It builds a cookie-bound Supabase client, calls `getUser()` (refreshing the session and writing cookies onto the response), then applies rules in order: public routes pass; **any `/admin/*` path is rewritten to its `/studio/*` equivalent and redirected**; unauthenticated → `/login`; admins on portal routes → `/studio`; non-admins on `/admin` or `/studio` → `/dashboard`; logged-in on `/login` → role home. `[VERIFIED — proxy.ts:29-125]` Note this runs on **every** `/api/*` request too, including the Stripe webhook and cron — a `getUser()` network round-trip per webhook.

2. **Layout gate.** `app/studio/layout.tsx` calls `getUser()`, redirects non-admins, **flips an invited crew member's membership to `active` before resolving their role**, renders a hold screen for `paused` members, then resolves `orgAccessOf(user)`. `[VERIFIED — app/studio/layout.tsx:16-90]` `app/(portal)/layout.tsx` does the analogous work — but via `getSession()`, not `getUser()` (§9).

3. **Page.** Server Components fetch data. **Almost all reads go through `supabaseAdmin` (service role) with explicit JavaScript-side scoping, not RLS.** `app/(portal)/dashboard/page.tsx:125-127` states the policy: *"Service role + explicit ownership scoping … mirrors the projects/messages/files pages, which don't depend on RLS for reads."* `[VERIFIED]` **68 modules import `lib/supabase/admin`.** `[VERIFIED]`

4. **Feature gate.** Studio feature routes call `requireOrgFeature(spaceId, slug)`, which resolves org roles + grants and redirects to `/studio` on denial. `[VERIFIED — lib/studio/guard.ts:10-18]`

5. **Mutations.** No Server Actions for data mutation; everything is a Route Handler that re-authenticates, re-authorizes, and writes via `supabaseAdmin`. `[INFERRED — 41 handlers carry all writes; no `'use server'` mutation modules found]`

6. **Uploads** bypass the server: `POST /api/files/presign` mints a server-generated R2 key `<clientId>/<projectId>/<rand>` and a presigned PUT; the browser PUTs directly to R2; `POST /api/files/commit` re-authorizes, verifies the key prefix, inserts the `files` row. `[VERIFIED]`

7. **Realtime** carries three transports at once: `postgres_changes` (badges, project tabs, bell), **broadcast** (`thread:<projectId>` hubs, Yjs doc sync), and **presence** (`presence:app`). `[VERIFIED]`

8. **The exception to (3):** `components/studio/*` uses the **browser** Supabase client and therefore hits RLS for real — `ScriptHome.tsx:280,292,321,338,344`, `ScriptEditorView.tsx:111,121,140,280`, `DocEditor.tsx:368,659,675`, `DocComments.tsx:93,123,136,141`, `StoryboardHome.tsx:31,46`, `StoryboardBoard.tsx:34,48,87,99,106,122`. `[VERIFIED]` This matters — see §9 item 4.

9. **Background.** One Vercel cron: `GET /api/cron/message-nudge` daily at 09:00 UTC. `[VERIFIED — vercel.json]` No job queue, no worker.

### Directory map

```
/
├── app/                          102 files, 9,726 lines — routes and route handlers
│   ├── (auth)/                   public: /login, /reset-password, /set-password
│   ├── (portal)/                 CLIENT app: /dashboard /projects /approvals /files
│   │                             /messages /invoices /team. The mature half.
│   ├── (admin)/                  LEGACY admin. NO URL REACHES THIS GROUP — proxy.ts
│   │                             redirects all /admin/* to /studio/*. Page modules
│   │                             live on as ES imports; layout + loading + dashboard
│   │                             are dead.
│   ├── studio/                   Throughline shell (admin-only)
│   │   ├── layout.tsx            crew gate + sidebar + topbar + PrimeOS dock
│   │   ├── client/*              14 thin gated wrappers re-mounting (admin) modules
│   │   ├── crew/{directory,settings}
│   │   └── [space]/[feature]/    catch-all → real component, else "coming soon"
│   ├── api/                      40 route handlers
│   ├── auth/callback/            PKCE + magic-link + invite exchange
│   ├── onboarding/               client self-serve wizard
│   ├── globals.css               291 lines: HSL semantic token system
│   └── layout.tsx                root: fonts, ThemeProvider (light default), Toaster
├── components/                   81 files, 26,066 lines — the bulk of the codebase
│   ├── admin/    18 files, alive via /studio/client/* re-exports
│   ├── portal/   12 files, client-facing
│   ├── shared/   14 files used by both sides (MessageThread, TaskBoard, FileVault,
│   │             FileViewer, PresencePulse, VoiceRecorder…)
│   ├── studio/   Throughline-native: DocEditor, ScriptDesign, Storyboard, PrimeOS*,
│   │             TeamManager, StudioSidebar
│   ├── layout/   client portal Sidebar + Topbar
│   └── ui/       11 shadcn primitives — ALL EFFECTIVELY UNUSED
├── lib/                          41 files, 3,502 lines — well-factored, nothing >270 L
│   ├── supabase/  server.ts · client.ts · admin.ts (service role)
│   ├── auth/role.ts  app_metadata reads; DEFAULT_ORG_ID sentinel
│   ├── team.ts       role resolution from the membership tables
│   ├── permissions.ts the capability matrices (both sides)
│   ├── studio/       spaces.ts (the IA), guard.ts, editor plumbing
│   ├── ai/models.ts  44-model catalog (3 wired)
│   ├── billing/plans.ts entitlement tiers — ZERO importers
│   ├── collab/supabaseYjs.ts  Yjs-over-Realtime provider
│   └── r2.ts, notify.ts, push.ts, sms.ts, usage.ts, credits.ts, stripe.ts …
├── hooks/                        1 file, 192 lines — useFileUpload.ts, ZERO importers
├── supabase/migrations/          31 .sql files. NOTHING ELSE — no config.toml, no
│                                 seed.sql, no CLI project, no runner.
├── docs/                         master plan, architecture wiring, 8 preview PNGs,
│                                 a standalone preview.html, throughline-logo.svg
├── public/                       3 files: mcprime-logo.jpg, primeos-mark.png, sw.js
├── proxy.ts                      Next 16's renamed middleware (130 lines)
├── CLAUDE.md                     agent instructions — partially inaccurate (§9)
└── README.md                     UNMODIFIED create-next-app boilerplate
```
`[VERIFIED]`

---

## 4. DATA MODEL

**26 tables**, created across two overlapping migration series. `[VERIFIED]`

### The two migration schemes — and the fact that they conflict

- **Scheme A, `2026MMDD_*.sql`** (13 files, May 31 – Jun 4). Hand-written "paste into Supabase → SQL Editor → Run" patches against the **live production** database. Every header says exactly that (`20260531_invoicing.sql:2` and 8 others). Almost entirely `alter table … add column if not exists`; no transactions; defensive `information_schema` guards.
- **Scheme B, `00NN_*.sql`** (18 files, Aug 24–25 mtimes). A clean re-baselining for a fresh project. `0000_baseline_schema.sql:2-12`: *"Captured from the live McPrime portal on 2026-06-05 (Phase 0 / F1), AFTER the security hardening … The older `2026*_phaseN.sql` files are historical: they are **already baked into THIS baseline. Do NOT re-run them.**"*

Git proves Scheme A is older: `f778bfc` → `1e160c3` add the phase files; **then** `7e7cef9` adds `0000`–`0003`; then one commit each for `0004`–`0017`. `[VERIFIED — git log --diff-filter=A -- supabase/migrations]`

**They conflict, and lexicographic ordering makes it worse.** Any migration runner sorts `0000…0017` **before** `20260531…20260606` — the exact reverse of the historical order. If both sets are applied in filename order:

1. **RLS security regression.** `20260603_phase7.sql:44-52` recreates `admin_realtime_select_<table>` on 8 tables with the predicate `coalesce(auth.jwt()->'user_metadata'->>'role', auth.jwt()->'app_metadata'->>'role') = 'admin'`. **`user_metadata` is user-editable via `auth.updateUser()`** — any authenticated user could self-promote to full-table SELECT on `tasks, activity_log, notifications, project_phases, projects, messages, files, invoices`. The baseline deliberately replaced these with `is_admin()` (`0000:407,421,436,444,453,461,467,473`), which reads `app_metadata` only. Same for `admin_select_activity_log` (`20260604_phase8.sql:69-75`).
2. **Data loss.** `20260531_reseed_phases.sql:6-23` **deletes every `project_phases` row** and resets `projects.progress = 0` for all projects.
3. **Type disagreement.** `20260604_phase8.sql:30` declares `activity_log.actor_id uuid`; `0000:44` declares it `text`. Both statements are `if not exists` no-ops on an existing table, so no error — but the disagreement is the root of the `log_activity` overload ambiguity below.

`[VERIFIED — all three]` Scheme A is otherwise fully subsumed by `0000`.

### Core domain tables

| Table | Represents | Key columns |
|---|---|---|
| `clients` | A client **company** (the UI calls these "Companies") | `id, user_id (primary login, FK→auth.users), name, email UNIQUE, company, phone, avatar_url, notes, invited_at, onboarded_at, onboarding_completed_at, is_active, invite_count, notification_prefs jsonb, welcome_dismissed_at, last_seen_at, invite_policy CHECK IN ('open','approval','locked')` |
| `projects` | A piece of work | `id, client_id, title, type (no CHECK), status (no CHECK), progress smallint CHECK 0–100, brief, due_date, kickoff_date, stripe_payment_url, invoice_amount, deadline_notified_at, image_url` |
| `project_phases` | Named stages | `id, project_id, name, progress CHECK 0–100, is_complete, sort_order, description` |
| `tasks` | Work items, incl. client approval gates | `id, project_id, title, status CHECK IN (pending,in_progress,review,completed,blocked), priority CHECK IN (low,medium,high,urgent), category CHECK IN (deliverable,milestone,revision,approval,internal), due_date, visible_to_client, approved_at, phase_id, requires_approval, approval_status (no CHECK), approval_note, review_requested_at, auto_proceeded` |
| `files` | An uploaded asset | `id, project_id, client_id, file_name, file_path, file_size, file_type, mime_type, direction, bucket (default 'deliverables'; code writes 'r2'), uploaded_by, uploaded_by_id (orphan duplicate), uploaded_by_role CHECK IN (admin,client), uploaded_by_name, is_final, version, notes, download_count, category, folder, task_id (no FK)` |
| `messages` | A chat message on a project thread | `id, project_id, sender_id, sender_role CHECK IN (admin,client), sender_name, body CHECK len<=5000, read_at, delivered_at, nudged_at, attachment_url ("bucket::path"), attachment_name, reply_to_id (self-FK), is_deleted, edited_at` |
| `invoices` | A bill | `id, client_id, project_id, title, amount numeric(10,2), currency, status CHECK IN (unpaid,paid,overdue,partial), due_date, paid_at, invoice_number (trigger-set 'MPD-0001'), line_items jsonb, payment_method default 'bank_transfer', receipt_file_id, receipt_status, receipt_uploaded_by, receipt_submitted_at, stripe_payment_url` |
| `notifications` | Bell rows, client **and** admin | `id, client_id, project_id, type, title, body, read_at, dismissed_at, for_admin` |
| `activity_log` | Append-only audit / "Approvals & Records" | `id, project_id, client_id, actor_id **text**, actor_name, actor_role, event_type, title, body, meta jsonb` |
| `business_settings` | Agency identity + **bank/wire details** | PK `id text default 'singleton'`, `business_name/_email/_address, bank_name, account_name, account_number, routing_number, swift, bank_address, payment_instructions, admin_last_seen_at, notification_prefs` |
| `push_subscriptions` | Browser push endpoints | `id, user_id (no FK), role, client_id (no FK), endpoint UNIQUE, subscription jsonb` |

`[VERIFIED — 0000_baseline_schema.sql plus the phase migrations that added later columns]`

**`business_settings` holding `account_number`, `routing_number` and `swift` is the clearest evidence that invoicing is a manual bank-transfer workflow, not a Stripe one.** `[VERIFIED + INFERRED]`

### Multi-tenancy

`organizations` (`0001:18-27`): `id, name, subdomain UNIQUE, logo_url, branding jsonb, plan text default 'agency'`. A sentinel row `00000000-0000-0000-0000-000000000001` / name `'McPrime'` is inserted at `0001:30-32`, and that literal is the **DEFAULT of every `organization_id` column** (`0001:40-50`). It is also exported as `DEFAULT_ORG_ID` from `lib/auth/role.ts:22`. `[VERIFIED]`

### Membership & access

| Table | Migration | Key columns |
|---|---|---|
| `organization_members` | 0012 | `id, organization_id, user_id UNIQUE (no FK), name, email, role CHECK IN (owner,admin,producer,member) → widened to +finance,+editor by 0015, status CHECK IN (invited,active,revoked) → +paused by 0016, invited_by, invited_at, accepted_at`; later `history_from` (0013), `roles text[]` (0015), `extra_caps text[]` + `title` (0017) |
| `client_members` | 0012 | Same shape plus `client_id`, `role CHECK IN (owner,approver,member,viewer)`, UNIQUE `(client_id, email)`, `history_from`, `extra_caps`, `title`. **Never got `roles[]`** — asymmetric with the org side |
| `client_member_projects` | 0013 | Composite PK `(member_id, project_id)`. **No rows = sees all** company projects; any rows = only those |

`[VERIFIED]`

### Throughline substrates — built ahead of the features

| Table | Migration | Purpose | Code refs |
|---|---|---|---|
| `usage_events` | 0002 | Metering journal: `kind, units, cost_cents, ref jsonb` | 2 |
| `org_budgets` | 0002 | `monthly_cap_cents, alert_pct, hard_stop` | 1 (`hard_stop` only) |
| `org_credits` | 0002 | `balance_cents` | 1 |
| `asset_provenance` | 0003 | `file_id, parent_asset_id (self-FK), model, prompt, seed, params, signature` | **0** |
| `rights` | 0003 | `file_id, license, commercial_ok, talent_consent, expires_at` | **0** |
| `credit_ledger` | 0011 | `delta_cents, reason, ref` | **0 direct** (written only inside the credit RPCs, never read) |
| `documents` | 0004 | `kind, title, ydoc` (base64 Yjs) + `preview` (0008), `last_opened_at` (0009) | 12 |
| `document_versions` | 0005 | `document_id, tab_key, label, content jsonb` | — |
| `document_comments` | 0006 | `document_id, tab_key, body, mentions text[], resolved` + `anchor_id` (0010) | — |
| `storyboards` | 0007 | `project_id (SET NULL — asymmetric with documents, which CASCADEs), title` | 4 |
| `storyboard_shots` | 0007 | `idx, title, shot_type, description, prompt, image_key, image_bucket` | — |

`[VERIFIED]`

### Database functions and triggers

**12 functions** (counting both `log_activity` overloads), **2 triggers**, no others. `[VERIFIED]`

| Function | Security | What it does | Migration |
|---|---|---|---|
| `is_admin()` | STABLE, not definer | `auth.jwt()->'app_metadata'->>'role' = 'admin'` | `0000:319` |
| `current_org()` | STABLE, not definer | `nullif(auth.jwt()->'app_metadata'->>'organization_id','')::uuid` — **returns NULL when the claim is absent** | `0001:35` |
| `is_client_member(cid)` | **SECURITY DEFINER** | active `client_members` row for `cid`, OR is `clients.user_id` for `cid` | `0012:54` |
| `increment_download_count(file_id)` | **DEFINER** | `download_count + 1` | `0000:313` |
| `log_activity(… p_actor_id **uuid** …)` | **DEFINER** | inserts into `activity_log` | `0000:323` |
| `log_activity(… p_actor_id **text** …)` | **DEFINER** | **second overload, identical argument names** | `0000:330` |
| `mark_overdue_invoices()` | **DEFINER** | flips `unpaid` → `overdue` past due date | `0000:337` |
| `project_completion(p_id)` | **DEFINER**, STABLE | % of `visible_to_client` tasks completed | `0000:343` |
| `set_invoice_number()` | trigger fn | `'MPD-' || lpad(nextval(...),4,'0')` | `0000:351` |
| `update_updated_at()` | trigger fn | sets `NEW.updated_at` | `0000:362` |
| `charge_credits(org, cents, reason, ref)` | **DEFINER** | decrements `org_credits`, journals negative `credit_ledger`, returns balance | `0011:28` |
| `add_credits(...)` | **DEFINER** | increments; called by the Stripe webhook | `0011:42` |

Execute is revoked from `public, anon, authenticated` and granted only to `service_role` for the sensitive ones (`0000:374-385`, `0011:55-58`). `[VERIFIED]`

**Triggers:** `invoice_number_trigger` (BEFORE INSERT ON invoices) and `tasks_updated_at` (BEFORE UPDATE ON tasks) — `0000:388-389`. **There is no `updated_at` trigger on `projects`, `clients`, `invoices`, `documents`, `storyboards`, `organizations`, `org_credits` or `org_budgets`**, despite all having the column. `[VERIFIED]`

**`is_admin`, `current_org`, `is_client_member` and `project_completion` are never called from application code** — they exist only inside RLS predicates. `[VERIFIED — grep over app/ lib/ components/ returns zero hits]`

### Relationship graph

```
auth.users ─┬─(SET NULL, was CASCADE via 0016)──> clients.user_id
            ├─(SET NULL)─────────────────────────> files.uploaded_by
            └─(SET NULL)─────────────────────────> messages.sender_id
   (NO FK at all: push_subscriptions.user_id, organization_members.user_id,
    client_members.user_id, *.created_by, *.author_id, *.invited_by)

organizations (sentinel …0001)
  ├─ plain FK (no ON DELETE): organization_id on 19 tables
  └─ CASCADE: org_budgets, org_credits, credit_ledger,
              organization_members, client_members

clients  ──CASCADE──> projects · invoices · notifications · files ·
                      activity_log · client_members
projects ──CASCADE──> project_phases · tasks · messages · files ·
                      notifications · activity_log · documents ·
                      client_member_projects
         ──SET NULL─> invoices.project_id · storyboards.project_id
project_phases ──SET NULL──> tasks.phase_id
messages       ──SET NULL──> messages.reply_to_id (self)
files ──SET NULL─> invoices.receipt_file_id
      ──CASCADE──> asset_provenance.file_id · rights.file_id
documents  ──CASCADE──> document_versions · document_comments
storyboards──CASCADE──> storyboard_shots
client_members ──CASCADE──> client_member_projects.member_id
```

The design principle is documented at `0016:20-22`: **"deleting a PERSON must never delete the WORK"** — a `do $$` block rewrites every `public.*`→`auth.users` FK to `ON DELETE SET NULL` and drops the NOT NULL, relying on denormalised `sender_name` / `uploaded_by_name` / `actor_name` to keep history readable. `[VERIFIED]`

**Dangling references with no FK:** `files.task_id` → `tasks.id` (column added `20260531_phase3.sql:26`, constraint never added — in contrast to `phase3:12-22`, which *does* add `tasks_phase_id_fkey`); `files.uploaded_by_id` → nothing; `push_subscriptions.client_id` → `clients.id`; `activity_log.actor_id` (text) → `auth.users.id` by design. `[VERIFIED]`

### RLS

RLS is **ENABLED on all 26 tables**. `[VERIFIED]` Because the app reads through the service role, RLS matters in exactly two places: browser Realtime subscriptions, and the `components/studio/*` components, which use the browser client.

Baseline domain tables carry an `is_admin()` ALL policy plus client-side predicates of the form `client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())`. The Throughline tables (`usage_events`, `org_budgets`, `org_credits`, `asset_provenance`, `rights`, `documents`, `document_versions`, `document_comments`, `storyboards`, `storyboard_shots`, `credit_ledger`) all use `using (is_admin() and organization_id = current_org())`. Membership tables use `is_admin()` **alone**. `[VERIFIED]`

Weak, stale or broken predicates are catalogued in §9.

### Anomalies

**Defined, never used in code:** `asset_provenance`, `rights`, `credit_ledger` (0 references each — the Phase-0 substrates). Columns with zero code references: `files.uploaded_by_id` (self-flagged as a duplicate at `0000:20`), `files.download_count` (incremented but never displayed), `files.version`, `files.notes`, `storyboard_shots.image_bucket`, `org_budgets.monthly_cap_cents`, `org_budgets.alert_pct`, `credit_ledger.delta_cents`, all of `asset_provenance.*` and `rights.*`, and `organizations.subdomain / .logo_url / .branding`. `[VERIFIED]`

**Referenced in code but not created by any migration: none.** The two candidates both check out — `attachment_file_id` lives inside `activity_log.meta` jsonb, and `client_company` / `project_title` / `file_id` are API-payload or `ref`-jsonb keys. `[VERIFIED]`

**But the TypeScript type file is badly stale.** `lib/types/database.ts` (177 L) is hand-written, not generated, and imported by only **6 of ~60** data-touching modules. `Client` omits ten real columns and types `user_id: string` when `0016:44` explicitly drops the NOT NULL. `Task` omits seven (self-flagged at `0000:23`). **No TS type exists at all for 16 of the 26 tables.** `[VERIFIED]`

**Duplicate / overlapping concepts:**
- `files.uploaded_by` (FK) vs `files.uploaded_by_id` (orphan) — self-declared drift at `0000:20`.
- **Six pairs of duplicated RLS policies** — `files` has two identical client-SELECT policies and two identical client-INSERT policies; `invoices` and `clients` each have a duplicated SELECT; `activity_log` has three admin policies where one would do. Artefacts of merging the phase-era policies into the baseline without reconciling.
- **Two identities for "the client":** `clients.user_id` and `client_members`. `is_client_member()` ORs them together, and `0012:113-117` backfills every `clients.user_id` into `client_members` as an owner — the same human in two places with no FK or trigger keeping them in sync.
- Two onboarding timestamps (`onboarded_at` vs `onboarding_completed_at`) with no documented difference.
- Two credit sources of truth (`org_credits.balance_cents` vs the sum of `credit_ledger.delta_cents`) — consistent only because both are written inside one plpgsql body.
- **Two metering write paths despite an explicit prohibition.** `lib/usage.ts:16` says "New surfaces add a kind here — **never a second write path**", yet `lib/credits.ts:43-49` inserts into `usage_events` directly, writing `units = cents` while every `recordUsage()` caller writes native units. **`usage_events.units` is not comparable across rows.** `[VERIFIED]`
- Role modelling is triplicated: `role` (CHECK-constrained), `roles text[]` (org side only), `extra_caps text[]`, plus `title` as a display override.

**CHECK constraints code can violate — one is a live hard failure:**

| Constraint | Violating code | Effect |
|---|---|---|
| `invoices_status_check` allows only `unpaid\|paid\|overdue\|partial` (`0000:257`) | `app/api/admin/invoice-actions/route.ts:76` writes `'draft'`; `components/admin/NewInvoiceForm.tsx:49` types it as `'draft' \| 'unpaid'`; `lib/types/database.ts:122` declares `'draft'` (not permitted) and omits `'partial'` (permitted) | **Hard failure, Postgres 23514.** Creating a draft invoice raises. Self-declared at `0000:21-22`. |
| `notifications_type_check` (`0000:260`) | `lib/notify.ts:10-17` inserts `'member_invited'` and `'member_invite_pending'` | Works **only because `0012:86-97` drops the constraint.** A database at `0000`–`0011` rejects every team-invite notification. |
| `messages_body_check` (len ≤ 5000, `0000:258`) | **No `maxLength` on any chat composer** and no length guard in the API | A >5000-char paste raises 23514 with no client-side guard. |
| `activity_log` event types | `lib/logActivity.ts:15-31` uses 15 types; `files/commit/route.ts:158` adds a 16th | Safe **only because `20260604_phase8.sql:41-53` drops every CHECK on the table** — a documented live production bug. |
| `organization_members_role_check` (`0012:20`) forbids `finance`/`editor` | `lib/permissions.ts:85,100-101` treats them as first-class | Fixed by `0015`; latent if `0015` is skipped. |
| `*_status_check` forbids `'paused'` (`0012:21,39`) | The UI writes it | Fixed by `0016`; latent if skipped. |
| `projects.type` / `.status` have **no** CHECK | `lib/types/database.ts:29-30` declares tight unions | Inverse risk: the DB accepts anything; TS lies about what's there. |

`[VERIFIED — each row]`

**`log_activity` overload ambiguity.** Two functions differing only in `p_actor_id`'s type (`uuid` vs `text`) with **identical argument names**. PostgREST resolves `.rpc()` by argument name, so both candidates match and Postgres raises "function … is not unique" (PGRST203). The correct one is the **text** overload, since `activity_log.actor_id` is `text`. The codebase already works around it: `lib/logActivity.server.ts:64-75` falls back to a direct insert on any RPC error, and `recordActivity` bypasses the RPC entirely "so it does NOT depend on the `log_activity` RPC existing" (`logActivity.server.ts:17-18`). `[VERIFIED]`

### Storage

- **Cloudflare R2** is the current store for all new files. `lib/r2.ts` is the sole client; the bucket name comes from `R2_BUCKET_NAME`, never a literal. `app/api/files/commit/route.ts:81` writes `bucket: 'r2'` on **every** new row. Keys are `<clientId>/<projectId>/<rand>`. `[VERIFIED]`
- **Supabase Storage** — **no bucket is created by any migration**; `0000:14-16` explicitly lists buckets as parity work handled outside version control. `client-files` is the only bucket named in code (avatars at `app/api/portal/avatar/route.ts:57`, project images at `app/api/admin/project-image/route.ts:38`), because it can mint ~10-year signed URLs where R2 presigned URLs cap at 7 days. `deliverables` is the column default but is never passed to `storage.from()` as a literal. `client-uploads` exists only in a TS union and a stale RLS policy. `[VERIFIED]`
- **Realtime publication** membership is likewise added by the phase migrations and by `0006`–`0013`, but **`0000` never re-adds the eight core tables** — so a database built from `0000` alone has no realtime on `notifications, activity_log, projects, project_phases, tasks, invoices, messages, files`. `[VERIFIED — 0000:16 documents this as out of scope]`

---

## 5. CURRENT STATE — WHAT ACTUALLY WORKS

### Authentication — COMPLETE (with stale redirects)

| Feature | Path | Status |
|---|---|---|
| Login | `app/(auth)/login/page.tsx` (198 L) | **COMPLETE.** Always pushes `/dashboard`; admins then eat a proxy redirect to `/studio`. Two hops, works. |
| Reset password | `app/(auth)/reset-password/page.tsx` (286 L) | **COMPLETE** |
| Set password (invite accept) | `app/(auth)/set-password/page.tsx` (371 L) | **PARTIAL.** Hardcodes `/onboarding` for everyone including crew, who bounce through `/admin` → `/studio/client/overview`. Works only via redirect chains. |
| OAuth / magic-link callback | `app/auth/callback/route.ts` (118 L) | **PARTIAL / STALE.** Line 86 redirects admins to `/admin/dashboard`, a URL with no page behind it. Uses `supabase: any`, `user: any`. |
| Root | `app/page.tsx` (7 L) | **STUB.** `redirect('/login')` |

### Client portal — COMPLETE. This is real, shipped software.

| Feature | Entry point | Component | Status |
|---|---|---|---|
| Overview | `app/(portal)/dashboard/page.tsx` (935 L) | `OverviewGreeting`, `WelcomeBanner` | **COMPLETE** — real queries, KPI tiles, phase progress. No mock data. |
| Projects list | `app/(portal)/projects/page.tsx` (314 L) | inline | **COMPLETE**, project-scoped |
| Project detail | `app/(portal)/projects/[id]/page.tsx` (123 L) | `ProjectDetail` (940 L) → `TaskBoard` (1,505 L), `FileVault` (564 L), `MessageThread` (772 L) | **COMPLETE** — deepest feature in the repo |
| Review & Approvals | `app/(portal)/approvals/page.tsx` (232 L) | inline | **COMPLETE** |
| Messages | `app/(portal)/messages/page.tsx` (106 L) | `MessagesHub` (839 L) | **COMPLETE** — threads, unread, presence, voice notes, R2 attachments |
| File Vault | `app/(portal)/files/page.tsx` (67 L) | `AllFilesVault` (310 L) → `FileViewer` (683 L) | **COMPLETE** — in-app docx/xlsx/zip/pdf viewing |
| Invoices | `app/(portal)/invoices/page.tsx` (57 L) | `InvoicesClient` (595 L) | **COMPLETE** |
| Team | `app/(portal)/team/page.tsx` (18 L) | `ClientTeamManager` (394 L) | **COMPLETE** |
| Settings | `app/(portal)/dashboard/settings/page.tsx` (31 L) | `ClientSettings` (705 L) | **COMPLETE** |
| Onboarding | `app/onboarding/page.tsx` (37 L) | `OnboardingWizard` (279 L) | **COMPLETE**; line 15 `redirect('/admin')` is stale |
| Notification bell | via `Topbar` | `NotificationBell` (375 L) | **COMPLETE** |

`[VERIFIED]`

### Studio — Client space

14 of 15 routes under `app/studio/client/*` are **10-line gated wrappers**: `import Page from '@/app/(admin)/admin/...'`, `await requireOrgFeature(space, slug)`, then `<Page {...props} />` with an `eslint-disable no-explicit-any` on `props: any`. `[VERIFIED]`

| Route | Component | Status |
|---|---|---|
| `/studio/client/overview` | `AdminDashboard` (779 L) | **COMPLETE** |
| `/studio/client/companies` (+ new/[id]/edit) | `ClientsTable` (366 L), `NewClientForm` (744 L), `ClientTeamPanel` (211 L), `EditClientForm` (130 L) | **COMPLETE** |
| `/studio/client/projects` (+ new/[id]/edit) | `AdminProjectsList` (411 L), `NewProjectForm` (983 L), `AdminProjectDetail` (1,342 L), `EditProjectForm` (213 L) | **COMPLETE** |
| `/studio/client/files` | `AdminFileVault` (445 L) + `StorageMeter` | **COMPLETE** |
| `/studio/client/messages` | `AdminMessagesHub` (741 L) | **COMPLETE** |
| `/studio/client/invoices` (+ new) | `AdminInvoicesList` (709 L), `NewInvoiceForm` (804 L) | **PARTIAL / BROKEN** — creating a **draft** invoice violates `invoices_status_check` and raises Postgres 23514 |
| `/studio/client/settings` **and** `/studio/crew/settings` | `AdminSettings` (348 L) — **same module at two URLs** | **PARTIAL** — its "Team & Roles" tab is a hardcoded stub (§6) |
| `/studio/client/review` | hand-written (187 L) | **COMPLETE** — the one studio-native page here |
| `/studio/crew/directory` | `TeamManager` (334 L) | **COMPLETE** — real multi-seat roster, invites, roles, grants, realtime |

### Studio — Workspace

| Feature | Component | Status |
|---|---|---|
| **Script Design** | `ScriptDesign.tsx` (33 L router) → `ScriptHome` (563 L) + `ScriptEditorView` (528 L) → **`DocEditor` (1,323 L)** | **COMPLETE** and genuinely substantial: BlockNote + Yjs collaboration, draggable Google-Docs rulers with margin stops, a real ProseMirror pagination plugin (178 L), 35+ Google Fonts, tracked changes, outline/TOC, word count, version snapshots, anchored comments |
| **PrimeOS chat** | `PrimeOSChat` (281 L) + `PrimeOSAssistant` (557 L) + `PrimeOSDock` (52 L) | **COMPLETE.** SSE streaming, 14-model picker, 7 personas, ~30 commands, localStorage history, dictation, abort/regenerate, live credit balance |
| **Storyboard** | `Storyboard.tsx` (28 L) → `StoryboardHome` (111 L) + `StoryboardBoard` (312 L) | **PARTIAL.** Metadata board is real (CRUD shots, reorder, shot type, prompt, debounced saves, realtime). **Frame slots render a static icon and Generate is permanently `disabled`** — "available once AI model keys are added" |
| Everything else | — | **STUB** (§6) |

`[VERIFIED]`

### API layer — COMPLETE in structure

**40 route handlers under `app/api/` plus `app/auth/callback/route.ts`.** `[VERIFIED — find app/api -name route.ts \| wc -l → 40]` Consistently structured: `getUser()` → authorize → `supabaseAdmin` write → `NextResponse.json({ error }, { status })`. 151 error responses follow that shape. **Every handler that touches data has an authentication check** — the six apparent gaps are all shared-helper patterns. `[VERIFIED]` Authorization gaps do exist and are listed in §9.

### Cross-cutting systems — COMPLETE

Realtime everywhere (presence, broadcast, Yjs, badges, bell); notifications with Web Push + SMS + email escalation gated on a 90-second away window; two declarative capability matrices with default-deny and server-side enforcement. `[VERIFIED]`

---

## 6. HALF-BUILT & IN-FLIGHT

### 19 of 32 advertised features are "Phase N · coming soon" cards

`app/studio/[space]/[feature]/page.tsx` (68 L) gates the feature, hardcodes three `if` branches for real components, and otherwise renders the placeholder. `[VERIFIED]`

- **CREW — 7 of 9 stubs:** `chat` (4), `tasks` (4), `calendar` (4), `meetings` (5), `crm` (5), `leads` (5), `control-tower` (3, badged **★ COST**). Real: `directory`, `settings`.
- **CLIENT — 3 of 11:** `documents` (4), `brand-kit` (3), `guest-links` (2).
- **WORKSPACE — 9 of 12:** `workflow` (2, badged **★ CORE**), `generation` (3), `remaster` (3), `finishing` (3), `continuity` (2, badged **★ NEW**), `arena` (3), `studio-kits` (4), `library` (4), `provenance` (4). Real: `script`, `storyboard`, `ai-chat`.

**The badges actively mislead.** The three genuinely-built Workspace features carry **no** LIVE badge, while three stubs carry CORE / NEW / COST. `app/studio/[space]/page.tsx` renders all 32 as an undifferentiated grid. `[VERIFIED]`

### Specific half-built things

1. **`SessionDock.tsx` (99 L) — the "page-in-view" shell.** Dock/minimize/maximize, F-to-toggle and localStorage persistence work, but the body renders only a `<PlayCircle>` icon on a gradient. `StudioTopbar.tsx:37` opens it with the **hardcoded fictional string `'Brand Film — Aurora v3'`**. This is F4 from the master plan, shipped as an empty frame. `[VERIFIED]`
2. **`StudioTopbar` search.** A static `<div>` with no input and no handler; the `⌘K` chip is decorative. `[VERIFIED — StudioTopbar.tsx:24-28]`
3. **`AdminSettings` "Team & Roles" tab.** A hardcoded single-row roster — always the current user, always labelled `Owner` — plus "Multi-seat teams & granular roles — Coming soon". Live at both `/studio/crew/settings` and `/studio/client/settings`, **while the real multi-seat team manager already works** at `/studio/crew/directory`. `[VERIFIED — AdminSettings.tsx:317-341]`
4. **Storyboard frame generation** — permanently disabled button.
5. **The AI catalog.** 44 models across 19 providers; **three wired**. `via: 'fal'` and `via: 'replicate'` are type values with no implementation. `PROVIDER_KEYS` (19) is a UI list with no storage path — `app/api/studio/muse/route.ts:8-9` says *"Provider keys come from env **for now** (per-org key storage lands with the org settings screen)"*, a screen that does not exist. **All orgs currently share the house's AI keys.** `[VERIFIED]`
6. **Credit metering.** The loop works end to end, but the gate is soft — it blocks only when `hardStop && balanceCents <= 0`, so a zero-balance org without `hard_stop` keeps generating. Billing rates are estimates on a ~4-chars-per-token heuristic (`lib/credits.ts:9,24`). `[VERIFIED]`
7. **`lib/billing/plans.ts` (39 L).** Four entitlement tiers including `meetingMinutesPerMonth`. **Zero importers.** Nothing enforced; the meetings it meters cannot happen. `[VERIFIED]`
8. **`deadline-check` is a cron-shaped job with no cron.** `app/api/admin/deadline-check/route.ts` scans deadlines and auto-proceeds stale approvals after 7 days, but it is **not on any schedule** — it is triggered client-side from `components/admin/AdminNotificationBell.tsx:65` on admin page load. **Auto-approval of client deliverables only fires when an admin happens to open the app.** `[VERIFIED]`
9. **Documents/storyboards have no client-facing story.** All four migrations `0004`–`0007` state "Internal/team-facing **for now** (admins); client review later." `[VERIFIED]`

### Dead code paths

| Path | Lines | Why dead |
|---|---|---|
| `app/(admin)/admin/layout.tsx` | 52 | No URL reaches `/admin/*`; layouts bind to segments, not imports |
| `components/admin/AdminSidebar.tsx` | 216 | Sole importer is that dead layout (still contains a live subscription + 15s poll) |
| `components/admin/AdminTopbar.tsx` | 61 | Same |
| `app/(admin)/admin/loading.tsx` | 20 | Segment-bound to a dead segment |
| `app/(admin)/admin/dashboard/page.tsx` | 116 | Unreachable **and** not re-exported — a stale fork |
| `components/shared/FileList.tsx` | 349 | **Zero importers** |
| `hooks/useFileUpload.ts` | 192 | **Zero importers** — the whole `hooks/` dir is dead |
| `lib/billing/plans.ts` | 39 | **Zero importers** |
| `lib/r2.ts:39-130` — `uploadToR2` + entire multipart implementation | ~90 | **Zero call sites**; `CLAUDE.md` acknowledges it |
| `components/ui/*` (10 shadcn primitives) | ~665 | **All effectively dead.** `ui/button` has one importer — `ui/sheet` — which has none |
| `app/(portal)/dashboard/invoices/page.tsx` + `ClientInvoices.tsx` | 45 + 501 | Orphan route; the sidebar links only to `/invoices` |
| `feature.legacyHref` branch | — | `[feature]/page.tsx:25` reads it; **no feature ever sets it** |
| `0016:39-42` push_subscriptions FK branch | — | No FK to `auth.users` exists on that table |

**~2,340 lines of confirmed-dead code.** `[VERIFIED — import grep for each]`

### Stale branches

**None.** `[VERIFIED]`

---

## 7. UNBUILT BUT PLANNED

### From `docs/throughline-master-plan.md`

**Foundations F1–F7:** F1 and F5 done. **F4 (page-in-view)** is a shell only. F2's `NEXT_PUBLIC_ENABLE_SAAS_FLOWS` flag **does not exist in code** — it appears only in the two docs. `[VERIFIED — 3 grep hits, all in docs/]` F6 has tables; F7 has tables and zero code.

**Marked 🟢 "build first (revenue wedge)" — none built:** frame-accurate timecoded comments + canvas annotation (:41), version stacking + compare via `parent_file_id` (:42 — the column does not exist), dynamic canvas watermarking (:43), release-on-payment (:44).

**Marked 🟡:** The Graph, Continuity, Model Arena, generation hub, Remaster, PDF approval certificates, DAM. **Crew:** internal-vs-client chat via `messages.is_internal` (column does not exist), task assignment via `tasks.assigned_to` (does not exist), CRM, Control Tower, lead-gen, outreach, LiveKit, Cal.com. **Client:** guest review links at `/review/[token]`.

### From `docs/throughline-architecture-wiring.md`

Concrete schemas are specified for systems that do not exist. **Zero migrations create:** `graphs`, `graph_nodes`, `graph_edges`, `graph_runs`, `graph_run_steps` (:60-61), `video_comments` (:107), `review_links` (:112), `leads`, `deals` (:122), `team_members`, `client_contacts`, `client_companies` (:46, :117). `[VERIFIED]`

Two infrastructure layers are named as required and are **entirely absent**: a **job queue + worker** and a **media transcode** layer (`master-plan:92-95`). `[VERIFIED]`

### From code comments

Per-org AI key storage; card payment on invoices ("Stripe/card can slot in later"); storyboard frame generation; client-facing RLS for documents/storyboards. `[VERIFIED]`

**There are zero `TODO`, `FIXME`, `HACK`, `XXX`, `@ts-ignore` or `@deprecated` markers in the entire source tree.** `[VERIFIED]` The debt is encoded in prose comments and structure instead, which means **grep-based triage will not find the unfinished work.** The word "legacy" appears at 14 sites carrying **three distinct meanings** (retired URL space, the dual auth path, and old data rows) — itself a hazard.

---

## 8. PROPOSED / ASPIRATIONAL

### Explicitly written down

The two docs, both committed 2026-06-06, neither revised. `[VERIFIED]`

**The stated product:** *"A creative production & automation workspace ('studio OS'). Built by an AI-native production company that produces AI commercial films and original films made entirely with AI, plus enterprise-grade automations."* `[VERIFIED — master-plan:3-5]`

**The stated architecture:** seven "spines" — Tenancy & Identity, the Event/Activity bus, **The Graph** (a node-DAG runtime where "film generation and automations are the same engine — only the node library differs"), Credit & Cost, Provenance & Rights, Storage & Media, Realtime & Presence. `[VERIFIED — architecture-wiring:33-160]`

**Five "golden threads"**: Prompt→Shot; Cut→Review→Approve→Pay→Release; Lead→Deal→Client→Project; Cost→Budget→Bill; Any event→live everywhere. `[VERIFIED — :164-186]`

**The stated phase plan** (`master-plan:136-143`): 0 Foundations · 1 **Revenue wedge** (frame-accurate review, versioning, watermarking, release-on-payment) · 2 Workspace core · 3 AI engine · 4 Enterprise + Crew · 5 Automation domain · 6 Monetization.

**An enterprise layer:** forensic + session watermarking with DRM, AI content moderation, Brand Kit + guardrails, model governance allowlists, SSO/SAML + SCIM + MFA, pooled credits with usage-based billing, data export. `[VERIFIED — :72-80]`

**A pre-build checklist that was never completed** — every checkbox in sections A–E of `master-plan:110-133` is unticked, including "Lead feature: Continuity vs The Graph vs Provenance", "MVP scope", "Rough plan tiers", and the entire accounts/keys list. `[VERIFIED]`

### Inferred from direction of travel

`[INFERRED]` The last two working days (18 commits) went almost entirely into **multi-seat teams, roles, lifecycle and custom access** — not into any of the six phases. Evidence: `040634e`, `ab69e9e`, `61809b1`, `27ac61e`, `543c2ec`, `a7d207e`. Combined with the 08-24 cutover commits, the real trajectory is **hardening the existing portal into a multi-tenant-safe product for live client use**, with the Throughline feature set deferred.

`[INFERRED]` `organizations.plan`, the four tiers in `lib/billing/plans.ts`, the `usage_events` meter, and the Stripe credit loop together indicate an intended **usage-based SaaS** model. None of it is enforced.

---

## 9. KNOWN ISSUES, DEBT & RISK

Ranked by severity.

### CRITICAL

**1. The client-side RLS layer is still single-seat, and the app runs on the service role instead.**
`is_client_member()` was created in `0012:54` as "the membership predicate future RLS pivots on" — **and nothing ever pivoted.** Every client-side policy on `messages`, `files`, `invoices`, `tasks`, `notifications` and `activity_log` still reads `clients.user_id = auth.uid()`, which no invited teammate satisfies. `[VERIFIED — 0000:410-476]` The portal works because **68 modules** read through `supabaseAdmin`, with `app/(portal)/dashboard/page.tsx:125-127` stating the policy outright: *"no RLS dependency."* `[VERIFIED]`
**Consequence:** one forgotten `.eq('client_id', …)` is a cross-tenant leak with **no database backstop.** This contradicts both `CLAUDE.md` ("RLS is load-bearing") and `architecture-wiring:29` ("RLS is the authorization boundary").

**2. Applying both migration schemes in filename order re-introduces a privilege-escalation hole and destroys data.**
Lexicographic order puts `0000…0017` **before** `2026*`, the reverse of history. `20260603_phase7.sql:44-52` and `20260604_phase8.sql:69-75` recreate RLS policies keyed on **`user_metadata.role`, which any user can set via `auth.updateUser()`** — a self-service admin escalation granting full-table SELECT on eight tables. And `20260531_reseed_phases.sql:6-23` **deletes every `project_phases` row** and resets all project progress to 0. The only thing preventing this is a comment at `0000:11-12`. There is no runner, no ordering metadata, and no README. `[VERIFIED]`

**3. Four authorization gaps in route handlers.** All authenticate; these fail to *authorize*.
- **`app/api/activity/route.ts:17`** — the actor is correctly taken from the session, but `projectId` and `clientId` come straight from the request body with **no ownership check**. Any authenticated user can write a forged `activity_log` entry against any project or client, via a service-role writer. The activity log is displayed in both dashboards → cross-tenant content injection. `[VERIFIED]`
- **`app/api/project-tasks/route.ts:24-25`** resolves the caller with `clients.select('id').eq('user_id', user.id).single()` — the **legacy primary-login path only**, not `portalClientId()`. **An invited client teammate gets a 403** from an endpoint `components/shared/TaskBoard.tsx:314` polls every 7 seconds (`:347`). It also ignores `portalAccess().projectIds` scoping entirely. `[VERIFIED]`
- **`app/api/studio/credits/checkout/route.ts:10-11`** — auth but no authorization. **Any authenticated user, including a `client`-role user**, can create a Stripe Checkout session that tops up `userOrgId(user)`'s balance. Same gap on the read at `credits/route.ts:9-11`. `[VERIFIED]`
- **`app/api/presence/heartbeat/route.ts:19-22`** — the admin branch issues `.update({ admin_last_seen_at }).not('id','is',null)`, an **unfiltered UPDATE across the entire `business_settings` table**, fired every 30 seconds per admin. Correct only while that table is a true singleton. `[VERIFIED]`

**4. `current_org()` returns NULL when the JWT lacks the claim, silently emptying the entire Workspace.**
`0001:37` returns NULL if `app_metadata.organization_id` is absent, so all eleven `organization_id = current_org()` policies evaluate to NULL → false → **zero rows**. The claim is only stamped on users created *through the app*; the `0012:101-110` admin backfill does **not** touch `app_metadata`. Because `components/studio/*` uses the **browser** client, the entire Script Design + Storyboard workspace **silently returns empty and every write silently fails** for such a user. `lib/auth/role.ts:42` papers over this server-side with a `DEFAULT_ORG_ID` fallback; the SQL function has no equivalent. `[VERIFIED]`

**5. No input validation anywhere.** `zod`, `react-hook-form` and `@hookform/resolvers` are installed and imported **zero times**. `[VERIFIED]` Every route does `await req.json()` and reads fields untyped. `CLAUDE.md` claims "React Hook Form + Zod for forms" — false.

**6. `CRON_SECRET` fails open, and the nudge job is self-amplifying.**
`app/api/cron/message-nudge/route.ts:74-80` wraps the bearer check in `if (secret)` — **unset means no check.** The variable is in neither `.env.example` nor `CLAUDE.md`, so the default deployment is the unauthenticated one, exposing a service-role scan plus **billable** Twilio/Resend fan-out to anonymous callers. Separately, the authenticated `POST` twin is fired **on every app load** by `components/shared/PresencePulse.tsx:138` — N users × page loads → N full 500-row scans plus notification fan-outs. `[VERIFIED]`

**7. No tests. No CI. No pre-merge gate.** Exhaustive search for `*.test.*`, `*.spec.*`, `__tests__/`, vitest/jest/playwright configs returns **zero**. No `.github/`, no Dockerfile, no CI YAML, no `test` script. `[VERIFIED]` Deployment is Vercel git-push with nothing verifying anything.

### HIGH

**8. Two imported packages are not declared in `package.json`.** `@tiptap/pm/state`, `@tiptap/pm/view` (`lib/studio/pagination.ts:17-18`, `lib/studio/suggesting.ts:1`) and `y-prosemirror` (`suggesting.ts:2`). `grep -c` on `package.json` → **0**. `[VERIFIED]` They resolve today only as hoisted transitives of `@blocknote/*`. A BlockNote minor bump, or any package manager with a strict `node_modules` layout, breaks the build with an unresolved import and no obvious cause.

**9. Stored-HTML XSS in Script Design.** `components/studio/ScriptHome.tsx:202` renders `documents.preview` — produced by `editor.blocksToHTMLLossy` at `DocEditor.tsx:366` and persisted — via `dangerouslySetInnerHTML` **with no sanitizer**. `[VERIFIED]` Note `components/studio/Markdown.tsx:6` explicitly documents avoiding this pattern, so it was considered and then violated elsewhere.

**10. Creating a draft invoice is a hard failure.** `app/api/admin/invoice-actions/route.ts:76` writes `status: 'draft'`; `invoices_status_check` (`0000:257`) permits only `unpaid|paid|overdue|partial`. Postgres raises 23514. Meanwhile `lib/types/database.ts:122` declares `'draft'` (not permitted) and omits `'partial'` (permitted). Self-declared at `0000:21-22`. `[VERIFIED]`

**11. `npm run lint` fails: 361 problems (256 errors, 105 warnings), exit 1.** 197 × `no-explicit-any`, 74 × `no-unused-vars`, 29 × `react-hooks/set-state-in-effect`, 24 × `exhaustive-deps`, 10 × `react-hooks/refs`, 7 × `no-unescaped-entities`, 7 × `static-components`, 5 × `next/no-img-element`, 2 × `no-html-link-for-pages`, 1 × `purity`, 1 × `no-require-imports`. `[VERIFIED — npx eslint . run during this audit]` Lint does not run during `next build`, so none of it blocks a deploy.
*Counterpoint:* `npx tsc --noEmit` **passes cleanly, exit 0.** `[VERIFIED]` The type system is satisfied; ~229 escapes (71 `as any` + 158 `: any`) are how. The worst single line is **`components/admin/AdminProjectDetail.tsx:87` — `}: any) {`**, untyping the props of a 1,342-line component. `components/studio/DocEditor.tsx:39` has a file-wide `eslint-disable`. Root cause: `lib/types/database.ts` is hand-written, stale, and adopted in only 6 of ~60 data-touching modules.

**12. Module-scope SDK construction — the exact pattern that already broke a deploy.**
`lib/stripe.ts:5-15` gets it right and documents why: *"a module-scope instance would crash `next build`'s page-data collection in any environment missing STRIPE_SECRET_KEY."* **Two modules still violate it.** `lib/supabase/admin.ts:5-8` constructs the service-role client at module scope with `!`-asserted env vars — `createClient` **throws at import time** if the URL is missing, and this module is imported by 68 files including 13 pages Next statically analyses during build. `lib/r2.ts:16-27` is worse: it fails **silently**, producing the literal endpoint `https://undefined.r2.cloudflarestorage.com`. `[VERIFIED]` Also, `app/api/admin/create-client/route.ts:29-30` and `resend-invite/route.ts:36-37` construct a **second ad-hoc service-role client inline** rather than importing the guarded one.

**13. Two exported `OrgRole` types with different members.** `lib/team.ts:11` has four roles; `lib/permissions.ts:85` has six (`+finance, +editor`). `lib/permissions.ts:96` defines capabilities for roles `lib/team.ts:35` can never produce. `lib/studio/guard.ts:16` spreads one into the other, and the cast papers over the mismatch. `[VERIFIED]`

**14. Every internal link in the Client space still points at `/admin/*`.** 40+ hardcoded hrefs and `router.push` calls across `AdminDashboard.tsx` (15), `ClientsTable.tsx`, `AdminProjectsList.tsx`, `AdminInvoicesList.tsx`, `NewInvoiceForm.tsx`, `NewProjectForm.tsx`, `NewClientForm.tsx`, `EditProjectForm.tsx`, `EditClientForm.tsx`, `AdminProjectDetail.tsx`, `AdminNotificationBell.tsx`, plus a raw `<a href="/admin/clients/new">` in `app/(admin)/admin/clients/page.tsx:59`. `[VERIFIED]` Nothing 404s — the proxy catches all of it — but **every click in the studio's most-used space is a middleware redirect round-trip**, defeating client-side navigation and polluting history. The clearest "not actually finished" signal in the codebase.

**15. Massive duplication.** `MessagesHub.tsx` (839) and `AdminMessagesHub.tsx` (741) are **~78% identical — ~612 shared lines**, mirrored function-for-function (`samePersisted`, `timeAgo`, `broadcastSync`, `loadMessages`, `refetchMessages`, `handleIncoming`, the channel effect, the 6s poll). The only substantive differences are the fetch URL and the presence selector. `ProjectDetail.tsx` (940) and `AdminProjectDetail.tsx` (1,342) share ~471 lines, with `handleDeleteMessage`/`handleEditMessage` byte-identical. Also `ClientTeamManager` ↔ `TeamManager` (~222 shared) and three copies of the sidebar badge logic. Copy-pasted helpers: **7 copies of `timeAgo`, 6 of `formatCurrency`, 5 of `formatBytes`** — one of which is already exported from `lib/fileCategories.ts:88`. `[VERIFIED]`

**16. Performance landmines in the most-used surface.** `app/(admin)/admin/messages/page.tsx:32-37` loads **every message ever sent, across every client**, with no `.limit()`, to compute latest-per-project in JS. `app/api/{portal,admin}/messages/route.ts` return **entire threads** unpaginated — and both hubs poll them every **6 seconds**, so a 5,000-message thread re-downloads 5,000 rows every 6s per open tab. `app/(admin)/admin/page.tsx:54-60` selects the whole `invoices` table to compute three sums in JS, re-triggered every 30s. **10 unfiltered `postgres_changes` subscriptions**, worst being `PresencePulse.tsx:105` (app-wide, every user, every message) and `app/(admin)/admin/projects/page.tsx:38` (five tables at once). **16 polling intervals**, several layered on top of an already-subscribed table. `[VERIFIED]`

**17. The Stripe webhook: one event, no idempotency.** `app/api/webhooks/stripe/route.ts` handles only `checkout.session.completed`. **Stripe retries webhooks, and nothing dedupes on the session id — a retry double-credits the org.** It also exports an unauthenticated `GET` returning `'OK'`. If `STRIPE_WEBHOOK_SECRET` is unset it defaults to `''` and every top-up is silently dropped with a 400. `[VERIFIED]`

### MEDIUM

**18. `CLAUDE.md` — the file steering every future contributor — contains false claims.** "Stripe for invoicing" (it is a manual bank-transfer workflow). "React Hook Form + Zod for forms" (zero imports). "shadcn/ui" (all primitives unused). "`/auth/callback` is reserved for future OAuth" (it already handles PKCE, magic-link and invite). "RLS is load-bearing" (the portal bypasses it). "`app/(admin)/` — Layout enforces `role === 'admin'`" (that layout never executes). "Admins hitting `/dashboard` → redirected to `/admin`" (it is `/studio`). Its required-env list omits `CRON_SECRET`, all AI keys, `NOTIFY_FROM_EMAIL`, the VAPID vars and the Twilio vars. `[VERIFIED — each claim checked]`

**19. RLS policies with weak or stale predicates.**
- **`clients` `"Client can update own record"` (`0000:416`) is an unrestricted-column UPDATE.** No column allowlist in the policy, so a client with a session could set `is_active`, `invite_policy` (bypassing an owner's `locked` setting), or `organization_id` (moving their company to another tenant). The app enforces an allowlist server-side; the policy does not.
- **Membership tables are not tenant-scoped.** `organization_members_admin_all` (`0012:69`), `client_members_admin_all` (`0012:77`) and `client_member_projects_admin_all` (`0013:27`) gate on `is_admin()` **alone**. The moment a second organization exists, any org's admin can read and write every other org's rosters. Every other post-`0001` table pairs `is_admin()` with `current_org()`; these three do not.
- **`files` `clients_upload_own_files` (`0000:430-432`) is dead** — it requires `bucket = 'client-uploads'`, but the only insert path hardcodes `bucket: 'r2'`.
- **`business_settings` is a singleton with a tenant column** — PK is the literal `'singleton'`, yet `0001:41` added `organization_id` and the policy has no org predicate. Multi-tenant agency identity is unimplemented.
`[VERIFIED]`

**20. The client-portal auth gate uses `getSession()`, not `getUser()`.** `app/(portal)/layout.tsx:17` — the gate for the entire client app — reads the cookie payload **without revalidating the JWT** against the Auth server. 71 files use `getUser()`; this is one of only two `getSession()` sites. `[VERIFIED]` `[INFERRED]` Practical risk is low because `proxy.ts` calls `getUser()` first on every matched request, but it is an inconsistency in the most security-sensitive line in the portal.

**21. Admin authorization is JWT-based in most routes, contradicting "the table is truth".** Most `api/admin/*` routes gate on `isAdmin(user)` reading `app_metadata` alone; only `admin/team` and `admin/client-team` consult the membership tables. A revoked-but-not-yet-refreshed admin retains access. `[VERIFIED]`

**22. Hardcoded McPrime identity in a product sold as white-label.** `app/api/cron/message-nudge/route.ts:49` hardcodes `'McPrime Digital'` as the sender name in **every outbound nudge** — so a white-labelled tenant's clients receive push/SMS/email attributed to McPrime, while `lib/billing/plans.ts:14-28` sells `whiteLabel: true` on two tiers. Also `lib/push.ts:16` (`mailto:notifications@mcprime.digital`), `app/(auth)/set-password/page.tsx:190` (`mailto:hello@mcprimedigital.com` on a public page), and `app/(admin)/admin/messages/page.tsx` (`adminName="McPrime Digital"`, not read from `business_settings`). `[VERIFIED]`

**23. Silent catches mask un-run migrations.** **78 empty/silent `catch` blocks**, concentrated in `AdminProjectDetail.tsx` (18), `DocEditor.tsx` (17), `PrimeOSAssistant.tsx` (15), `TaskBoard.tsx` (14). The deliberate best-effort ones are fine; the concerning class is `app/api/portal/actions/route.ts:52-54` (*"Column may not exist yet"*) and `app/api/presence/heartbeat/route.ts:7-9` (*"if the last_seen columns haven't been migrated yet … the update simply no-ops"*). **The app cannot tell you whether its schema is current** — a partially-migrated database presents as "features quietly don't work". `[VERIFIED]`

**24. No observability.** No Sentry, no analytics, no error tracking; **48 `console.*` calls** are the only error surface, landing invisibly in Vercel function logs. `[VERIFIED]`

**25. Other data-integrity traps.**
- **`lib/team.ts:147` and `:222`** use `.single()` on `client_members` filtered only by `user_id` + status. **If one person is ever a member of two client companies, `.single()` errors and they are locked out of the entire portal.** Same shape at `:24` for the org side.
- **`lib/team.ts:185`** hardcodes `extraCaps: []` and `title: null` on the `owner` path, discarding the `membership.extraCaps` resolved two lines earlier — **owner-granted custom capabilities are silently dropped for owners.**
- **`lib/team.ts:26-29`** bootstraps *any* `app_metadata.role === 'admin'` user to `owner` if `organization_members` is empty — correct for a fresh environment, a privilege-escalation window if that table is ever truncated.
- **Admin message moderation runs through client-scoped endpoints.** `AdminProjectDetail.tsx:554,567` call `/api/portal/messages/{delete,edit}`, which gate on `sender_id === user.id` with a hardcoded 5-minute delete and 1-hour edit window. **Admins cannot moderate a client's message at all.**
`[VERIFIED]`

**26. Supply chain.** `xlsx` is resolved from `https://cdn.sheetjs.com/...tgz`, not npm — no registry provenance, breaks air-gapped or proxied installs. `shadcn` (a CLI) ships in `dependencies`. `overrides: { postcss: "$postcss" }` has no explanatory comment. `components/studio/ScriptHome.tsx:100` fetches template cover art from `picsum.photos` on every Script Design home load. `[VERIFIED]`

**27. Yjs sync has an unhandled size ceiling.** `lib/collab/supabaseYjs.ts:64-70` broadcasts the full `Y.encodeStateAsUpdate(doc)` base64-encoded over a Supabase Realtime broadcast channel on every peer join. Supabase broadcast has a per-message size limit; a large document will silently exceed it and **CRDT convergence fails with no error path.** The base64 conversion at `:10-19` is also a per-byte string concat — O(n) allocations over the full document. `[VERIFIED]`

### LOW

**28. ~2,340 lines of dead code** (§6), including two substantial superseded implementations and the entire unused shadcn install.
**29. `sonner` is mounted but never used.** `<Toaster>` renders in `app/layout.tsx:41`; `toast()` is called **nowhere**. Feedback is handled ad-hoc with inline state. `[VERIFIED]`
**30. `README.md` is unmodified `create-next-app` boilerplate.** `[VERIFIED]`
**31. Brand drift.** `package.json:2` still `mcprime-clients-portal`; root `<title>` still "McPrime Digital — Client Portal"; the AI route still `/api/studio/muse`; no Throughline logo in `public/`. `[VERIFIED]`
**32. No robots.txt, sitemap, PWA manifest or OG image**; `public/` contains exactly three files. **33.** `next.config.mjs` has no `images` config while `next/image` is disabled at 13 sites — **no image optimization anywhere.** **34.** `serverActions.bodySizeLimit: '50gb'` is vestigial. **35.** No rate limiting on any route, including `/api/studio/muse`, which spends money per call. **36.** Voice notes may still be unplayable in Safari — `VoiceRecorder.tsx:70-75` prefers `audio/mp4`, which Chrome's `MediaRecorder` does not support, so Chrome still records webm `[INFERRED]`; whether this manifests is `[UNKNOWN]`. **37.** `react-hooks/exhaustive-deps` is disabled at four sites in the most complex stateful components. **38.** `lib/permissions.ts` has no `server-only` guard — it holds no secret, but the complete authorization matrix ships to the browser; worth a deliberate decision rather than an accident.

---

## 10. CONVENTIONS & DECISIONS IN FORCE

### Written down (`CLAUDE.md`)

- **Three Supabase clients, never interchangeable** — server / browser / admin. In practice the third dominates.
- **Never reintroduce server-buffered upload routes** — Vercel caps function bodies at ~4.5 MB.
- **`params` and `cookies()` are async in Next 16** — always `await`.
- **`public/mcprime-logo.jpg` is McPrime's own branding only** — never a client's logo.
- **No test framework. Do not invent one or claim tests passed.**

### Implicit but consistently enforced

1. **Authorization is server-side, at two layers.** Every gated page has a nav-level hide *and* a server redirect. `lib/permissions.ts:50-73` states the rule: *"Hidden, not just blocked."* `clientNavAllowed` / `orgFeatureAllowed` feed both the sidebar and the guard, so screens cannot disagree with enforcement.
2. **Default-deny.** `ORG_FEATURE_CAP` (`permissions.ts:139-175`) is a **complete** map — every feature declares the capability that reveals it. A new feature that forgets to declare one is visible to everyone, so the map must be updated in the same change.
3. **Role gives defaults; grants union on top.** Every check takes an optional `extra?: readonly string[]` and short-circuits on it. Custom role *names* live in a separate `title` column that never affects permissions.
4. **The table is truth; the JWT is a cache** (`lib/team.ts:7-9`). Honored inconsistently — §9 item 21.
5. **Least privilege on every fallback.** `orgRolesOf` returns `['member']` for an admin with no row, bootstrapping `['owner']` only on an empty roster. A nil-UUID `NO_CLIENT` sentinel makes a failed lookup behave like no match rather than requiring null-handling at 24 call sites (`lib/team.ts:151-158`).
6. **Every lifecycle needs both a live hook and a backfill.** Both layouts flip `invited → active` before resolving the role; `0014` backfills rows that predate the hook.
7. **FKs onto `auth.users` are `ON DELETE SET NULL`** — `6f18024`: "deleting a person never deletes the work". `push_subscriptions` is the intended exception.
8. **Route handlers, not Server Actions, for mutations.** Uniform `NextResponse.json({ error }, { status })`; 151 such responses.
9. **Idempotent migrations.** `create table if not exists`; every `create policy` preceded by `drop policy if exists` (Postgres has no `IF NOT EXISTS` for policies) — established by `b196f6f`.
10. **Every new table carries `organization_id` from birth**, defaulting to the house sentinel.
11. **Metering has one write path** — `lib/usage.ts:16` says so explicitly, and `lib/credits.ts:43-49` violates it (§4).
12. **Best-effort side effects never break a request** — and therefore never report either (§9 item 24).

### Styling — two competing approaches

The token system is a shadcn-style HSL semantic set in `app/globals.css` (`--background`, `--card`, `--primary`, `--border`, `--status-*`, `--text-faint`) for `:root` (light) and `.dark`, mapped through `tailwind.config.ts` with `<alpha-value>`. `darkMode: ['class']`; `next-themes` with **`defaultTheme="light"` and `enableSystem={false}`**. `[VERIFIED — app/layout.tsx:35-40]`

But there are **2,227 inline `hsl(var(--token))` style expressions across 50 files.** `[VERIFIED]` Roughly half the components deliver tokens through React `style={{}}` objects rather than Tailwind classes. Both respect the token system; neither is wrong; they are inconsistent. `[INFERRED]` Tailwind classes dominate newer studio components; inline styles dominate older portal/admin ones (`AdminSettings.tsx:319-341` is typical).

**Palette note:** any description of a "Shark 300 (#AEBECB)" light canvas is out of date — `app/globals.css:10` now sets light `--background: 210 36% 98%` (≈`#F7F9FB`, near-white). `[VERIFIED]`

### File organization & naming

Route groups by audience; components mirror the split; shared UI in `components/shared/` takes role-parameterised props (`readOnly`, `canSend`, `canApprove`) rather than being forked. `PascalCase.tsx` components, `camelCase.ts` lib modules, `kebab-case.ts` Zustand stores, `NNNN_snake_case.sql` migrations. Path alias `@/*` from the root.

### Error handling

Server: `NextResponse.json({ error }, { status })`, 41 `try` blocks in the API layer. Client: local component state — **no toast library in use** despite one being mounted. Integrations: swallow and continue.

### Testing

None. The only gates are manual `npm run lint` (failing) and `npm run build`.

---

## 11. HOW TO RUN IT

### Install

```bash
npm install
```
npm is the package manager (`package-lock.json`, no `packageManager` field). Node is unpinned — no `engines`, no `.nvmrc`. `[UNKNOWN]` which version is intended; Next 16 needs Node 20.9+.

### Commands

```bash
npm run dev      # next dev — http://localhost:3000
npm run build    # next build
npm start        # next start
npm run lint     # eslint .  ← CURRENTLY FAILS
```
These four are the **only** scripts — no `test`, no `typecheck`, no `format`, no migration script. `[VERIFIED — package.json:5-10]`

### What passes and fails

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **PASSES**, exit 0 `[VERIFIED — run during this audit]` |
| `npm run lint` | **FAILS**, exit 1 — 361 problems (256 errors) `[VERIFIED — run during this audit]` |
| `npm run build` | `[UNKNOWN]` — not run here. It writes build artifacts and needs the full env set, because `lib/supabase/admin.ts:5` and `lib/r2.ts:16` construct clients at module scope. A `.next/` directory exists, so it has succeeded locally at some point. |
| `npm test` | No such script. |

Lint does not block the build — Next 16 removed `next lint`, so ESLint never runs during `next build`.

### Database

**There is no runner in this repository.** `supabase/` contains only `migrations/` — no `config.toml`, no seed, no CLI project. `[VERIFIED]` Migrations have historically been applied by ad-hoc shell scripts kept **outside** the repo. For a fresh database, apply `0000_baseline_schema.sql` first, then `0001` → `0017` in order, and **do not apply the `2026*` series** — see §9 item 2 for what happens if you do. Two things `0000` does **not** do and that must be done by hand: create the Supabase Storage buckets, and add the eight core tables to the `supabase_realtime` publication. `[VERIFIED — 0000:13-16]`

### Required environment variables

Loaded from `.env.local` (gitignored; only `.env.example` is tracked). **Names only.**

**Boot-critical:** `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` (used by 68 modules, non-null-asserted at module scope).

**Required for all file features** (module-scope `S3Client`): `R2_ACCOUNT_ID` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` · `R2_BUCKET_NAME`.

**Money:** `STRIPE_SECRET_KEY` (lazy) · `STRIPE_WEBHOOK_SECRET` (defaults to `''`, which 400s every webhook).

**Required for the only AI feature — and absent from `.env.example`:** `ANTHROPIC_API_KEY` · `OPENAI_API_KEY` · `GEMINI_API_KEY` (or `GOOGLE_API_KEY`). Read via **dynamic** `process.env[envName]` lookup, invisible to static analysis and to Next's build-time inlining.

**Optional, degrade to silent no-ops:** `RESEND_API_KEY` + `NOTIFY_FROM_EMAIL` · `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_SUBJECT` · `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM` · `NEXT_PUBLIC_APP_URL` · `NEXT_PUBLIC_STORAGE_QUOTA_GB`.

**Security-relevant:** `CRON_SECRET` — absent from `.env.example` and from both local env files, and the code skips the check when unset.

**Unused:** `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is configured in every environment and **read by no code** — there is no Stripe.js on the client.

**Env-file drift:** `.env.local` has the three AI keys; `.env.live.local` does not — **AI is unconfigured in the live environment.** Neither file has any `TWILIO_*` var, so SMS is inert everywhere. `.env.local` has `VAPID_PUBLIC_KEY` but no `VAPID_PRIVATE_KEY`, so push half-configures and no-ops locally.
`[VERIFIED — cross-reference performed during this audit; no values read or reproduced]`

### Deploy

Vercel, git-push. `vercel.json` contains one entry: cron `{ "path": "/api/cron/message-nudge", "schedule": "0 9 * * *" }`. No regions, no function config, no headers. **No CI, no Dockerfile, no pre-deploy verification.** `[VERIFIED]`

### Domain-change checklist

`[INFERRED]` Changing the app's URL silently breaks: `NEXT_PUBLIC_APP_URL`, the Supabase Auth Site URL + redirect allowlist (invite and reset emails), the R2 bucket CORS origin (direct PUT uploads), the Stripe webhook endpoint, and the Resend sending domain.

---

## 12. OPEN QUESTIONS FOR THE HUMAN

### Product & intent

1. **Is Throughline a product for sale, or an internal tool for one agency?** The repo says both. Which is true today?
2. **Is the master plan still the plan?** Dated 2026-06-06, says "No build started", never revised, and the last two working days went entirely into teams/roles — none of the six phases.
3. **What is the actual lead feature?** `master-plan:113` asks exactly this ("Continuity vs The Graph vs Provenance") and the box is unticked; the doc separately calls frame-accurate review the "revenue wedge".
4. **Who is the paying customer** — the agency, the agency's clients, or an end filmmaker? Determines whether client seats stay free.
5. **Is the McPrime portal in live production use with real clients right now?** This governs how freely any of it can be refactored.
6. **Is "the agency" one org forever?** Nothing in the code creates a second organization, and several policies (§9 item 19) would leak across tenants the moment one exists.
7. **What is the intended relationship between `clients` (a company), `organizations` (a tenant), and `clients.user_id` (a single primary login)?**
8. **Should white-label actually ship?** Two plan tiers sell it while the nudge sender is hardcoded to "McPrime Digital".

### Scope & sequencing

9. **Do the 19 stub features stay advertised?** Today a crew member sees 32 cards, 19 of them "coming soon", with CORE/NEW/COST badges on stubs and no LIVE badge on the three real Workspace features.
10. **Is the "page-in-view" concept (F4) still wanted?** `SessionDock` is an empty frame opened with a fictional project name — finish or delete?
11. **Which of the 44 catalogued AI models must actually work?** Wiring fal.ai or Replicate as meta-providers would cover most of the remainder.
12. **Is a job queue + worker being adopted?** Every Phase-3 feature requires it; nothing chosen.
13. **Is transcode/proxy generation being adopted?** Frame-accurate review — the stated revenue wedge — cannot exist without it.
14. **Is LiveKit still the meetings choice?** `plans.ts` already meters `meetingMinutesPerMonth` for a feature with no code.
15. **Delete the legacy `(admin)` route group, or keep it?** Its layout and chrome are dead; its page modules are load-bearing.
16. **Should invoicing move to Stripe, or stay bank-transfer?** And **is the "draft" invoice status supposed to exist?** Today writing it raises a Postgres error (§9 item 10) — is the fix the constraint or the code?
17. **Should `deadline-check` be on a real cron?** Auto-approval of client deliverables currently only fires when an admin opens the app.

### Technical decisions needed

18. **Do we pivot RLS to `is_client_member()` and make the database the authorization boundary again, or formally accept service-role + JS-side scoping as the model?** This is the single biggest architectural fork; the docs and the code currently disagree.
19. **Do we adopt Zod at the API boundary?** Installed, unused; there is no input validation anywhere.
20. **What is the intended test strategy?** `CLAUDE.md` forbids inventing one. Is that still standing, and if so how should correctness be verified before deploy?
21. **Should CI be added, and what gates a merge** — typecheck (green), lint (256 errors), build?
22. **Is the 256-error lint backlog worth clearing, or should rules be relaxed?** 197 are `no-explicit-any`.
23. **Which styling convention wins** — Tailwind token classes or inline `hsl(var(--token))`? 2,227 instances of the latter.
24. **Where should the migration runner live, and can the `2026*` series be deleted or archived** so the ordering hazard cannot fire?
25. **Should `@tiptap/pm` and `y-prosemirror` be declared explicitly** rather than relying on hoisting?
26. **Is `CRON_SECRET` set in Vercel?** If not, that endpoint is publicly callable today.
27. **Are the AI keys set in the live Vercel environment?** They are present locally and absent from `.env.live.local`.
28. **Should the message-hub duplication be consolidated** before or after the planned rooms/company-keyed-hub refactor?
29. **What happens to `asset_provenance`, `rights` and `credit_ledger`** — three tables with zero code references? Keep as substrate, or drop?
30. **Is `picsum.photos` acceptable in shipped product chrome?**
31. **Should a person be allowed to belong to two client companies?** Today `.single()` in `lib/team.ts:147` locks them out entirely if they do.
32. **Is there a design system or brand kit outside the repo?** `docs/previews/*.png` and `docs/throughline-preview.html` appear to be design targets rather than screenshots of built UI — `[UNKNOWN]` which.
33. **What is the intended Node version?**
34. **Is `docs/throughline-preview.html` (420 L, with its own mirrored token set) still a reference?** It duplicates `app/globals.css` and will drift.

---

## 13. THE 10 THINGS THAT MATTER MOST

1. **This repo contains two products at very different maturity levels.** The client portal and the agency-side project/invoice/messaging tooling — roughly 20,000 lines — are finished, production-grade software. The Throughline studio is a well-designed shell around mostly-empty rooms: **19 of its 32 advertised features render the same "Phase N · coming soon" card**, and the badges are inverted — stubs carry CORE/NEW/COST while the three real Workspace features carry nothing.

2. **Only three Throughline features are actually built:** Script Design (excellent — ~2,400 lines of BlockNote+Yjs editor with real pagination), PrimeOS chat (excellent — streaming, multi-model, credit-metered), and Storyboard (a working metadata board whose frame generation is a permanently disabled button).

3. **Authorization is enforced in application code, not in the database.** `is_client_member()` was created in `0012` as the predicate RLS would pivot to, and nothing pivoted. Every client-side policy still assumes one login per company. The portal works because **68 modules** read through the service-role client with JavaScript-side scoping. One forgotten filter is a cross-tenant leak with no backstop — and both `CLAUDE.md` and the architecture doc claim the opposite is true.

4. **The migration directory is a loaded gun.** Two naming schemes sort in the reverse of their historical order. Applying both — which any standard runner would do — **re-introduces an RLS predicate keyed on user-editable `user_metadata` (self-service admin escalation on eight tables) and deletes every `project_phases` row.** The only safeguard is a comment. There is no runner, no ordering metadata, and no README.

5. **Nothing is automatically verified.** Zero tests, zero CI, no pre-merge gate. `tsc` passes cleanly; `npm run lint` fails with **361 problems (256 errors)**, and lint does not run during `next build`, so none of it blocks a deploy.

6. **There are four real authorization gaps and one stored-XSS**, all in otherwise-authenticated routes: forged activity-log entries (`api/activity`), invited teammates 403'd from a 7-second-polled endpoint (`api/project-tasks` — a live functional bug), any client able to create org credit top-ups (`credits/checkout`), an unfiltered cross-row UPDATE every 30s (`presence/heartbeat`), and unsanitized `dangerouslySetInnerHTML` on stored document HTML (`ScriptHome.tsx:202`).

7. **The permission system is the best-engineered thing here and should be preserved.** Two declarative capability matrices, default-deny with a complete feature map, per-member grants unioned onto role defaults, resolution centralised in `lib/team.ts`, enforcement at one choke point. It is consistently applied on both sides and represents roughly a third of all recent commits.

8. **`/admin/*` is a pure redirect table, and the Client space still links to it 40+ times.** The `(admin)` layout and chrome are dead code, while the components that now render at `/studio/client/*` still contain hardcoded `/admin/...` hrefs. Nothing 404s, but every click in the studio's most-used space is a middleware round-trip instead of a client-side navigation.

9. **The two infrastructure layers every remaining Phase-3+ feature depends on do not exist and have not been chosen** — a job queue + worker, and a media transcode layer (`master-plan:92-95`). Generation, Remaster, The Graph and frame-accurate review (the stated revenue wedge) are all blocked on them. Relatedly, the AI surface is ~7% wired: 3 of 44 models reach a real endpoint, through a single route, with keys from `process.env` rather than per-org storage — so the AI layer is structurally single-tenant.

10. **The written plan and the actual trajectory have diverged.** `docs/throughline-master-plan.md` (2026-06-06, never revised, still says "No build started", every pre-build checkbox unticked) describes six phases. After a **78-day gap with zero commits**, work resumed on 2026-08-24 and went entirely into production cutover plus multi-seat teams, roles and access control — none of which appears in the plan. Treat the docs as historical intent, not current roadmap.

---

*End of audit. No source file, config, migration, or dependency was modified in producing this document.*
