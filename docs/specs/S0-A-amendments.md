# Throughline — S0-A: Amendments to S0

**Status:** Settled. Supersedes the named entries in `S0-decisions-and-constraints.md`.
**Date:** 2026-08-26
**Cause:** `docs/specs/S0-conformance.md` (commit e9c62a8) verified three S0 claims against source and found them false, and surfaced four schema-level constraints S0 did not know about.
**Rule:** where this document and S0 disagree, this document wins. S0 entries are not edited in place; the original text stands as the record of what was believed at the time.

---

## 1. Superseding entries

### AD-004-R — One file pipeline *(supersedes AD-004)*

**What AD-004 got wrong.** It asserted that chat attachments never become `files` rows, are uncounted in metering, invisible in the vault, and carry no category. Every clause except the first is false. Verified: all four attachment handlers call `uploadFileToR2` (`components/portal/MessagesHub.tsx:442`, `components/portal/ProjectDetail.tsx:450`, `components/admin/AdminMessagesHub.tsx:437`, `components/admin/AdminProjectDetail.tsx:540`), which POSTs `/api/files/commit`, which inserts the `files` row at `route.ts:70-90` and calls `recordUsage` at `:97`. `lib/fileCategories.ts:185` maps `category === 'message'` to a first-class vault folder.

The error entered via the state-of-play audit and was not verified before being written into a decision. Recorded here because the failure mode — a plausible claim inherited from a prior document and promoted to settled fact — is the one most likely to recur.

**Decision, restated.** The single file pipeline already exists and is correct. The work is to close four defects in it, all additive:

1. **Reference by FK, not by path.** `messages.attachment_url` stores a `"bucket::path"` string (`0000:150`), constructed at six sites. It cannot be joined, is enforced by no constraint, and breaks if the object moves. Replace with `messages.attachment_file_id → files(id)`, backfilled from `file_path`.
2. **Stop trusting the body.** `app/api/portal/actions/route.ts:225` and `app/api/admin/project-actions/route.ts:123` write whatever attachment reference the client sent, unvalidated against any `files` row. Resolve server-side from the session, per I-6.
3. **Stop orphaning objects.** `app/api/portal/messages/delete/route.ts:43` nulls `attachment_url` and leaves both the `files` row and the R2 object behind.
4. **Build the resumable uploader.** `lib/uploadClient.ts:68-85` is a single XHR PUT with no retry, no resume, no chunking. Against S0 §4's 5 GB ceiling this is the binding defect: one network blip restarts a 90-minute upload from zero. The existing `lib/r2.ts:39-107` is not the answer — it is server-side, buffers the whole body in memory, thresholds at 5 GB against S0's 100 MB, and has no callers. Delete it and write a browser-side multipart client against a presign-part / complete-part route pair.

**Also true, and separate:** `asset_provenance` and `rights` (migration 0003) have zero reads and zero writes anywhere. Provenance is a genuine gap, but it is a gap in the whole system, not in chat specifically. It belongs to S3.

**Net direction.** AD-004 said this decision deletes code. It does not — it adds a resumable uploader and an FK, and deletes only `hooks/useFileUpload.ts` and `lib/r2.ts:39-107`, both already dead.

### AD-002-R — Region *(clarifies AD-002)*

AD-002 stated that `organizations` "carries a `region` column from day one." It does not: `0001_multitenancy.sql:18-27` defines `id, name, subdomain, logo_url, branding, plan, created_at, updated_at`, and no later migration adds one.

The sentence was intended prescriptively and read descriptively. Restated: **`organizations` must gain a nullable `region text` column, backfilled to the US region for the sentinel org, before any second tenant is created.** One migration, zero code files, no upstream dependency. It is the cheapest item in the conformance report.

The conforming half stands: no region is hardcoded in application logic. `lib/r2.ts:17`'s `region: 'auto'` is the required literal for an R2 S3-compatible endpoint, not a residency assumption.

