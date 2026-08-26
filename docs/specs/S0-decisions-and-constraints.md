# Throughline — S0: Decisions & Constraints

**Status:** Settled. Amendable only by superseding entry.
**Date:** 2026-08-25
**Supersedes:** `docs/throughline-master-plan.md` and `docs/throughline-architecture-wiring.md` as roadmap. Both are retained as historical intent only.
**Baseline:** `THROUGHLINE_STATE_OF_PLAY.md` (audit, 2026-08-25, commit a7d207e)

---

## 0. Purpose

This document exists so that no later spec re-opens a settled question, and so that anything assumed rather than known is visible as an assumption.

Every entry is one of three kinds:

| Kind | Meaning |
|---|---|
| **DECISION** | Settled. Later specs comply or file a superseding entry. |
| **CONSTRAINT** | A fact about the world we must design around. Not negotiable by us. |
| **ASSUMPTION** | A default chosen in the absence of data. Cheap to revise. Flagged so nobody mistakes it for a fact. |

Spec stack, in dependency order. Each is unwritable until the prior is settled:

- **S0** — Decisions & Constraints *(this document)*
- **S1** — Product definition & tenancy model
- **S2** — Authorization spec
- **S2.5** — Threat model & non-functional requirements
- **S3** — Target domain model
- **S4** — Surface & IA spec
- **S5** — Infrastructure spec
- **S6** — Remediation & sequencing plan

---

## 1. Settled product answers

**P-1 — Throughline is a product built to sell.** McPrime Digital is tenant zero and a real dependent user, not the customer. Where "convenient for McPrime" and "correct for a tenant" conflict, correct-for-a-tenant wins. Hardcoded McPrime identity is a defect, not a shortcut.

**P-2 — The portal is live with real client traffic today.** Every change ships against a running system. No big-bang migrations. No refactor that requires a coordinated outage.

**P-3 — Throughline is the product; the client portal is a subsystem of it.** Not two products, not a portal with a studio bolted on. The portal is how a tenant's clients see the work.

---

## 2. Architecture decisions

### AD-001 — Authorization boundary: layered, tenancy in the database

**Decision.** RLS owns *tenancy* — organization, company and project membership. Coarse, simple, readable in `pg_policies` without running it. The TypeScript capability matrix owns *capability* — approval rights, feature gating, `extra_caps`, column allowlists. Service role is an enumerated allowlist for paths with no user session: webhooks, cron, invite creation, admin backfills. Everything reachable by a user session goes through the cookie-bound user client.

**Why.** The deciding constraint is not philosophy, it is Realtime. Browser subscriptions — presence, broadcast, the Yjs provider, `postgres_changes` badges — authenticate as the user and are filtered by RLS. Service role cannot do browser realtime. Correct RLS must therefore be maintained regardless. Given that, app-layer-only means paying the full cost of RLS and receiving none of its protection.

Secondary: we are selling now, and tenant isolation is the first thing a buyer's security review examines. And with one tenant live, blast radius is near zero — this is the cheapest hour this decision will ever cost. `is_client_member()` already exists in migration 0012, built for exactly this pivot and never adopted.

**Rejected alternative — app layer as sole boundary.** The case was real, not a strawman: authorization logic stays visible, testable and co-located with the code that uses it; policies express business rules badly and can only be debugged through EXPLAIN. Rejected because it breaks Realtime, and because a single forgotten filter becomes a customer-notification event rather than a bug.

**Consequences.**
1. A Custom Access Token Hook stamps `organization_id` and roles into the JWT at issue. This alone fixes the silent-empty-Workspace bug where `current_org()` returns NULL. Claims baked into a JWT persist until the token refreshes, so revocation requires a short TTL or forced refresh — design for it.
2. An RLS test harness is a prerequisite, not a follow-up. It is what makes incremental migration safe, and it is the artifact a security reviewer asks for.
3. Client-side policies move from `clients.user_id = auth.uid()` to membership predicates.
4. Read paths migrate off `supabaseAdmin` one surface at a time. Policies are corrected and verified *before* any read path flips, so nothing breaks for live clients mid-migration.
5. A lint rule bans `supabaseAdmin` import outside the allowlist, so the decision cannot erode.
6. Explicit `.eq('organization_id', …)` filters are retained under RLS. Not redundancy — the explicit predicate lets Postgres use the index.

### AD-002 — Region: United States, single region

**Decision.** One US region. `organizations` carries a `region` column from day one. No region assumption is hardcoded anywhere.

