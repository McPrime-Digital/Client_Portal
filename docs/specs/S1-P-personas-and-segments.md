# Throughline — S1-P: Personas, Segments & Entitlement Scope

**Status:** Draft for approval. Not settled until signed off.
**Date:** 2026-08-26
**Purpose:** Establish who signs up, what they do, what they need, and which features must exist for each — before the full platform architecture (S-V) is written.
**Method:** Market-grounded where possible; assumptions flagged. Sources noted inline.

---

## 0. The core structural finding

"Persona" is two questions in this product, and the current codebase answers one and a half of them.

| Axis | Question | Determines | Current state |
|---|---|---|---|
| **Org archetype** | What kind of company signed up? | Which **spaces** exist at all | **Does not exist.** No column, no concept. |
| **Plan tier** | What are they paying for? | Which **features** within a space; quotas | `lib/billing/plans.ts` — four tiers, zero importers |
| **Person archetype** | Who is logging in? | Role, capabilities, what they can **do** | Built, and the strongest part of the codebase |

The org archetype is the missing primitive. It is what lets an enterprise marketing team turn the Client space off entirely, a production company run all three, and a solo filmmaker see only the Workspace — without three different products.

It is cheap now (one column, one matrix) and expensive later, because every navigation decision, every guard, and every onboarding path has to consult it.

---

## 1. Org archetypes — who signs up and pays

Six archetypes. The market research finding worth stating up front: in production-software buyer guides, the dominant real-world buyer is not the film studio but the **client-serving creative firm** — agencies, multimedia production companies, content studios. The stated dividing line is whether you run one production a year (a script tool suffices) or multiple productions with freelancers and clients simultaneously (you need an operating system).

### O-1 — Production company, client-serving
*McPrime Digital. Makes commercial films, ads, branded content and original work for paying company clients.*

- **Job to be done:** win work, produce it, keep the client informed, get approvals on record, get paid.
- **Revenue model:** project fees from clients.
- **Team shape:** small core crew, large rotating freelance bench per production.
- **Spaces needed:** all three.
- **Distinctive need:** the client relationship is the product. Approval provenance is contractual, not convenience — "who signed off on v3, and when" settles disputes.

### O-2 — Creative agency / content studio
*Broader deliverable set: campaigns, social, e-learning, corporate. Video is one output among several.*

- **Job to be done:** same as O-1 but higher project count, lower per-project value, more variants per project.
- **Spaces needed:** all three.
- **Distinctive need:** volume and margin visibility. Per-project profitability matters more than per-project craft. Multiple concurrent clients means cross-project views, not just per-project ones.
- **Market note:** buyer guides identify this as the largest actual segment for production-management tooling.

### O-3 — Enterprise in-house team
*Brand, marketing or comms team producing video for their own company. No external clients.*

- **Job to be done:** produce a high volume of on-brand assets faster than the agency cycle, with governance.
- **Revenue model:** internal budget. Purchase is a procurement decision, not a founder decision.
- **Spaces needed:** Workspace + Crew. **Client space hidden.**
- **Distinctive needs:**
  - **Approvals still exist — the counterparty is internal.** Legal, brand and executive review are the gates. This is the key architectural consequence: approvals must be decoupled from the Client space, or hiding that space breaks the workflow.
  - **Brand governance.** Brand kit, templates, on-brand enforcement. Industry coverage consistently names this as the top enterprise differentiator.
  - **Variant production.** Enterprise teams do not ship one master export; they ship a family — cutdowns, aspect ratios, caption versions, localised variants. Tooling that assumes one deliverable per project fails here.
  - **DAM behaviour.** Asset library with tagging and search, not just a project file vault.
  - **SSO/SAML, audit trail, data governance** — procurement blockers, not features.

### O-4 — Independent filmmaker / director
*Makes their own films. Occasional commissioned work.*

- **Job to be done:** write it, visualise it, make it, without buying six subscriptions.
- **Revenue model:** grants, financiers, self-funded. Highly price-sensitive.
- **Spaces needed:** Workspace + minimal Crew. Client space rarely (though financiers and investors are a client-shaped stakeholder — see §7).
- **Distinctive needs:** FDX interoperability is absolute; script + storyboard are the daily surfaces; AI generation for previs. Invoicing, CRM and client management are dead weight.
- **Market note:** this segment feels "subscription exhaustion" most acutely — the cost of maintaining separate accounts across generation providers is a named pain point in industry coverage.

### O-5 — Freelancer / creative director
*Sells their skill into other people's productions. May also have direct clients.*