### AD-001-C — `is_client_member()` adoption *(corrects AD-001's rationale)*

AD-001 said `is_client_member()` was "never adopted." It is adopted by two policies — `client_members_team_read` (`0012:82`) and `client_member_projects_team_read` (`0013:35`) — both on the membership tables themselves.

The accurate and more damning statement: **no policy on a work table uses it.** `clients`, `projects`, `files`, `messages`, `tasks`, `invoices`, `notifications`, `project_phases` and `activity_log` all still predicate on `clients.user_id = auth.uid()`. An invited client teammate satisfies no client-side policy on any real data. The decision is unchanged; the rationale is sharper.

---

## 2. New constraints — tenant two is currently impossible

S0 assumed multi-tenancy was a filtering problem to be solved in S1. On the crew and identity side it is a **cardinality** problem, enforced by schema. These are CONSTRAINT entries in S0 §0's taxonomy: facts we must design around, not choices.

| ID | Constraint | Source | Consequence |
|---|---|---|---|
| **T-1** | `organization_members.user_id` is UNIQUE | `0012:17` | A person belongs to at most one organization, permanently. Forecloses contractors serving two studios, agency partnerships, and any "one login, many orgs" model. |
| **T-2** | `clients.email` is globally UNIQUE across all tenants | `0000:252` | Two studios cannot both have a client at the same address. `create-client:40-51` surfaces the collision as "A client with this email already exists," disclosing the existence of another tenant's client. |
| **T-3** | `business_settings` is a literal singleton | `0000:55`, id `text default 'singleton'` | Holds tenant identity, address and **bank details**. Accessed by `.eq('id','singleton')` or `.limit(1).single()` at six sites. Per-tenant requires a table redesign, not a predicate. |
| **T-4** | The owner bootstrap counts the entire members table | `lib/team.ts:26-29` | The first admin of a second organization resolves to `member`, not `owner`, because tenant zero's roster is non-empty. Tenant two cannot be onboarded correctly. |
| **T-5** | No insert stamps `organization_id` on any work table | 15 insert sites; all rely on the column DEFAULT at `0001:40-50` | Tenant two's rows would be created inside tenant zero regardless of every fix above. |

**Taken together: the product cannot accept a second tenant today.** Not "would leak" — would fail. Since P-1 states Throughline is built to sell, T-1 through T-5 are the gate on the commercial premise, and S1 must resolve all five before any of them is a coding task.

Two further cardinality facts S1 inherits:

- **A person in two client companies breaks the app.** The schema permits it (`client_members.user_id` has no unique constraint), but `lib/team.ts:142-147` and `:218-223` both use `.single()`, which errors on two rows and resolves the person to *no* client account at all. Uploads break with it, via `lib/uploadScope.ts:35`.
- **Removing a teammate deletes their account globally.** `app/api/portal/team/route.ts:188-189` and both admin equivalents call `auth.admin.deleteUser()`. A company owner removing one collaborator destroys that person's access to every other company and to the crew.
  *(CORRECTED, Batch 12.2: true when written, no longer true. Batch 6.2 replaced all of these calls with `cutMemberAccess()` — removal takes the membership row and the claims, never the account. The account is deleted only by the deliberate erasure path, `lib/erasure.ts`.)*

---

## 3. Corrections to §3 and §5 of S0

**I-5 — the credit gate default is inverted in schema.** S0 §4 records "hard-stop at zero balance: on by default, opt-out only" as a DECISION. `org_budgets.hard_stop` is declared `not null default false` (`0002:28`), and `app/api/studio/muse/route.ts:75` gates on `credit.hardStop && balanceCents <= 0`. The shipped default is therefore *no gate*. One migration flips the default and backfills existing rows; it has no upstream dependency and the highest ratio of financial exposure to remediation cost in the report.