**Constraint.** A Supabase project's region is fixed at creation. Changing it means a new project plus a migration of database, auth users and storage, with downtime.

**Why now.** Some buyers require data resident in their region, often as a procurement condition rather than a legal one. More relevant to this market: film has its own regime — studios and broadcasters impose content-security requirements on pre-release footage, and the Trusted Partner Network is the industry audit program. Carrying a `region` column now makes a second region a deployment; retrofitting one makes it a rewrite.

### AD-003 — Person deletion: tombstone, never cascade

**Decision.** Deleting a person never deletes their work. On deletion, denormalized display names — `sender_name`, `uploaded_by_name`, `actor_name` — are replaced with a stable pseudonym. Threads stay readable, attribution survives, the person is gone.

**Why.** Migration 0016 already established `ON DELETE SET NULL` on every `auth.users` FK for this reason. But denormalized names currently survive deletion everywhere the person ever spoke, which blocks true erasure. One migration and one function now; an archaeology project in two years.

### AD-004 — One file pipeline

**Decision.** Every uploaded byte is a `files` row. A message attachment is a file whose origin is a message. One uploader, one metering path, one vault, one provenance chain.

**Why.** Today `messages.attachment_url` is a `"bucket::path"` string that never becomes a `files` row — so chat attachments are invisible to the File Vault, uncounted in storage metering, and carry no category, version or provenance. Tolerable at 100 MB. Untenable at 5 GB, where someone drops a master in chat and it neither appears in the vault nor bills against storage. This decision deletes code rather than adding it.

**Consequences.** Chat and deliverables share the resumable multipart uploader. Above ~100 MB the UI renders a file card with a generated proxy rather than an inline preview.

### AD-005 — FDX interoperability is an adoption gate, not a feature

**Decision.** Script Design ships FDX import and export, or professionals cannot adopt it at all.

**Why.** Final Draft is the industry standard and `.FDX` is the format professionals exchange. A director who cannot hand a script to a Final Draft script supervisor cannot use Script Design, regardless of editor quality. This outranks every other Script Design enhancement including document size.

### AD-006 — Review Session, not generic video meetings

**Decision.** Build the Review Session: synced frame-accurate playback with all participants locked to the same frame, voice and video alongside, and comments captured to project timecode during the session. A plain call mode for standups is the easy remainder.

**Why.** The industry separates synchronous review — edit sessions, VFX review, sound spotting, colour — from asynchronous review, which is Frame.io's territory. cineSync serves the synchronous case and is priced out of indie reach. Nobody currently sells synchronous review, asynchronous review and the production workspace together at an indie price. Generic conferencing is a commodity we would lose to Zoom, for free.

**Consequences.** `SessionDock` — the existing "page-in-view" shell, currently an empty frame opened with a fictional project name — is the container. It was designed for this and never filled. LiveKit stays the transport: already named in the plan, `plans.ts` already meters `meetingMinutesPerMonth`, cloud tier is free to start and self-hostable when spend justifies it.

---

## 3. The prime directive

> **No operation in the system may be unbounded.**

"Handles sudden growth without a rebuild" is not a capacity property — Vercel and Supabase scale machines, not query patterns. It is a design property with the definition above. If it holds, growth costs money instead of rewrites.

What forces rewrites is never unpredicted traffic. It is unbounded operations that were fine at one tenant: loading every message ever sent, polling an unpaginated thread every six seconds, an app-wide subscription per user. These do not degrade — they work perfectly, then fall off a cliff, and the fix is a rewrite of the surface.

### Invariants — checkable in review, enforced by lint, type or test where possible

| ID | Invariant |
|---|---|
| **I-1** | Every collection query is keyset-paginated. No offset pagination. No unbounded `select`. |
| **I-2** | Every realtime channel is scoped to a tenant or room. Maximum 2 subscriptions per user session. |
| **I-3** | No polling where push exists. |
| **I-4** | Any operation exceeding ~5s runs on a queue, not in a request. |
| **I-5** | Every AI call carries a per-call ceiling and an org budget check before execution. |
| **I-6** | Ownership is resolved server-side from the session. Never read a tenant identifier from the request body. |
| **I-7** | Every API boundary validates input against a schema. |
| **I-8** | No service-role access on a user-session path. Allowlist only, each entry justified in comment. |
| **I-9** | Every query against a tenant-scoped table carries an explicit tenant filter, even under RLS. |
| **I-10** | No silent failure. No empty catch. Errors reach an error sink. |
| **I-11** | No module-scope client construction requiring env vars. Lazy, guarded accessors only. |
| **I-12** | Migrations are idempotent and forward-only, with a single ordering scheme. |

