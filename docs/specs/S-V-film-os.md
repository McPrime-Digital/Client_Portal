# Throughline — S-V: The Film OS

**Status:** Target architecture. Describes the destination, not a schedule.
**Date:** 2026-08-26
**Depends on:** `S0-decisions-and-constraints.md`, `S0-A-amendments.md`, `S1-P-personas-and-segments.md`
**Supersedes:** `docs/throughline-master-plan.md` and `docs/throughline-architecture-wiring.md` in full. Those are archived as historical intent.

---

## 0. How to read this document

This is the only document in the stack that describes the whole platform. Everything else narrows.

It has two halves that must not be confused:

- **§1–§12 — the destination.** What Throughline is when it is finished. No dates, no sequencing, no promises.
- **§13–§16 — the cap.** A hard line drawn through the destination marking what v1 contains, what it excludes, and why.

`master-plan.md` failed because it merged those two halves. It described six phases with no v1 boundary, so there was no first task, and after one day of building it was never opened again. The separation here is the point.

**Rule for later specs:** a feature described in §1–§12 but below the line in §13 is *permitted to exist in the architecture* and *forbidden to be built* until its gate opens. Building above the line without moving the line is how a roadmap dies.

---

## 1. The thesis

**Throughline is where a film gets made — script to delivery — including the client relationship and the crew that makes it.**

Three claims, in order of defensibility:

1. **Production tooling is fragmented across a dozen subscriptions**, and the seams between them are where projects lose time and money. A script in Final Draft, boards in a deck, dailies in Frame.io, chat in Slack, files in Dropbox, approvals in email, invoices in Xero. Nobody owns the throughline.
2. **AI production tooling is fragmenting the same way, faster.** Industry coverage names "subscription exhaustion" — the cost of maintaining separate accounts across generation providers — as a specific and growing pain for independent creators. Aggregation is the answer, and it is cheaper to build than any individual model.
3. **The client relationship is production infrastructure, not CRM.** For a company that makes films for paying clients, "who approved v3 and when" is contractual. Every generic project tool treats this as a comment thread. That is Throughline's structural advantage and the half that already exists.

What Throughline is **not**: a model. A generic conferencing tool. A generic project manager. Each of those is a commodity fight against a funded incumbent.

---

## 2. The three spaces

The product is one application with three spaces. Which spaces exist is a property of the **org archetype** (§3), not of the plan or the role.

| Space | Question it answers | Primary occupants |
|---|---|---|
| **Workspace** | *How is the work made?* | Directors, writers, crew, collaborators |
| **Client** | *How does the buyer see the work?* | Client approvers and viewers, producers |
| **Crew** | *How does the company run?* | Owners, producers, finance, everyone internal |

The Client space is the only one that switches off. Workspace and Crew scale down but never disappear — a solo filmmaker still has a Workspace and still has a (one-person) Crew space.

---

## 3. Who it serves

Full definitions in S1-P. Summary and space configuration:

| ID | Archetype | Config | Status |
|---|---|---|---|
| **O-1** | Production company, client-serving | A | **v1 target** |
| **O-2** | Creative agency / content studio | A | **v1 target** |
| **O-3a** | Mid-market in-house team | B | v1.5 |
| **O-3b** | True enterprise (SSO, SOC2, procurement) | B | Destination; deliberately unbuilt |
| **O-4** | Independent filmmaker / director | C | v2 |
| **O-5** | Freelancer | *not an archetype* — a member of others' orgs; multi-org membership, v2 |
| **O-7** | Post house / VFX boutique | A | v2 — Config A with a studio as the client |
| ~~O-6~~ | ~~Content creator~~ | — | **Out of scope, permanently.** Not a target. |

**Configurations:**

- **A — Client-serving.** Workspace + Client + Crew. Approval counterparty is an external client contact.
- **B — Internal.** Workspace + Crew. Client space hidden. Approval counterparty is an internal stakeholder (P-9).
- **C — Solo.** Workspace + minimal Crew. Optional light Client space for financiers and investors (P-10).

**Person archetypes** P-1 … P-9 are defined in S1-P §3. Added here:

- **P-10 — Investor / financier.** A P-7 (client viewer) with budget and milestone reporting, no creative authority, no invoice access. Exists so Config C can expose a narrow Client space without becoming Config A.

---

## 4. Cross-cutting systems

These belong to no space and are used by all of them. Getting their boundaries right is what makes the spaces independent — and what lets you build one feature at a time later without every feature touching every other.

### X-1 — Identity & tenancy
Organizations, membership, roles, capabilities, project scoping, invitations, lifecycle. Owns the answer to "who is this and what may they see." Settled by S1 and S2.

### X-2 — The approval engine
**Decoupled from the Client space by design.** An approval is: a subject (a deliverable version), a requested approver (any person archetype), a decision, a timestamp, an actor identity, and an immutable record. The counterparty may be an external client (Config A), an internal stakeholder (Config B), or the owner themselves (Config C).

Today this is welded to the Client space via `tasks.visible_to_client`, `tasks.requires_approval` and `approval_status`. Decoupling it is the highest-leverage single change in the platform: it is what makes Config B possible at all, and it costs almost nothing now.

### X-3 — The asset pipeline
Every uploaded or generated byte is a `files` row. One uploader (resumable multipart), one authorization path, one metering hook, one provenance chain, one vault. A message attachment is a file whose origin is a message. A generated frame is a file whose origin is a generation. See AD-004-R.

Adjacent: **version stacking** (a file is a version of a parent file, not a new file), **proxy generation** (a normalised playable render for review), and **rights** (licence, commercial use, talent consent, expiry).

### X-4 — The review engine
Two modes over one comment model:

- **Asynchronous** — frame-accurate timecoded comments, drawing on frames, version comparison side by side. Frame.io's territory.
- **Synchronous (Review Session)** — all participants locked to the same frame, voice and video alongside, comments captured to project timecode live. cineSync's territory, and priced out of indie reach.

Both write to the same `video_comments` model, anchored to `(file_version, timecode, optional_region)`. A session produces artifacts rather than evaporating. See AD-006.

### X-5 — Messaging
Threads scoped to a project or a room. Slack-grade infrastructure: keyset pagination, per-user read watermarks (not a per-message `read_at`), first-class threads (not a reply chain), full-text search, push-only delivery. Throughline-specific surface: a message can be an approval gate, a comment can be pinned to a timecode. Internal and client threads are the same engine with different visibility.

### X-6 — Notification & escalation
One event bus. Channel escalation (in-app → push → email → SMS) gated on presence and preference. Per-tenant sender identity — never a hardcoded company name.

### X-7 — Activity & provenance ledger
Append-only. Two audiences: the **activity log** (who did what, for dispute resolution and audit) and **asset provenance** (which model, prompt, seed, parameters and parent asset produced this frame).

Provenance is not optional. Industry coverage reports that a large majority of major studios now maintain AI usage logs for contractual and credit purposes. It is becoming a delivery requirement, not a feature.

### X-8 — Metering & billing
Every consumable recorded at the point of consumption. See §11.

### X-9 — The AI provider mesh
See §10.

### X-10 — Realtime fabric
Presence, broadcast, collaborative document sync, live badges. Scoped to tenant or room, budgeted per session. Never app-wide.

---

## 5. The Workspace

Where the film is made. This is the half that is mostly unbuilt and entirely the future.

