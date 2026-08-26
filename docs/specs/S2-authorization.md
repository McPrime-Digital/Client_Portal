# Throughline — S2: Authorization Spec

**Status:** Draft for approval.
**Date:** 2026-08-26
**Depends on:** `S0` (AD-001), `S0-A`, `S0-conformance.md`, `S1-tenancy-and-entitlement.md`
**Implements:** AD-001 — layered authorization, tenancy in the database.
**Resolves:** conformance C-1 (session establishment), C-5 (default-deny), I-8 (service-role allowlist), and the three RLS defects in S1 §6.

**Applied state as of writing:** migrations 0018 and 0019 applied. Batch 1 shipped. `organizations.type` and `.region` exist, `business_settings` is per-tenant, `clients.email` is org-scoped, `organization_member_projects` exists, `scope_mode` exists on both rosters.

---

## 0. What this document is for

Today, authorization lives in application code. 65 modules read through the service role, which bypasses RLS entirely. The policies that exist are therefore decorative on those paths — and load-bearing on the handful of browser-client paths, where they are wrong.

S2 makes the database the tenancy boundary. When it is done, a forgotten `.eq()` is a bug rather than a breach.

**The order of operations is the whole spec.** Policies are corrected and *proven* before any read path moves. Getting this backwards breaks live clients.

---

## 1. The layered model

| Layer | Owns | Where |
|---|---|---|
| **RLS** | Tenancy: which org, which company, which project, which history window | Postgres policies |
| **Capability matrix** | Capability: may this role approve, see this feature, write this column | `lib/permissions.ts` |
| **Service role** | Paths with no user session, enumerated | Allowlist + lint rule |

RLS answers *whose rows are these*. TypeScript answers *what may this person do with them*. Neither substitutes for the other, and the split is what keeps policies simple enough to read in `pg_policies` without running them.

---

## 2. Session establishment — resolves C-1

**Rule: every protected surface establishes identity with `auth.getUser()`. `auth.getSession()` is never used for an authorization decision.**

`getSession()` decodes the cookie without revalidating it against the auth server. `app/(portal)/layout.tsx:17` — the gate for the entire client portal — is the only protected surface using it. Every other surface (71 files) uses `getUser()`.

Practical risk today is low because `proxy.ts:31` calls `getUser()` first on every matched request. It is still the single most security-sensitive line in the portal, and it should not be the outlier.

**Change:** one line in `app/(portal)/layout.tsx`. Add an ESLint rule banning `getSession` outside `lib/supabase/`.

---

## 3. Helper functions

All are `stable`, `security definer`, with `set search_path = public`. Security definer is required so the function can read membership tables that the calling user's own policies would otherwise restrict — without it, membership checks recurse.

```sql
-- Existing, unchanged
current_org()            -- app_metadata.organization_id, null when absent

-- Existing, redefined
is_client_member(cid)    -- drops the clients.user_id branch; client_members is sole
                         -- authority per S1 §5.2

-- New
is_org_member()          -- active organization_members row for auth.uid() in current_org()
is_org_admin()           -- as above, role in ('owner','admin')
org_project_visible(pid) -- scope_mode='all', or a matching organization_member_projects row
client_project_visible(pid) -- scope_mode='all', or a matching client_member_projects row
member_history_from()    -- the caller's history_from cutoff, null = full history
```

**Performance rule, non-negotiable in policy authoring:** wrap every helper call in a subselect — `(select is_org_member())`, never `is_org_member()`. Postgres then evaluates it once per query as an InitPlan rather than once per row. On a 174-row message table the difference is invisible; on a 200,000-row table it is the difference between 8ms and 4 seconds. Write it correctly from the first policy so it is never retrofitted.

**On `is_admin()`.** It reads `app_metadata.role` from the JWT and is used by ~40 existing policies. It is *not* org-scoped, which is why `organization_members_admin_all` and its two siblings leak across tenants. It is not deleted in this spec — it is progressively replaced by `is_org_admin()` per table class, so no policy is left in an ambiguous half-migrated state.

---

## 4. The policy set

Five table classes. Every policy is `to authenticated`; nothing is `to public`.

### Class A — Org-internal
`documents` · `document_versions` · `document_comments` · `storyboards` · `storyboard_shots` · `usage_events` · `org_budgets` · `org_credits` · `credit_ledger` · `asset_provenance` · `rights`

No client access at all.

```sql
using (organization_id = (select current_org()) and (select is_org_member()))
```

### Class B — Client work
`projects` · `files` · `messages` · `tasks` · `invoices` · `notifications` · `project_phases` · `activity_log`

