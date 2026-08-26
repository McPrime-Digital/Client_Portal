# Throughline — S1: Tenancy & Entitlement Model

**Status:** Draft for approval.
**Date:** 2026-08-26
**Depends on:** `S0-decisions-and-constraints.md`, `S0-A-amendments.md`, `S0-conformance.md`, `S1-P-personas-and-segments.md`, `S-V-film-os.md`
**Resolves:** T-1 … T-5 (S0-A §2) — the constraints that make a second tenant impossible.
**Live data as of 2026-08-26:** 1 organization · 6 client companies · 7 auth users · 7 projects · 174 messages · 18 files · 49 activity rows. Every migration below is safe at this size. This is the cheapest this work will ever be.

---

## 0. The correction that shapes this document

There are **two** client-side surfaces, and S-V §6 described them as one:

| Surface | Route group | Whose tool it is | Roster |
|---|---|---|---|
| **Client Management** | `/studio/client/*` | The studio's. How McPrime manages its client companies. | `organization_members` |
| **Client Portal** | `(portal)` | The client company's own. Their projects, files, invoices, team, settings. | `client_members` |

The Client Portal is a **mini-tenant inside a tenant**. A client company has its own roster, its own role vocabulary (`owner` / `approver` / `member` / `viewer`), its own project scoping, and its own invite policy. It is not a filtered view of the studio's data — it is a parallel entitlement tree.

**Therefore S1 resolves two membership models, not one.** Any design that treats client access as "the studio's permissions, minus some" is wrong and will have to be undone.

---

## 1. The entity model

```
organizations                      ← THE TENANT. Billing, plan, archetype, region.
│
├── organization_members           ← CREW ROSTER (studio side)
│   │                                roles: owner|admin|producer|finance|editor|member
│   └── organization_member_projects   ← NEW. Crew project scoping.
│
└── clients                        ← A CLIENT COMPANY (belongs to exactly one org)
    │                                the studio's customer
    ├── client_members             ← CLIENT ROSTER (portal side)
    │   │                            roles: owner|approver|member|viewer
    │   └── client_member_projects ← existing. Client project scoping.
    │
    └── projects                   ← the work, belonging to one client company
```

**Naming, settled.** `clients` is a **client company**, not a person. The UI already calls this "Companies" (`spaces.ts:42`). The table is not renamed in v1 — 63 query chains reference it and the rename buys nothing — but every spec, comment and new identifier uses *client company*. The single-login-per-company reading of `clients.user_id` is a legacy artifact, addressed in §3.

---

## 2. v1 cardinality — settled

| Relationship | v1 rule | Enforcement |
|---|---|---|
| Person → organization | **One.** A person is crew at one studio. | `unique(user_id)` on `organization_members` — kept deliberately |
| Person → client company | **One active membership.** | Application-enforced; schema permits more (see §5) |
| Client company → organization | **One.** | `clients.organization_id`, not null |
| Project → client company | **At most one.** May be zero (orphaned by company deletion). | `projects.client_id`, nullable |
| Person → both trees | **Allowed.** Someone may be crew at McPrime *and* a client contact at another company. Different tables, no conflict. | — |

**Why keep `unique(user_id)` on `organization_members` rather than widen it now.** The schema must not permit states the code cannot handle. `lib/team.ts:20-24` resolves org roles with `.single()` on `user_id`; two rows would error and lock the person out entirely. Until the code supports multi-org (v2), the constraint is a *guard*, not an obstacle. Widening it early creates a data state that silently breaks logins.

**The v2 migration is written down now so it is not rediscovered:**
```sql
alter table public.organization_members drop constraint organization_members_user_id_key;
alter table public.organization_members add constraint organization_members_org_user_key
  unique (organization_id, user_id);
```
Paired code change: `lib/team.ts:20-36` and `:56-60` stop using `.single()` on `user_id` and take an active-org parameter. That is the whole of T-1's v2 cost, and it is small — which is the point of writing it down.

---

## 3. T-1 … T-5 — resolutions

### T-1 — Person belongs to one organization
**Resolution: accept for v1, guard in schema, seam documented in §2.** No migration.