| Feature | What it is | State |
|---|---|---|
| **Script Design** | Screenplay editor: industry format (Courier 12pt, fixed margins), page-as-minute pagination, revision mode with coloured pages and paragraph-level asterisks, locked scene numbers with letter insertion (12A), OMITTED pages, tracked changes, anchored comments, version snapshots, collaborative editing | **Built, strong.** Missing FDX, revision mode, document types |
| **FDX interoperability** | Import and export Final Draft `.FDX`; import Fountain, PDF, Word | **Unbuilt.** Adoption gate — see AD-005 |
| **Script breakdown** | Scene/cast/location/prop extraction; day-night reports; the bridge from script into scheduling | Unbuilt |
| **Storyboard** | Boards, shots, shot types, prompts, ordering, frame generation, animatics | **Metadata built.** Generation is a disabled button |
| **The Stage** | Generation surface: text→image, image→video, text→video, reference-consistent characters and environments, take management. The Higgsfield-shaped room | Unbuilt. Blocked on queue + transcode + provider mesh |
| **Continuity** | Character, location, wardrobe and style consistency across shots. Reference libraries, LoRA/style assets, consistency checking | Unbuilt |
| **Sound** | Music, SFX, dialogue, ADR, spotting, mix. Generation and library | Unbuilt |
| **Edit** | Assembly and timeline. Cut, arrange, export. Not a Premiere replacement — an assembly surface for generated and shot material | Unbuilt |
| **Remaster** | Upscale, restore, denoise, frame interpolation, format conversion | Unbuilt |
| **Finishing** | Colour, grade, delivery specs, format packaging, caption and subtitle tracks | Unbuilt |
| **Variant output** | One master → a family: cutdowns, aspect ratios, caption versions, localisations. The enterprise requirement | Unbuilt |
| **Model Arena** | Same prompt across multiple models, side by side, with cost per result. Sells the mesh by making it visible | Unbuilt |
| **Studio Kits** | Templates, presets, house styles, brand kits, reusable LoRAs and reference sets | Unbuilt |
| **Library (DAM)** | Asset library with tagging, search, collections. Distinct from the per-project File Vault | Unbuilt |
| **Provenance** | AI usage log per asset: model, prompt, seed, parameters, parent asset, rights | Tables exist (`asset_provenance`, `rights`), zero reads, zero writes |
| **Workflow / The Graph** | Node DAG. Generation pipelines and business automations on one runtime — only the node library differs | Unbuilt |
| **PrimeOS Assistant** | Multi-model chat assistant, personas, commands, project context | **Built, strong** |

**On The Graph.** It is the most architecturally ambitious item here and the most likely to consume months for no revenue. It should be built only after several Workspace features exist to be composed — a pipeline runtime with nothing to run is an engine on blocks.

---

## 6. The Client space

How the buyer sees the work. This is the half that is largely finished.

| Feature | What it is | State |
|---|---|---|
| **Overview** | Client-facing dashboard: active projects, pending approvals, recent deliverables | **Built** |
| **Companies** | Client company records, contacts, teams, invite policy | **Built** |
| **Projects** | Project detail, phases, progress, brief, timeline | **Built** |
| **Deliverables & review** | Versioned deliverables, frame-accurate comments, version comparison | Vault built; frame-accurate review unbuilt |
| **Approvals & records** | Approval queue, decision provenance, exportable certificates | Built; needs decoupling (X-2), certificates unbuilt |
| **Messages** | Client↔studio threads, attachments, voice notes, presence | **Built** |
| **Invoices** | Issue, track, receipt upload, payment status | **Built** (bank transfer; `draft` status is a live defect) |
| **File vault** | Categorised, foldered, versioned project files | **Built** |
| **Guest links** | Tokenised review links for people without accounts, expiring, watermarked | Unbuilt |
| **Client brand kit** | Per-client assets, palettes, guidelines the studio works against | Unbuilt |
| **Release on payment** | Deliverable unlocks when the invoice clears | Unbuilt |
| **Watermarking** | Session and forensic watermarking on pre-release content | Unbuilt |

---

## 7. The Crew space

How the company runs.

| Feature | What it is | State |
|---|---|---|
| **Directory** | Crew database: skills, day rates, availability, union affiliation, equipment, hire history across productions | Roster built; the production-grade fields are not |
| **Teams & roles** | Membership, roles, custom capabilities, lifecycle, project scoping | **Built and good** — crew-side project scoping is the gap |
| **Internal chat** | Crew-only threads, separate from client threads | Unbuilt (`messages.is_internal` does not exist) |
| **Tasks** | Internal task board, assignment, dependencies | Client-facing board built; internal assignment unbuilt (`tasks.assigned_to` does not exist) |
| **Calendar & scheduling** | Shoot days, call sheets, crew availability, conflicts | Unbuilt |
| **Meetings** | Standup-grade calls. The easy remainder of the Review Session | Unbuilt |
| **Control Tower** | Spend, margin per project, credit burn, utilisation | Unbuilt |
| **CRM & leads** | Pipeline, deals, proposals, outreach | Unbuilt |
| **Settings** | Org identity, branding, billing, integrations, security | Partially built; currently a singleton (T-3) |

