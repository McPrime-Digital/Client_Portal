# Genreline — S-R: Roles, Capabilities and Surfaces

**Status:** Settled. Approved by the owner 2026-09-12.
**Date:** 2026-09-12
**Depends on:** `S0` AD-001 · `S1` §4, §5 · `S1-P` (O-1, O-2) · `S-V` §8 · `S-F` §1.3 · `S2` §1, §4, §5 · `S3-b` §4.1 · `S3-c`
**Supersedes:** `S1` §5.1 (the crew resolution order and its project-scoping table) and `S2` §5 (default-deny, which was the whole capability layer and is not enough) where they disagree. **Amends `S0` AD-001** — see §9, which is the one place this document changes a settled decision.
**Applied state at writing:** the tenancy half of AD-001 is built and proven at 20 harness assertions. The capability half is not built. `organization_members.role` has carried six values since 0015 and almost nothing reads it.

---

## 0. What this document is for

An invited crew member can currently see and do everything the owner can.

That is not a defect in one file. It is the architecture working exactly as specified, with half of it missing. `S2` §1 splits authorization in two — RLS owns tenancy, the capability matrix owns capability — and then §4's crew predicate reads `organization_id = current_org() and is_org_member()`. There is no role anywhere in it. Every active member of a tenant can read every row in that tenant, by design, because the layer that was supposed to narrow it was scheduled after tenancy and never built.

What exists today under the name "capability matrix" is `lib/permissions.ts`, a map from feature slugs to visibility. **Hiding a tile in the rail is not authorization.** The page underneath still queries, the route underneath still writes, and PostgREST is still reachable directly.

This document specifies the missing layer: which roles a film company actually has, what each may do, how an owner or admin adjusts that per person, how it is enforced at the row rather than in a handler, and how a person's dashboard reshapes the moment any of it changes.

**One thing it does not do.** It does not loosen tenancy. Every predicate here is an AND on top of the existing tenant predicates, never an OR beside them.

---

## 1. The decisions

**R-1 — One role enum cannot express a film company, and trying is what produced this.** There are four independent axes. A person is a *kind of seat* (permanent or freelance), holds a *company role* (what they may do studio-wide), holds a *project role* on each production they are on (what they are on that job), and carries *individual grants and denials* on top. Collapsing these into `organization_members.role` is why a freelance editor and a head of production are the same row shape today.