Two audiences, two policies per operation.

```sql
-- crew
using (
  organization_id = (select current_org())
  and (select is_org_member())
  and (project_id is null or (select org_project_visible(project_id)))
)

-- client portal
using (
  (select is_client_member(client_id))
  and (project_id is null or (select client_project_visible(project_id)))
  and (created_at >= coalesce((select member_history_from()), '-infinity'::timestamptz))
)
```

The `history_from` clause applies to `messages` and `activity_log` only — a teammate invited in August should not read July's thread. It is currently enforced in application code and nowhere in the database.

### Class C — Membership
`organization_members` · `organization_member_projects` · `client_members` · `client_member_projects`

```sql
-- admin manage (replaces the three un-scoped is_admin() policies in S1 §6)
using (organization_id = (select current_org()) and (select is_org_admin()))

-- self read
using (user_id = auth.uid())

-- client team read
using ((select is_client_member(client_id)))
```

**These three are the highest-priority fix in the document.** `organization_members_admin_all` (0012:69), `client_members_admin_all` (0012:77) and `client_member_projects_admin_all` (0013:27) gate on `is_admin()` alone with no org predicate. The moment a second organization exists, any admin reads and writes every organization's roster.

### Class D — Tenant root
`organizations` · `business_settings`

```sql
using (id = (select current_org()))              -- organizations
using (organization_id = (select current_org())) -- business_settings
```

`business_settings` holds bank details. Write access is `is_org_admin()` only.

### Class E — `clients`, and the column problem

`clients` needs its own treatment because of the defect at `0000:416`:

```sql
create policy "Client can update own record" on public.clients
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
```