**Retention (S0 §5) has no expression surface.** No table has a `deleted_at` column, no purge job exists, no export path exists. The 90-day grace and the 7-year activity-log policy are currently unimplementable statements rather than violated ones. S3 owns the schema for this.
*(PARTIALLY CORRECTED, Batch 12.2: the erasure-request half of §5 is now expressible — `lib/erasure.ts` + `POST /api/admin/erase-person` answer a right-to-erasure request. `deleted_at`, the 90-day grace, purge jobs and the export path remain unbuilt and remain S3's.)*

**Default-deny is not in force.** `lib/permissions.ts:183-185` returns `true` when a capability key is unknown, contradicting its own comment at `:136-138`. Any feature slug added to `lib/studio/spaces.ts` without a matching `ORG_FEATURE_CAP` entry is visible to every crew member. This moves the default-deny question from S4 to **S2**, since it is an authorization defect rather than an IA one.

---

## 4. Sequencing constraints discovered

These are not decisions; they are couplings S6 must respect or it will schedule work that cannot be done in the order planned.

1. **I-1 and I-3 move together, per surface.** A poll that refetches page 1 while the user is reading page 3 is worse than no poll. Paginate and de-poll the same surface in the same change.
2. **I-3 is gated on AD-001.** Every poll exists because realtime delivery was not trusted, and it was not trusted because RLS does not cover the readers. Removing a poll before its channel is verified to deliver for that reader converts a slow surface into a silently stale one — strictly worse for a live client. The RLS test harness is what earns the right to delete each poll.
3. **I-8 and I-11 are one pass.** Both touch the same 65 modules. Converting `supabaseAdmin` from a const to a guarded accessor and migrating call sites off it should not be two sweeps.
4. **I-8's allowlist lands first, as a ratchet.** Allowlist all 65 importers on day one, then shrink it. Without the lint rule in place during a migration that long, the surface regrows behind you.
5. **I-9 lands behind a typed helper, not 350 edits.** ~350 query chains across ~90 files is the largest mechanical change in the report and the one most likely to be done wrong by hand.
6. **AD-006 is gated on I-2 and on S5.** A Review Session adds subscriptions to a session already at 13, and frame-accurate synced playback needs a normalised proxy render that nothing in the repo produces.
7. **AD-005 is gated on the document-types question.** Mapping FDX onto today's single generic `kind='script'` document will be redone if types land later. Sequence types first or accept the rework knowingly.

---

## 5. Unblocked and independent

Items with no upstream dependency, listed so S6 has a set of things that can proceed while S1 is written:

- `CRON_SECRET` fail-open — `app/api/cron/message-nudge/route.ts:74-80`, two lines, one file.
- `organizations.region` column — one migration (AD-002-R).
- `org_budgets.hard_stop` default flip — one migration.
- The `supabaseAdmin` allowlist + ESLint rule, as a ratchet.
- Zod at the API boundary (I-7) — additive, per-route, dependency already installed.
- `lib/supabase/admin.ts` and `lib/r2.ts` lazy accessors (I-11), paired with the above.

**Requires a production read, not a repo read.** Whether `20260603_phase7.sql:44-52` and `20260604_phase8.sql:69-75` are applied to the live database cannot be answered from source. They grant admin SELECT on eight tables based on user-editable `user_metadata`. If present, this is the only actively exploitable finding in the report and outranks everything in this document.

---

## 6. Carried forward — updated

Added to S0 §7:

- Resolution of T-1 … T-5 → **S1**, blocking
- Session establishment rule (`getSession()` vs `getUser()`, conformance C-1) → **S2**
- Default-deny in `orgFeatureAllowed` (C-5) → **S2**, moved from S4
- Stored XSS in Script Design (C-2) → **S2.5**, first entry
- Global presence disclosure (C-3) → **S2.5**
- Rate limiting (C-10) → **S2.5**
- Retention schema (C-11) → **S3**
- Dead code inventory beyond the `(admin)` group (C-6) → **S4**
- Styling system selection (C-12) → **S4**

---

*End of S0-A. Next: S1 — Product definition & tenancy model, which must resolve T-1 through T-5.*