**R-2 — Capability resolves from the roster on every request. Never from the token.** `app_metadata` is stamped and ADVISORY (0022's header), and a JWT survives until logout — so a capability cached in a claim stays live for hours after it is revoked. Membership already follows this rule (`is_org_member()` reads status per query, which is why revocation needs no refresh). Capability follows it for the same reason, and it is what makes §7's live reshape possible at all.

**R-3 — Deny beats grant, always.** An owner or admin can raise a person above their role's baseline and can lower them below it. Both are needed: a Producer who should not see rates on one particular production is a real staffing situation, and inventing a new role for them is how role lists become unreadable. Where a grant and a denial name the same capability, the denial wins, with no branch and no precedence table to argue about.

**R-4 — Nobody grants what they do not hold, and some capabilities are not grantable at all.** "An admin can grant anything" is one sentence from "an admin can make themselves owner." The delegation rules in §6 are what separate the two, and they live in a trigger, not in a route.

**R-5 — Enforcement lives at or below the row for anything that matters.** `S3-c`'s build proved this the hard way: 0038 let an assignee insert a decision directly, so every rule that lived only in the route was optional, and three defects followed (HANDOFF §12 lesson 6). Money, roster and grant operations are reachable by the user client under AD-001. They are enforced in policies and triggers. Routes still check, because a clear 403 beats a silent empty set — but the route is the message, not the control.

**R-5a — Project scope is a filter, not a capability.** Holding `work.file.read` says you may read files. Your project scope says *which*. Conflating them produces a matrix with one row per person per project, which is unmaintainable, and it is the mistake that makes permission systems collapse into "admin or not."

**R-6 — A denied surface does not render.** Not greyed out, not disabled with a tooltip, not present-but-erroring. A disabled tile telling a freelance editor the studio has a production called *Netflix Pilot* is an information leak wearing a UI convention. Absence is the correct rendering of a thing you may not have.

**R-7 — A permission change takes effect live, in both directions, with no refresh.** Adding a capability reveals its surfaces; removing one withdraws them, including from the page the person is standing on. §7 specifies the mechanism and the eviction rule.

**R-8 — Every grant and revoke is a ledger event.** Who changed whom, which capability, when, and by what authority — written server-side as a side effect of the action (`S3-core` §5). A permission change is precisely the fact you need a record of when something has gone wrong, and it is the second table after approvals where "the record is the product" applies.

**R-9 — A named subset of tables gets a role predicate in RLS.** This amends AD-001 and is argued in §9 rather than smuggled in as a migration.

**R-10 — A project role carries a capability baseline, overridable per
person.** A `colorist` on a production gets the Suite surfaces for colour
without an admin granting four keys by hand; an `observer` gets read-only
without four denials. The alternative is administratively hopeless at bench
scale, and what a studio does instead is make everyone an admin — which is
the state this document exists to fix. The cost is that capabilities resolve
from two places, and §5 step 4 is where that happens. Recorded as a cost, not
waved away.

**R-11 — An assignee who can no longer decide is reported, never lapsed.**
If a person loses `record.approval.decide` while they are the assignee of an
active stage, the stage waits on someone who cannot act, the window lapses,
and the certificate says *no response was received* about a person who was
silently prevented from responding. That is `S3-c` AP-2's failure mode
arriving through this document's door. The sweep detects an assignee whose
resolved set no longer permits the decision and reports the stage as blocked
on a permission change rather than advancing it. A silent stall is worse than
an error — Batch 22's three triggers exist for the same reason.

---

## 2. The four axes

| Axis | Question it answers | Where it lives | State today |
|---|---|---|---|
| **Seat class** | Permanent staff, or freelance bench? | `organization_members.seat_class` | Specified in `S3-b` §4.1. **Not built.** |
| **Company role** | What may you do studio-wide? | `organization_members.role` | Exists since 0015. **Almost nothing reads it.** |
| **Project role** | What are you *on this production*? | `organization_member_projects.project_role` | **Does not exist anywhere.** |
| **Grants and denials** | The exceptions, per person | `org_member_cap_grants` | `extra_caps[]` does half (grants). No denials. |

**Why seat class is the load-bearing one for this product.** `S1-P`'s O-1 and O-2 are defined by a large rotating freelance bench — that is the archetype, not a detail of it. A permanent producer joining should see the studio. A freelance colorist joining should see the one job they were hired for. Those are opposite defaults, and today there is one default: everything.

`scope_mode` exists from B1–B4 and the machinery works. What was never built is the thing that *states* the value at invite time, which `S3-b` §4.1 specified. So every crew member invited today gets the permissive default because nothing chooses otherwise. **The mechanism is not missing. The decision is.**

**Why project role is the missing axis.** A person is a producer on one production and an editor on another. This is not an edge case in film; it is the normal case. One studio-wide role cannot express it, so any system built on one either over-grants (everyone is a producer) or forces a person into a single identity that is wrong on half their jobs.

---

## 3. The roles, as film companies and agencies actually have them

### 3.1 Company roles

Studio-wide. `organization_members.role`, widened from 0015's six.

| Role | Who this is | The shape of what they hold |
|---|---|---|
| `owner` | Studio principal, founder | Everything, including billing, the organization itself, and the right to grant |
| `admin` | Head of production, studio manager | Everything except billing, org deletion, erasure, and granting the grant |
| `producer` | Producer, Executive Producer | Owns productions: creates projects, runs the client relationship, requests approvals, sees budget on their own productions — not the company's books |
| `coordinator` | Production Coordinator, Production Secretary, Project Manager | Scheduling, tasks, files, client messaging. **No money, no roster.** |
| `finance` | Production Accountant, Bookkeeper, Business Affairs | Invoices, credits, budgets, rates across every production. **Not the craft floor, not client messaging.** |
| `crew` | The craft floor — editors, artists, assistants | Works on assigned productions. Nothing studio-wide. |

**`editor` is retired as a company role.** 0015 admits it, and it is exactly the collapse R-1 names: Editor is what someone *is on a job*, not what they may do across a studio. It stays accepted by the CHECK so no live row breaks, is mapped to the `crew` baseline, and is marked for retirement once its holders are migrated. `member` maps to `crew` for the same reason.

**`coordinator` is additive.** It is the role most production companies actually hire first after a producer, and today those people have to be made admins.

### 3.2 Project roles

Per production, on `organization_member_projects`. This is the new axis.

**Film:** `director` · `producer` · `line_producer` · `writer` · `coordinator` · `post_supervisor` · `editor` · `assistant_editor` · `colorist` · `sound` · `vfx` · `motion` · `observer`

**Agency**, because `S1-P` targets O-2 as a first-class archetype and these are not the same words: `account_director` · `creative_director` · `strategist`

One vocabulary, CHECK-constrained, both sets admitted. An agency's `account_director` resolves to the same capability baseline as a `producer`; a `creative_director` to a `director`; a `strategist` to `observer` plus comment. Same shapes, the names a studio actually uses — which matters, because a person invited into a tool that calls them the wrong thing stops trusting the tool.

`observer` exists so there is a way to put someone on a production read-only without inventing a denial for every write capability.

---

## 4. The capability namespace

Dot-notation, five working domains plus platform. Keys are data, not code branches.

**`money.*`** — `invoice.read` · `invoice.write` · `invoice.send` · `credits.read` · `credits.topup` · `budget.read` · `budget.write` · `rates.read`

**`people.*`** — `roster.read` · `invite` · `remove` · `role.set` · `caps.grant` · `caps.deny`

**`client.*`** — `company.read` · `company.create` · `company.update` · `company.delete` · `message.send` · `portal.configure`

**`work.*`** — `project.read` · `project.create` · `project.update` · `project.archive` · `file.read` · `file.upload` · `file.version` · `file.delete` · `task.read` · `task.write` · `suite.script` · `suite.storyboard`

**`record.*`** — `ledger.read` · `certificate.export`

**`platform.*`** — `billing` · `org.delete` · `erasure` · `grant`

**The approval capabilities already exist.** `S3-c`'s build created five of them on both rosters in Batch 22. They are the first real entries in this namespace and **are not renamed** — churn on live keys buys nothing. The build's item 0 reports their actual key strings and this namespace adopts them verbatim; the `record.*` domain is where they sit.

**The boundaries that actually matter**, stated plainly because the table above is long and the shape is short: **money**, **people**, **the client relationship**, **the work**, and **the record**. A freelance editor needs the work, on one production. A production accountant needs money, across all of them, and none of the craft floor. Almost every real permission question is one of those five.

`money.rates.read` is specified and has no surface yet — no rates table exists. It is here because crew rates are the single most sensitive thing a production company holds, and the capability should exist before the table does rather than after.

---

## 5. Resolution order

Default deny at every level. This supersedes `S1` §5.1.

```
0. Active organization_member of this org?          → else DENY
1. organizations.plan permits the feature?          → else DENY   (S-V §8)
2. organizations.type permits the space?            → else HIDE   (S1 §4)
3. seat_class permits?                              → else DENY
4. role baseline grants the capability?
5.   ∪ individual grants
6.   − individual denials                           → DENY WINS
7. project scope admits this row?                   → else DENY   (R-5a)
```

Steps 4–6 produce a capability **set**. Step 7 filters rows and never removes a capability — a scoped person holds `work.file.read` in full; it simply matches fewer rows.

The `null` / `undefined` distinction from `S2` §5 stands and is load-bearing: `null` means a capability is deliberately ungated, `undefined` means nobody mapped it, and unmapped denies. Keep the type-level guard so an unmapped slug fails `tsc` rather than shipping open.

**One resolver.** The rail, the space landings, the route guards and the policies all answer from the same computation. Three copies of a permission check drift, and the first time the rail and the route disagree, neither is trusted — the same argument `S3-c` §3 makes about one row read three ways.

---

## 6. Granting and revoking

An owner or admin may raise or lower any person on either roster. Five rules make that safe.

**G-1 — You cannot grant what you do not hold.** The granter's own resolved set is the ceiling on what they may give.

**G-2 — `platform.*` is owner-only and ungrantable.** Billing, organization deletion, erasure, and `platform.grant` itself. An admin who can grant the grant is an owner with extra steps.

**G-3 — Nobody edits their own row, and an admin never edits an owner's.** Self-elevation and lateral capture, both closed. An owner edits their own row only for things outside `platform.*`.

**G-4 — Never zero owners.** A change that would leave an organization, or a client company, without an active owner is refused. Batch 7.5 found this exact shape already: a bootstrap whose count had no status filter demoted the owner out of their own team management.

**G-5 — Grants may expire.** `expires_at`, null meaning permanent. For a freelance bench this is what you actually want — access granted for a production should not accumulate across every job a person has ever touched. An expired grant is simply not resolved; nothing is deleted, so the record of what was held and when survives.

**Where these live.** `organization_members` and `client_members` are Class C tables with RLS. An admin holding UPDATE can write any role string and any capability array straight through PostgREST, past every route check in the codebase. So G-1 through G-4 are **triggers**, in the shape 0039 and 0040 established. The route checks too, and returns a reason — but the trigger is the control.

**The client side has two ceilings, not one.** A client company's owner grants and revokes for their teammates, bounded by their own set (G-1) *and* by what the studio has made available to that company. The studio's ceiling sits over the client owner's ceiling, and a studio lowering a company's ceiling lowers every teammate under it at the same moment.

---

## 7. Live propagation

R-7. The moment a role, grant or denial changes, the affected person's dashboard reshapes — no refresh, in both directions.

**Why this works at all:** R-2. Capability is resolved from the roster per request, so there is no cached token to invalidate. Both roster tables are already in `supabase_realtime` (0013:42, 0013:45), so the change is already broadcast.

**The mechanism:**

1. The person's session subscribes to **their own roster row and their own grant rows**, filtered on their id. Never the whole roster — a member watching every membership row is a disclosure surface and an I-2 violation at once.
2. On a change, the session re-fetches its resolved capability set from one route and updates one context. The rail, the landing tiles and the route guards all read that context, so they reshape together (§5's one resolver).
3. Server-rendered data refreshes in the same tick, because a capability change usually changes what a server component may read.

**This must not add a channel.** I-2 is violated at roughly six subscriptions per hub session and the budget work is deferred, not forgiven. The capability listener rides an existing per-session channel with a user-filtered replication predicate. If it cannot, that is a stop-and-report, not a seventh channel.

**Eviction — the part that is easy to forget.** If a capability is removed while the person is standing on the surface it granted, they are moved to the nearest surface they still hold, with a plain sentence saying access changed. They are never left on a stale render, never shown a raw error, and never shown a 403 page that names what they lost. A withdrawal that only hides the nav leaves the person on a live page reading data they no longer may see.

**Writes are already covered.** A revoked capability fails at the policy and the trigger on the next attempt, regardless of what the browser still has on screen. The live reshape is a courtesy to the user; the row is the control.

**Claims are re-stamped for consistency and authorize nothing** — 0022's header, unchanged.

---

## 8. Surfaces

**S-1 — A dashboard is a projection of a capability set, not a design.** There is no per-role layout file. The surfaces a person holds are computed, and the dashboard renders their union. A new capability produces a new dashboard for everyone who holds it, with no layout work.

**S-2 — Denied surfaces are absent** (R-6).

**S-3 — Empty states never name what is missing.** "No projects yet" is correct for a collaborator with no assignments. "No projects — ask an admin for access to Production X" is a leak.

**S-4 — Navigation, landing tiles and route guards read the same resolver** (§5).

What this produces, sketched so the shape is concrete rather than asserted:

- **Owner / admin** — the studio: every space, the roster, the books, every production, settings.
- **Producer** — their productions in full, the client relationship, approvals, budget on their own jobs; no company books, no roster management.
- **Coordinator** — schedule, tasks, files and client messaging across assigned productions; money surfaces absent entirely.
- **Finance** — invoices, credits, budgets, usage across every production; the craft floor and client messaging absent. A first-class dashboard of its own rather than the producer view with tiles removed.
- **Crew, permanent** — the craft floor and the productions they are on.
- **Collaborator, freelance** — one production, or a few. The Suite for their craft, the files and tasks of those jobs, the room for those jobs. No client company list, no roster, no money, and no indication that any of it exists.

**Client portal.** The same rule, one ceiling lower. A client company's owner sees their company's work, their roster, their invoices. An `approver` sees what they must decide on. A `member` sees the projects they are scoped to. A `viewer` reads and comments and never writes — which is what `S3-c` §4.3 already requires of the artifact viewer, now stated as a role rather than as one feature's rule.

---

## 9. The RLS amendment — this changes AD-001

**Approved by the owner 2026-09-12.** AD-001 stands amended: for the
subset named below, and for nothing else, RLS carries a capability
predicate alongside its tenancy predicate.
AD-001 is clean: RLS owns tenancy, TypeScript owns capability. This document keeps that for everything except a named subset, and the exception is argued here rather than appearing in a migration header.

**Why it is necessary.** AD-001 puts the *user* client on these paths. A crew member with a session can query `invoices` through PostgREST directly. If the only thing standing between them and the company's books is a check in a route handler, there is nothing standing between them and the company's books. That is HANDOFF §12 lesson 6, already paid for once in Batch 22.

**The subset:** `invoices` · `org_credits` · `org_budgets` · `credit_ledger` · `usage_events` · `organization_members` · `client_members` · `org_member_cap_grants` · `client_member_cap_grants`.

Money and people. Nothing else.

**The mechanism** is one helper, so policies stay readable in `pg_policies` — which `S2` §1 names as the reason the split exists:

```sql
create or replace function public.has_cap(p_cap text)
returns boolean language sql stable security definer set search_path = public as $$ … $$;
```

Resolving role baseline ∪ grants − denials, from the roster, for `auth.uid()` in `current_org()`. Policies read `(select public.has_cap('money.invoice.read'))` — wrapped, per 0021's InitPlan rule, so it evaluates once per query rather than once per row.

**What stays app-layer.** Everything in `work.*` and `client.*`. Those tables are already correctly scoped by tenant and project, the capability distinctions there are about *actions* rather than *visibility*, and adding a role predicate to `messages` or `files` would double the policy count for no security gain. The split is not abandoned — it is drawn at money and people, which is where a wrong answer costs real money or real privacy.

---

## 10. Schema

**Additive:**

| Change | Why |
|---|---|
| `organization_members.seat_class text not null default 'crew'` CHECK (`crew`,`collaborator`) | `S3-b` §4.1, built here instead. Backfill: every existing member is `crew` |
| `organization_members.role` CHECK widened to add `coordinator` | §3.1. `editor` and `member` stay admitted, deprecated |
| `organization_member_projects` (`member_id`, `project_id`, `project_role`, `created_at`, `expires_at`) | `S1` §5.1's table, plus §3.2's axis and G-5's expiry. PK `(member_id, project_id)` |
| `org_member_cap_grants` / `client_member_cap_grants` | §6. `member_id` FK, `capability`, `mode` (`grant`\|`deny`), `granted_by`, `granted_by_name`, `granted_at`, `expires_at`, `revoked_at` |
| `public.has_cap(text)` | §9 |

**Two grant tables, not one polymorphic table.** The rosters are separate tables with separate FKs, and a real foreign key is worth more here than one fewer table — `S3-core` §2.2 records what polymorphism costs, and there is no reason to pay it twice.

**`granted_by_name` is resolved from the roster at grant time**, never from `user_metadata` — the 7.8 / 11.5 defect, and the same rule `approval_decisions.actor_name` follows.

**`extra_caps[]` keeps being written** as a derived projection of the grant rows until a later batch drops it. Rule Zero: it is live on both rosters and read by `lib/permissions.ts` today. Same dual-write shape Batch 22 used for the six legacy task columns.

**The footgun, restated because it has bitten once.** `organization_member_projects` inherits the client-side semantics: **no rows means all projects; any rows means only those.** An empty set is "all", so a bulk delete silently grants full access. `scope_mode` is what states it rather than inferring it — B1's lesson — and `seat_class` is what chooses `scope_mode` at invite time.

**The grant ledger is `activity_log`**, with event types for grant, revoke, role change and scope change. No new table; R-8 needs the record, not a schema.

---

## 11. Harness additions

Eight, each with a positive control.

1. A crew member without `money.invoice.read` cannot read an invoice. Control: `finance` can.
2. A denial beats a grant on the same capability. Control: the grant alone permits.
3. An admin cannot change their own role or their own caps. Control: they can change another member's.
4. An admin cannot modify an owner's row. Control: an owner can.
5. Nobody grants a capability they do not hold. Control: an owner granting one they hold succeeds.
6. The last active owner cannot be downgraded or removed. Control: with two owners, one can.
7. A collaborator with no project rows reads no projects. Control: a `crew` member with `scope_mode='all'` reads them.
8. An expired grant does not resolve. Control: the same grant before expiry does.

Assertions 3 through 6 are the ones that make §6 true rather than intended. They are also the ones a route test cannot prove, because the route is not the control.

---

## 12. Migration sequence

Runs after `S3-c`. Additive first.

| # | Contents | Shape |
|---|---|---|
| 1 | `seat_class` + backfill; role CHECK widened; `organization_member_projects`; both grant tables + RLS | Additive |
| 2 | `has_cap()`; role predicates on §9's subset; `extra_caps` projection trigger | Constraining |
| 3 | G-1…G-4 delegation triggers on both rosters | Additive |

Migration 2 is the only one that can break a live read. It ships behind the deploy that teaches the app to ask for capabilities, per the additive/destructive ordering rule.

**Sequenced as three batches**, not one: the audit plus the matrix and route enforcement; then seat class, project roles and the scoping default; then the surfaces and live propagation. The first of those is where the live problem closes.

---

## 13. Deliberately not in v1

Studio-defined custom roles — the six in §3.1 plus grants and denials cover every real case, and a role builder is a settings surface nobody has asked for. Per-capability toggles in the UI for all ~40 keys; the grant surface offers the capabilities a granter holds, grouped by domain, not a wall of checkboxes. Approval workflows on grants themselves. Time-of-day or IP restrictions. Delegation chains beyond one level.

---

## 14. Open questions

1. **ANSWERED 2026-09-12 — a baseline, overridable. See R-10.**

2. **ANSWERED 2026-09-12 — the sweep reports, it does not lapse. See R-11.**

3. **Do collaborators count against a separate seat cap for billing?** `S-F` §1.3 says 100 crew and 100 collaborators counted separately. Confirm that survives contact with pricing, since seat class now has teeth.

4. **Do client-side project roles need to exist in v1?** The client roster has `role` and project scoping but no per-project role. **Recommendation: no.** A client company's people are not staffed per production the way a crew is, and the four roles plus scope cover it. Additive if a real case appears.

5. **`money.rates.read` has no table behind it.** The capability exists before the surface, deliberately. Whether crew rates live in Genreline at all is a product question that the first real production company will answer, and it affects §9's subset.

---

*End of S-R. Governs roles, capabilities, delegation and surface composition on both rosters. Amends `S0` AD-001 at §9 and nothing else in S0, S0-A or S0-B.*
