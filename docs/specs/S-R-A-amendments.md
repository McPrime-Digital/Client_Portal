# Genreline — S-R-A: Amendments to S-R

**Status:** Settled. Supersedes the named sections of `S-R`.
**Date:** 2026-09-12
**Cause:** the Batch 25 item 0 audit and the build that followed. `S-R` was written against the schema and the capability layer as described in `S1`, `S2` and `HANDOFF`, not against `lib/permissions.ts` and `organization_members` as they actually stand. Four of its claims are false, one of its decisions is unreachable in the schema it specifies, and the vocabulary it prescribes is one granularity finer than the one that shipped.
**Rule:** `S-R` is not edited. It is settled at `b8cf4aa` and its text stands as the record. This document governs where they disagree.

**One amendment describes a decision the schema cannot execute.** It is marked.

---

## A-1 — `organization_member_projects` already exists

`S-R` §2's axis table says the project-role axis "**Does not exist anywhere**," and §10 lists the table under *Additive* as something to create.

The table exists. It landed with the B1–B4 crew-scoping work and carries `member_id`, `project_id`, `organization_id`, `created_at`.

**Amendment:** only `project_role` and `expires_at` are additive. The table, its primary key and its FKs are already live, and a migration that creates it will fail or — worse, if written defensively — silently do nothing while reporting success.

The substance of §2 survives: the project-role *axis* does not exist, because the table has no `project_role` column. What does not exist is the column, not the table. That distinction is the whole difference between an `alter` and a `create`.

---

## A-2 — §4's paragraph about Batch 22's capabilities is false

`S-R` §4 states that Batch 22 created five approval capabilities on both rosters, that they are "the first real entries in this namespace," and that the build "adopts them verbatim."

No such strings were ever created. Batch 22 deliberately created an **action type**, not capability keys:

```ts
type ApprovalAction = 'create' | 'decide' | 'set_window' | 'withdraw' | 'set_comment_permission'
```

mapping onto capabilities that already existed — `run_projects` and `approve` for create and decide, `approval_policy` for the other three. `lib/permissions.ts:152-158` records the reason in full: every new capability string is a value that can end up stored in an `extra_caps` row, and renaming or removing one later strips granted access.

Exactly **one** new capability string came out of Batch 22: `approval_policy`.

**Amendment:** §4's paragraph is struck. The distinction it got backwards is load-bearing and is stated here as the rule: **actions are what code asks; capabilities are what is stored and granted.** They are different vocabularies with different lifetimes, and a stored value is far more expensive to change than a symbol in a switch.

A consequence `S-R` depends on elsewhere: **`record.approval.decide` does not exist.** `S-R` R-11 and its build item both name it. The authority it refers to is `run_projects` crew-side and `approve` client-side, reached through `ApprovalAction 'decide'`.

---

## A-3 ⚠️ — §10's unique index makes R-3 unreachable

*The only amendment here that requires a migration rather than a correction.*

`S-R` R-3 says: **deny beats grant, always.** "Where a grant and a denial name the same capability, the denial wins, with no branch and no precedence table to argue about." That sentence presupposes both rows existing at once.

`S-R` §10 then specifies:

```
unique (member_id, capability) where revoked_at is null
```

One active row per person per capability. A grant and a deny on the same key **cannot coexist**, so there is never anything for "deny wins" to resolve between. The decision is unreachable in the schema that was written to implement it, and harness assertion 31 tests a state the tables cannot hold.

**Amendment — the index widens to admit both:**

```
unique (member_id, capability, mode) where revoked_at is null
```

`has_cap()` resolves as R-3 already states: baseline ∪ active grants − active denials, deny winning.

**Why widening rather than restating R-3 as "the latest row wins."** The alternative is coherent and simpler — a deny replaces the grant — and it is rejected for two reasons.

A grant and a denial are separate acts, by potentially different people, for different reasons, each with its own `granted_by`, `granted_at` and `expires_at`. Letting one destroy the other loses the record of why the grant existed, in the table, while R-8's ledger still remembers it. The row and the ledger would then disagree about what a person holds, which is the shape `HANDOFF` §12 lesson 4 records.

And it changes behaviour on revocation. Under the widened index, revoking a denial restores the underlying grant — which is what "this person is denied rates *for now*" means. Under latest-wins, revoking the denial leaves nothing, because the grant row was overwritten, and the person silently ends up below where an admin deliberately put them. The second is the surprising one, and it surprises in the direction of removing access someone was given.

"Latest wins" is also itself a precedence rule — a temporal one — which is precisely what R-3 says it does not want.

**Cost.** One index swap. It is cheapest before grants accumulate; the migration's item 0 confirms the live row count on both grant tables before it runs, and reports rather than assumes.