RLS controls *rows*, not *columns*. A client with a session can set `is_active`, `invite_policy` (overriding an owner's `locked` setting), or `organization_id` — moving their company into another tenant. The application enforces an allowlist; the policy does not.

**Fix: column-level privileges, which Postgres does support.**

```sql
revoke update on public.clients from authenticated;
grant update (name, phone, avatar_url, notification_prefs, welcome_dismissed_at)
  on public.clients to authenticated;
```

Combined with the row policy, a client may update their own company row and only the five columns a client is permitted to touch. Everything else routes through an admin path.

### Not covered by RLS
`push_subscriptions` has no FK to `clients` and no reliable tenant predicate. It stays service-role-only and is listed as a permanent allowlist entry.

---

## 5. Default-deny — resolves C-5

`lib/permissions.ts:183-185` returns `true` when a capability key is unknown, contradicting its own comment at `:136-138`. Any feature slug added to `lib/studio/spaces.ts` without a matching `ORG_FEATURE_CAP` entry is visible to every crew member.

```ts
// before
if (cap === null || cap === undefined) return true;
// after
if (cap === undefined) return false;   // unmapped slug → denied
if (cap === null) return true;         // explicitly public, deliberate
```

The `null` case must stay meaningful — it is how a feature declares itself intentionally ungated. `undefined` means nobody mapped it, which is a mistake, and mistakes deny.

Pair with a type-level guard: `ORG_FEATURE_CAP` keyed by a union derived from `spaces.ts`, so an unmapped slug fails `tsc` rather than shipping open.

---

## 6. The RLS test harness

**This is the artifact that makes everything else safe.** It is not a follow-up.

Not a test framework — CLAUDE.md's constraint stands. A single script, plain `supabase-js`, no dependencies, run with `npm run test:rls`.

**Design.** Seed a second organization and a second client company in a transaction, create sessions for each persona, run assertions with the *user* client (never service role), roll back.

**Personas:** studio-A owner · studio-A scoped crew · studio-B owner · client-1 owner · client-1 scoped teammate · client-2 owner · revoked member.

**Assertions — every one a `count = 0`:**

| # | Assertion |
|---|---|
| 1 | Studio B reads zero rows of studio A's projects, files, messages, tasks, invoices, activity |
| 2 | Studio B's admin reads zero rows of studio A's rosters |
| 3 | Client 1 reads zero rows belonging to client 2 |
| 4 | A teammate scoped to project 1 reads zero rows of project 2 — tasks *and* activity |
| 5 | A teammate with `history_from` set reads zero messages older than the cutoff |
| 6 | A revoked member reads zero rows anywhere |
| 7 | A client cannot update `is_active`, `invite_policy` or `organization_id` on their own row |
| 8 | A client cannot insert a row carrying another company's `client_id` |
| 9 | An unauthenticated session reads zero rows from every table |

Assertion 4 is the one that matters most: it is the class of bug that was live in `project-tasks` until this week, where scoping was configured and silently unenforced.

**Baseline first.** Run the harness against *current* policies before changing any of them. It will fail on most assertions. That failing output is the baseline, and each policy class turns a group green. Without it there is no evidence anything improved.

---

## 7. The service-role migration — I-8

65 modules import `supabaseAdmin`. Three are legitimate.

**Permanent allowlist:**
- `app/api/webhooks/stripe/route.ts` — no session by construction
- `app/api/cron/message-nudge/route.ts` (GET) — cron, bearer-authenticated
- Supabase Auth admin calls in the invite routes (`inviteUserByEmail`, `createUser`, `updateUserById`) — these require service role by design
- `push_subscriptions` access — no tenant predicate available

**Everything else migrates.** Order, and it is not negotiable:

1. **Helpers land.** Additive, nothing reads them.
2. **Harness lands, red.** Baseline recorded.
3. **Policies fixed per class**, harness green per class. No application code changes yet.
4. **Read paths flip, one surface at a time.** Portal dashboard first — it is the highest-traffic client surface and the easiest to verify. Then projects, files, messages, invoices. Studio surfaces after.
5. **Write paths flip.** Later than reads: a failed read shows an empty list, a failed write loses data.
6. **Allowlist shrinks** as each surface migrates. The lint rule from Batch 1 prevents regrowth.

**Pair with I-11 in the same pass.** Converting `supabaseAdmin` from a module-scope const to a guarded `getSupabaseAdmin()` accessor touches the same 65 files. Do it once, not twice.

---

## 8. The Custom Access Token Hook

AD-001 consequence 1. All 7 current users carry `app_metadata.organization_id`, so `current_org()` resolves today and this is not an emergency. It is needed before the next new user is created — otherwise a new crew member's JWT lacks the claim, `current_org()` returns NULL, and every Class A and D policy evaluates false. They log in to a silently empty Workspace with no error.

The hook stamps `organization_id` and roles at token issue. **Claims go stale until refresh**, so role changes need either a short token TTL or a forced refresh on the roles-changed event. Multi-org switching (v2) must *not* use a claim — a URL segment resolves immediately and revocation works.

---

## 9. Batches

**Migration 0020 — helpers and Class C.** Six functions, plus the three un-scoped membership policies replaced. Class C first because it is the live cross-tenant hole.

**Migration 0021 — Classes A, B, D, E.** The bulk of the policy set, plus the column grants on `clients`.

**Code batch:**

| # | Change | Files |
|---|---|---|
| 1 | `getSession()` → `getUser()` + lint rule | `(portal)/layout.tsx`, eslint config |
| 2 | Default-deny + typed cap map | `lib/permissions.ts`, `lib/studio/spaces.ts` |
| 3 | RLS test harness | 1 new script, `package.json` |
| 4 | Custom Access Token Hook | 1 Supabase function + config |
| 5 | `getSupabaseAdmin()` accessor + call-site migration | 65 |
| 6 | Read paths off service role, per surface | staged |

Items 1–4 are independent and land immediately. Item 5 is the large mechanical pass. Item 6 is staged and gated on the harness.

---

## 10. What this unblocks

- **I-3, de-polling.** Every one of the 24 polls exists because realtime delivery was not trusted, and it was not trusted because RLS does not cover the readers. A verified policy per reader is what earns the right to delete each poll.
- **Browser-client reads in the Workspace**, which is how Script Design and Storyboard already work — correctly, but on policies nobody has proven.
- **The multiplexed realtime channel (I-2)**, which is only safe once rows are scoped to the member.
- **Selling.** Tenant isolation in the database is the first question a buyer's technical reviewer asks, and the harness output is the answer.

---

## 11. Open questions

1. **Harness environment.** Against a local Supabase instance (`supabase start`, needs the CLI, which the repo does not currently have) or a dedicated staging project? Staging is faster to stand up; local is free and offline.
2. **`is_admin()` retirement.** Replace per class as specified, or redefine `is_admin()` itself to be org-scoped in one migration? The second is fewer changes and riskier — it silently alters the meaning of ~40 existing policies at once.
3. **Read-path migration order.** Portal-first (highest traffic, easiest to verify, most exposed if wrong) or studio-first (lower traffic, you are the only user, safest to break)? Recommendation: studio-first for the first two surfaces to shake out the pattern, then portal.
4. **`clients.user_id` drop.** S1 deferred it to this batch. Once no policy references it, the column and the `lib/team.ts` primary-login branches go together.

---

*End of S2. Next: S3-core — messaging schema, approval decoupling, file version stacking, retention columns.*