---

## 8. Entitlement model — the three axes

Every visibility decision in the product resolves against exactly three inputs.

| Axis | Stored | Determines | Example |
|---|---|---|---|
| **Org archetype** | `organizations.type` → config A / B / C | Which **spaces** render at all | Config B never shows the Client space |
| **Plan tier** | `organizations.plan` | Which **features** within a space; quotas | Starter has no Model Arena |
| **Role + caps** | `organization_members` / `client_members` | Which **actions** are permitted | A viewer cannot approve |

**Resolution order:** archetype → plan → role. A feature renders only if all three permit it. Default deny at every level — including the currently broken case at `lib/permissions.ts:183-185`, where an unknown capability key returns `true`.

**Why three and not one:** collapsing them is what forces a rebuild later. An enterprise buyer is an archetype change, not a plan change. An upgrade is a plan change, not a role change. Conflating any two means a customer type you cannot serve without touching every guard in the application.

---

## 9. What makes this defensible

Stated plainly, because a scope document that does not say why anyone would buy it is a wishlist.

1. **The client relationship is production infrastructure.** No AI film tool has it. No generic PM tool does it properly. It already exists here and is production-grade.
2. **Synchronous *and* asynchronous review, together, at indie price.** cineSync serves sync and is expensive. Frame.io serves async. Nobody bundles both with the workspace.
3. **Aggregation over generation.** Competing on model quality is a funded arms race. Removing subscription exhaustion is a product.
4. **Provenance as a delivery requirement.** AI usage logs are becoming contractual. Building the ledger into the pipeline is far harder to retrofit than to include.
5. **One product, three configurations.** Serving a production company, an agency and an in-house team from one codebase is only possible if the archetype axis exists from the start.

---

## 10. The AI provider mesh

The Workspace's engine. Design principles, in priority order:

**Aggregate, don't integrate.** fal.ai and Replicate are meta-providers exposing hundreds of models behind one API. Two integrations inherit most of the catalogue. Direct integrations (Anthropic, OpenAI, Google) exist only for the assistant, where streaming and tool use matter. `lib/ai/models.ts` already carries `via: 'fal'` and `via: 'replicate'` as type values with no implementation — the catalogue anticipated this.

**Capability routing, not model naming.** Surfaces request a *capability* — `image.generate`, `video.i2v`, `audio.music`, `video.upscale` — and the mesh selects from candidate models by policy (quality, cost ceiling, tenant preference, licence constraints). Users may pin a specific model; nothing in the product should hardcode one.

**Per-org keys, with a house fallback.** Current state is structurally single-tenant: every tenant shares the house keys, so you pay for their generations. Target: a tenant may bring their own keys (their cost, their rate limits, their contractual relationship) or use house keys metered against credits. BYOK is also an enterprise procurement requirement.

**Every call passes through one gate.** Budget check → per-call ceiling → capability route → execute on the queue → meter → write provenance. No surface calls a provider directly. This is what makes I-5 enforceable across every future generation feature rather than re-litigated in each.

**Generation is queued, never in-request.** Video generation is minutes. A request cannot hold it. This is why the job queue gates the entire Workspace.

---

## 11. Metering taxonomy

Defined here in full because **usage data cannot be backfilled.** Every month shipped unmetered is a month of pricing evidence permanently lost. This is a foundation item, not a billing feature.