**And the assertion.** Harness assertion 31 is reachable today — it was phrased against the ROLE BASELINE, which is R-3's own Producer/rates example and is constructible under the narrow index. So it is not vacuous, and it should not be rewritten. What the widening adds is a SECOND constructible case: an explicit grant and an explicit deny on the same capability, held at once, which is the state R-3 was written for and the tables have never been able to hold. Batch 26 adds an assertion for it alongside 31, with the grant alone as its positive control. Without that, the widening ships with nothing proving the behaviour it exists to enable — lesson 9 one step later in time, and the step where it is easiest to miss, because the existing assertion passes either way.

---

## A-4 — the stored vocabulary is coarse; §4 is the vocabulary of questions

`S-R` §4 specifies 38 fine-grained capability keys and the build was briefed to migrate the stored vocabulary onto them. The audit established that this conflates two different things, and the migration was refused on that ground.

`lib/permissions.ts` holds **14 coarse capabilities** — 8 crew-side, 6 portal-side — each covering a feature area. §4's 38 keys are not another spelling of those; they are a finer granularity. Expanding one stored grant into ten fine keys is not a rename. It asserts that a coarse grant made months ago meant all ten, which is an intent nobody recorded — `HANDOFF` §12 lesson 1's shape, a migration that repairs state while inventing the invariant behind it.

**Amendment, and it is the largest in this document:**

- **§4's 38 keys are the vocabulary of QUESTIONS the code asks.** `can('money.invoice.send')` is a legitimate question and stays.
- **The 14 coarse capabilities are the vocabulary of what is STORED and GRANTED.** One stored value per grant.
- A **coarse→fine resolution table** sits between them, the way `ORG_APPROVAL_CAP` already resolves `ApprovalAction`. That table is authoritative over §4 where the two disagree.

Stored vocabulary as shipped, renamed 1→1 into dot form so item 8's grant surface can group by domain, with no capability gaining or losing scope:

| Was | Is | Grants |
|---|---|---|
| `run_projects` | `work.projects` | projects, tasks, approvals, files, messages |
| `workspace` | `work.suite` | the Suite |
| `manage_clients` | `client.manage` | companies, client teams, invite policy |
| `manage_team` | `people.manage` | crew invites, roles, removal, grants |
| `client_money` | `money.invoices` | invoices: read, create, send, mark paid |
| `cost_control` | `money.costs` | Control Tower, budgets, credits, usage |
| `org_settings` | `org.settings` | business settings — not billing |
| `approval_policy` | `record.approval_policy` | the terms of an approval |
| `view` | `portal.view` | overview, projects, files, approvals, messages |
| `message` | `portal.message` | send messages |
| `upload` | `portal.upload` | upload files |
| `approve` | `portal.approve` | approve / request changes |
| `invoices` | `portal.invoices` | see and pay invoices |
| `manage_team` (portal) | `portal.team` | invite, roles, remove teammates |

`platform.*` resolves to an **`OWNER_ONLY` sentinel, not `null`.** `null` already means "deliberately ungated" in `ORG_FEATURE_CAP`, and reusing it with the opposite meaning is a trap that reads as safe — the same reasoning behind `CLIENT_APPROVAL_CAP`'s existing `'never'`.

---

## A-5 — §4 has no key for business settings

`org_settings` grants writes to `business_settings`, which holds the studio's bank details — `S2` §4 Class D data. `S-R` §4 enumerates no key for it, and the nearest candidate, `platform.billing`, is wrong: billing is owner-only and ungrantable under G-2, while business settings are legitimately an admin's.

**Amendment:** `org.settings` is its own capability, grantable, distinct from `platform.billing`.

Found the expensive way. The build's first pass gated the whole of `invoice-actions` behind one money capability — which would have handed the studio's banking to `finance`, who legitimately holds money and legitimately does not hold settings. Closing one over-grant by opening another, and it would have read as correct in review.

---

## A-6 — §4 enumerates no client-side namespace

`S-R` §4 lists five domains and every one of them is crew-side. The six portal capabilities have no namespace at all.

**Amendment:** the portal tree is `portal.*`, not `client.*`.

`client.*` is already §4's domain for **the studio's authority over its client companies** — `client.company.create`, `client.portal.configure`. Putting a portal member's authority over *their own* company behind the same prefix recreates the `member` trap one prefix up: the same word meaning two different things depending on which roster a row came from, with nothing in the key to say which. `portal.*` is also what this codebase already calls that tree (`app/(portal)/`, `portalAccess`, `PortalAccess`).

The trap this avoids, recorded because it nearly fired twice: **org-side `member` is deprecated and maps to `crew`; client-side `member` is a live, current role.** Nothing may ever sweep `member → crew` across both rosters.

---

## A-7 — `money.rates.read` is deliberately unmapped

Every candidate over-grants. `money.costs` is held by `producer`, and `S-R` §3.1 gives a producer budget on their own productions and explicitly not the company's books, while §4 calls crew rates the most sensitive thing a production company holds.

