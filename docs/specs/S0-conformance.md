# S0 Conformance Report

**Spec under test:** `docs/specs/S0-decisions-and-constraints.md`
**Repo state:** branch `throughline`, commit `01f3ec4` (working tree clean apart from the
untracked `THROUGHLINE_STATE_OF_PLAY.md`)
**Date:** 2026-08-25
**Purpose:** raw input to S6 sequencing. A violation missing from this file is a remediation
task that will not get scheduled.

## Method

Every finding was read out of the source at the cited `path:line`. Nothing is quoted from
memory, from `THROUGHLINE_STATE_OF_PLAY.md`, or from the previous `CLAUDE.md`. Counts come
from mechanical sweeps over `app/`, `lib/`, `components/`, `hooks/`, `proxy.ts` and
`supabase/migrations/` (217 TypeScript files, 41 route handlers, 31 migration files).

Schema statements are read from the migration files, which are the repo's source of truth. The
live database was not queried; where a claim depends on live data it is marked **UNKNOWN**.

**Status values**

| Status | Meaning |
|---|---|
| CONFORMS | The code already satisfies the decision/invariant. |
| PARTIAL | Satisfied on some surfaces, violated on others. |
| VIOLATES | Systematically violated. |
| NOT-YET-APPLICABLE | The thing the decision governs does not exist yet, so there is nothing to conform or violate. Becomes a build task, not a remediation task. |

**Blast radius** counts files and surfaces a fix touches. No time estimates.

---

## ⚠️ Read this first — three places where S0 is contradicted by the repo

Per the S0 adoption instruction, these are stated plainly rather than worked around.

### 1. AD-004's premise is factually wrong against this code

S0 AD-004 states: *"Today `messages.attachment_url` is a `"bucket::path"` string that never
becomes a `files` row — so chat attachments are invisible to the File Vault, uncounted in
storage metering, and carry no category, version or provenance."*

Every clause of that except the first is false in the current code:

- Chat attachments **do** become `files` rows. All four attachment handlers call the shared
  direct-to-R2 uploader: `components/portal/MessagesHub.tsx:442`,
  `components/portal/ProjectDetail.tsx:450`, `components/admin/AdminMessagesHub.tsx:437`,
  `components/admin/AdminProjectDetail.tsx:540` — each `uploadFileToR2({ category: 'message' })`,
  which POSTs `/api/files/commit`, which inserts the `files` row at
  `app/api/files/commit/route.ts:70-90`.
- They **are** counted in storage metering: `app/api/files/commit/route.ts:97` calls
  `recordUsage(orgId, 'storage.bytes', …)` on every commit, chat included.
- They **are** visible in the File Vault: `lib/fileCategories.ts:185` maps
  `category === 'message'` to the `chat` folder, which is a first-class vault folder with a
  label and description (`lib/fileCategories.ts:140`, `:150`) rendered by
  `components/shared/FileVault.tsx:279-281`, `components/portal/AllFilesVault.tsx:229-230`
  and `components/admin/AdminFileVault.tsx:94`.
- They **do** carry a category (`'message'`) and a folder (`'chat'`).

What **is** true, and is the real defect AD-004 should be re-scoped to:

- `messages.attachment_url` stores a `"bucket::path"` **string, not a `files.id` FK**
  (`components/portal/MessagesHub.tsx:450`). The link between a message and its file row is by
  path, so it cannot be joined, is not enforced by a constraint, and breaks if the object moves.
- The value arrives **from the request body** and is never validated against a `files` row:
  `app/api/portal/actions/route.ts:225` and `app/api/admin/project-actions/route.ts:123` write
  whatever the client sent.
- Soft-deleting a message nulls `attachment_url`
  (`app/api/portal/messages/delete/route.ts:43`) but leaves the `files` row and the R2 object —
  an orphan.
- There is **no resumable multipart uploader**. `lib/uploadClient.ts:68-85` is a single
  `XMLHttpRequest` PUT with no retry and no resume, so a 5 GB attachment restarts from zero on
  any network blip. The multipart code in `lib/r2.ts:39-107` is server-side, buffers the whole
  body in memory, uses a 5 GB threshold and 256 MB chunks (`lib/r2.ts:32-37`), and is dead —
  nothing imports `uploadToR2`.
- `provenance` is a genuine gap, but not specific to chat: `asset_provenance`
  (migration `0003`) has **zero** reads or writes anywhere in the codebase.

**Consequence for S6:** AD-004 as written would have someone "delete code" to stop chat
attachments bypassing the file pipeline. They already go through it. The work that actually
needs doing is the FK, the body-trust fix, the orphan cleanup, and the resumable uploader —
which is *adding* code, not deleting it. AD-004 needs a superseding entry before it can be
sequenced.

### 2. AD-002's "from day one" `region` column does not exist

S0 AD-002 states `organizations` carries a `region` column from day one. It does not:
`supabase/migrations/0001_multitenancy.sql:18-27` defines `organizations` as
`id, name, subdomain, logo_url, branding, plan, created_at, updated_at`. No migration adds
`region`. This is a build task, not a violation — noted so it is not assumed present.

### 3. `is_client_member()` is not entirely unadopted

S0 AD-001 says `is_client_member()` was "built for exactly this pivot and never adopted."
It is adopted — by two policies, both on the membership tables themselves:
`supabase/migrations/0012_memberships.sql:82` (`client_members_team_read`) and
`supabase/migrations/0013_member_scoping.sql:35` (`client_member_projects_team_read`).
The accurate statement is that **no policy on a work table** — `clients`, `projects`, `files`,
`messages`, `tasks`, `invoices`, `notifications`, `project_phases`, `activity_log` — uses it;
those still key off `clients.user_id = auth.uid()`. The distinction matters because it means
invited teammates are already invisible to every client-side RLS policy on real data.

---

# Part A — Architecture decisions

## AD-001 — Authorization boundary: layered, tenancy in the database

| Field | Content |
|---|---|
| **ID** | AD-001 |
| **Status** | **VIOLATES** |

**Violations**

*Service role on user-session paths (the core of the violation)*

`supabaseAdmin` is imported by **65 modules**; 33 of the 41 route handlers and 22 page/layout
Server Components. Every one is a user-session path. The full import list:

Page and layout Server Components (all reachable by a logged-in user):
- `app/(portal)/layout.tsx:4` — resolves the client record and business settings as service role on every portal request.
- `app/(portal)/dashboard/page.tsx:4` — projects, tasks, messages, invoices, phases.
- `app/(portal)/projects/page.tsx:3`, `app/(portal)/projects/[id]/page.tsx:4` — project reads.
- `app/(portal)/files/page.tsx:4` — file vault.
- `app/(portal)/messages/page.tsx:4` — threads.
- `app/(portal)/invoices/page.tsx:4`, `app/(portal)/dashboard/invoices/page.tsx:4` — invoices.
- `app/(portal)/approvals/page.tsx:7` — approvals queue.
- `app/(portal)/dashboard/settings/page.tsx:4` — settings.
- `app/studio/layout.tsx:3` — org name, crew activation, crew status.
- `app/studio/client/review/page.tsx:5` — cross-project approvals.
- `app/onboarding/page.tsx:3` — onboarding.
- `app/(admin)/admin/layout.tsx:6` and 11 further `(admin)` pages (`clients/[id]/edit:3`, `clients/[id]:3`, `clients:3`, `dashboard:2`, `files:3`, `invoices/new:3`, `invoices:3`, `messages:3`, `page:2`, `projects/[id]/edit:3`, `projects/[id]:3`, `projects/new:3`, `projects:3`) — currently unreachable behind the proxy redirect, but still service-role page code.

Route handlers:
`app/api/activity` (via `lib/logActivity.server.ts:3`), `admin/badge-counts:4`,
`admin/client-team:3`, `admin/create-project:4`, `admin/deadline-check:4`,
`admin/delete-client:3`, `admin/invite-client:3`, `admin/invoice-actions:4`,
`admin/messages:4`, `admin/notifications:4`, `admin/project-actions:4`,
`admin/project-image:4`, `admin/team:3`, `admin/update-client:3`, `cron/message-nudge:3`,
`files/[id]/download:4`, `files/[id]/raw:4`, `files/[id]:3`, `files/commit:3`,
`files/signed-url:4`, `portal/actions:3`, `portal/avatar:4`, `portal/badge-counts:4`,
`portal/messages/attachment:4`, `portal/messages/delete:3`, `portal/messages/edit:3`,
`portal/messages:4`, `portal/notifications:5`, `portal/onboarding:3`, `portal/team:3`,
`presence/heartbeat:4`, `project-tasks:3`, `push/subscribe:4`, `webhooks/stripe:3`.

Library modules: `lib/credits.ts:3`, `lib/logActivity.server.ts:3`, `lib/notify.ts:3`,
`lib/push.ts:4`, `lib/team.ts:4`, `lib/uploadScope.ts:4`, `lib/usage.ts:3`.

Two handlers additionally build their own service-role client inline instead of importing the
shared one: `app/api/admin/create-client/route.ts:28-37` and
`app/api/admin/resend-invite/route.ts:36-38`.

Of these, only three are legitimate under AD-001's allowlist (no user session):
`app/api/webhooks/stripe/route.ts`, the `GET` half of `app/api/cron/message-nudge/route.ts`,
and the `auth.admin.inviteUserByEmail` / `createUser` / `updateUserById` calls in the invite
routes. Everything else is a read or write on a cookie-bound request.

*Client-side RLS still keys on `clients.user_id`, not membership*

Every client-facing policy in the baseline predicates on `clients.user_id = auth.uid()`, so an
invited teammate (a `client_members` row whose company's `clients.user_id` is someone else's)
matches **no** client-side policy on any work table:
- `supabase/migrations/0000_baseline_schema.sql:409-411` (`activity_log`)
- `:415`, `:416`, `:417` (`clients` — self only)
- `:422-425` (`files` select), `:426-432` (`files` insert)
- `:437-440` (`invoices`)
- `:445-449` (`messages`)
- `:454-457` (`notifications`)
- `:462-463` (`project_phases`)
- `:468-469` (`projects`)
- `:474-476` (`tasks`)
- `supabase/migrations/20260604_phase8.sql:79-88` (`activity_log`, re-created)

*The JWT does not carry the org claim, and nothing stamps it*

- `public.current_org()` (`supabase/migrations/0001_multitenancy.sql:35-37`) reads
  `app_metadata->>'organization_id'`, returning NULL when absent.
- 12 policies gate on `organization_id = current_org()`: `0002:49,51-52,54`, `0003:50-51,53-54`,
  `0004:27-28`, `0005:29-30`, `0006:31-32`, `0007:42-43,46-47`, `0011:25`, plus `0001:69,72-73`
  on `organizations` itself. With a NULL claim all of them evaluate to NULL → **empty result
  set, no error**. Every browser-client read of `documents`, `document_versions`,
  `document_comments`, `storyboards`, `storyboard_shots` runs through these policies
  (`components/studio/ScriptHome.tsx:279-285`, `components/studio/DocEditor.tsx:659`,
  `components/studio/DocComments.tsx:93`, `components/studio/StoryboardBoard.tsx:34`,
  `components/studio/StoryboardHome.tsx:31`).
- The claim is set only for users created through `app/api/admin/create-client/route.ts:146`,
  `app/api/admin/invite-client/route.ts:102`, `app/api/admin/team/route.ts:62`,
  `app/api/admin/client-team/route.ts:69`, `app/api/portal/team/route.ts:96`. Whether the
  pre-existing owner account carries it is **UNKNOWN** (live-data question).
- There is no Custom Access Token Hook anywhere in the repo.

*No RLS test harness, no lint rule*

- No test framework: `package.json:5-10` has `dev`, `build`, `start`, `lint` and nothing else;
  no test files exist.
- `eslint.config.mjs:4-18` adds only an `ignores` block on top of the Next presets — no
  `no-restricted-imports` rule guarding `@/lib/supabase/admin`.

*Two admin-realtime policies read the user-editable `user_metadata` first*

- `supabase/migrations/20260603_phase7.sql:44-52` creates `admin_realtime_select_<table>` on
  `tasks`, `activity_log`, `notifications`, `project_phases`, `projects`, `messages`, `files`,
  `invoices` with `coalesce(auth.jwt()->'user_metadata'->>'role', auth.jwt()->'app_metadata'->>'role') = 'admin'`.
- `supabase/migrations/20260604_phase8.sql:69-75` does the same for `activity_log`.

`user_metadata` is writable by the end user via `supabase.auth.updateUser({ data })`. The
`0000` baseline was captured *after* these were removed and replaces them with
`public.is_admin()` (`0000:319-321`, app_metadata only) — but the phase files are still on
disk and sort **after** `0000` (see I-12). Whether they are currently applied to production is
**UNKNOWN**; the hazard is that any filename-ordered run re-applies them.

| Field | Content |
|---|---|
| **Blast radius** | **65 modules** to migrate off `supabaseAdmin` (33 route handlers, 22 page/layout components, 7 lib modules, 2 inline constructions, plus `lib/supabase/admin.ts` itself). **~20 RLS policies** to rewrite from `clients.user_id` to `is_client_member()`. **2 policy families** (phase7's 8 tables + phase8's 1) to delete. **1** new auth hook. **1** new test harness (new surface). **1** ESLint rule. Migration is per-surface and can be staged. |
| **Blocked by** | S1 (tenancy model — the membership predicate cannot be written until `clients` vs `organizations` is settled); S2 (authorization spec); the RLS test harness, which AD-001 §2 makes a prerequisite; the JWT org-claim hook, which must land before any `current_org()`-gated read flips to the user client, or live Workspace surfaces go blank. |

---

## AD-002 — Region: United States, single region

| Field | Content |
|---|---|
| **ID** | AD-002 |
| **Status** | **PARTIAL** |

**Violations**

- `organizations` has **no `region` column**: `supabase/migrations/0001_multitenancy.sql:18-27`
  defines `id, name, subdomain, logo_url, branding, plan, created_at, updated_at`. No later
  migration adds one. AD-002's "from day one" has not happened.

**Conforming**

- No region is hardcoded in application logic. The only occurrence of the word is
  `lib/r2.ts:17` — `region: 'auto'`, which is the required literal for a Cloudflare R2
  S3-compatible endpoint, not a data-residency assumption.
- The Supabase project region is not referenced in code at all.

| Field | Content |
|---|---|
| **Blast radius** | 1 new migration (add nullable `region text` + backfill the sentinel org). 0 code files today — nothing reads it yet. |
| **Blocked by** | Nothing. This is the cheapest S0 item in the repo and can land independently of S1. |