| Kind | Unit | Recorded when | Notes |
|---|---|---|---|
| `seat.active` | member-days | Daily snapshot | Distinguish crew, client and guest seats |
| `storage.bytes` | byte-days | Daily snapshot | Peak and average; not a delta |
| `storage.egress` | bytes | On download | R2 has no egress fee — but tenant cost visibility still matters |
| `ai.text.tokens` | tokens in / out | Per call | From provider-reported usage, never estimated from character counts |
| `ai.image.count` | images | Per generation | Tagged by model class |
| `ai.video.seconds` | output seconds | Per generation | The expensive one |
| `ai.audio.seconds` | output seconds | Per generation | |
| `transcode.minutes` | source minutes | Per job | Proxy and variant generation |
| `meeting.minutes` | participant-minutes | Per session | `plans.ts` already declares this |
| `review.sessions` | count | Per session | |
| `project.active` | project-days | Daily snapshot | Candidate pricing dimension for agencies |
| `document.count` | count | Daily snapshot | |

**Two defects to fix before any of this accumulates:**

1. **The single-write-path rule is already violated.** `lib/usage.ts:16` states there is one write path and never a second. `lib/credits.ts:43-49` inserts into `usage_events` directly, writing `units` as *cents* while every `recordUsage()` caller writes native units. `usage_events.units` is therefore not comparable across rows, and any pricing analysis on it would be wrong.
2. **Cost is estimated, not measured.** `lib/credits.ts:22-26` divides character counts by four against a stale rate table. All three providers return actual token usage; it is discarded.

**Pricing shape — the one structural decision made now.** Seats plus usage credits, not pure per-seat. O-1 and O-2's defining trait is a large rotating freelance bench, and per-seat pricing punishes exactly that: it charges your best customers most in their busiest months. `org_credits` and `usage_events` already anticipate this shape. The numbers are deferred; the shape is not.

---

## 12. Non-functional commitments

From S0 §3 and §4, restated as they apply platform-wide. **No operation in the system may be unbounded.** Every list keyset-paginated. Every realtime channel scoped to a tenant or room, ≤2 per session. No polling where push exists. Anything over ~5s on a queue. Every AI call ceilinged and budget-checked. Ownership resolved server-side. Every API boundary schema-validated. Tenant isolation enforced in the database, not only in application code.

Growth should cost money, never a rewrite. That is the whole of the prime directive.

---

# THE V1 CAP

Everything above this line is the destination. Everything below is the boundary.

---

## 13. v1 — what ships

**Target archetypes: O-1 and O-2. Sellable to a production company or creative agency that is not McPrime.**

**The definition of done for v1 is not "launch." It is "studio two is live and paying."**

### 13.1 Foundation — non-negotiable, blocks everything

- Tenancy model resolved: T-1 … T-5 from S0-A. Without these, tenant two cannot be onboarded at all.
- `organizations.type` — the archetype axis, consulted by `spaces.ts` and `permissions.ts`
- `organizations.region` — AD-002-R
- Authorization boundary — AD-001 (layered; RLS owns tenancy) + the RLS test harness
- Default-deny fixed at `permissions.ts:183`
- Approvals decoupled from the Client space — X-2
- Crew-side project scoping, mirroring `client_member_projects`
- Metering taxonomy §11 implemented, single write path restored, provider-reported usage
- Per-tenant identity everywhere — no hardcoded "McPrime Digital" in any sender name, email or UI string
- Live-risk remediation: `CRON_SECRET`, draft-invoice failure, `project-tasks` 403, forgeable activity entries, Script Design XSS, migration ordering hazard
- Invariants enforced on the two surfaces that matter: messages and files (I-1, I-3), plus I-5, I-7, I-8, I-11, I-12

### 13.2 Client space — harden what exists

Everything in §6 marked Built, made multi-tenant-correct. Plus:
- Approval certificates (exportable PDF record of a decision)
- `draft` invoice status resolved
- Per-tenant business settings (T-3)

### 13.3 Crew space — core only

- Directory and Teams & roles, with crew-side project scoping
- Internal chat (`messages.is_internal`)
- Internal task assignment (`tasks.assigned_to`)
- Settings, per-tenant

### 13.4 Workspace — the three that exist

- **Script Design** + **FDX import/export** (AD-005 — adoption gate) + document types
- **Storyboard** — metadata board, no generation
- **PrimeOS Assistant** — with per-org keys and the §10 gate in place