- **Structural finding: this is not a separate archetype.** A freelancer with direct clients is the one-seat tier of O-1. A freelancer working inside someone else's production is a **member of that org**, not an org.
- **What they actually need:** to be a member of multiple orgs with one login, and to see only what each has scoped to them.
- **Consequence:** the freelancer case is not a product configuration, it is the multi-org membership feature — deferred to v2 by prior decision. Until then, freelancers hold separate accounts per studio, or exist as scoped members of one.

### O-6 — Content creator / creator-led studio
*High-volume short-form. YouTube, social, branded creator content.*

- **Job to be done:** more output, faster, cheaper. Craft matters less than throughput.
- **Spaces needed:** Workspace + Crew-lite. No Client space.
- **Distinctive needs:** generation volume, templates, fast iteration, publishing formats.
- **What they do not need:** screenplay formatting, FDX, invoicing, approval chains.
- **Honest note:** this segment is served by dozens of well-funded tools competing on generation quality alone. It is the least defensible for Throughline and the most price-sensitive.

---

## 2. The collapse — six archetypes, three configurations

The six archetypes reduce to three space configurations. This is the finding that makes the org-type axis cheap to build.

| Config | Spaces | Archetypes | Approval counterparty |
|---|---|---|---|
| **A — Client-serving** | Workspace + Client + Crew | O-1, O-2, O-5 (with clients) | External client contact |
| **B — Internal** | Workspace + Crew | O-3, O-6 | Internal stakeholder |
| **C — Solo** | Workspace + minimal Crew | O-4 | Self, or none |

Three configurations, one product. The Client space is the only space that switches off; Workspace and Crew scale down rather than disappear.

**The architectural requirement this creates:** approval, review and deliverable-versioning must belong to the *project*, not to the *Client space*. Today they are entangled — `tasks.visible_to_client`, `tasks.requires_approval` and `approval_status` all assume an external counterparty. Config B needs the same machinery pointed at an internal reviewer. That decoupling is the single highest-leverage change for making enterprise viable later.

---

## 3. Person archetypes — who logs in

Nine. The first four are org-side, the next two are external, the last three are cross-cutting.

| ID | Archetype | What they do | Must have | Must not have |
|---|---|---|---|---|
| **P-1** | **Principal / Owner** | Signs up, pays, owns the account | Billing, org settings, full access, member lifecycle | — |
| **P-2** | **Producer** | Runs projects: schedule, budget, crew, client comms | Project CRUD, task/phase management, client messaging, invoicing, crew scheduling | — |
| **P-3** | **Creative lead / Director** | Owns the creative: script, boards, cut approval | Script Design, Storyboard, review sessions, creative sign-off | Billing, client financials |
| **P-4** | **Crew / Specialist** | Editor, VFX, sound, colourist — does the work | Assigned projects only, file up/download, task board, review participation | Other projects, client financials, org settings |
| **P-5** | **External collaborator** | Freelancer brought in for one production | Time-boxed, project-scoped access; upload and comment | Everything outside their scope; history before they joined |
| **P-6** | **Client — Approver** | Signs off deliverables, pays invoices | Approvals, invoices, messaging, deliverable download | Crew space, other clients, internal chat, costs |
| **P-7** | **Client — Viewer** | Stakeholder who watches and comments | Read deliverables, comment, view progress | Approval authority, invoices, uploads |
| **P-8** | **Finance / Ops** | Invoices, budgets, spend | Invoicing, budgets, credit/usage reporting | Creative surfaces, client creative comms |
| **P-9** | **Internal stakeholder** | Enterprise legal/brand/exec reviewer | Approval authority on assigned projects; comment | Production surfaces, crew management, costs |

**P-9 is the one that does not exist today**, and it is what makes Config B work. Structurally it is P-6 without the Client space wrapper — same approval capability, different home.

**P-5 partially exists.** `client_members` + `client_member_projects` + `history_from` already implement project scoping and history cutoff for the client side. The crew side has no equivalent — `organization_members` has no project scoping. That asymmetry is a real gap for O-1 and O-2, whose freelance bench is the majority of their headcount.

---

## 4. Feature requirements by archetype

**M** = must have to adopt at all · **S** = should have, drives upgrade · **L** = later, not an adoption blocker · **—** = not wanted