---

## AD-003 — Person deletion: tombstone, never cascade

| Field | Content |
|---|---|
| **ID** | AD-003 |
| **Status** | **PARTIAL** — FK half done; tombstone exists as an on-demand erasure (Batch 12.2), not yet as an automatic step of removal |

**Conforming (the FK half)**

- `supabase/migrations/0016_member_lifecycle.sql:24-50` rewrites every `public.*` FK onto
  `auth.users` to `ON DELETE SET NULL`, dropping the `NOT NULL` where needed, with
  `push_subscriptions` deliberately left `ON DELETE CASCADE` (lines 39-42). Deleting a person
  no longer deletes their work.

**Conforming since Batch 12.2 (the tombstone half, on demand)**

- `lib/erasure.ts` is the pseudonymisation routine: one stable pseudonym across
  `messages.sender_name`, `files.uploaded_by_name` (both author columns),
  `activity_log.actor_name`, `document_versions.created_by_name`,
  `document_comments.author_name`; the raw address scrubbed from
  `notifications` copy and `activity_log.meta`; leftover `revoked` membership
  rows deleted; the auth account deleted last so a partial run is resumable.
  App-level, not a SQL function — no pending-migration window.
- Surfaced at `POST /api/admin/erase-person` (zod-validated, I-7) and in
  Settings → Data & Privacy. Gated to an owner on the plan carrying
  `platform.erasure` (house only) because the rewrite crosses tenants; S3 owns
  per-tenant self-serve erasure.

**Still open (the automatic half)**

- Ordinary member REMOVAL still keeps names verbatim — the tombstone runs only
  when erasure is invoked, which AD-003's wording permits but S0 §5's 30-day
  erasure clock now has an answer for. No trigger exists.
- Denormalised display names therefore survive deletion verbatim at every site:
  - `messages.sender_name` — `supabase/migrations/0000_baseline_schema.sql:146` (`not null`),
    written at `app/api/portal/actions/route.ts:223`,
    `app/api/admin/project-actions/route.ts:121`, `:557`,
    `app/api/admin/deadline-check/route.ts:58`.
  - `files.uploaded_by_name` — `0000:108`. (Note: `/api/files/commit` does **not** populate it —
    `app/api/files/commit/route.ts:72-88` writes `uploaded_by` and `uploaded_by_role` only — so
    the column is largely stale/empty for R2-era uploads, which is its own data-model question.)
  - `activity_log.actor_name` — `0000:45` (`not null`), written at
    `lib/logActivity.server.ts:32`, `:70`, and via the `log_activity` RPC
    (`0000:323-335`) from `app/api/files/commit/route.ts:154-156`,
    `app/api/files/[id]/route.ts:56`, `app/api/admin/invoice-actions/route.ts:256`.
  - `document_versions.created_by_name` — `supabase/migrations/0005_document_versions.sql:20`.
  - `document_comments.author_name` — `supabase/migrations/0006_document_comments.sql:20`.
  - `client_members.name` / `organization_members.name` — `0012:18`, `0012:35`.
- ~~**Deletion is currently hard and unscoped.**~~ **CORRECTED, Batch 12.2 —
  this bullet described code that no longer exists.** Batch 6.2 replaced every
  one of these `auth.admin.deleteUser` calls with `cutMemberAccess()`
  (`lib/memberAccess.ts:55`): removal now deletes the MEMBERSHIP row and strips
  the claims, and the auth account survives every app path. The only
  `deleteUser` calls in the repo today are the provisioning rollback
  (`scripts/provision-tenant.ts`) and the erasure routine (`lib/erasure.ts`),
  which deletes the account deliberately, last, behind the platform-operator
  gate. The original text stands struck-through as the record of what this
  audit believed.