### 13.5 Explicitly excluded from v1

Generation and The Stage · Sound · Edit · Remaster · Finishing · Continuity · Model Arena · Studio Kits · Library/DAM · The Graph · Review Session (sync) · async frame-accurate review · guest links · watermarking · release-on-payment · calendar and scheduling · CRM and leads · Control Tower · brand kit · variant output · SSO · multi-org membership · O-7 and O-4 archetypes.

**Correction to S1-P §4:** async frame-accurate review was marked **M** for O-1 and O-2. That was wrong. It is **M for displacing their current stack** and **S for adoption** — a studio can adopt Throughline and keep Frame.io alongside. Reclassified to S, which is what moves it out of v1 and keeps the queue and transcode layer out of the critical path to first revenue.

---

## 14. v1.5 — the first expansion

**Gate: v1 shipped, studio two live.**

- **Job queue + worker** and **transcode/proxy layer** — the two infrastructure pieces everything later needs
- **Async frame-accurate review** — timecoded comments, drawing, version stacking and comparison
- **Guest review links** + **watermarking** + **release-on-payment** — the revenue-wedge cluster
- **Brand kit** and **variant output** → unlocks **O-3a**
- **Calendar and scheduling**

At the end of v1.5 the product serves O-1, O-2 and O-3a, and the infrastructure for the entire Workspace exists.

---

## 15. v2 and beyond

**v2** — The Stage (generation, on the v1.5 queue) · Continuity · Model Arena · Studio Kits · Library/DAM · Review Session (sync) · multi-org membership → unlocks **O-5** and **O-7** · Control Tower · CRM and leads → **O-4** becomes viable once generation exists

**v3** — Sound · Edit · Remaster · Finishing · The Graph · SSO/SAML, SCIM, SOC2 → **O-3b**

Compliance work is scheduled when a real buyer asks for it, never speculatively.

---

## 16. Dependency graph — what unblocks what

```
Tenancy (T-1…T-5) ─┬─> everything. Nothing ships to a second tenant without it.
                   │
Authorization ─────┼─> realtime trust ──> de-polling ──> scale
(AD-001 + harness) │
                   └─> RLS-safe browser reads ──> Workspace surfaces

Archetype axis ────> Config B ──> O-3a
Approval decoupling ┘

Metering taxonomy ─> pricing evidence ──> SaaS pricing decision
                  └─> AI budget gate ──> The Stage is affordable to run

Job queue ─────────┬─> transcode ──┬─> proxies ──> frame-accurate review
                   │               ├─> variants ──> O-3a
                   │               └─> Review Session (sync)
                   ├─> generation ──> The Stage ──> Continuity, Arena, Kits
                   └─> Sound, Remaster, Finishing

Provider mesh ─────> The Stage, Storyboard generation, Continuity
(fal + replicate,   
 per-org keys)      

FDX ───────────────> O-4 viability
Document types ────┘
```

**The two chokepoints:** tenancy gates all revenue; the job queue gates the entire Workspace. Everything else is downstream of one or the other.

---

## 17. Open questions

1. **Job queue selection** — S0 §6 rules out anything with a fixed monthly floor. Postgres-backed (pgmq, Graphile Worker) versus a hosted queue. → S5
2. **Transcode** — self-hosted ffmpeg on a worker versus a hosted API. Cost model differs sharply at volume. → S5
3. **Error sink** — nothing is currently observable. Sentry's free tier fits the constraint. → S5
4. **Document types** — screenplay, treatment, bible, breakdown as distinct types with distinct rules, versus one generic document. Gates FDX; rework if deferred. → S3
5. **Edit scope** — an assembly surface for generated material, or a real NLE? The second is a multi-year product on its own. → v3 scoping
6. **Hours per week available** — still unanswered, and S6 cannot be ordered without it.

---

*End of S-V. Next: S1 (tenancy & entitlement model) → S2 (authorization) → S2.5 (threat model & NFRs) → S3 (domain model) → S4 (surface & IA) → S5 (infrastructure) → S6 (sequencing).*