### T-2 — `clients.email` is globally unique
**Resolution: fix now.** `0000:252` makes the constraint global across all tenants. Two studios cannot both have a client at the same address, and `create-client:40-51` reports the collision as "A client with this email already exists" — disclosing another tenant's client roster one probe at a time.

```sql
alter table public.clients drop constraint clients_email_key;
alter table public.clients add constraint clients_org_email_key
  unique (organization_id, email);
```
Six rows today. Non-breaking. Also close the leak: the duplicate-email error must not distinguish "exists in your org" from "exists somewhere."

### T-3 — `business_settings` is a literal singleton
**Resolution: fix now.** It holds tenant name, address and **bank details** (`0000:55-66`). Studio two seeing studio one's account number is not a defect you survive commercially. One row today.

```sql
-- organization_id becomes the primary key; the 'singleton' text id is retired.
alter table public.business_settings drop constraint business_settings_pkey;
update public.business_settings set organization_id = '00000000-...-0001' where organization_id is null;
alter table public.business_settings alter column organization_id set not null;
alter table public.business_settings add primary key (organization_id);
alter table public.business_settings drop column id;
```
Six code sites change from `.eq('id','singleton')` or `.limit(1).single()` to an org-scoped lookup: `invoice-actions:195,203,220`, `(portal)/invoices/page.tsx:43`, `(portal)/layout.tsx:97`, `(admin)/admin/layout.tsx:27`, `lib/notify.ts:177`, `presence/heartbeat:20`.

**Related, same migration:** `presence/heartbeat:19-22` issues an unfiltered `UPDATE ... .not('id','is',null)` across the whole table every 30 seconds per admin. Correct only while the table is a true singleton. Scope it to the caller's org.

### T-4 — Owner bootstrap counts the entire members table
**Resolution: fix now.** `lib/team.ts:26-29` counts all rows in `organization_members`, so the first admin of a second organization resolves to `member` because tenant zero's roster is non-empty. One line: scope the count to the caller's `organization_id`. No migration.

### T-5 — No insert stamps `organization_id`
**Resolution: fix now, both belt and braces.** Every work-table insert relies on the column DEFAULT (`0001:40-50`). Fifteen sites must stamp it explicitly from the session; the DEFAULT stays as a backstop rather than the mechanism.

Sites: `create-client:117` · `invite-client:78` · `create-project:57` · `files/commit:72` · `portal/actions:219` · `admin/project-actions` (message and task inserts) · `notify.ts:44,75` · `ScriptHome.tsx:320` (documents) · storyboard inserts · `logActivity.server.ts` · invoice creation · phase creation · push subscription.

**How to make this hold without discipline (S0 §6):** a single `tenantScope(session)` helper returning `{ organizationId, clientId, projectIds }`, plus an ESLint rule banning direct `supabaseAdmin.from(<tenant table>).insert()` outside it. The invariant then survives without anyone remembering it.

---

## 4. The archetype axis

The missing primitive from S1-P §0.

```sql
alter table public.organizations
  add column if not exists type text not null default 'client_serving'
  check (type in ('client_serving','internal','solo'));
alter table public.organizations
  add column if not exists region text;   -- AD-002-R, same migration
```

| `type` | Config | Spaces rendered | Approval counterparty |
|---|---|---|---|
| `client_serving` | A | Workspace + Client + Crew | External client contact (P-6) |
| `internal` | B | Workspace + Crew | Internal stakeholder (P-9) |
| `solo` | C | Workspace + minimal Crew | Self, or investor (P-10) |

Consumed by `lib/studio/spaces.ts` (which spaces render) and `lib/permissions.ts` (which guards apply). McPrime is `client_serving`.

**This column is why enterprise is later a configuration rather than a rebuild.** Nothing in v1 sets it to anything but `client_serving` — that is expected and correct. The value is that every navigation and guard decision consults it *from the start*, so Config B is a value change rather than a branch inserted into forty call sites.

---

## 5. The two entitlement trees

### 5.1 Crew side (studio)

Resolution order, **default deny at every level**:

```
1. Is the person an active organization_member of this org?   → else deny
2. Does organizations.type permit this space?                  → else hide
3. Does organizations.plan permit this feature?                → else hide
4. Do role + roles[] + extra_caps permit this action?          → else deny
5. Is the project within their organization_member_projects?   → else deny
```

**Step 5 is new.** `organization_members` has no project scoping today, while `client_members` does. That asymmetry is a real gap for O-1 and O-2, whose freelance bench is most of their headcount — a freelance editor should see one production, not the whole studio.

```sql
create table if not exists public.organization_member_projects (
  member_id  uuid not null references public.organization_members(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, project_id)
);
```
Same semantics as the client side, and the same footgun to document: **no rows means all projects; any rows means only those.** An empty set is "all", so a bulk delete silently grants full access.

**Fix `lib/permissions.ts:183-185` in the same change.** It returns `true` for an unknown capability key despite a comment claiming default-deny. Any feature slug added to `spaces.ts` without a matching `ORG_FEATURE_CAP` entry is currently visible to every crew member.

### 5.2 Client side (portal)

```
1. Is the person the client company's primary login, or an active client_member?
2. Does the client company belong to this organization?
3. Does role (owner|approver|member|viewer) permit this action?
4. Is the project within their client_member_projects?
5. Is the record newer than their history_from cutoff?
```

**Two identities for one person, and it must collapse.** `is_client_member()` (`0012:54`) ORs `client_members` with `clients.user_id`, and `0012:113-117` backfilled every primary login into `client_members` as an `owner`. So the same human exists in two places with nothing keeping them in sync.

**Resolution: `client_members` is the sole authority. `clients.user_id` becomes a legacy pointer, read by nothing.**

Why this matters beyond tidiness — `lib/team.ts:123-124` hardcodes `role: 'owner'`, `extraCaps: []`, `title: null` whenever `clients.user_id === user.id`, bypassing the membership row entirely. So a primary login can never be given a narrower role, and `:182-186` short-circuits their `portalAccess` to `historyFrom: null, projectIds: null` — primary logins can never be project-scoped. Both are wrong for a real client company where the billing contact isn't the person reviewing cuts.

Migration path: verify every `clients.user_id` has a matching `client_members` row (the 0012 backfill did this); delete the `clients.user_id === user.id` branches in `lib/team.ts`; keep the column for one release as a fallback, then drop it.

**Also fix in this batch — the two routes that bypass the helper.** `project-tasks:24-25` and `push/subscribe:20` resolve the caller via `clients.user_id` alone, so invited teammates get 403 from an endpoint polled every 7 seconds. `lib/team.ts:115-148` already handles both cases. Live today; live the moment Monday's client invites anyone.

---

## 6. RLS predicates (feeds S2)

AD-001: RLS owns tenancy, the capability matrix owns capability. The predicate shapes:

| Table class | Crew predicate | Client predicate |
|---|---|---|
| Org-scoped (`documents`, `storyboards`, metering) | `organization_id = current_org()` | none |
| Client work (`projects`, `files`, `messages`, `tasks`, `invoices`) | `organization_id = current_org() and is_org_member()` | `is_client_member(client_id)` |
| Membership tables | `organization_id = current_org() and is_org_admin()` | `is_client_member(client_id)` |

**Three fixes required before any read path flips to the user client:**