- `supabase/migrations/0016_member_lifecycle.sql:55-66` already ran one such purge (deleting
  every previously-`revoked` member's auth user and rows).
- **No soft-delete grace period anywhere.** S0 §5 specifies 90 days; no table has a
  `deleted_at` column and no code path defers a delete.

| Field | Content |
|---|---|
| **Blast radius** | 1 migration (pseudonymisation function + trigger or `on delete` hook covering 7 name columns). 4 route handlers to route deletion through it (`portal/team`, `admin/client-team`, `admin/team`, `admin/delete-client`). Separately, the cross-company deletion bug touches the same 4 handlers and depends on the S1 cardinality answer. |
| **Blocked by** | S1 for the cross-company deletion semantics (what "remove from this company" means when a person belongs to two). The pseudonymisation function itself is not blocked. |

---

## AD-004 — One file pipeline

| Field | Content |
|---|---|
| **ID** | AD-004 |
| **Status** | **PARTIAL** — and the decision's premise is inaccurate; see the flagged section above. |

**Conforming**

- One uploader for every surface: `lib/uploadClient.ts:26` `uploadFileToR2`, used by
  `components/shared/FileVault.tsx:183`, `components/shared/TaskBoard.tsx:387,447`,
  `components/portal/MessagesHub.tsx:442`, `components/portal/ProjectDetail.tsx:450,504`,
  `components/portal/InvoicesClient.tsx:79`, `components/admin/AdminMessagesHub.tsx:437`,
  `components/admin/AdminProjectDetail.tsx:450,540`,
  `components/admin/AdminInvoicesList.tsx:199`, `components/admin/NewInvoiceForm.tsx:165`.
- One authorization path: `lib/uploadScope.ts:18` `resolveUploadScope`, called by both
  `app/api/files/presign/route.ts:36` and `app/api/files/commit/route.ts:47`.
- One metering path: `app/api/files/commit/route.ts:97` → `lib/usage.ts:17`.
- Every uploaded byte **is** a `files` row (`app/api/files/commit/route.ts:70-90`), chat
  attachments included.

**Violations**

- `messages.attachment_url` is a `"bucket::path"` string, not a `files.id` FK —
  `supabase/migrations/0000_baseline_schema.sql:150`; constructed at
  `components/portal/MessagesHub.tsx:450`, `components/portal/ProjectDetail.tsx:461`,
  `components/admin/AdminMessagesHub.tsx:445`, `components/admin/AdminProjectDetail.tsx:548`,
  `components/shared/TaskBoard.tsx:390`, `:450`.
- That string is accepted straight from the request body and never checked against a `files`
  row: `app/api/portal/actions/route.ts:225`, `:98`, `:167`;
  `app/api/admin/project-actions/route.ts:123`, `:559`.
- Message soft-delete orphans the file and the R2 object:
  `app/api/portal/messages/delete/route.ts:43` nulls `attachment_url` only.
- **No resumable multipart uploader.** `lib/uploadClient.ts:68-85` is a single XHR PUT, no
  retry, no resume, no chunking. Against S0 §4's 5 GB attachment ceiling this is the binding
  defect.
- The server-side multipart code that does exist is dead and mis-parameterised:
  `lib/r2.ts:39-107` (`uploadToR2`) buffers the entire body in memory, thresholds at 5 GB
  (`lib/r2.ts:32-33`, vs S0's 100 MB) and chunks at 256 MB; nothing imports it.
- A second, entirely dead upload path still exists: `hooks/useFileUpload.ts:151` POSTs
  `FormData` to `/api/files/upload`, **a route that does not exist**; nothing imports the hook.
- No proxy/preview generation for large files — no transcode or thumbnail code anywhere.
- `asset_provenance` (`supabase/migrations/0003_provenance.sql:12-24`) and `rights` (`:29-39`)
  have zero reads and zero writes in the codebase, so no file carries provenance.
- `files` still has the duplicate-column drift called out in `0000:20`: `uploaded_by` (FK) and
  `uploaded_by_id` (orphan, `0000:106`), plus `uploaded_by_name` which the live commit path
  never populates.

| Field | Content |
|---|---|
| **Blast radius** | 1 migration (`messages.attachment_file_id` FK + backfill from `file_path`, drop the orphan columns). ~6 components that construct or read the `bucket::path` ref. 2 route handlers that accept it from the body. 1 new resumable uploader in `lib/uploadClient.ts` plus a presign-part / complete-part route pair (new surface). 2 dead modules to delete (`hooks/useFileUpload.ts`, `lib/r2.ts:39-107`). |
| **Blocked by** | A superseding S0 entry correcting AD-004's premise and re-scoping it — without that, the decision as written prescribes the wrong work. |

---

## AD-005 — FDX interoperability is an adoption gate

| Field | Content |
|---|---|
| **ID** | AD-005 |
| **Status** | **NOT-YET-APPLICABLE** |

**Violations** — none, because nothing exists to violate. There is **no occurrence of `fdx`,
`final draft` or `fountain`** anywhere in `app/`, `lib/`, `components/`, `hooks/` or the
planning docs. Script Design has no import and no export of any format: the only exports in
`components/studio/ScriptDesign.tsx` and `components/studio/ScriptHome.tsx` are the React
default exports (`ScriptDesign.tsx:21`, `ScriptHome.tsx:229`).

What exists to build on: `documents` + `documents.ydoc` (BlockNote/Yjs snapshot,
`supabase/migrations/0004_documents.sql:11-21`), `document_versions`
(`0005_document_versions.sql:12-22`), and the editor at `components/studio/DocEditor.tsx`.
The block model is BlockNote's, so FDX mapping is a new translation layer both ways.

| Field | Content |
|---|---|
| **Blast radius** | New surface: an FDX parser/serialiser module, a BlockNote↔FDX block mapping, an import route and an export route, plus UI entry points in `ScriptHome`/`ScriptDesign`. Touches ~4 new files and ~2 existing components. |
| **Blocked by** | The document-types question S0 §4 raises ("the better long-term answer is document *types*"): FDX maps to a screenplay type, and mapping it onto the current single generic `kind='script'` document will have to be redone if types land later. Sequence types first or accept the rework. |

---

## AD-006 — Review Session, not generic video meetings

| Field | Content |
|---|---|
| **ID** | AD-006 |
| **Status** | **NOT-YET-APPLICABLE** |

**Findings (accuracy check on the decision's own claims)**

- `components/studio/SessionDock.tsx` exists and is mounted globally in the studio shell
  (`app/studio/layout.tsx:84`), persists across navigation and survives refresh via
  `localStorage` (`lib/stores/session-store.ts:20-32`). **Confirmed as the container.**
- It is genuinely empty: the body renders a `PlayCircle` icon over a gradient with a caption
  and nothing else (`components/studio/SessionDock.tsx:74-80`).
- It is **not** a video shell today — it is a Storyboard⇄Workflow pairing. `SessionView` is
  `'storyboard' | 'workflow'` (`lib/stores/session-store.ts:7`) and the `F` key toggles between
  them (`SessionDock.tsx:17-19`). Repurposing it for synced playback is a rewrite of its state
  model, not a fill-in.
- The only opener is `components/studio/StudioTopbar.tsx:14` (`open` from the store); nothing
  passes a project id or asset — the title is whatever string the topbar supplies.
- **LiveKit is not installed.** It appears in no dependency of `package.json` and in no source
  file — only in `docs/throughline-architecture-wiring.md:27,114,117-118` (superseded as
  roadmap) and in `THROUGHLINE_STATE_OF_PLAY.md`.
- `plans.ts` does meter meeting minutes, as S0 claims: `lib/billing/plans.ts:18` declares
  `meetingMinutesPerMonth`, set per tier at `:25-28`. Nothing reads it —
  `planLimits`/`withinLimit` (`:31-38`) have no callers.
- `crew/meetings` is a stub card gated to nobody: `lib/studio/spaces.ts:27` declares it, and
  `lib/permissions.ts:144` maps `'crew/meetings': null`, meaning **any** crew member passes the
  gate (`lib/permissions.ts:184`).
- There is no timecode, playhead, frame or comment-on-frame model anywhere: `tasks` carries the
  approval workflow (`0000:226-232`) but has no time-based anchor, and `document_comments`
  anchors to a text range (`0010_comment_anchors.sql:11`), not a frame.

| Field | Content |
|---|---|
| **Blast radius** | New surface. Rewrites `lib/stores/session-store.ts` and `components/studio/SessionDock.tsx`; adds a LiveKit dependency, a token-mint route, a synced-playhead transport, a timecoded-comment table + migration, and a player component. Touches ~2 existing files, ~6 new. Also intersects I-2 (a Review Session adds subscriptions to a session that is already far over budget). |
| **Blocked by** | I-2 remediation (the per-session channel budget), and the S5 infrastructure spec for the transcode/proxy layer — frame-accurate synced playback needs a normalised proxy render, which nothing in the repo produces. |

---

# Part B — Invariants

## I-1 — Every collection query is keyset-paginated. No offset pagination. No unbounded `select`.

| Field | Content |
|---|---|
| **ID** | I-1 |
| **Status** | **VIOLATES** |

**Conforming**: no offset pagination exists — `.range(` appears **zero** times in the codebase,
so there is nothing to migrate away from. Nothing is keyset-paginated either.

**Violations — 67 unbounded collection selects** across 34 files (no `.limit()`, no
`.single()`, no head-count). Every one returns the entire matching set:

*Portal (client-facing, the live surface)*
1. `app/(portal)/dashboard/page.tsx:151` — all projects for the client.
2. `app/(portal)/dashboard/page.tsx:178` — all tasks across all those projects.
3. `app/(portal)/dashboard/page.tsx:191` — all unread admin message ids.
4. `app/(portal)/dashboard/page.tsx:205` — all invoices for the client.
5. `app/(portal)/dashboard/page.tsx:208` — all phases across all projects.
6. `app/(portal)/projects/page.tsx:42` — all projects.
7. `app/(portal)/projects/page.tsx:57` — all phases.
8. `app/(portal)/projects/page.tsx:60` — all tasks.
9. `app/(portal)/projects/page.tsx:63` — all files (id+direction) across all projects.
10. `app/(portal)/projects/[id]/page.tsx:71` — all phases for the project.
11. `app/(portal)/projects/[id]/page.tsx:76` — all tasks for the project.
12. `app/(portal)/projects/[id]/page.tsx:81` — all files for the project.
13. `app/(portal)/projects/[id]/page.tsx:87` — **entire message history** from `historyFrom`.
14. `app/(portal)/projects/[id]/page.tsx:93` — **entire message history**, unfiltered branch.
15. `app/(portal)/messages/page.tsx:28` — all projects (thread list).
16. `app/(portal)/messages/page.tsx:49` — **every message across every project**, `select('*')`.
17. `app/(portal)/messages/page.tsx:58` — all unread admin message rows.
18. `app/(portal)/files/page.tsx:36` — **every file the client owns**, `select('*')`.
19. `app/(portal)/files/page.tsx:41` — all projects.
20. `app/(portal)/invoices/page.tsx:30` — all invoices with joined project.
21. `app/(portal)/dashboard/invoices/page.tsx:35` — all invoices with joined project.
22. `app/(portal)/approvals/page.tsx:82` — all projects.

*Admin/legacy pages*
23. `app/(admin)/admin/clients/[id]/page.tsx:42` — client record + nested projects.
24. `app/(admin)/admin/clients/[id]/page.tsx:88` — all invoices for the client.
25. `app/(admin)/admin/clients/page.tsx:25` — **all clients**.
26. `app/(admin)/admin/dashboard/page.tsx:22` — all projects + nested tasks.
27. `app/(admin)/admin/dashboard/page.tsx:48` — all clients + nested projects.
28. `app/(admin)/admin/dashboard/page.tsx:65` — activity log with joins.
29. `app/(admin)/admin/dashboard/page.tsx:80` — **all invoice amounts, ever** (for a total).
30. `app/(admin)/admin/files/page.tsx:26` — **every file in the system**, `select('*')` + joins.
31. `app/(admin)/admin/invoices/new/page.tsx:21` — all clients.
32. `app/(admin)/admin/invoices/new/page.tsx:26` — all non-completed projects.
33. `app/(admin)/admin/invoices/page.tsx:25` — **all invoices**, `select('*')` + joins.
34. `app/(admin)/admin/messages/page.tsx:18` — all projects + client join.
35. `app/(admin)/admin/messages/page.tsx:33` — **every message in the system**, `select('*')`.
36. `app/(admin)/admin/messages/page.tsx:39` — all unread client message rows.
37. `app/(admin)/admin/page.tsx:18` — all projects + nested tasks/files/messages.
38. `app/(admin)/admin/page.tsx:34` — all clients + nested projects.
39. `app/(admin)/admin/page.tsx:54` — all invoice amounts.
40. `app/(admin)/admin/projects/[id]/edit/page.tsx:24` — all clients.
41. `app/(admin)/admin/projects/[id]/page.tsx:22` — project + client join.
42. `app/(admin)/admin/projects/[id]/page.tsx:39` — all phases.
43. `app/(admin)/admin/projects/[id]/page.tsx:44` — all tasks.
44. `app/(admin)/admin/projects/[id]/page.tsx:49` — all files.
45. `app/(admin)/admin/projects/[id]/page.tsx:54` — **entire message history**.
46. `app/(admin)/admin/projects/new/page.tsx:18` — all clients.
47. `app/(admin)/admin/projects/page.tsx:19` — all projects with four nested collections.

*Route handlers*
48. `app/api/admin/deadline-check/route.ts:31` — every task in `review` system-wide.
49. `app/api/admin/deadline-check/route.ts:87` — every project with a due date.
50. `app/api/admin/invoice-actions/route.ts:45` — all invoices for a project.
51. `app/api/admin/messages/route.ts:19` — **entire thread**, `select('*')`, polled every 10s by `components/admin/AdminProjectDetail.tsx:332`.
52. `app/api/admin/project-actions/route.ts:41` — all phases.
53. `app/api/admin/project-actions/route.ts:264` — all phases.
54. `app/api/admin/project-actions/route.ts:276` — all tasks.
55. `app/api/admin/project-actions/route.ts:322` — all tasks, `select('*')`.
56. `app/api/admin/team/route.ts:25` — entire crew roster.
57. `app/api/portal/badge-counts/route.ts:26` — all project ids, hit every 15s by `components/layout/Sidebar.tsx:100`.
58. `app/api/portal/messages/route.ts:46` — **entire thread**, `select('*')`, polled every 10s by `components/portal/ProjectDetail.tsx:322`.
59. `app/api/portal/team/route.ts:37` — all projects for the company.
60. `app/api/portal/team/route.ts:118` — project-scope validation set.
61. `app/studio/client/review/page.tsx:115` — approvals queue with joins.

*Studio / library*
62. `components/studio/DocComments.tsx:93` — every comment on a document tab.
63. `components/studio/DocEditor.tsx:659` — every version snapshot for a doc tab.
64. `components/studio/StoryboardBoard.tsx:34` — every shot on a board.
65. `components/studio/StoryboardHome.tsx:31` — every storyboard.
66. `lib/push.ts:41` — **every push subscription matching the filter**; for
  `sendPushToAdmins` (`lib/push.ts:69`) that is every admin device across every org.
67. `lib/team.ts:198` — all project-scope rows for a member.

Additionally, `.limit(N)` where it *is* used is a hard truncation with no cursor — the tail is
silently dropped, not paged: `app/(portal)/approvals/page.tsx:106` (200),
`app/(portal)/dashboard/page.tsx:188` (200), `app/(portal)/projects/[id]/page.tsx:60` (500),
`app/(admin)/admin/projects/[id]/page.tsx:71` (500), `app/api/project-tasks/route.ts:44` (500),
`app/api/cron/message-nudge/route.ts:29` (500), `app/studio/client/review/page.tsx:122` (200),
`components/studio/ScriptHome.tsx:285`/`:296` (60),
`app/api/admin/notifications/route.ts:28`/`:35` (30),
`app/api/portal/notifications/route.ts:39` (30).

| Field | Content |
|---|---|
| **Blast radius** | **34 files**: 19 portal/admin page components, 8 route handlers, 1 studio page, 4 studio components, 2 lib modules. Each message and file surface additionally needs a client-side cursor UI, so the ~8 list components that render them change too. The messages and files surfaces are the load-bearing ones — every other list is bounded in practice by a client's project count. |
| **Blocked by** | Nothing technically. But paginating `messages` interacts with the 6s/10s poll loops in I-3 (a poll that refetches page 1 while the user is on page 3 is worse than no poll), so I-1 and I-3 should be sequenced together per surface. |

---

## I-2 — Every realtime channel is scoped to a tenant or room. Max 2 subscriptions per user session.

| Field | Content |
|---|---|
| **ID** | I-2 |
| **Status** | **VIOLATES** — on both halves. |

**Violations — globally-named channels (not scoped to tenant or room)**

Every user of every future tenant joins the same topic:
- `components/shared/PresencePulse.tsx:39` — `'presence:app'`. **One global presence channel
  for the entire product**, mounted in both `app/(portal)/layout.tsx:109` and
  `app/studio/layout.tsx:73`. Each member tracks `{ role, userId, clientId }`
  (`PresencePulse.tsx:46`) and every member reads the full presence state
  (`:52-66`). At two tenants this leaks the roster of one to the other, and presence traffic
  grows with the square of the *whole product*, not the room.
- `components/layout/Sidebar.tsx:104` — `'sidebar-badges'`.
- `components/admin/AdminSidebar.tsx:90` — `'admin-sidebar-badges'`.
- `components/studio/StudioSidebar.tsx:56` — `'studio-sidebar-badges'`.
- `components/admin/AdminNotificationBell.tsx:72` — `'admin-notifications'`.
- `components/admin/AdminDashboard.tsx:185` — `'admin-activity-notifs'`.
- `components/studio/ScriptHome.tsx:310` — `'docs-home'`.
- `components/studio/TeamManager.tsx:64` — `'studio-crew-roster'`.
- `components/portal/ClientTeamManager.tsx:76` — `'portal-team-roster'`.

**Violations — unfiltered `postgres_changes` listeners**

These subscribe to *every* row change on a table and rely on RLS to filter delivery, which
means the server evaluates the policy per subscriber per row:
- `components/shared/PresencePulse.tsx:104-106` — `messages` INSERT, no filter, app-wide, one per session.
- `components/layout/Sidebar.tsx:105-110` — `messages`, `invoices`, `tasks`, no filters.
- `components/admin/AdminSidebar.tsx:91`, `components/studio/StudioSidebar.tsx:57` — `messages`, no filter.
- `components/shared/RealtimeRefresh.tsx:33-39` — subscribes to every table it is handed, **unfiltered**. Mounted with up to 8 tables at once: `app/(portal)/dashboard/page.tsx:377` and `app/(admin)/admin/page.tsx:74`.

**Violations — subscriptions per session far exceed 2**

Counting a single client on `/projects/[id]`:

| Source | Channels |
|---|---|
| `PresencePulse` (`:39`, `:103`) | 2 |
| `Sidebar` (`:104`) | 1 |
| `useNotifications` via the bell (`lib/hooks/useNotifications.ts:68`) | 1 |
| `RealtimeRefresh` (`app/(portal)/projects/[id]/page.tsx:104`) | 1 |
| `ProjectDetail` (`:219` messages, `:274` typing, `:288` presence, `:346` phases, `:373` project) | 5 |
| `TaskBoard` (`:253` tasks, `:275` records) | 2 |
| `FileVault` (`:155` files) | 1 |
| **Total** | **13** |

Plus ephemeral channels created per action: `components/portal/ProjectDetail.tsx:310` and
`components/admin/AdminProjectDetail.tsx:320` each open a `typing:` channel to send a single
broadcast; `components/shared/PresencePulse.tsx:81-87` opens a `thread:` channel and removes it
1.5s later.

An admin on `/studio` with a message hub open reaches a comparable count via
`components/admin/AdminMessagesHub.tsx:276`, which opens **one channel per thread** in the list
(`threadChannelsRef`, `:290-296`) — unbounded in the number of projects. Same at
`components/portal/MessagesHub.tsx:282-302`.

**Conforming**

Room-scoped channel names are used correctly where they exist: `tasks:${projectId}`
(`TaskBoard.tsx:253`), `records:${projectId}` (`:275`), `files:${projectId}`
(`FileVault.tsx:155`), `thread:${projectId}` (`MessagesHub.tsx:282`), `doc:${docId}`
(`lib/collab/supabaseYjs.ts:47`), `comments:${docId}:${tabKey}` (`DocComments.tsx:106`),
`storyboard:${boardId}` (`StoryboardBoard.tsx:69`), `notifications:${clientId}:…`
(`useNotifications.ts:68`, correctly filtered at `:71`),
`admin-client-roster-${clientId}` (`ClientTeamPanel.tsx:60`),
`invoices:${projectId}` (`AdminInvoicesTab.tsx:100`). Cleanup is disciplined —
`removeChannel` is called in every effect teardown.

| Field | Content |
|---|---|
| **Blast radius** | **21 components** hold channels (34 `.channel()` call sites). Reaching "≤2 per session" is not a rename — it needs a single multiplexed per-session channel with a client-side event bus, which restructures `PresencePulse`, the three sidebars, both message hubs, both project details, `TaskBoard`, `FileVault`, `RealtimeRefresh` and the notification hooks. `lib/realtimeBus.ts` (a 37-line refcount) is the only existing coordination and would be replaced. Supabase's ~100-channels-per-connection ceiling (S0 §4) is not the binding limit; per-subscriber RLS evaluation is. |
| **Blocked by** | AD-001 — a multiplexed channel is only safe once RLS actually scopes rows to the member; today several of these channels are unfiltered and rely on policies that do not cover invited teammates at all. Also blocked on the tenant-scoping decision in S1 for `presence:app`'s replacement key. |

---

## I-3 — No polling where push exists.

| Field | Content |
|---|---|
| **ID** | I-3 |
| **Status** | **VIOLATES** |

**Violations — every one of these runs *alongside* a realtime subscription on the same data**

| Site | Interval | What it refetches |
|---|---|---|
| `components/portal/MessagesHub.tsx:327` | 6s | full thread refetch, per active thread |
| `components/admin/AdminMessagesHub.tsx:321` | 6s | full thread refetch |
| `components/shared/TaskBoard.tsx:347` | 7s | `/api/project-tasks` — tasks + up to 500 activity rows |
| `components/portal/ProjectDetail.tsx:322,339` | 10s | `/api/portal/messages` — **entire** thread |
| `components/admin/AdminProjectDetail.tsx:332,347` | 10s | `/api/admin/messages` — **entire** thread |
| `app/(portal)/projects/[id]/page.tsx:106` | 12s | full server re-render (`router.refresh()`) |
| `components/layout/Sidebar.tsx:100` | 15s | `/api/portal/badge-counts` |
| `components/admin/AdminSidebar.tsx:87` | 15s | `/api/admin/badge-counts` |
| `components/studio/StudioSidebar.tsx:54` | 15s | `/api/admin/badge-counts` |
| `app/(portal)/files/page.tsx:63` | 15s | full server re-render |
| `app/(admin)/admin/files/page.tsx:64` | 15s | full server re-render |
| `app/(admin)/admin/projects/[id]/page.tsx:128` | 15s | full server re-render |
| `lib/hooks/useNotifications.ts:22,62` | 20s | `/api/portal/notifications` |
| `components/admin/AdminNotificationBell.tsx:69` | 20s | admin notifications |
| `components/admin/AdminProjectDetail.tsx:190` | 20s | admin project notifications |
| `components/shared/PresencePulse.tsx:122` | 30s | `POST /api/presence/heartbeat` (heartbeat, not a refetch — but it is the polling substrate the whole away-detection design rests on) |
| `components/admin/AdminInvoicesTab.tsx:103` | 30s | invoice list |
| `app/(portal)/approvals/page.tsx:125` | 30s | full server re-render |
| `app/studio/client/review/page.tsx:133` | 30s | full server re-render |
| `app/(portal)/dashboard/page.tsx:378` | 30s | full server re-render, 8 tables of data |
| `app/(admin)/admin/page.tsx:75` | 30s | full server re-render, 8 tables of data |
| `app/(admin)/admin/projects/page.tsx:38` | 45s | full server re-render |
| `app/(admin)/admin/invoices/page.tsx:50` | 45s | full server re-render |
| `app/(admin)/admin/clients/page.tsx:40` | 45s | full server re-render |

Additionally `components/shared/PresencePulse.tsx:138` fires `POST /api/cron/message-nudge` on
**every app load** — a full cron scan (up to 500 messages, `app/api/cron/message-nudge/route.ts:29`)
triggered by page navigation.

Not a violation: `components/shared/VoiceRecorder.tsx:142` (1s UI elapsed-time counter, no I/O).

The comments make the intent explicit and self-incriminating —
`components/portal/ProjectDetail.tsx:320` "Polling fallback — every 10s",
`components/shared/TaskBoard.tsx:345` "ignore — realtime/other polls cover it",
`components/layout/Sidebar.tsx:102` "Realtime subscription still fires when replication is on".
The polls exist because realtime delivery was not trusted, and it was not trusted because RLS
does not cover the readers (AD-001).

| Field | Content |
|---|---|
| **Blast radius** | **24 sites across 19 files**, of which 13 are `RealtimeRefresh pollMs` props (a one-line change each once realtime is trusted) and 11 are hand-rolled `setInterval` loops in components. Removing the polls is cheap; *earning the right to* is the AD-001 work. |
| **Blocked by** | AD-001 and I-2. Deleting a poll before the corresponding RLS policy covers the reader turns a slow surface into a silently stale one — worse for a live client than the poll. Each poll must be removed only after its channel is verified to deliver for that reader, which is exactly what the RLS test harness is for. |

---

## I-4 — Any operation exceeding ~5s runs on a queue, not in a request.

| Field | Content |
|---|---|
| **ID** | I-4 |
| **Status** | **VIOLATES** |

**Violations**

- **There is no queue.** No queue library in `package.json`, no worker, no job table in any
  migration. The only scheduled execution is one Vercel cron entry: `vercel.json:3`,
  `GET /api/cron/message-nudge` daily at 09:00.
- **The AI call is a long-lived streaming request.** `app/api/studio/muse/route.ts:130-172`
  proxies a provider SSE stream through the route for the full generation. No route segment
  config exists anywhere in `app/` (`export const maxDuration` / `runtime` return zero
  matches), so it runs on the platform default.
- **The cron scan is unbounded in work, bounded only in input.**
  `app/api/cron/message-nudge/route.ts:21-29` pulls up to 500 messages, then loops per group
  (`:44-69`) doing a `notifyAwayRecipient` — each of which does 1 DB read plus up to three
  network sends (push, SMS, email) at `lib/notify.ts:254-262`, all inside the request.
- **The same scan is triggered from every page load** (`components/shared/PresencePulse.tsx:138`),
  so it runs at user-navigation frequency in a user-facing request path.
- **Project creation does 5+ sequential writes in one request**:
  `app/api/admin/create-project/route.ts:54` (project), `:83` (image), `:111` (phases),
  `:143` (tasks), `:164` (invoice) — plus notification and activity writes.
- **Client deletion is a multi-step cascade in-request**:
  `app/api/admin/delete-client/route.ts:44` (null out projects), `:55` (delete client),
  `:66` (delete the auth user).
- **Push fan-out is in-request**: `lib/push.ts:45-55` `Promise.all`s a `webpush.sendNotification`
  per device, with a DB delete per expired endpoint, inside whatever request triggered the
  notification.
- The infrastructure gap is acknowledged but unaddressed:
  `docs/throughline-architecture-wiring.md:6` names a "job-queue/worker" that does not exist.

| Field | Content |
|---|---|
| **Blast radius** | New surface — a queue is a whole subsystem (table + worker + retry + dead-letter, or a hosted service). Once it exists, ~6 call sites move onto it: the AI generation boundary, the nudge scan, push fan-out, project creation, client deletion, and (when built) transcode. |
| **Blocked by** | S5 (infrastructure spec) — the job-queue selection is explicitly carried forward in S0 §7. The solo-maintainer / no-fixed-monthly-floor constraint in S0 §6 rules out most hosted options, so this is a real decision, not a default. |

---

## I-5 — Every AI call carries a per-call ceiling and an org budget check before execution.

| Field | Content |
|---|---|
| **ID** | I-5 |
| **Status** | **VIOLATES** |

There is exactly one AI call path in the codebase: `app/api/studio/muse/route.ts`.

**Violations**

- **No per-call ceiling.** S0 §4 sets $2 with explicit confirm above. Nothing in
  `app/api/studio/muse/route.ts` computes a projected cost before dispatch, and no confirm
  step exists. The only bound is a provider token cap, applied to **one of three providers**:
  `max_tokens: 2000` for Anthropic (`:137`). The OpenAI request (`:162-170`) and the Google
  request (`:153-156`) send **no output limit at all**.
- **The budget check is not a budget check.** `:75` is
  `if (credit.hardStop && credit.balanceCents <= 0)`. `hardStop` comes from
  `org_budgets.hard_stop` (`lib/credits.ts:31`), which is declared
  `not null default false` (`supabase/migrations/0002_cost_metering.sql:28`). **So the default
  state is: no gate.** S0 §4 says hard-stop at zero balance is *on by default, opt-out only* —
  the schema default is the exact inverse.
- **`org_budgets.monthly_cap_cents` and `alert_pct` are never read.**
  `supabase/migrations/0002_cost_metering.sql:27,28` define them; `lib/credits.ts:31` selects
  only `hard_stop`. No cap is enforced and no alert is ever sent.
- **Charging happens after the fact, unawaited, and is skipped on failure.**
  `app/api/studio/muse/route.ts:83-85` defines `charge` as a `void chargeCredits(...)`
  fire-and-forget, invoked from the stream's `onDone` (`:99`) and `cancel` (`:120`) callbacks.
  If `chargeCredits` rejects, nothing catches it (`lib/credits.ts:43-56` has no error handling
  on either the `usage_events` insert or the RPC). A stream that errors mid-flight bills nothing.
- **Cost is estimated from character counts, not reported token usage.**
  `lib/credits.ts:22-26` divides characters by 4 against a hardcoded rate table
  (`:10-19`) whose model ids are stale relative to the registry. The provider's actual usage
  numbers, which all three APIs return, are discarded.
- **`planLimits` / `withinLimit` are dead.** `lib/billing/plans.ts:31-38` has no callers, so no
  plan quota gates anything — including `meetingMinutesPerMonth` and `storageGb`.
- The house-org bypass S0 §6 and the memory-of-record require is half-built:
  `lib/billing/plans.ts:32` returns the `house` plan for `DEFAULT_ORG_ID` — but since
  `planLimits` is never called, the bypass has no effect, and the credit gate at
  `muse/route.ts:75` does **not** exempt the house org.

| Field | Content |
|---|---|
| **Blast radius** | 3 files today (`app/api/studio/muse/route.ts`, `lib/credits.ts`, `lib/billing/plans.ts`) + 1 migration (flip `org_budgets.hard_stop` default to `true`, backfill existing rows). Small now — and it is the only moment it will ever be this small. Every future generation surface (The Stage, Remaster, Finishing, Model Arena, Continuity — `lib/studio/spaces.ts:65-72`) inherits whatever shape this ends up with. |
| **Blocked by** | Nothing. This is the highest ratio of financial risk to remediation cost in the report and has no upstream dependency. |

---

## I-6 — Ownership is resolved server-side from the session. Never read a tenant identifier from the request body.

| Field | Content |
|---|---|
| **ID** | I-6 |
| **Status** | **PARTIAL** |

**Conforming — the pattern is right in the places that matter most**

- `app/api/portal/actions/route.ts:13-30` `verifyClient()` resolves the client from the session
  and every branch uses `client.id`, never a body value; `send_message` additionally verifies
  the project belongs to that client (`:206-211`).
- `app/api/files/presign/route.ts:36` and `app/api/files/commit/route.ts:47` both route through
  `lib/uploadScope.ts`, which derives the client from `userId` for non-admins
  (`lib/uploadScope.ts:34-40`, `:45-51`) and rejects a mismatched body `clientId` (`:48-50`).
- `app/api/activity/route.ts:29-31` takes the actor from the session, explicitly, with a comment.
- `app/api/portal/notifications/route.ts:8-18` scopes every read and write to the
  session-resolved `clientId` (`:37`, `:79`, `:83`).
- `app/api/portal/messages/edit/route.ts:29` and `delete/route.ts:29` verify `sender_id` against
  the session before mutating.
- `app/api/studio/credits/checkout/route.ts:15` and `credits/route.ts:11` take the org from
  `userOrgId(user)`, never the body.

**Violations**

- `app/api/admin/create-project/route.ts:46,58` — `client_id` comes straight from the request
  body and is written to `projects` with **no check that the client belongs to the caller's
  org**. This is the single clearest cross-tenant write once a second org exists.
- `lib/uploadScope.ts:53-56` — for `role === 'admin'` with no `projectId`, the scope is
  `bodyClientId` with no ownership check at all; the R2 key prefix becomes `<anyClientId>/_general`.
- `app/api/admin/messages/route.ts:13-22` (GET) and `:39-68` (PATCH) — any admin may read or
  mutate the message history of **any** `project_id`, no org check.
- `app/api/files/signed-url/route.ts:41` — `if (!isAdmin(user))`: any admin mints a signed URL
  for **any** file id.
- `app/api/files/[id]/route.ts:16` — any admin deletes **any** file id (and its R2 object,
  `:38`).
- `app/api/files/[id]/download/route.ts` and `raw/route.ts` — same admin-sees-all shape.
- `app/api/project-tasks/route.ts:22` — `if (!admin)` gates only clients; any admin reads any
  project's tasks and records.
- `app/api/admin/invoice-actions/route.ts:45` — invoices fetched by body `project_id`, no org check.
- `app/api/admin/project-actions/route.ts` — the whole handler operates on a body `project_id`
  with no org check (`:41`, `:264`, `:276`, `:322`).
- `app/api/admin/project-image/route.ts`, `update-client/route.ts`, `delete-client/route.ts`,
  `client-team/route.ts` (`:60`, `:86`, `:99`, `:111`, `:127`, `:137`, `:148`) — all key off a
  body id with only an `isAdmin` gate.
- `app/api/activity/route.ts:17,27-28` — `projectId` and `clientId` come from the body with
  **no authorization that the caller may write against them**. Any authenticated user can
  insert an `activity_log` row against any project or client, with an arbitrary `eventType`,
  `title`, `body` and `meta`. The actor name is the session's, so entries are attributable —
  but the *target* is forgeable, which is the "forgeable activity log entries" risk in S0 §7.
- `app/api/portal/actions/route.ts:225` and `app/api/admin/project-actions/route.ts:123` —
  `attachment_url` is written from the body unvalidated (see AD-004).

Note that with exactly one organization these are latent rather than exploited: `isAdmin` is
currently equivalent to "belongs to the only tenant". They become live cross-tenant holes on
the day a second org exists, which is the day the product ships.

| Field | Content |
|---|---|
| **Blast radius** | **~14 route handlers** plus `lib/uploadScope.ts`. The fix is mechanical once there is a single helper — "resolve the caller's org, and assert the target row belongs to it" — but that helper cannot be written before S1 defines what "the caller's org" means for a client-side user. |
| **Blocked by** | S1 (tenancy model). Partially mitigated for free by AD-001: under correct RLS with the user client, several of these stop being reachable regardless of the body value. |

---

## I-7 — Every API boundary validates input against a schema.

| Field | Content |
|---|---|
| **ID** | I-7 |
| **Status** | **VIOLATES** — completely. |

**Violations**

- **Zero schema validation exists.** `zod` is in `package.json:41` and
  `@hookform/resolvers` at `:14`, but there are **no imports of `zod` anywhere** in `app/`,
  `lib/`, `components/` or `hooks/`. Same for `react-hook-form` (`package.json:31`) — zero
  imports.
- All **41 route handlers** destructure `await req.json()` directly. Representative sites:
  `app/api/activity/route.ts:16-17`, `app/api/files/commit/route.ts:24-37` (12 fields, none
  typed or checked beyond two presence tests at `:39`), `app/api/portal/actions/route.ts:39-40`
  (a switch on a body-supplied `action` string), `app/api/admin/project-actions/route.ts`
  (same shape), `app/api/admin/create-project/route.ts:30-44`,
  `app/api/portal/team/route.ts:66`, `:147`, `:175`,
  `app/api/admin/team/route.ts` (3 separate `req.json()` calls),
  `app/api/studio/muse/route.ts:47`.
- Where validation exists it is ad-hoc and inconsistent — presence checks
  (`app/api/activity/route.ts:19`), allowlists (`app/api/portal/team/route.ts:68` roles,
  `:153-157` caps, `:149-152` status), clamps
  (`app/api/studio/credits/checkout/route.ts:14`), or nothing at all
  (`app/api/files/commit/route.ts` accepts any `category`, `folder`, `taskId`, `fileSize`).
- Several handlers call `req.json()` without a `.catch()`, so a malformed body throws into the
  handler rather than returning 400: `app/api/files/commit/route.ts:37`,
  `app/api/files/presign/route.ts:24`, `app/api/portal/messages/edit/route.ts:12`,
  `app/api/portal/messages/delete/route.ts:12`, `app/api/portal/actions/route.ts:39`,
  `app/api/admin/messages/route.ts:39`.
- Query-parameter boundaries are equally unvalidated:
  `app/api/project-tasks/route.ts:18`, `app/api/admin/messages/route.ts:13` take a raw
  `project_id` string.

**Conforming**: nothing.

| Field | Content |
|---|---|
| **Blast radius** | **41 route handlers**, one schema each — plus a shared `parseBody` helper. Purely additive and independently landable per route; no schema change, no data migration. It is also the invariant most amenable to a lint rule (ban bare `req.json()` outside the helper), which is what S0 §6 asks for. |
| **Blocked by** | Nothing. `zod` is already a dependency. |

---

## I-8 — No service-role access on a user-session path. Allowlist only, each entry justified in comment.

| Field | Content |
|---|---|
| **ID** | I-8 |
| **Status** | **VIOLATES** |

This is the operational half of AD-001; the site list is above and not repeated. Summarised:

- **65 modules import `supabaseAdmin`** — 33 route handlers, 22 page/layout Server Components,
  7 lib modules, plus 2 handlers constructing their own inline
  (`app/api/admin/create-client/route.ts:28`, `app/api/admin/resend-invite/route.ts:36`).
- **No allowlist exists** — not as a file, a comment convention, or a lint rule.
  `eslint.config.mjs` has no `no-restricted-imports`.
- **Only 3 of the 65 are justifiable under I-8's exception**: the Stripe webhook
  (`app/api/webhooks/stripe/route.ts` — no session by construction), the cron `GET`
  (`app/api/cron/message-nudge/route.ts:73`), and Supabase Auth admin calls in the invite
  paths. Everything else is a cookie-bound user request.
- The `POST` half of the cron route (`app/api/cron/message-nudge/route.ts:90-99`) **is** a
  user-session path — any authenticated user triggers a service-role scan of every unread
  message in the system.
- **`CRON_SECRET` fails open**: `app/api/cron/message-nudge/route.ts:74-80` —
  `const secret = process.env.CRON_SECRET; if (secret) { …check… }`. With the variable unset,
  the check is skipped entirely and `GET` is unauthenticated. `CRON_SECRET` is absent from
  `.env.example`, `.env.local` and `.env.live.local`, so the unset case is the default.
- `lib/logActivity.server.ts` and `lib/uploadScope.ts` and `lib/team.ts` are guarded by
  `import 'server-only'` (`:1` in each), which prevents client-bundle leakage — a real and
  correct control, but orthogonal to I-8, which is about *session paths*, not *bundles*.

| Field | Content |
|---|---|
| **Blast radius** | Same 65 modules as AD-001. The allowlist file and the lint rule are ~2 new files and can land immediately as a ratchet (allowlist everything today, then shrink it), which is the only way this does not regress while the migration runs. `CRON_SECRET` fail-open is a 2-line fix in 1 file and should not wait for any of it. |
| **Blocked by** | AD-001 / S2 for the migration. The ratchet and the `CRON_SECRET` fix are blocked by nothing. |

---

## I-9 — Every query against a tenant-scoped table carries an explicit tenant filter, even under RLS.

| Field | Content |
|---|---|
| **ID** | I-9 |
| **Status** | **VIOLATES** — near-totally. |

**Violations**

- **`organization_id` appears in exactly 24 lines of TypeScript** across the whole codebase
  (see S1 INPUTS §3 and §7 for the enumeration).
- **Only two queries in the entire application filter by it**: `lib/credits.ts:30`
  (`org_credits`) and `lib/credits.ts:31` (`org_budgets`) — and both of those tables have
  `organization_id` as their primary key, so the filter is a lookup, not tenant scoping.
- **Zero of the ~350 queries against tenant-scoped work tables carry an org filter.** Not one
  query against `clients`, `projects`, `tasks`, `messages`, `files`, `invoices`,
  `notifications`, `project_phases`, `activity_log`, `documents`, `storyboards`,
  `organization_members`, `client_members` includes `organization_id`.
- **No code path writes `organization_id` to a work table.** Every insert relies on the column
  DEFAULT of `'00000000-0000-0000-0000-000000000001'` set in
  `supabase/migrations/0001_multitenancy.sql:40-50`. Confirmed at
  `app/api/admin/create-client/route.ts:117-126` (clients),
  `app/api/admin/invite-client/route.ts:78-87` (clients),
  `app/api/admin/create-project/route.ts:57-68` (projects),
  `app/api/files/commit/route.ts:72-88` (files),
  `app/api/portal/actions/route.ts:219-228` (messages),
  `lib/notify.ts:44-50` and `:75-82` (notifications),
  `components/studio/ScriptHome.tsx:320-322` (documents).
  The **four exceptions** that do write it are all on membership/metering tables, never on
  client work: `lib/usage.ts:27` and `lib/credits.ts:44` (`usage_events`),
  `app/api/portal/team/route.ts:102` (`client_members`, copied from the parent company), and
  `app/api/admin/team/route.ts:68` (`organization_members`, from `userOrgId(user)`).
- **The indexes built for this are unused.** `0001:53-63` creates 11 `*_org_idx` indexes;
  nothing in the codebase produces a query that can use them.
- `client_member_projects` (`supabase/migrations/0013_member_scoping.sql:16-21`) has **no
  `organization_id` column at all** — the only membership table without one.

**Conforming**: the schema half. Every work table has the column, `not null`, with a default
and an index and an FK to `organizations` (`0001:40-63`). The scaffolding is complete; nothing
uses it.

| Field | Content |
|---|---|
| **Blast radius** | Roughly **every data-access site in the app** — ~350 query chains across ~90 files, plus ~15 insert sites that must start stamping the column. This is the largest single mechanical change in the report. It is also the one most likely to be done wrong by hand, which argues for landing it behind a typed query helper rather than 350 edits. |
| **Blocked by** | S1 — until the tenancy model is settled, "the tenant filter" has no definition for a client-side user (is a portal user scoped by `organization_id`, by `client_id`, or by both?). Also depends on the JWT org claim (AD-001 consequence 1), since a filter needs a value to filter by. |

---

## I-10 — No silent failure. No empty catch. Errors reach an error sink.

| Field | Content |
|---|---|
| **ID** | I-10 |
| **Status** | **VIOLATES** |

**Violations**

- **There is no error sink.** No Sentry, no logging service, no error-reporting dependency in
  `package.json`. The only destination for an error is `console.error`.
- **78 `catch` blocks discard the error entirely** (empty body, or a comment only). Seven are
  literally `catch {}`: `lib/supabase/server.ts:19`, `components/layout/Sidebar.tsx:96`,
  `components/portal/ClientTeamManager.tsx:66`, `components/admin/ClientTeamPanel.tsx:50`,
  `components/admin/AdminSidebar.tsx:83`, `components/studio/StudioSidebar.tsx:50`,
  `components/studio/TeamManager.tsx:54`.
- The ones that matter most, because they hide authorization or persistence failures:
  - `lib/usage.ts:34` — metering write; every storage byte and every seat invite is lost silently on failure.
  - `lib/logActivity.ts:62` and `lib/logActivity.server.ts:77` — the audit trail. (`recordActivity` at `lib/logActivity.server.ts:38-43` is the one correct example in the file — it logs the error.)
  - `lib/notify.ts:51`, `:83`, `:141`, `:219`, `:264` — every notification, email and push escalation.
  - `lib/push.ts:56`, `lib/sms.ts:25`, `lib/pushClient.ts:82`.
  - `app/api/files/commit/route.ts:166` — activity log for an upload.
  - `app/api/portal/avatar/route.ts:121`, `app/api/push/subscribe/route.ts:61`,
    `app/api/files/signed-url/route.ts:92`, `app/api/files/[id]/route.ts:63`.
  - `app/auth/callback/route.ts:115` — swallows onboarding-stamp failure inside the auth flow.
  - `app/(portal)/layout.tsx:103`, `app/(admin)/admin/layout.tsx:33`, `app/studio/layout.tsx:32` — org/business-name lookups; a failure silently renders the hardcoded McPrime fallback.
  - `app/api/admin/project-actions/route.ts:367`, `:401`, `:481`, `:512`, `:575` — five `catch { /* column may not exist yet */ }` blocks. These are schema-drift guards that will mask a real failure indefinitely once the columns do exist.
  - `app/api/studio/muse/route.ts:113` — SSE parse failures during a billed generation.
- **Fire-and-forget promises with no rejection handler**, which fail even more quietly than an
  empty catch: `app/api/studio/muse/route.ts:84` (`void chargeCredits`),
  `app/api/files/commit/route.ts:97` (`void recordUsage`),
  `app/api/portal/team/route.ts:123-124` (`void recordUsage`, `void createAdminNotification`),
  `lib/sms.ts:24`.
- **Errors swallowed at the fetch layer** in components: `.catch(() => {})` at
  `components/shared/PresencePulse.tsx:99`, `:119`, `:138`,
  `components/portal/ProjectDetail.tsx:338`, `components/admin/AdminProjectDetail.tsx:346`.

**Conforming**: `lib/logActivity.server.ts:25-44` `recordActivity` is the model — it inspects
the error, logs it with context, and never throws into the caller. Route handlers do
consistently return a JSON error with a status code on their outer catch.

| Field | Content |
|---|---|
| **Blast radius** | **78 sites across ~50 files**, plus 1 new error-sink module and its wiring. Most are one-line changes. The five `/* column may not exist yet */` guards in `app/api/admin/project-actions/route.ts` should be deleted outright rather than logged — they exist only because migration state was uncertain, which I-12 fixes. |
| **Blocked by** | Choice of error sink, which is an S5 question and is constrained by S0 §6 ("nothing with a fixed monthly floor") — Sentry's free tier qualifies, most alternatives do not. |

---

## I-11 — No module-scope client construction requiring env vars. Lazy, guarded accessors only.

| Field | Content |
|---|---|
| **ID** | I-11 |
| **Status** | **PARTIAL** |

**Violations**

- `lib/supabase/admin.ts:5-8` — `export const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)` at module scope. `@supabase/supabase-js`'s `createClient` throws when the URL or key is undefined, so any build or runtime environment missing `SUPABASE_SERVICE_ROLE_KEY` fails at import time — and this module is imported by 65 others.
- `lib/r2.ts:16-27` — `export const r2 = new S3Client({ ... credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! } })` at module scope, with the endpoint interpolated from `process.env.R2_ACCOUNT_ID` (`:19`) — which silently produces `https://undefined.r2.cloudflarestorage.com` when unset rather than failing loudly.
- `lib/notify.ts:33` — `const APP_URL = process.env.NEXT_PUBLIC_APP_URL || ''` is read at module scope. Not a client construction, so not a strict violation, but it bakes in the value at import and silently degrades every deep link to a relative path (`lib/notify.ts:128`) when unset.

**Conforming — and the pattern to copy**

- `lib/stripe.ts:9-16` — lazy `getStripe()` with an explicit `throw new Error('STRIPE_SECRET_KEY is not set')`, and a comment (`:6-8`) explaining exactly why module scope was wrong here.
- `lib/push.ts:10-28` — `ensureConfigured()` memoises VAPID setup and returns `false` rather than throwing, so push no-ops cleanly without keys.
- `lib/sms.ts:10-13` — reads Twilio env per call and returns early when unset.
- `lib/supabase/server.ts:6-23` and `lib/supabase/client.ts:3-8` — both are factory functions, constructed per request/render.
- `app/api/admin/create-client/route.ts:28` and `app/api/admin/resend-invite/route.ts:36` construct their service-role client inside the handler — correct for I-11 (though a violation of I-8).

| Field | Content |
|---|---|
| **Blast radius** | **2 modules** to convert (`lib/supabase/admin.ts`, `lib/r2.ts`). Converting `supabaseAdmin` from a `const` to a `getSupabaseAdmin()` accessor is a call-site change in all **65** importing modules — mechanical, but wide. It naturally combines with the I-8 migration, which touches the same 65 files: do them in one pass, not two. |
| **Blocked by** | Nothing. Best sequenced with I-8 to avoid touching 65 files twice. |

---

## I-12 — Migrations are idempotent and forward-only, with a single ordering scheme.

| Field | Content |
|---|---|
| **ID** | I-12 |
| **Status** | **VIOLATES** — on all three clauses. |

**Violations — two ordering schemes, and they sort in the wrong order**

31 migration files in two incompatible schemes:
- `0000_baseline_schema.sql` … `0017_custom_access.sql` (18 files) — the current source of truth.
- `20260531_invoicing.sql` … `20260606_phase12.sql` (13 files) — retired, explicitly marked
  "do NOT re-run" at `supabase/migrations/0000_baseline_schema.sql:11-12`.

`'0'` (0x30) sorts before `'2'` (0x32), so **any filename-ordered runner applies the retired
series last**, on top of the baseline. Consequences, in severity order:

1. **Privilege-escalation regression.** `supabase/migrations/20260603_phase7.sql:44-52` recreates
   `admin_realtime_select_<table>` on 8 tables (`tasks`, `activity_log`, `notifications`,
   `project_phases`, `projects`, `messages`, `files`, `invoices`) using
   `coalesce(auth.jwt()->'user_metadata'->>'role', auth.jwt()->'app_metadata'->>'role') = 'admin'`.
   `supabase/migrations/20260604_phase8.sql:69-75` does the same for `activity_log`.
   `user_metadata` is writable by the end user. Re-applying either file hands any authenticated
   user SELECT on every row of eight tables — across every tenant. The `0000` baseline exists
   specifically to close this (`0000:6-9`, replacing them with `public.is_admin()` at
   `0000:319-321`, which reads `app_metadata` only). Whether these are applied to production
   right now is **UNKNOWN**.
2. **Destructive data reset.** `supabase/migrations/20260531_reseed_phases.sql:10-21` deletes
   every row of `project_phases` for every project and resets `projects.progress` to 0.
3. **Schema drift on re-run.** `supabase/migrations/20260604_phase8.sql:13-30` creates
   `activity_log` with `actor_id uuid`; `0000:44` declares it `actor_id text`.

**Violations — not forward-only**

- `supabase/migrations/0000_baseline_schema.sql:30-33` — `drop table if exists public.activity_log, business_settings, clients, files, invoices, messages, notifications, project_phases, projects, push_subscriptions, tasks cascade;`. Re-running the baseline destroys the production database.
- `supabase/migrations/0016_member_lifecycle.sql:55-66` — deletes rows from `auth.users`, `client_members` and `organization_members`.

**Violations — not idempotent**

`create policy` has no `IF NOT EXISTS`; re-running these throws `42710` and aborts the batch:
- `supabase/migrations/0002_cost_metering.sql:48`, `:50`, `:53` — 3 policies, no `drop policy if exists`.
- `supabase/migrations/0003_provenance.sql:49`, `:52` — 2 policies, unguarded.
- `supabase/migrations/0004_documents.sql:26` — 1 policy, unguarded.
- `supabase/migrations/0000_baseline_schema.sql:406-482` — 38 policies, unguarded (masked only by the destructive drop at `:30`).
- `supabase/migrations/0000_baseline_schema.sql:388-389` — 2 `CREATE TRIGGER` with no `drop trigger if exists` (same masking).

Guarded correctly, for contrast: `0001:67,70`, `0005:27`, `0006:29`, `0007:40,44`, `0011:23`,
`0012:68,72,76,80`, `0013:26,30`, `20260603_phase7.sql:44`, `20260604_phase8.sql:69,78`.

**Violations — no runner**

There is no migration runner, no `supabase/config.toml`, and no applied-migrations tracking in
the repo. Every migration file's header instructs a human to paste it into the Supabase SQL
editor. Consequently **the applied state of the live database is UNKNOWN from the repo alone** —
which is what produced the five `catch { /* column may not exist yet */ }` guards in
`app/api/admin/project-actions/route.ts` and the graceful-degradation branches at
`components/studio/ScriptHome.tsx:290-302` and `app/api/portal/notifications/route.ts:42-45`.

| Field | Content |
|---|---|
| **Blast radius** | **13 files to archive** (the `2026*` series) — but archiving must not happen until it is confirmed against the live database which of them are applied, because `0000` was hand-captured, not generated. **6 files to make idempotent** (`0000`, `0002`, `0003`, `0004` policies; `0000` triggers). **1** runner to introduce plus a tracking table. Downstream, ~7 code sites of defensive schema-drift handling can then be deleted. |
| **Blocked by** | A read of the live database's `pg_policies` and applied-migration state — this cannot be resolved from the repo. S0 §7 already carries "migration runner location; archival of the `2026*` series" to S6. Given the phase7/phase8 privilege-escalation content, **verifying whether those policies exist in production is the single most urgent item in this report** and should not wait for S6 sequencing. |

---

# Part C — In the repo, not covered by S0

Gaps in the spec matter as much as violations of it. These are real, present in the code, and
S0 says nothing about them.

**C-1 — `app/(portal)/layout.tsx:17` authenticates with `auth.getSession()`, not `auth.getUser()`.**
`getSession()` reads and decodes the cookie without revalidating it against the auth server.
Every other protected surface uses `getUser()` (`proxy.ts:31`, `app/studio/layout.tsx:19`,
`app/(admin)/admin/layout.tsx:16`, all 41 route handlers). The entire client portal is the
outlier. S0's authorization decisions are about *what* a session may do, never about *how a
session is established*; S2 needs a session-establishment rule.

**C-2 — Stored XSS in Script Design.** `components/studio/DocEditor.tsx:366-368` writes
`editor.blocksToHTMLLossy(...)` output into `documents.preview`; `components/studio/ScriptHome.tsx:202`
renders it with `dangerouslySetInnerHTML` into every collaborator's document-home page. There is
no sanitiser in the repo. This is stored, cross-user HTML with no escaping step. S0 has no
threat model — S2.5 is unwritten and this is its first entry. (`components/studio/Markdown.tsx:6`
documents the *opposite* choice for AI replies — "no `dangerouslySetInnerHTML` → no XSS" — so
the correct instinct exists in the codebase, just not here.)

**C-3 — Global cross-tenant presence leak.** `components/shared/PresencePulse.tsx:39-66`: one
`presence:app` channel product-wide, every member publishing `{ role, userId, clientId }` and
reading everyone else's. I-2 covers the *scaling* consequence; nothing in S0 covers the
*disclosure* consequence.

**C-4 — Invited client teammates are 403'd from a 7-second-polled endpoint.**
`app/api/project-tasks/route.ts:24-29` resolves the caller via
`clients.select('id').eq('user_id', user.id).single()` — the legacy primary-login path only. An
invited teammate (a `client_members` row) has no matching `clients` row and gets 403. The task
board polls this every 7s (`components/shared/TaskBoard.tsx:347`). Same pattern at
`app/api/push/subscribe/route.ts:20`. Meanwhile `lib/team.ts:115-148` `clientMembershipOf`
exists and handles both cases correctly — these two routes just don't use it. S0 §7 lists this
as a live production risk but assigns it to no decision.

**C-5 — `orgFeatureAllowed` is not default-deny despite its comment.**
`lib/permissions.ts:183-185`: `if (cap === null || cap === undefined) return true`. The comment
at `:136-138` claims "default-deny discipline", but an unknown `${spaceId}/${slug}` key returns
`true`. Any feature slug added to `lib/studio/spaces.ts` without a matching
`ORG_FEATURE_CAP` entry is visible to everyone.

**C-6 — Dead code that will be mistaken for live code.** `app/(admin)/` — 17 page/layout files
unreachable behind `proxy.ts:65-80`. `hooks/useFileUpload.ts` — posts to `/api/files/upload`,
a route that does not exist; nothing imports it. `lib/r2.ts:39-107` `uploadToR2` and its
multipart helpers — no callers. `lib/billing/plans.ts:31-38` `planLimits`/`withinLimit` — no
callers. `components/ui/` — 11 shadcn primitives of which only `sonner` is used
(`app/layout.tsx:4`). `asset_provenance` and `rights` tables — zero reads, zero writes.
`resend` and `react-hook-form`/`@hookform/resolvers`/`zod` — installed, never imported.
S0 §7 carries "legacy `(admin)` route group: delete or retain" to S4 but nothing covers the rest.

**C-7 — `clients.email` is globally UNIQUE across all tenants.**
`supabase/migrations/0000_baseline_schema.sql:252`. Two different studios cannot both have a
client at the same email address; the second insert fails with a constraint violation, and
`app/api/admin/create-client/route.ts:40-51` reports it as "A client with this email already
exists" — leaking the existence of another tenant's client. This is a hard schema blocker on
multi-tenancy that S0 does not mention.

**C-8 — `organization_members.user_id` is UNIQUE.** `supabase/migrations/0012_memberships.sql:17`.
A person can belong to at most **one** organization, forever. This forecloses agency
partnerships, contractors working for two studios, and the entire "one login, many orgs" model —
by schema, not by policy. S0 assumes multi-tenancy is a filtering problem; on the crew side it
is a cardinality problem.

**C-9 — `business_settings` is a literal singleton.**
`supabase/migrations/0000_baseline_schema.sql:55` — `id text not null default 'singleton'`.
It carries the agency's name, address, bank details and admin heartbeat. `0001:41` gave it an
`organization_id`, but every access still targets the single row:
`app/api/admin/invoice-actions/route.ts:195`, `:203`, `:220` and
`app/(portal)/invoices/page.tsx:43` use `.eq('id', 'singleton')`;
`app/(portal)/layout.tsx:97-101`, `app/(admin)/admin/layout.tsx:27-31`,
`lib/notify.ts:177-181` and `app/api/presence/heartbeat/route.ts:20` use `.limit(1).single()`.
Per-tenant business settings need a table redesign, not a filter.

**C-10 — No rate limiting anywhere.** No rate-limit middleware, no per-user throttle, on any of
the 41 route handlers — including `app/api/studio/muse/route.ts` (spends real money per call)
and `app/api/cron/message-nudge/route.ts:90` (any authenticated user triggers a full scan). S0
§3's prime directive is about unbounded *operations*; nothing covers unbounded *request rates*.
S2.5.

**C-11 — Retention (S0 §5) has no implementation surface at all.** No `deleted_at` column on any
table, no purge job, no export path, no 90-day grace. `activity_log` has no retention policy
against the 7-year requirement. S0 states the policy; nothing in the repo can express it.

**C-12 — Two competing styling systems.** `components/ui/` uses `cva` + `cn` +
`tailwind-merge`; the other ~150 components use hand-written Tailwind strings against CSS
custom-property tokens defined in `app/globals.css`. S4 will need to pick one.

---

# S1 INPUTS

Ground truth for S1 (product definition & tenancy model). Schema facts are read from the
migration files; runtime facts are marked **UNKNOWN** where they depend on live data.

## 1. The five tenancy tables

### 1.1 `clients`

**Columns** (`supabase/migrations/0000_baseline_schema.sql:71-90`, plus later `alter`s):

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, `default gen_random_uuid()` (`0000:241`) |
| `user_id` | `uuid` | nullable; the company's **primary login** |
| `name` | `text` | not null |
| `email` | `text` | not null, **globally UNIQUE** (`0000:252`) |
| `company` | `text` | |
| `phone` | `text` | |
| `avatar_url` | `text` | |
| `created_at` | `timestamptz` | `default now()` |
| `updated_at` | `timestamptz` | `default now()` |
| `notes` | `text` | |
| `invited_at` | `timestamptz` | |
| `onboarded_at` | `timestamptz` | |
| `is_active` | `boolean` | `default true` |
| `invite_count` | `integer` | `default 0` |
| `onboarding_completed_at` | `timestamptz` | |
| `notification_prefs` | `jsonb` | `default '{}'` |
| `welcome_dismissed_at` | `timestamptz` | |
| `last_seen_at` | `timestamptz` | presence heartbeat |
| `organization_id` | `uuid` | **not null**, `default '00000000-0000-0000-0000-000000000001'`, FK → `organizations(id)` (`0001:42`) |
| `invite_policy` | `text` | **not null**, `default 'open'`, `check in ('open','approval','locked')` (`0012:50-51`) |

**FKs out:** `clients.user_id → auth.users(id)`. Declared `ON DELETE CASCADE` at `0000:270`;
**rewritten to `ON DELETE SET NULL`** by the loop in `0016_member_lifecycle.sql:24-50`.
`clients.organization_id → organizations(id)` (`0001:42`, no explicit action → `NO ACTION`).

**FKs in (7):**
- `activity_log.client_id → clients(id) ON DELETE CASCADE` (`0000:268`)
- `files.client_id → clients(id) ON DELETE CASCADE` (`0000:271`)
- `invoices.client_id → clients(id) ON DELETE CASCADE` (`0000:274`)
- `notifications.client_id → clients(id) ON DELETE CASCADE` (`0000:280`)
- `projects.client_id → clients(id) ON DELETE CASCADE` (`0000:283`)
- `client_members.client_id → clients(id) ON DELETE CASCADE` (`0012:32`)
- `push_subscriptions.client_id` — column exists (`0000:205`) but **no FK constraint is declared**.

**Indexes:** `clients_pkey` (`0000:241`), `clients_email_key` UNIQUE (`0000:252`),
`idx_clients_email` (`0000:292`), `idx_clients_user_id` **UNIQUE … WHERE user_id IS NOT NULL**
(`0000:293`), `clients_org_idx` (`0001:55`).

**RLS policies, verbatim** (`supabase/migrations/0000_baseline_schema.sql:414-417`):

```sql
create policy admin_full_clients on public.clients for ALL to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "Client can view own record" on public.clients for SELECT to public
  using (user_id = auth.uid());

create policy "Client can update own record" on public.clients for UPDATE to public
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy clients_read_own on public.clients for SELECT to public
  using (user_id = auth.uid());
```

RLS enabled at `0000:394`. Note `"Client can view own record"` and `clients_read_own` are
duplicates, and both are `to public` (not `to authenticated`).

**Every code path that reads or writes `clients`** — 63 query chains:

*Reads:* `app/(portal)/layout.tsx:56`, `app/(portal)/dashboard/page.tsx` (via layout),
`app/(portal)/dashboard/settings/page.tsx`, `app/onboarding/page.tsx:20`,
`app/(admin)/admin/clients/page.tsx:25`, `app/(admin)/admin/clients/[id]/page.tsx:42`,
`app/(admin)/admin/clients/[id]/edit/page.tsx:17`, `app/(admin)/admin/dashboard/page.tsx:48`,
`app/(admin)/admin/page.tsx:34`, `app/(admin)/admin/invoices/new/page.tsx:21`,
`app/(admin)/admin/projects/new/page.tsx:18`, `app/(admin)/admin/projects/[id]/edit/page.tsx:24`,
`app/api/admin/client-team/route.ts:60`, `app/api/admin/create-client/route.ts:40`,
`app/api/admin/delete-client/route.ts:31`, `app/api/files/signed-url/route.ts:42`,
`app/api/portal/messages/attachment/route.ts:39`, `app/api/portal/notifications/route.ts:12`,
`app/api/portal/team/route.ts:36`, `:56`, `app/api/portal/actions/route.ts:21`,
`app/api/project-tasks/route.ts:25`, `app/api/push/subscribe/route.ts:20`,
`app/auth/callback/route.ts:101`, `lib/notify.ts:164`, `lib/team.ts:118`, `:136`, `:216`,
`lib/uploadScope.ts:34`, `:45`.

*Writes:* `app/(auth)/set-password/page.tsx:110-113` (**sets `user_id` from the browser client,
under RLS — see §2, it appears to be a no-op**),
`app/api/admin/create-client/route.ts:116`, `app/api/admin/invite-client/route.ts:77`,
`app/api/admin/update-client/route.ts`, `app/api/admin/resend-invite/route.ts:71`,
`app/api/admin/delete-client/route.ts:55`, `app/api/admin/client-team/route.ts:99`
(`invite_policy`), `app/api/portal/actions/route.ts:49`, `:253`, `:272`,
`app/api/portal/avatar/route.ts:75`, `:126`, `app/api/portal/onboarding/route.ts:40`,
`app/api/presence/heartbeat/route.ts:27`, `app/auth/callback/route.ts:108`.

### 1.2 `organizations`

**Columns** (`supabase/migrations/0001_multitenancy.sql:18-27`):

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, `default gen_random_uuid()` |
| `name` | `text` | not null |
| `subdomain` | `text` | UNIQUE, nullable |
| `logo_url` | `text` | |
| `branding` | `jsonb` | not null, `default '{}'` |
| `plan` | `text` | not null, `default 'agency'` |
| `created_at` | `timestamptz` | not null, `default now()` |
| `updated_at` | `timestamptz` | not null, `default now()` |

**No `region` column** (contradicts AD-002). **No FKs out.**

**FKs in (24)** — every `organization_id` column: `activity_log`, `business_settings`,
`clients`, `files`, `invoices`, `messages`, `notifications`, `project_phases`, `projects`,
`push_subscriptions`, `tasks` (all `0001:40-50`, no delete action);
`usage_events` (`0002:13`), `org_budgets` (`0002:25`, `on delete cascade`),
`org_credits` (`0002:33`, `on delete cascade`), `asset_provenance` (`0003:14`),
`rights` (`0003:31`), `documents` (`0004:13`), `document_versions` (`0005:14`),
`document_comments` (`0006:15`), `storyboards` (`0007:14`), `storyboard_shots` (`0007:25`),
`credit_ledger` (`0011:14`, `on delete cascade`),
`organization_members` (`0012:16`, `on delete cascade`),
`client_members` (`0012:33`, `on delete cascade`).

**Seed row:** `insert into public.organizations (id, name) values ('00000000-0000-0000-0000-000000000001', 'McPrime') on conflict (id) do nothing;` (`0001:30-32`).

**RLS policies, verbatim** (`supabase/migrations/0001_multitenancy.sql:66-73`):

```sql
alter table public.organizations enable row level security;

drop policy if exists org_select_own on public.organizations;
create policy org_select_own on public.organizations for select to authenticated
  using (id = public.current_org());

drop policy if exists org_admin_manage on public.organizations;
create policy org_admin_manage on public.organizations for all to authenticated
  using (public.is_admin() and id = public.current_org())
  with check (public.is_admin() and id = public.current_org());
```

**Every code path:** exactly **one** — `app/studio/layout.tsx:26-31`,
`supabaseAdmin.from('organizations').select('name').limit(1).single()`. It reads whichever row
comes back first, with no relation to the caller. There is no create, update, or delete path
for an organization anywhere in the application.

### 1.3 `client_members`

**Columns** (`supabase/migrations/0012_memberships.sql:30-45`, plus `0013`, `0016`, `0017`):

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, `default gen_random_uuid()` |
| `client_id` | `uuid` | not null, FK → `clients(id) on delete cascade` |
| `organization_id` | `uuid` | not null, `default` sentinel, FK → `organizations(id) on delete cascade` |
| `user_id` | `uuid` | nullable, **no unique constraint**, **no FK** |
| `name` | `text` | |
| `email` | `text` | not null |
| `role` | `text` | not null, `default 'member'`, `check in ('owner','approver','member','viewer')` |
| `status` | `text` | not null, `default 'invited'`; check widened by `0016:12-14` to `('pending','invited','active','paused','revoked')` |
| `invited_by` | `uuid` | |
| `invited_at` | `timestamptz` | not null, `default now()` |
| `accepted_at` | `timestamptz` | |
| `created_at` | `timestamptz` | not null, `default now()` |
| `history_from` | `timestamptz` | `0013:13` — null = full history |
| `extra_caps` | `text[]` | not null, `default '{}'` (`0017:11`) |
| `title` | `text` | `0017:12` — custom role label |

**Constraints:** `unique (client_id, email)` (`0012:44`).
**Indexes:** `client_members_client_idx (client_id, status)` (`0012:46`),
`client_members_user_idx (user_id)` (`0012:47`).
**FKs in:** `client_member_projects.member_id → client_members(id) on delete cascade` (`0013:17`).
**Realtime:** added to `supabase_realtime` (`0013:42`).

**RLS policies, verbatim** (`supabase/migrations/0012_memberships.sql:66,76-82`):

```sql
alter table public.client_members enable row level security;

drop policy if exists client_members_admin_all on public.client_members;
create policy client_members_admin_all on public.client_members
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists client_members_team_read on public.client_members;
create policy client_members_team_read on public.client_members
  for select to authenticated using (public.is_client_member(client_id));
```

Note `client_members_admin_all` has **no org predicate** — any admin of any org may read and
write every client team row in the database.

Supporting function (`0012:54-62`):

```sql
create or replace function public.is_client_member(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.client_members m
    where m.client_id = cid and m.user_id = auth.uid() and m.status = 'active'
  ) or exists (
    select 1 from public.clients c where c.id = cid and c.user_id = auth.uid()
  )
$$;
```

**Every code path:**
*Reads:* `lib/team.ts:126-131`, `:142-147`, `:188-194`, `:218-223`;
`app/api/portal/team/route.ts:31`, `:75`, `:176`;
`app/api/admin/client-team/route.ts:28`, `:148`;
`app/(portal)/layout.tsx:38`;
`components/portal/ClientTeamManager.tsx:76` and `components/admin/ClientTeamPanel.tsx:60`
(browser realtime subscriptions).
*Writes:* `app/(portal)/layout.tsx:26-30` (auto-activate on first login),
`app/api/portal/team/route.ts:112` (update existing), `:113` (insert), `:160-165` (role /
status / caps patch), `:191` (delete);
`app/api/admin/client-team/route.ts:72`, `:86`, `:111`, `:127`, `:137`;
backfill at `0012:113-117`, activation backfill at `0014:12-18`,
purge at `0016:65`.

### 1.4 `client_member_projects`

**Columns** (`supabase/migrations/0013_member_scoping.sql:16-21`):

| Column | Type | Notes |
|---|---|---|
| `member_id` | `uuid` | not null, FK → `client_members(id) on delete cascade` |
| `project_id` | `uuid` | not null, FK → `projects(id) on delete cascade` |
| `created_at` | `timestamptz` | not null, `default now()` |

**PK:** `(member_id, project_id)`. **Index:** `client_member_projects_project_idx (project_id)`
(`0013:22`). **No `organization_id` column** — the only membership table without one.
**No FKs in.** **Realtime:** added (`0013:48`).

Semantics (`0013:5-7`): **no rows = the member sees every project of the company; any rows =
only those.** An empty set is "all", which is a footgun for any future bulk-delete.

**RLS policies, verbatim** (`supabase/migrations/0013_member_scoping.sql:24-37`):

```sql
alter table public.client_member_projects enable row level security;

drop policy if exists client_member_projects_admin_all on public.client_member_projects;
create policy client_member_projects_admin_all on public.client_member_projects
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists client_member_projects_team_read on public.client_member_projects;
create policy client_member_projects_team_read on public.client_member_projects
  for select to authenticated using (
    exists (
      select 1 from public.client_members m
      where m.id = member_id and public.is_client_member(m.client_id)
    )
  );
```

**Every code path:** `lib/team.ts:197-201` (read the member's scope);
`app/api/portal/team/route.ts:32` (nested select), `:118-120` (insert, filtered to the
company's own projects);
`app/api/admin/client-team/route.ts` (nested select in the roster query at `:28`).
Consumed at `app/(portal)/projects/page.tsx`, `app/(portal)/dashboard/page.tsx` and
`app/api/portal/notifications/route.ts:54` via `portalAccess().projectIds`.

### 1.5 `organization_members`

**Columns** (`supabase/migrations/0012_memberships.sql:14-26`, plus `0013`, `0015`, `0016`, `0017`):

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, `default gen_random_uuid()` |
| `organization_id` | `uuid` | not null, `default` sentinel, FK → `organizations(id) on delete cascade` |
| `user_id` | `uuid` | **UNIQUE** (`0012:17`), nullable, **no FK** |
| `name` | `text` | |
| `email` | `text` | not null |
| `role` | `text` | not null, `default 'member'`; check widened by `0015:16-17` to `('owner','admin','producer','finance','editor','member')` |
| `status` | `text` | not null, `default 'invited'`; check widened by `0016:16-18` to `('invited','active','paused','revoked')` |
| `invited_by` | `uuid` | |
| `invited_at` | `timestamptz` | not null, `default now()` |
| `accepted_at` | `timestamptz` | |
| `created_at` | `timestamptz` | not null, `default now()` |
| `history_from` | `timestamptz` | `0013:14` |
| `roles` | `text[]` | not null, `default '{}'` (`0015:11`) — additional roles; effective caps are the union |
| `extra_caps` | `text[]` | not null, `default '{}'` (`0017:14`) |
| `title` | `text` | `0017:15` |

**Index:** `organization_members_org_idx (organization_id, status)` (`0012:27`).
**No FKs in.** **Realtime:** added (`0013:45`).

**RLS policies, verbatim** (`supabase/migrations/0012_memberships.sql:65,68-74`):

```sql
alter table public.organization_members enable row level security;

drop policy if exists organization_members_admin_all on public.organization_members;
create policy organization_members_admin_all on public.organization_members
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists organization_members_self_read on public.organization_members;
create policy organization_members_self_read on public.organization_members
  for select to authenticated using (user_id = auth.uid());
```

Again **no org predicate** on `organization_members_admin_all`.

**Every code path:**
*Reads:* `lib/team.ts:20-24` (`orgRolesOf`), `:26-29` (bootstrap count),
`:56-60` (`orgAccessOf`); `app/studio/layout.tsx:48-52` (paused check);
`app/(portal)/layout.tsx:39`; `app/api/admin/team/route.ts:25`, `:102`, `:144`;
`components/studio/TeamManager.tsx:64` (browser realtime).
*Writes:* `app/studio/layout.tsx:41-45` (auto-activate on first studio load);
`app/api/admin/team/route.ts:66` (insert), plus role/status/caps updates;
backfill at `0012:101-110`, activation backfill at `0014:20-26`, purge at `0016:66`.

**Bootstrap hazard:** `lib/team.ts:25-29` — an admin with no membership row gets `['owner']`
when the roster is empty and `['member']` otherwise. Since `organization_members` has no org
predicate in its policy and `lib/team.ts:26-28` counts **all rows in the table**, the "empty
roster" bootstrap is global, not per-org: the first admin of a *second* organization would be
demoted to `member` because tenant zero's roster is non-empty.

---

## 2. Every place `clients.user_id` is read or written

**Reads (14 sites):**

| Site | What it does |
|---|---|
| `app/(portal)/layout.tsx:29` | `client_members` update filter, not `clients` — listed for completeness of the `user_id` sweep |
| `app/api/project-tasks/route.ts:25` | `clients.select('id').eq('user_id', user.id).single()` — the sole authorization for a client on this endpoint; **403s invited teammates** |
| `app/api/push/subscribe/route.ts:20` | same pattern, resolves `client_id` for the push row |
| `app/auth/callback/route.ts:104` | `.eq('user_id', userId).single()` — onboarding stamp |
| `app/onboarding/page.tsx:20` | `.eq('user_id', user.id)` — loads the company for the wizard |
| `app/studio/layout.tsx:44`, `:51` | `organization_members`, not `clients` — completeness |
| `lib/team.ts:120`, `:123` | reads `clients.user_id` and compares to `user.id` to decide "primary login ⇒ owner" |
| `lib/team.ts:139` | `clients.select('id, name').eq('user_id', user.id).single()` — legacy sessions with no `client_id` claim |
| `lib/team.ts:216` | `portalClientIdByUserId` — `clients.select('id').eq('user_id', userId).single()` |
| `lib/notify.ts:166`, `:172` | selects `user_id` off `clients` to target a push |
| `lib/push.ts:64` | `push_subscriptions.user_id`, not `clients` — completeness |
| `app/api/admin/delete-client/route.ts:31`, `:64`, `:66` | reads `clients.user_id` then **deletes that auth user** |
| `components/portal/ProjectDetail.tsx:399` | `sender_id: client.user_id ?? client.id` — the company's user id, on the **optimistic placeholder only**; the persisted row is written server-side from the session (`app/api/portal/actions/route.ts:221`) and replaces it at `:430-432`. See §5 item 7. |
| `lib/types/database.ts:14` | `user_id: string` — typed **non-nullable**, contradicting the schema (`0000:73` nullable, and `0016` explicitly drops NOT NULL) |

**Writes (3):**

| Site | What it does |
|---|---|
| `app/(auth)/set-password/page.tsx:110-113` | `clients.update({ user_id: user.id }).eq('id', clientId)` — **written from the browser client**, so it runs under RLS. `clientId` comes from `userClientId(user)` (`:108`), i.e. the tamper-proof `app_metadata` claim, so it is not forgeable. But the governing policy is `"Client can update own record" … using (user_id = auth.uid())` (`0000:416`): on a row whose `user_id` is still NULL the USING clause matches nothing, so the update **silently affects zero rows**; on a row where `user_id` is already set (which both `create-client:118` and `invite-client:84` do at insert) it is a no-op. This path appears to be dead either way — worth confirming before S1 relies on it as the teammate-linking mechanism. |
| `app/api/admin/create-client/route.ts:118` | sets `user_id` on insert |
| `app/api/admin/invite-client/route.ts:84` | sets `user_id` on insert |

**Schema constraints on it:** nullable (`0000:73`); FK → `auth.users(id)`, originally
`ON DELETE CASCADE` (`0000:270`), rewritten to `ON DELETE SET NULL` (`0016:24-50`);
`idx_clients_user_id` UNIQUE WHERE NOT NULL (`0000:293`).

## 3. Every place `DEFAULT_ORG_ID` / the sentinel UUID appears

**TypeScript (5 sites):**

| Site | Use |
|---|---|
| `lib/auth/role.ts:20-22` | the definition: `export const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001'` |
| `lib/auth/role.ts:42` | `userOrgId()` returns it as the fallback whenever the JWT lacks `app_metadata.organization_id` — **so every un-stamped session silently becomes tenant zero** |
| `lib/billing/plans.ts:3,32` | `if (orgId === DEFAULT_ORG_ID) return PLANS.house` — the house-org bypass (dead: `planLimits` has no callers) |
| `lib/sms.ts:4,24` | `recordUsage(DEFAULT_ORG_ID, 'sms.sent', …)` — **hardcodes tenant zero**; every tenant's SMS is metered against McPrime |

A separate sentinel, distinct from the org one: `lib/team.ts:153` —
`const NO_CLIENT = '00000000-0000-0000-0000-000000000000'`, returned by `portalClientId()` and
`portalClientIdByUserId()` when no membership is found, and then used as a query filter
(`app/(portal)/layout.tsx:58`, `app/api/portal/notifications/route.ts:15`).

**SQL (14 sites):** `supabase/migrations/0001_multitenancy.sql:13` (comment), `:31` (the seed
insert), `:40-50` (11 column defaults); `0002_cost_metering.sql:13` (default), `:39`, `:40`
(seed rows); `0003_provenance.sql:14`, `:31`; `0004_documents.sql:13`;
`0005_document_versions.sql:14`; `0006_document_comments.sql:15`; `0007_storyboards.sql:14`,
`:25`; `0012_memberships.sql:16`, `:33`, `:103`.

## 4. Where the code assumes exactly one organization exists

This is the list that determines how much S1 changes. Ten distinct assumptions:

1. **`app/studio/layout.tsx:26-31`** — `organizations.select('name').limit(1).single()`. The
   studio header shows whatever org row sorts first, unrelated to the signed-in user's org.
2. **`lib/auth/role.ts:42`** — `userOrgId()` defaults to the sentinel. Any user whose JWT lacks
   the claim is treated as a member of tenant zero for metering and credits.
3. **`lib/sms.ts:24`** — the sentinel org id is a literal argument. Hardcoded, not a fallback.
4. **`lib/billing/plans.ts:32`** — plan resolution branches on equality with the sentinel.
5. **`business_settings` is a singleton row.** `0000:55` (`id text default 'singleton'`), read
   or written at `app/api/admin/invoice-actions/route.ts:195`, `:203`, `:220` (all
   `.eq('id','singleton')`), `app/(portal)/invoices/page.tsx:43` (same), and via
   `.limit(1).single()` at `app/(portal)/layout.tsx:97-101`,
   `app/(admin)/admin/layout.tsx:27-31`, `lib/notify.ts:177-181`. The admin presence heartbeat
   also stamps this single row (`app/api/presence/heartbeat/route.ts:18-22`), so "is the admin
   away?" is a **product-wide** boolean.
6. **`lib/notify.ts:177-189`** — the admin recipient's email, last-seen and notification
   preferences all come from that one row. Every org's admin alerts would resolve to tenant
   zero's email address.
7. **`lib/push.ts:69`** — `sendPushToAdmins` matches `push_subscriptions.role = 'admin'` with no
   org filter: one org's notification pushes to **every** admin device in the product.
8. **`lib/team.ts:26-29`** — the org-owner bootstrap counts rows across the entire
   `organization_members` table, not the caller's org.
9. **`app/api/admin/deadline-check/route.ts:31`, `:87`** — scans every task in `review` and
   every project with a due date, product-wide, in one pass.
10. **`app/api/cron/message-nudge/route.ts:21-29`** — scans every unread message in the
    product, product-wide, and attributes admin-side messages to the literal string
    `'McPrime Digital'` (`:49`).

Plus the structural version of the same assumption: **no insert stamps `organization_id`** (I-9),
so a second org's rows would be created inside tenant zero regardless of any of the above.

## 5. Where the code assumes one login per client company

1. **`idx_clients_user_id`** UNIQUE WHERE `user_id IS NOT NULL` (`0000:293`) — one auth user may
   be the primary login of at most one company. Schema-enforced.
2. **`clients.user_id` is the *only* identity in every client-side RLS policy** —
   `0000:409-411`, `:415-417`, `:422-432`, `:437-440`, `:445-449`, `:454-457`, `:462-463`,
   `:468-469`, `:474-476`, and `20260604_phase8.sql:79-88`. A `client_members` teammate matches
   none of them.
3. **`app/api/project-tasks/route.ts:24-29`** — resolves the caller purely by `clients.user_id`;
   invited teammates get 403 from an endpoint polled every 7s.
4. **`app/api/push/subscribe/route.ts:20`** — same, so teammates cannot register for push.
5. **`app/auth/callback/route.ts:101-104`** — onboarding stamp keys on `clients.user_id`.
6. **`app/onboarding/page.tsx:20`** — the wizard loads by `clients.user_id`.
7. **`components/portal/ProjectDetail.tsx:399`** — `sender_id: client.user_id ?? client.id` on
   the **optimistic placeholder only**. The persisted row comes from
   `app/api/portal/actions/route.ts:221`, which correctly sets `sender_id: user.id` from the
   session, and the placeholder is replaced at `ProjectDetail.tsx:430-432`. So the stored data
   is right; the assumption is confined to the pre-reconciliation UI (a teammate's own message
   momentarily carries the owner's id, which matters only if a local check reads it before the
   server responds — no such check exists today).
8. **`lib/team.ts:123-124`** — if `clients.user_id === user.id`, the role is hardcoded `'owner'`
   with `extraCaps: []` and `title: null`, bypassing the `client_members` row entirely. The
   primary login can never be given a narrower role.
9. **`lib/team.ts:182-186`** — `portalAccess` short-circuits for `role === 'owner'`, returning
   `historyFrom: null` and `projectIds: null`. Primary logins can never be scoped.
10. **`lib/types/database.ts:14`** — `user_id: string` typed non-nullable.

The counter-evidence that the model is mid-migration: `lib/team.ts:115-148`
(`clientMembershipOf`) handles both shapes correctly, and 20+ call sites already use it. The
assumption survives only in the 10 places above and in RLS.

## 6. Every hardcoded "McPrime" string or McPrime-owned identifier

69 lines across 34 files.

**Identity / contact / domain**
- `app/(auth)/set-password/page.tsx:190` — `href="mailto:hello@mcprimedigital.com"`
- `lib/push.ts:16` — VAPID subject default `'mailto:notifications@mcprime.digital'`
- `package.json:2` — `"name": "mcprime-clients-portal"`
- `supabase/migrations/0000_baseline_schema.sql:356` — invoice numbers are `'MPD-' || …`
- `supabase/migrations/0001_multitenancy.sql:31` — the seed org is named `'McPrime'`
- `lib/auth/role.ts:20`, `:40` — comments naming the default org McPrime

**Logo asset**
- `components/McPrimeLogo.tsx:29` — `src="/mcprime-logo.jpg"`; `:30` `alt="McPrime Digital"`;
  `:10`, `:14`, `:17` comments/name
- Imported and rendered at `app/(auth)/login/page.tsx:7,47`,
  `app/(auth)/reset-password/page.tsx:8,83`, `app/(auth)/set-password/page.tsx:8,147`,
  `components/admin/AdminSidebar.tsx:20,125`, `components/portal/OnboardingWizard.tsx:5,101`
- `public/sw.js:15` `icon: '/mcprime-logo.jpg'`, `:16` `badge: '/mcprime-logo.jpg'`

**Document / app metadata**
- `app/layout.tsx:21` — `title: 'McPrime Digital — Client Portal'`
- `app/layout.tsx:22` — `description: 'Your McPrime Digital project portal'`
- `public/sw.js:1` (header comment), `:10`, `:12` — push fallback title `'McPrime Digital'`

**Fallback org / company names**
- `app/(admin)/admin/layout.tsx:25` — `let companyName = 'McPrime Digital'`
- `app/(portal)/layout.tsx:95` — `let orgName = 'McPrime Digital'`
- `app/studio/layout.tsx:24` — `let orgName = 'McPrime'`
- `components/admin/AdminSidebar.tsx:59` — default prop `companyName = 'McPrime Digital'`
- `components/layout/Sidebar.tsx:62` — default prop `orgName = 'McPrime Digital'`

**Sender / actor names written into the database** (these persist as data, not just UI)
- `app/api/admin/deadline-check/route.ts:58` — `sender_name: 'McPrime Digital'`
- `app/api/admin/project-actions/route.ts:18` — `actorName: 'McPrime Digital'`
- `app/api/admin/project-actions/route.ts:121`, `:557` — `sender_name: 'McPrime Digital'`
- `app/api/admin/project-actions/route.ts:137` — `senderName: 'McPrime Digital'`
- `app/api/admin/project-actions/route.ts:564` — notification title `'New message from McPrime Digital'`
- `app/api/admin/project-actions/route.ts:589` — `actorName: 'McPrime Digital'`
- `app/api/admin/invoice-actions/route.ts:256` — `p_actor_name: … ?? 'McPrime Digital'`
- `app/api/files/commit/route.ts:156` — `p_actor_name: … ?? 'McPrime Digital'`
- `app/api/cron/message-nudge/route.ts:49` — `'McPrime Digital'` as the admin-side sender
- `components/admin/AdminProjectDetail.tsx:501` — `sender_name: 'McPrime Digital'`

**Client-visible UI copy**
- `app/(auth)/login/page.tsx:58` — "Sign in to access your McPrime Digital portal"
- `app/(auth)/login/page.tsx:152` — "© {year} McPrime Digital. All rights reserved."
- `app/(auth)/set-password/page.tsx:175`, `:199`, `:238` — "contact McPrime Digital", "Contact McPrime Digital", "Welcome to McPrime Digital"
- `app/(portal)/dashboard/page.tsx:139`, `app/(portal)/files/page.tsx:28`,
  `app/(portal)/projects/[id]/page.tsx:30`, `app/(portal)/projects/page.tsx:35` —
  "Your account is being set up. Please contact McPrime Digital."
- `app/(portal)/projects/page.tsx:254` — "McPrime Digital will set up your projects here"
- `components/portal/InvoicesClient.tsx:129` — "Contact McPrime Digital for payment details."
- `components/portal/InvoicesClient.tsx:346` — "Your invoices from McPrime Digital will appear here"
- `components/portal/WelcomeBanner.tsx:85` — "Welcome to McPrime Digital,"
- `components/portal/MessagesHub.tsx:643` — thread prefix `'McPrime: '`
- `components/portal/MessagesHub.tsx:822`, `components/portal/ProjectDetail.tsx:889` — `otherName="McPrime Digital"`
- `components/shared/FileVault.tsx:327` — uploader label `'McPrime'`
- `components/shared/TaskBoard.tsx:796` — "awaiting McPrime to resend for approval"
- `components/shared/TaskBoard.tsx:851` — "stored here for both you and McPrime"
- `lib/fileCategories.ts:146` — folder description "Final files delivered by McPrime"
- `components/admin/NewClientForm.tsx:466` — "Sent via Resend from your McPrime domain"
- `components/admin/AdminProjectDetail.tsx:954` — `userName="McPrime Admin"`
- `components/admin/AdminProjectDetail.tsx:1019` — `currentName="McPrime Digital"`
- `app/(admin)/admin/messages/page.tsx:79` — `adminName="McPrime Digital"`

**Comments only** (no runtime effect): `app/(admin)/admin/layout.tsx:24`,
`app/api/files/commit/route.ts:126`, `supabase/migrations/0000_baseline_schema.sql:3`,
`0001_multitenancy.sql:4`, `:13`, `:29`, `:39`.

## 7. Every table with an `organization_id` column, and whether code filters by it

| Table | Column source | Written by code? | Filtered by code? |
|---|---|---|---|
| `activity_log` | `0001:40` | No — column default only | **No** |
| `business_settings` | `0001:41` | No | **No** (singleton by `id`) |
| `clients` | `0001:42` | No | **No** |
| `files` | `0001:43` | No | **No** |
| `invoices` | `0001:44` | No | **No** |
| `messages` | `0001:45` | No | **No** |
| `notifications` | `0001:46` | No | **No** |
| `project_phases` | `0001:47` | No | **No** |
| `projects` | `0001:48` | No | **No** |
| `push_subscriptions` | `0001:49` | No | **No** |
| `tasks` | `0001:50` | No | **No** |
| `usage_events` | `0002:13` | **Yes** — `lib/usage.ts:27`, `lib/credits.ts:44` | **No** (RLS only) |
| `org_budgets` | `0002:25` (PK) | No | **Yes** — `lib/credits.ts:31` |
| `org_credits` | `0002:33` (PK) | Via RPC `charge_credits`/`add_credits` (`0011:32-53`) | **Yes** — `lib/credits.ts:30` |
| `asset_provenance` | `0003:14` | No — table entirely unused | n/a |
| `rights` | `0003:31` | No — table entirely unused | n/a |
| `documents` | `0004:13` | No — `components/studio/ScriptHome.tsx:320-322` inserts `{ kind, title }` only | **No** (RLS only) |
| `document_versions` | `0005:14` | No | **No** (RLS only) |
| `document_comments` | `0006:15` | No | **No** (RLS only) |
| `storyboards` | `0007:14` | No | **No** (RLS only) |
| `storyboard_shots` | `0007:25` | No | **No** (RLS only) |
| `credit_ledger` | `0011:14` | Via RPC (`0011:36`, `:50`) | **No** (RLS only) |
| `organization_members` | `0012:16` | **Yes** — `app/api/admin/team/route.ts:68` (`organization_id: userOrgId(user)`) | **No** |
| `client_members` | `0012:33` | **Yes** — `app/api/portal/team/route.ts:102` (copied from the parent company) | **No** |
| `client_member_projects` | **absent** | n/a | n/a |

So four code paths write the column (`usage_events` ×2, `client_members`,
`organization_members`) and two queries filter by it (`org_credits`, `org_budgets`, both by
primary key rather than as a tenant predicate).

**Net:** 24 tables carry the column; **0 client-facing work tables** are either stamped or
filtered by application code. The 11 `*_org_idx` indexes (`0001:53-63`) are unused.

## 8. The real cardinality questions

### Can a person belong to two client companies?

**Schema: YES.** `client_members.user_id` has **no unique constraint**
(`supabase/migrations/0012_memberships.sql:34`) and no FK. The only uniqueness is
`unique (client_id, email)` (`:44`), which is *per company* — the same email may legitimately
appear in many companies' teams.

**Code: NO — it breaks.** Three places assume at most one:
- `lib/team.ts:142-147` — `client_members … .eq('user_id', user.id).eq('status','active').single()`.
  PostgREST's `.single()` returns an error (PGRST116-class) when the row count is not exactly 1,
  so a person in two active client teams gets `null` membership → treated as having **no**
  client account at all (`app/(portal)/layout.tsx:36`, `app/api/portal/team/route.ts:21`).
- `lib/team.ts:218-223` — `portalClientIdByUserId`, same `.single()`, same failure. This is the
  helper `lib/uploadScope.ts:35`/`:46` uses, so uploads would break too.
- `app/api/admin/client-team/route.ts:154-155` / `app/api/portal/team/route.ts:188-189` —
  removing a person from one company calls `auth.admin.deleteUser`, destroying their access to
  the other.

There is also a partial escape hatch: when the JWT carries `app_metadata.client_id`,
`lib/team.ts:116-133` scopes the lookup to that one company and works correctly. So the answer
today is "one at a time, selected by a JWT claim that nothing lets the user change."

**Verdict: schema permits it, application does not support it, and there is no company switcher
anywhere in the UI.** Whether any such person exists in production is **UNKNOWN**.

### Can a person belong to two organizations?

**NO — hard schema constraint.** `organization_members.user_id uuid unique`
(`supabase/migrations/0012_memberships.sql:17`). One row per person, forever. Changing this is
a migration plus a rework of `lib/team.ts:18-36` (`orgRolesOf` uses `.single()` on `user_id`)
and `lib/team.ts:56-60`. See gap C-8.

### Can a client company relate to two organizations?

**NO.** `clients.organization_id` is a single `uuid`, `not null`, FK → `organizations(id)`
(`0001:42`). One company belongs to exactly one org. There is no join table and no code path
that changes a client's org after creation — indeed no code path that sets it at all
(it takes the column default).

Consequence worth surfacing for S1: because `clients.email` is **globally** unique
(`0000:252`), two organizations cannot both have a client at the same email address. So the
"one company, one org" rule is not merely a modelling choice — it is currently enforced across
tenants by an email collision.

### Can a project belong to two companies?

**NO.** `projects.client_id` is a single nullable `uuid`, FK → `clients(id) ON DELETE CASCADE`
(`0000:185`, `0000:283`). One project, at most one company.

It **can** belong to zero: the column is nullable, and
`app/api/admin/delete-client/route.ts:44` deliberately sets `client_id = null` on every project
before deleting a company, to preserve the work. Such orphan projects have
`organization_id` still set to the sentinel default, so they are invisible to every
client-side policy and belong to no company — a state S1 needs to name.

Note also `client_member_projects` (`0013:16-21`) scopes *members* to projects, not projects to
companies. It is a filter within one company, not a sharing mechanism.

### Additional cardinality facts S1 will need

- **`clients.user_id` → at most one company per primary login**: `idx_clients_user_id` UNIQUE
  WHERE NOT NULL (`0000:293`).
- **`clients.email` globally unique** (`0000:252`) — cross-tenant collision, see C-7.
- **`push_subscriptions.endpoint` globally unique** (`0000:253`), with `client_id` carrying no
  FK (`0000:205`) — a device is bound to one org's notion of a client with no referential
  integrity.
- **`invoices.client_id` is `not null`** (`0000:120`) while `projects.client_id` is nullable
  (`0000:185`) — so orphaning a project (above) leaves its invoices pointing at a deleted
  company, which the `ON DELETE CASCADE` at `0000:274` then removes. Deleting a company keeps
  its projects but destroys its invoice history.
- **`activity_log.actor_id` is `text`** (`0000:44`), not `uuid`, while
  `20260604_phase8.sql:30` declares it `uuid`. Two `log_activity` overloads exist to cope
  (`0000:323` uuid variant, `0000:330` text variant). Which is live is **UNKNOWN**.

---

*End of S0 conformance report.*