A short list that is actually enforced beats a long one that rots. These are chosen to be maintainable by one person.

---

## 4. Capacity defaults

**All ASSUMPTION unless marked CONSTRAINT.** Soft caps are rows in a plan table, raised without code change. Hard limits are platform facts.

| Item | Value | Kind |
|---|---|---|
| Tenants | Uncapped | Design property, AD-001 + shared schema |
| Seats per tenant | Soft 1,000; no hard cap; raisable per tenant | ASSUMPTION |
| Concurrent presence per room | 500 | ASSUMPTION — presence traffic grows with the square of the room |
| Projects per company | Uncapped; 500 active as index-design ceiling | User-supplied |
| Messages per thread | Unbounded; keyset paginated, 50/page | DECISION |
| Message attachment | 5 GB | User-supplied |
| Deliverable / master | 5 TiB | CONSTRAINT — R2 object limit |
| Single-part upload | 35 GiB | CONSTRAINT — R2 |
| Multipart threshold | 100 MB | DECISION |
| Multipart parts | 5 MiB–5 GiB, max 10,000 | CONSTRAINT — R2 |
| Storage per tenant | Metered, sold as upgrade. No technical cap. | DECISION |
| Document size | 500,000 characters | DECISION — see below |
| Concurrent doc editors | 50 editors, unlimited viewers | ASSUMPTION |
| Realtime message size | 1 MB | CONSTRAINT — Supabase |
| Channels per connection | ~100 on most plans | CONSTRAINT — Supabase |
| AI per-call ceiling | $2, explicit confirm above | ASSUMPTION |
| Hard-stop at zero balance | **On by default**, opt-out only | DECISION |
| p95 page load | 2.5s | ASSUMPTION |
| Uptime | Best-effort. No SLA, and no marketing copy implying one. | DECISION |

**On document size.** A feature screenplay is 90–120 pages (~200K characters); a TV episode 22–60. 500K covers series bibles and production binders at ~2.5× the longest screenplay while keeping the editor responsive and Yjs sync tractable. The better long-term answer is document *types* — screenplay, treatment, bible, breakdown — each with its own rules, rather than one enormous canvas.

**On viewers vs editors.** Viewers do not broadcast cursor awareness. That asymmetry is what makes unlimited viewers cheap, and it is why a 100-person crew is covered without raising the editor cap.

---

## 5. Retention

| Class | Policy |
|---|---|
| Active data | Retained indefinitely while subscribed |
| Soft-delete grace | 90 days |
| Account closure | 90-day export window, purge within 90 days after |
| Activity log | 7 years |
| Erasure request | Honoured within 30 days |
| Realtime broadcast messages | 3 days — CONSTRAINT, Supabase platform behaviour |

Text is cheap forever; files are not. Meter storage, never history.

**SOC2 is deferred.** It is a security certification enterprise buyers demand before signing — real cost, months of work, irrelevant to small studios. Deferring costs nothing later, because what it audits (audit trail, access control, encryption, offboarding) we are building regardless.

---

## 6. Operating constraint

Solo maintainer. No budget. Hiring is later, and the stated sequence is: one hire, then a second, then AI agents.

This is the binding constraint and specs are written to it, not around it. Concretely: nothing with a fixed monthly floor; free tiers until revenue; and few sharp invariants over broad controls. Every invariant in §3 must hold without discipline — enforced by a lint rule, a test, or a type, not by remembering.

Sequencing therefore matters more than scope. What ships first is a different answer at 5 hours a week than at 30, and S6 cannot be ordered without that number.

---

## 7. Carried forward

**Unresolved, owned by a later spec:**

- Tenancy model — relationship between `clients`, `organizations`, and `clients.user_id` → **S1**
- Whether the 19 stub features stay advertised → **S4**
- Job queue and transcode layer selection → **S5**
- Legacy `(admin)` route group: delete or retain → **S4**
- Invoicing: Stripe or bank transfer; whether `draft` status should exist → **S3**
- Migration runner location; archival of the `2026*` series → **S6**
- Hours per week available → gates **S6**

**Live production risks from the audit, ordered in S6 but noted here so they are not lost:** `CRON_SECRET` failing open; draft-invoice hard failure; invited client teammates 403'd from a 7-second-polled endpoint; forgeable activity log entries; stored XSS in Script Design; the migration ordering hazard.

---

*End of S0. Next: S1 — Product definition & tenancy model.*