1. `organization_members_admin_all` (`0012:69`), `client_members_admin_all` (`0012:77`) and `client_member_projects_admin_all` (`0013:27`) gate on `is_admin()` **alone, with no org predicate**. The moment a second org exists, any admin reads and writes every org's rosters. Every other post-0001 table pairs `is_admin()` with `current_org()`; these three do not.
2. Client-side policies on all nine work tables still read `clients.user_id = auth.uid()` — an invited teammate matches none of them. They move to `is_client_member(client_id)`.
3. `clients` "Client can update own record" (`0000:416`) is an unrestricted-column UPDATE. A client with a session could set `is_active`, `invite_policy` (overriding an owner's `locked` setting), or `organization_id` — moving their company to another tenant. The app enforces a column allowlist; the policy does not.

**Confirmed by production read:** every one of the 7 auth users carries `app_metadata.organization_id`, so `current_org()` resolves correctly today and the Workspace is not silently empty. The Custom Access Token Hook (AD-001 consequence 1) is needed for *new* users and for role changes, not as an emergency.

---

## 7. Migration batch

One migration file, forward-only, idempotent, next in the `00NN` series. Do not touch the `2026*` files.

| # | Change | Rows affected |
|---|---|---|
| 1 | `organizations.type` + `organizations.region` | 1 |
| 2 | `clients.email` unique → `(organization_id, email)` | 6 |
| 3 | `business_settings` PK → `organization_id`, drop `id` | 1 |
| 4 | `organization_member_projects` table | 0 |
| 5 | `client_member_projects.organization_id` added for consistency | 0 |
| 6 | `usage_events.units` → `bigint` **if it is currently `integer`** | 3 |
| 7 | `org_budgets.hard_stop` default → `true`, backfill | 1 |
| 8 | `invoices_status_check` to include `draft` | 0 |

**On item 6.** 10 files committed through the R2 route since June, zero `storage.bytes` rows, while `seat.invited` wrote 3 through the same function. Byte counts overflow `int4` above ~2.1 GB; the error is swallowed by the empty catch at `lib/usage.ts:34`. Confirm the column type before including this. Silver lining: no `ai.*` rows exist yet, so the cents-vs-units corruption in S-V §11 has not happened — fix the write path before AI usage accumulates and the table stays clean.

## 8. Code batch

| # | Change | Files |
|---|---|---|
| 1 | `tenantScope(session)` helper + all 15 inserts stamp `organization_id` | ~12 |
| 2 | Owner bootstrap scoped to org (T-4) | `lib/team.ts:26-29` |
| 3 | `business_settings` reads scoped to org (T-3) | 6 |
| 4 | `presence/heartbeat` unfiltered UPDATE scoped | 1 |
| 5 | `project-tasks` and `push/subscribe` use `clientMembershipOf` | 2 |
| 6 | `lib/team.ts` primary-login branches removed; `client_members` is authority | 1 |
| 7 | `permissions.ts:183` default-deny | 1 |
| 8 | `spaces.ts` / `permissions.ts` consult `organizations.type` | 2 |
| 9 | Crew project scoping in `orgAccessOf` | `lib/team.ts` |
| 10 | ESLint: no direct insert on tenant tables outside `tenantScope` | 1 |

---

## 9. Seams marked for v2

Each written down so it is a scheduled extension rather than a rediscovery:

- **Multi-org membership** (T-1) — migration in §2, plus `lib/team.ts` taking an active-org parameter. Unlocks O-5 (freelancers) and O-7 (post houses).
- **Active-org switching** — a URL segment or session value, never a JWT claim. Claims go stale until refresh; a URL segment is immediate and revocation works.
- **Client company across two studios** — deliberately *not* supported, and not merely deferred. Studio A must not see what a client is making with Studio B; pre-release content isolation is a feature here, not a limitation. Each studio keeps its own `clients` row for the same company.
- **P-9 internal stakeholder** — needs approvals decoupled from the Client space (X-2). The `organizations.type` column is the prerequisite and lands here.
- **P-10 investor** — a client-company role with budget and milestone visibility, no creative authority, no invoices.

---

## 10. Open questions

1. **`usage_events.units` column type** — gates migration item 6.
2. **`clients.user_id` retirement** — drop the column in this batch, or keep one release as a fallback? Recommendation: keep, marked deprecated, drop in the S2 batch once RLS no longer references it.
3. **Crew project scoping default** — should a new crew member see all projects (empty set = all, matching the client side) or none until scoped? The client-side default is permissive; for a freelance bench the safer default is restrictive. These would then differ, which is a real inconsistency either way.
4. **Does the archetype axis affect billing?** An `internal` org has no Client space and therefore no invoicing — does its plan differ, or is it the same plan with fewer surfaces? → S3.

---

*End of S1. Next: S2 — Authorization spec (RLS policy set, the test harness, the service-role allowlist migration).*