**Amendment:** `money.rates.read` maps to nothing and therefore denies, via the existing `undefined → false` default. There is no rates table and no surface, so "nothing answers true" is the correct answer until both exist. Its mapping is decided when the surface is built, not before.

---

## A-8 — two known coarsenesses, recorded rather than resolved

The coarse layer cannot express two distinctions that `S-R` §4 anticipated. Both ship as mapped, because re-granulating here would be A-4's rejected migration through a side door. Both are recorded so the next reader finds a decision rather than an accident.

**`record.ledger.read` and `record.certificate.export` resolve to `work.projects`.** So anyone who can touch a project can export the certificate proving what a client signed off — the dispute surface, `S3-c` §3.2. Defensible, since a producer running a job plausibly needs it. But the record surface has no grant of its own and cannot be given or withheld independently of the work. Splitting it needs a real case: a studio wanting a coordinator to run jobs without exporting sign-off certificates.

**`client.message.send` resolves to `work.projects`**, not `client.manage`. That is where it lives today, and it produces `S-R` §3.1's coordinator exactly — able to talk to a client without being able to create or delete the company.

The two share a cause. **`work.projects` is by a distance the broadest coarse capability**, covering projects, tasks, approvals, files and messages. Three times during the build, something the coarse layer could not express turned out to be inside it. It is where the first split lands when a real case appears.

---

## A-9 — §12's migration sequence, as built

`S-R` §12 bundles `seat_class` and `organization_member_projects` with the grant tables in migration 1.

**Amendment:** the batch boundary moved. `seat_class`, `project_role` and the scoping default are a later batch, because `organization_member_projects` carries the empty-set-means-all footgun (§10) and landing it alongside policies on live money tables stacks two independent risks on a tenant with real client traffic. The spec's *sequence* is unchanged; only where the batch line falls.

What shipped: the grant tables, `has_cap()`, `role_baseline()`, the coarse vocabulary, **capability predicates on eleven tables in twelve policies — wider than §9's nine** (see A-10; 0053 also gated `organization_member_projects` and `client_member_projects`, because the scope of a membership is part of the membership record), G-1…G-4 as triggers, the grant surface and permission ledger, R-11 in the sweep.

What is owed, and the exposure it leaves named plainly: **`seat_class`, `project_role`, and the invite-time scoping default.** Until they land, `scope_mode` is `'all'` on every live row because nothing states it at invite time, so **a crew member still reads every project in the tenant.** `work.*` and `client.*` remain app-layer per §9 and are filtered by project scope — and scope is not yet stated.

---

## A-10 — verified state at the close of the build

For the record, from live reads:

- Migrations 0000–0054 applied. Harness 35 assertions, 0 vacuous.
- `organization_members` carries eight admitted roles: `owner`, `admin`, `producer`, `coordinator`, `finance`, `crew`, plus `editor` and `member` admitted and deprecated. Two production rows, both already truthful before the batch.
- `client_members` needed no widening — its CHECK already admitted `S-R`'s four exactly.
- `app_metadata.org_role` is gone from every auth row. `app_metadata.role` keeps its two-valued routing meaning and authorizes nothing. `is_admin()` has zero database consumers since 0021.
- Capability predicates live on eleven tables, in twelve policies — `S-R` §9 names nine, and 0053 also gated `organization_member_projects` and `client_member_projects`, because the scope of a membership is part of the membership record. Leaving them out would let a granted `people.manage` change a role but not the project scope attached to it. Deliberate, recorded in the migration header, and wider than §9 as written. All 23 money paths still run on the service role, so those predicates changed no application behaviour — they closed the PostgREST door a probe had walked as a roster member.
- One `auth.users` row carries a typo'd address (`.con`) with no membership on either roster and no `client_id` claim — so it authenticates and then resolves to nothing: `resolveCaps()` returns denied and the portal layout finds no membership. The Norton Slims member is at the correct `.com` address and receives mail normally. Recorded because the two defects are different and the wrong one was filed first: "a member who can never be reached" is an address to correct, "a sign-in that resolves to nothing" is an orphan auth row, and they have different fixes.

**The finding worth carrying.** `organization_members.role` was already honest, because it has a writer — both invite paths have written it since the roster existed. `organizations.plan` is wrong for the mirrored reason: nothing writes it, so every row reads the column default. Stated as the rule, next to `HANDOFF` §12 lesson 5: **a column with a writer tells the truth; a column with only a default tells you its default.**

**And one about this document.** The `.con` claim above was wrong in its first draft and had to be corrected before commit. It entered `HANDOFF` §8.3 item 19 from a compression of the Batch 25 audit's q3 output — which had the right answer — was written up wrongly, and came back as a premise for a settled spec. `HANDOFF` §12 lesson 4 with one author on both ends of it. The audit that found it was the same one that produced the correct reading in the first place, which is the argument for verifying a claim against the source rather than against the document that quotes it.

---

*End of S-R-A. `S-R` governs except where this document names a section.*