| Feature | O-1 Prod co | O-2 Agency | O-3 Enterprise | O-4 Indie | O-6 Creator |
|---|---|---|---|---|---|
| Client portal | **M** | **M** | — | L | — |
| Approvals + provenance | **M** | **M** | **M** (internal) | S | L |
| Deliverable versioning | **M** | **M** | **M** | S | S |
| Project + task tracking | **M** | **M** | **M** | S | S |
| Messaging (internal + client) | **M** | **M** | **M** (internal only) | S | S |
| File vault | **M** | **M** | **M** | **M** | **M** |
| Invoicing | **M** | **M** | — | L | — |
| Crew directory + roles | **M** | **M** | **M** | L | L |
| Freelance scoped access | **M** | **M** | S | L | L |
| Script Design + FDX | S | S | L | **M** | — |
| Storyboard | S | S | S | **M** | S |
| AI assistant | S | S | S | S | S |
| AI generation (The Stage) | L | S | **M** | S | **M** |
| Review Session (sync) | S | L | L | S | L |
| Async frame-accurate review | **M** | **M** | S | S | L |
| Brand kit / governance | L | S | **M** | — | S |
| Variant / multi-format output | L | S | **M** | — | **M** |
| DAM search + tagging | L | S | **M** | L | S |
| Calendar / scheduling | S | S | S | L | L |
| CRM / leads | L | S | — | — | — |
| SSO / SAML | — | L | **M** | — | — |
| Provenance / AI usage log | S | S | **M** | S | L |
| Watermarking / content security | S | L | S | S | — |

**Reading the matrix:** O-1 and O-2 are almost entirely satisfied by what already exists. O-3's must-haves are almost entirely unbuilt. O-4 and O-6 depend on generation, which is blocked on infrastructure that does not exist.

---

## 5. What each archetype is currently blocked on

| Archetype | Blocked on | Severity |
|---|---|---|
| **O-1** | Nothing structural. Needs multi-tenancy fixes (T-1…T-5 in S0-A) and the live-risk remediation. | Weeks |
| **O-2** | Same as O-1, plus cross-project views and per-project margin visibility. | Weeks + |
| **O-3** | Org-type axis; approval decoupled from Client space; brand kit; variant model; DAM; SSO. | Quarters |
| **O-4** | FDX interop; generation (queue + transcode + per-org keys). | Quarters |
| **O-6** | Generation at volume; templates; publishing. Competing head-on with funded specialists. | Quarters, and least defensible |

---

## 6. Recommendation

**Target O-1 and O-2 for v1. Build the org-type axis now. Defer O-3, O-4 and O-6 to v2+ deliberately, with their seams marked.**

Reasoning:

1. **O-1 and O-2 are ~90% built.** The Client space and Crew space are finished, production-grade software. Every other archetype requires building something that does not exist.
2. **You are your own design partner.** McPrime is O-1. You will find the defects before customers do, on your own production work, at no cost.
3. **The market says this is the real buyer.** Production-software buyer guides consistently identify client-serving creative firms — not film studios — as the dominant purchaser.
4. **It is the only archetype where the existing portal is an asset.** For O-4 and O-6 the entire Client space is dead weight they will never open.
5. **O-3 is the same product with one space hidden** — *if* the org-type axis exists. Building that axis now converts enterprise from a rebuild into a configuration plus a feature set. Not building it means retrofitting a branch into every navigation and guard decision later.
6. **O-6 is the weakest strategic fit.** Competing on generation throughput against funded specialists, at the most price-sensitive end of the market, with no differentiating asset.

**What "build the seams" means concretely — the cheap-now items:**

- `organizations.type` column with the three configurations, consulted by `lib/studio/spaces.ts` and `lib/permissions.ts`
- Approval, review and versioning decoupled from the Client space so an internal stakeholder (P-9) can be the counterparty
- Project-scoped membership on the **crew** side, mirroring `client_member_projects` — needed by O-1/O-2 now, and by everything later
- `asset_provenance` actually written to, since AI usage logging is becoming a contractual requirement rather than a feature
- Per-org AI key storage, because the current shared-house-key model is structurally single-tenant and means you pay for every tenant's generations

Each of those is small today and structural later.

---

## 7. Open questions for approval

1. **Do you accept O-1/O-2 as the v1 target**, with O-3/O-4/O-6 explicitly deferred but seam-marked?
2. **O-6 (content creators) — in or out of the long-term vision?** It is the weakest fit and pulls the roadmap toward volume tooling and away from craft tooling. Cutting it now simplifies several later decisions.
3. **Do financiers and investors need a portal?** For O-4, an investor is a client-shaped stakeholder with approval and reporting needs. If yes, Config C gains a light Client space and the archetype count changes.
4. **Post houses and VFX boutiques** — a seventh archetype that *receives* work from studios rather than serving clients. Sync + async review is their entire job. Worth naming now or ignore?
5. **Enterprise timeline.** Is O-3 a v2 target with intent, or an opportunistic "if someone asks"? This determines whether the seam work is scheduled or merely permitted.
6. **Pricing shape.** Industry commentary flags that pure per-seat pricing punishes exactly the teams with large freelance benches — O-1 and O-2's defining trait. Seats + usage credits fits the existing `org_credits` and `usage_events` substrate better. Confirm direction before S-V assumes it.

---

*End of S1-P. On approval, this feeds S-V (full platform architecture) and S1 (tenancy and entitlement model).*
