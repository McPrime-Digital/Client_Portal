# Genreline — S-F: Feature Scope & Market Position

**Status:** Draft for approval. Governs feature scope once signed off.
**Date:** 2026-09-01
**Depends on:** `S0`, `S0-A`, `S0-B`, `S1-P`, `S-V`, `S1`, `S2`
**Supersedes:** `S-V` §13 (the v1 cap) in full. `S-V` §1–§12 stand as the destination. The Workspace is renamed the **Suite** throughout.
**Feeds:** `S3-core` and `S3-b` (schema), then feature batches in the order in §9.

---

## 0. Why this document exists

`S-V` described the destination and drew a hard v1 line. Since it was written, three things changed:

1. The founder's direction moved calendar, meetings and documents into v1, and set the build order as Client space and Portal together, then Crew, then Suite.
2. Each of those features had a name but not a spec. Nobody had listed what the best product on the market does, so nobody could say what Genreline adds.
3. `S3-core` was about to be written against four schema shapes. Meetings and documents each need their own, and messaging's shape changed when the room moved from the project to the client company.

This document does three jobs: names the market baseline for every v1 feature, states the Genreline gap above that baseline, and lists what the schema must provide so the feature is built once. It then redraws the cap.

**Method.** Market claims come from vendor documentation and 2026 reviews, checked this week. Where a claim is an assumption it is flagged. Where a feature is deferred, the reason is stated so it is a decision rather than an omission.

---

## 1. Structural changes

### 1.1 The Suite

The Workspace is renamed the **Suite**. Same space, same definition from `S-V` §5: where the film is made. The rename is cosmetic and lands with the next product-identity batch.

### 1.2 The top bar

Four surfaces the founder named do not belong to any space: **Marketplace** (digital likeness and voice licensing), **Theater** (filmmakers showing work), **Community**, and **Connect** (following other filmmakers). They live in the top bar beside search. Icons may exist now. None is a v1 build.

**Why they need naming even so.** Every table in the foundation assumes a row belongs to exactly one tenant and is invisible to all others. Theater, Community and Connect are cross-tenant public surfaces by definition. That is a new class of table with public-read policies, and a mistake there is the one kind of RLS error you cannot take back. They are not designed in this document. They are flagged so they are designed, not retrofitted. Marketplace already has a seam: `rights` and `asset_provenance` from migration 0003, and `S-V` §X-3's licence, consent and expiry fields.

### 1.3 Collaborators are a seat class

`S1-P` §1 said freelancers are not an archetype, just members of someone's org. That stands. What the founder's direction adds is sharper: **crew** (the org's own people) and **collaborators** (brought in for a skill, for a production) are counted, scoped and limited separately. Soft caps: 100 crew, 100 collaborators, raisable per tenant like every other cap in `S0` §4.

This is not new schema for identity. `organization_members` plus `organization_member_projects` plus `scope_mode` already carry it. It is a **seat class** on the roster row, a pricing dimension, and a default. Pricing shape is already seats plus usage credits, so it fits without a new mechanism.

**And it resolves an open question.** `HANDOFF` §11.2 asks whether a new crew member defaults to all projects or none. The answer splits by class: **crew default `all`, collaborators default `scoped`.** The client side stays permissive because a client company's teammates are that company's people. The inconsistency `S1` §10.3 worried about was the symptom of a missing distinction, not a real tension.

### 1.4 Per-member credit allocation

The owner allocates usage limits to each crew member and collaborator, who can see their own limit and usage. `org_budgets` is per-organization today; this needs a per-member budget row and a check in the same gate `S-V` §10 describes. It pairs with I-5's per-call ceiling, still unbuilt. Both belong in the metering schema of `S3-b`.

### 1.5 Build order

**Client space and Client Portal together**, because they share the messaging engine, the approval engine, meetings and documents, and building one side without the other means building the shared engine twice. **Then Crew. Then Suite.** Each space is finished to market standard before the next starts.

---

## 2. The messaging engine

This is the deepest section because messaging is where the founder's direction changed the foundation's shape, and because every other feature in v1 either lives in it or notifies through it.

### 2.1 Market baseline

Slack in 2026 is the reference. Channels and threads organise conversation by topic or team, huddles are drop-in audio and video calls without scheduling, and Slack Connect extends channels to external partners and clients. AI on paid tiers summarises threads and channels, generates huddle notes, translates in real time, and answers questions across permissioned messages, files and canvases with citations. Recent releases added a Today view pulling calendar and tasks together, an Activity feed for mentions and DMs, Focus Mode to mute notifications, and admin controls to exclude specific channels from AI processing. The two universal complaints in 2026 reviews are notification overload and old messages getting buried, which makes Slack a poor long-term record.

Frame.io is the reference for the media half: timestamped comments, drawing on the frame, threaded replies, version comparison, status tags, and share links that let a client comment without an account.

### 2.2 The Genreline model

**The room is the client company. The project is a tag on the message.**

A studio has one relationship with a client company, not one per project. Today `messages.project_id` is the room key, so a client with four projects has four disconnected threads and goes back to email. The room moves to the company. `project_id` becomes a nullable tag, and the UI colours a tagged message by its project.

**The conflict this creates, and its resolution.** Client-side RLS predicates project visibility on `messages.project_id`, and harness assertion 4 exists because a teammate scoped to one project once read a sibling project's board. If the room is the company, a member scoped to Project A is in a room that carries Project B traffic. **Resolution:** RLS shows untagged messages plus messages tagged to projects that member can see. A scoped member gets a filtered view of the one room, not a separate room. Threads inherit the tag of their root message.

The same engine serves two room kinds. **Client rooms** (Config A: one per client company, both rosters present) and **crew rooms** (internal, `organization_members` only). Internal and client threads are the same engine with different membership, exactly as `S-V` §X-5 said.

### 2.3 Feature list

**Core, Slack-grade:**
- First-class threads. A thread is a child room anchored to a root message, not a reply chain.
- Per-user read watermarks. `read_at` on the message is already wrong for a two-seat client company. One row per user per room, advanced on read.
- Keyset pagination, 50 per page, infinite scroll upward. I-1.
- Push delivery, no polling. I-3. One subscription per open room, within the I-2 budget.
- Full-text search across every room the caller can see, Postgres FTS with a GIN index. Results respect RLS by construction because they are RLS-filtered rows.
- @mentions of people, and Genreline-specific mentions of a **project**, a **file**, a **task** and an **approval**, each rendering as a card.
- Reactions, edit with history, soft delete. Deletion respects the retention policy in `S3-core`.
- Pins per room. Saved messages per user.
- Attachments through the single file pipeline (`AD-004-R`), 5 GB, file card above 100 MB. A message attachment is a `files` row with `origin = message`. Existing voice notes stay.
- Typing indicators and per-tenant presence (Batch 7 item 2).
- Per-user notification preferences per room: all, mentions only, muted. A focus mode. This is the direct answer to Slack's most-cited complaint.
- Draft persistence per room.

**Identity in the room:**
- Every participant shows a name from the roster (never `user_metadata`), a role, and which team they are on: the studio or the client company. This is what the founder asked for and it is only possible because both rosters are the sole authority now.
- Client company owners can add teammates from the message hub. Org admins can add crew, invite a collaborator into a specific client room, and pause or block a participant. All of these are roster operations surfaced in place, not new permission logic.

**Genreline-specific, nobody else has these:**
- **A message can be an approval gate.** Requesting approval posts a card into the room; the decision is recorded by the approval engine (§3.3) and the card updates. The conversation and the contractual record are the same object.
- **A comment can be pinned to a timecode** on a file version. When frame-accurate review lands in v1.5, those comments and chat are one model.
- **Native external party.** The client portal *is* the other side of the room. There is no Slack Connect configuration because the two-roster model already is that.
- **Audio and video call buttons** in every room header, both sides, opening a meeting (§3.4) with the room's participants pre-invited.
- **Meeting-intent detection.** When a message reads like "can we get on a call Thursday," the engine offers to book it. This is a **capability call** through the provider mesh (`S-V` §10), never a hardcoded model. Gemini's free tier is a fine first route; the product does not know which model answered.
- **Every message is a ledger event.** The activity ledger records sends, edits, deletes and approval decisions, so a dispute about "who said what when" is answered from the record, not from screenshots.

**Deferred, with reason:**
- AI thread summaries and translation: capabilities through the mesh, cheap to add once the mesh gate exists. v1.5.
- Canvases and collaborative notes: the Suite's document editor already exists; linking a document into a room is the Genreline shape of a canvas. v1.5.
- Cross-room search answers with citations: needs the mesh and a retrieval layer. v2.

### 2.4 What the schema must provide

Rooms with a kind (client, crew) and a subject (`client_id` or null). Messages with a nullable `project_id` tag, a nullable `thread_root_id`, a nullable `attachment_file_id` FK, soft-delete and edit history. Read watermarks per user per room. Pins, saved items, reactions, mentions as a join table so mentions are queryable. A `tsvector` column with a GIN index. Room-level notification preferences per user. RLS on messages as in §2.2. All of this is `S3-core` §1.

---

## 3. Client space and Client Portal

Two surfaces, one engine each. The studio-side **Client Management** (`/studio/client/*`) and the client company's own **Client Portal** (`(portal)`) are the two ends of the same features. What follows is specified once and rendered twice.

### 3.1 Messaging hub

§2, rendered on both sides. The hub is the main Messages page: one row per client room, project-coloured, with unread counts from the watermark table. Inside a project, a filtered view of the company room showing only that project's tagged messages plus untagged ones. That satisfies the founder's request for project-tagged messages in the main hub without duplicating storage.

### 3.2 Teams and invites

**Baseline.** Slack and Frame.io both handle invites with a role picker, an invitation state, and resend or revoke. Frame.io V4 adds per-share permissions. Wrapbook's onboarding sends an invite by email or QR code on set and tracks compliance-document status in real time.

**Genreline.** Both sides get one invite surface with the same structure:
- Role picker bound to the roster's actual role vocabulary (crew: owner, admin, producer, finance, editor, member; client: owner, approver, member, viewer), rendered as a single selectable control, not scattered toggles.
- Seat class on the crew side (crew or collaborator), with the scoping default from §1.3 applied and visible.
- Project scoping as an explicit choice, never inferred. `scope_mode` shown as a stated value.
- History cutoff (`history_from`) as an explicit choice for client teammates.
- Lifecycle: invited, active, paused, revoked, each with what it means stated in plain language. Removal removes the membership and never the login (Batch 6.2).
- Invite status visible: sent, opened, accepted, expired. Resend and revoke in place.

**Fix to carry in:** `invite-client:41`'s duplicate-email check is not org-scoped and discloses other tenants' clients. `S1` §3 T-2 required closing exactly this. It rides in the first Client batch.

### 3.3 Tasks, review and approval

**Baseline.** Ziflow is the reference for workflow: multi-stage routes with an owner, permissions and a deadline per stage; sequential and parallel stages; automatic reminders; conditional rules that stop a proof reaching the client while internal comments are open; side-by-side and overlay compare; checklists for mandatory content; and an audit trail that exists because approval cannot happen any other way. Frame.io is the reference for the media surface: frame-accurate comments, drawing, version compare, status tags, and account-free share links. Both report that email approvals are the compliance hole, because they leave no record against a version.

**Genreline.**
- **The approval engine is decoupled from the Client space.** `S-V` §X-2, and `HANDOFF` calls it the highest-leverage change remaining. An approval is a subject (a file version, a task, a milestone), a requested approver from any roster, a stage, a deadline, a decision, a timestamp, an actor identity resolved from the roster, and an immutable ledger row. The counterparty can be a client (Config A) or an internal stakeholder (Config B) with no change to the engine.
- **Tasks wire into approvals.** A task with `requires_approval` opens an approval on completion. The task board and the review page read the same engine, so status is one fact, not two.
- **Time-bound feedback.** Each stage carries a deadline. Reminders escalate through `X-6`. A stage that expires is recorded as expired, not silently open. This is the founder's "time bonded to feedbacks."
- **Everything is logged.** Every comment, version upload, stage transition, reminder, decision and expiry is a ledger event. The founder's requirement that reviews and approvals be audited is satisfied by construction, the way Ziflow describes its own design.
- **Approval certificates.** An exportable record of a decision: subject, version, approver, decision, timestamp, and the chain of stages. `S-V` §13.2 already listed this. It is the artifact a studio hands a client when a dispute arises.
- **Minimal Suite view for linked processes, later.** When a Suite process (a cut, a board, a script revision) requests approval, the client sees a minimal read-only view of that process inside the approval, which becomes unavailable once decided. This waits for the Suite features to exist. The approval engine carries a nullable `subject_kind` and `subject_id` from day one so no rework is needed.
- **Frame-accurate review** stays v1.5. It needs a proxy render, which needs the job queue and transcode layer (`S-V` §14). The comment model is designed now so that when proxies exist, comments simply gain a timecode.

### 3.4 Meetings

A new page on both sides holding three things that are one product elsewhere: a **calendar**, a **scheduler**, and **audio/video conferencing**, plus the place where a review asset can later be watched live in sync.

**Baseline, scheduling.** Cal.com is the reference and is open source under AGPL. Event types (one-on-one, round-robin, collective, recurring), availability windows, buffers, minimum notice, daily limits, booking questions, calendar sync across Google, Outlook, Apple and CalDAV with busy-time merging, automatic confirmations and reminders, video links created on booking, and routing forms. Its free tier already includes native video (Cal Video), which is the bar for "included."

**Baseline, conferencing.** LiveKit is open source (Apache 2.0) with a permanently free Build tier of 5,000 WebRTC minutes a month and identical APIs whether self-hosted or cloud. Daily and 100ms offer 10,000 free minutes but no self-host path. Self-hosting removes per-minute fees entirely. `S0` §6's no-fixed-floor rule makes LiveKit's shape the right one: free to start, self-hostable when volume justifies it, which is exactly what `AD-006` already decided.

**Baseline, synchronised review.** cineSync locks every participant to the same frame, with annotation, and never moves media through its servers, only sync commands. ClearView Flex streams under 100 ms latency with colour accuracy but needs dedicated hardware costing over a thousand dollars a year. Neither is priced for an indie studio, which is the gap `AD-006` named.

**Genreline.**
- **Calendar** per person and per room, showing bookings, approval deadlines (§3.3), invoice due dates, and shoot days once the Crew schedule exists. A Today view of the kind Slack shipped this year, built from data Genreline already holds.
- **Scheduler** with booking pages per crew member and per client room, availability rules, buffers, and calendar sync. Booking creates a meeting, a calendar entry on both sides, and a room notification. Routing (round-robin) is v1.5.
- **Meeting** on LiveKit: audio, video, screen share, participants from the room. Recording and transcript through the job queue when it exists; until then, live only. Every meeting produces a ledger event and, optionally, a summary posted to the room as a capability call.
- **Review Session** (`AD-006`): synced frame-accurate playback with comments captured to project timecode. **v1.5**, gated on the job queue and proxy layer like frame-accurate async review. The Meetings page is built so the session is an added mode, not a new page.
- **Meeting-intent detection** from chat (§2.3) lands bookings here.

**What is honestly not in v1:** the synced review itself, recordings and transcripts. What is: scheduling, calendar, and plain calls, which is the majority of what a studio and a client do together.

### 3.5 Documents

Contracts, PDFs, and anything that needs a signature. The founder's decision is to build signing rather than embed a vendor, so that a client signs without leaving Genreline.

**Baseline.** PandaDoc is the reference for the whole lifecycle: templates and reusable snippets, document generation from structured data, drag-and-drop fields (signature, initials, date, text), multiple signers with signing order, reminders and expiry, and a certificate of completion recording signer identity, verified email, IP address, timestamps for sent, viewed and completed, with a tamper-evident seal. Compliance with ESIGN and UETA in the US comes from the process (intent to sign, consent to do business electronically, association of the signature with the record, and a retained record), not from the vendor's name. Optional signer verification by passcode or SMS is the standard extra layer.

**Genreline.**
- **Templates** with merge fields pulling from data Genreline already has: client company, contacts, project, deliverables, invoice lines, dates. A production agreement, an NDA, a deal memo, a change order, a release. This is where "auto-generate" comes from, and it is stronger than any generic tool because the data is native.
- **Document builder** on the existing BlockNote editor with a signature-field block. Fields placed by the studio; a document is a `documents` row of a new type, versioned like every other document.
- **Signing flow.** Signer receives a notification, authenticates as a portal member (already a verified identity), views, signs. Consent language shown and accepted before signing. Optional SMS passcode through Twilio. Signature is a typed or drawn image plus a cryptographic hash of the document at signing time.
- **Certificate of completion**, generated as a PDF: every signer, verified email, IP, user agent, timestamps for sent, viewed, signed; the document hash; and the ledger events. The signed PDF and the certificate are `files` rows, so they are metered, vaulted and retained like everything else.
- **Tamper evidence.** The final PDF's hash is recorded in the ledger. Any later change is detectable.
- **Reminders, expiry, decline, void**, each a ledger event and an `X-6` notification.
- **Multi-signer with order**, and a studio-side countersign.

**Legal note, stated plainly.** ESIGN and UETA make properly-formed electronic signatures enforceable in the US; eIDAS governs the EU and has stricter tiers. The requirements are process requirements and Genreline can meet them. But whether a specific contract is enforceable depends on the contract, the jurisdiction and the parties, and this document is written by an architect, not a lawyer. **Before the first real contract is signed on Genreline, the signing flow and consent language get a legal review.** That is a task on the critical path to revenue, alongside the legal entity from `S0-B` §7.

### 3.6 Invoices and File Vault

Both built. Invoices harden with per-tenant everything and the `draft` status already fixed; release-on-payment is v1.5. The File Vault gains **version stacking** from `S3-core` (a file is a version of a parent, not a new row), which the approval engine, review and variants all depend on.

---

## 4. Crew space: recommendations

The founder asked what belongs here to make it world-class. This section is the answer, grounded in what production companies actually run on.

### 4.1 Market baseline

StudioBinder in 2026 is the default for indie and commercial production: import a script (Final Draft, PDF, Fountain), break it down into tagged elements, build a stripboard shooting schedule by dragging or auto-scheduling, generate day-out-of-days reports, and generate call sheets from the schedule with delivery tracking that answers "did the gaffer see it," down to timestamped confirmations. Yamdu is the funded-production equivalent used by broadcasters and studios, adding time cards and crew and cast management. Movie Magic is the industry-standard stripboard with a proprietary format nobody else imports. Wrapbook owns the money side: digital startwork packets (NDAs, deal memos, I-9s, W-4s) with in-platform e-signature, QR-code onboarding on set, crew profiles that follow a person from job to job, timecards that catch math and overtime, purchase orders, expenses, and payroll with union compliance.

The 2026 reviews agree on one thing: a film is four projects that hand off, development to pre-production to shoot to post, and productions die at the handoffs.

### 4.2 What Genreline's Crew space should contain

**Already scoped in `S-V` §7, stands:** Directory, Teams and roles (with seat class from §1.3), Internal chat (§2, crew rooms), internal Tasks, Settings, Control Tower, CRM later.

**Recommended additions, in priority order:**

1. **Call sheets, generated and tracked.** The single most valuable thing an indie production tool does, and the one crews feel daily. Generated from the schedule, distributed through `X-6`, with per-recipient delivery and confirmation status. This is the feature that makes a producer switch. v1 stretch; depends on a schedule existing.

2. **The breakdown-to-schedule chain.** Script Design (Suite) already holds the script. Script breakdown extracts scenes, cast, locations and elements. A stripboard schedule with day-out-of-days follows. This is the bridge between the Suite and the Crew space, and it is what no competitor has because none of them own the script editor. v1.5. Gated on document types (§8, decision 1), because a breakdown needs a screenplay type, not a generic document.

3. **Startwork through the Documents engine (§3.5).** Deal memos, NDAs, releases as templates, signed on the platform, tracked per crew member. Wrapbook's onboarding without Wrapbook's payroll. Falls out of §3.5 almost for free.

4. **Directory fields that make it a production database.** Skills, day rates, availability, union affiliation, equipment, hire history across productions. `S-V` §7 already names these as the gap.

5. **Calendar and scheduling** from the Meetings engine (§3.4): shoot days, availability, conflicts.

6. **Control Tower with per-member allocation.** Spend, margin per project, credit burn, and the per-member budgets from §1.4 with each person seeing their own.

7. **Timecards**, digital, with overtime math. v2. Payroll itself is **out of scope permanently**: it is a regulated, union-rule-bound, insurance-adjacent business that Wrapbook has spent seven years on. Genreline exports to it; it does not replace it.

8. **Location library.** Scout, curate, share photos per project. Cheap once the file pipeline is stable. v2.

### 4.3 What not to build

Payroll, insurance, tax filing, union reporting. Every one is a company on its own. The Crew space wins by owning the chain from script to call sheet, which nobody owns end to end, and by leaving the money-movement chain to specialists it integrates with.

---

## 5. The Suite: recommendations

`S-V` §5 already defines the destination in detail and it stands. Additions and adjustments only.

**Baseline.** Final Draft owns the screenplay format and FDX is what professionals exchange (`AD-005`). StudioBinder and Storyflow import FDX and pretend to nothing more. Frame.io owns async review. Higgsfield is the generation reference the founder named, with the explicit note that it is too busy and Genreline's version should be sparer.

**Adjustments:**
- **Script Design ships with FDX and document types**, gated on decision 1 in §8. Breakdown (§4.2 item 2) is the Suite's first bridge into Crew.
- **Storyboard** stays metadata-only in v1. Shot lists join it, because shot lists feed the schedule.
- **The Stage** stays v2 on the job queue, and its interface brief is now explicit: one surface, few controls, the mesh choosing models, cost visible per result.
- **Studios, the 3D previs of a set** the founder described, is a different technology class (a real-time 3D engine in the browser) and is a v3-or-later research item. It has no dependency on anything before it and blocks nothing, so it is parked rather than sequenced.
- **Director and producer style agents**, assisting or in auto mode: a capability composed over the mesh plus a retrieval layer over a director's public body of work. Two notes for when it is scoped: it depends on The Graph or an equivalent orchestration layer, and the question of whether a living director's style can be sold as a feature is a rights question the `rights` table and the Marketplace legal work will have to answer first. v3.
- **Sound effects and audio library.** `S-V` §5 already lists Sound. A library of licensed effects is a licensing deal before it is a feature. v3.

---

## 6. Cross-cutting requirements the features inherit

Every feature above depends on these, all of which are already decisions:

- **No operation unbounded.** Keyset pagination on every list. Push not poll. `S0` §3.
- **The activity ledger is load-bearing.** Approvals, signatures, meetings and messages all write to it. It must be authorized, validated and org-stamped, which Batch 6 item 1 delivered. The open question in `HANDOFF` §11.6, whether a browser-callable ledger endpoint should exist, becomes more urgent: with this much depending on it, **server-side emission as a side effect of the real action** is the correct shape, and `S3-core` should specify it.
- **Per-tenant identity everywhere.** `S0-B`. The sender envelope for email and SMS is still single-tenant and blocked on provider configuration; that is an `S5` item and it must land before a second tenant sends a client anything.
- **Metering at the point of consumption.** Meeting minutes, signatures, storage, AI calls, all recorded through the single write path.

---

## 7. The redrawn v1 cap

**Supersedes `S-V` §13. The definition of done is unchanged: studio two is live and paying.**

### 7.1 In v1

**Foundation** — complete as of Batch 8.

**Messaging engine** (§2) — new schema, both room kinds.

**Client space and Client Portal** — messaging hub, teams and invites, tasks wired to a decoupled approval engine with stages, deadlines and certificates, meetings (calendar, scheduler, plain audio/video calls), documents (templates, generation, on-platform signing with certificate of completion), invoices, file vault with version stacking.

**Crew space** — directory, teams and roles with seat class, internal chat, internal tasks, calendar, settings, per-member allocation visible to each member. Call sheets as a stretch goal if a schedule exists.

**Suite** — Script Design with FDX and document types, Storyboard metadata with shot lists, PrimeOS Assistant with per-org keys.

### 7.2 Moved into v1 from later

Calendar and scheduling (was v1.5). Meetings as plain calls (was v2 under Review Session). Documents and signing (was unscoped). Collaborator seat class and per-member allocation (new).

### 7.3 Still excluded from v1, with the gate

| Feature | Gate |
|---|---|
| Review Session (synced frame-accurate) | Job queue + proxy render, `S5` |
| Async frame-accurate review | Same |
| Recording and transcripts | Job queue |
| Round-robin scheduling | v1.5, additive |
| AI summaries, translation, meeting notes | Mesh gate, v1.5 |
| Script breakdown and stripboard | Document types, v1.5 |
| Guest links, watermarking, release-on-payment | v1.5 |
| Brand kit, variant output, DAM | v1.5, unlocks O-3a |
| The Stage, Continuity, Arena, Kits | Job queue, v2 |
| Timecards, location library | v2 |
| Marketplace, Theater, Community, Connect | New table class, undesigned, v2+ |
| Studios (3D previs), style agents | v3+ |
| Payroll | Never |

### 7.4 What this costs

Nothing came out. The cap grew by three engines, and v1 is roughly half again the size it was. That is stated so it is a decision and not a surprise. It is the right decision if meetings and documents are what studio two buys; the founder's judgement is that they are. Sequencing absorbs it by building the shared engines once and rendering them twice.

---

## 8. Open decisions

1. **Document types.** Screenplay, treatment, bible, breakdown as distinct types, or one generic document. Gates FDX (`AD-005`), gates breakdown (§4.2), and therefore gates the Suite-to-Crew bridge. **Recommendation: distinct types, decided now.** Every downstream feature in this document that touches a script wants a screenplay type, and `S0-A` §4.7 says FDX gets redone if types come later.

2. **Legal review of the signing flow** before the first real contract. Sits on the critical path with the legal entity. Not a code task.

3. **LiveKit cloud versus self-host timing.** Cloud Build tier is free to 5,000 minutes a month. When a tenant's meetings exceed that, self-hosting removes per-minute fees. The switch point is a number to watch in metering, not a decision to make now.

4. **Whether the ledger endpoint stays browser-callable** (`HANDOFF` §11.6). Recommendation: no. `S3-core` specifies server-side emission.

---

## 9. Sequencing into S3

`S3` was going to be four schema shapes. It is now eight, and it splits.

**`S3-core`** — the four original shapes, revised: **messaging** (§2.4, company rooms and project tags), **approvals** (§3.3, decoupled engine with stages), **file version stacking and the attachment FK** (§3.6, `AD-004-R`), **retention** (`deleted_at`, purge, the `AD-003` tombstone). Plus ledger emission moved server-side.

**`S3-b`** — the four new shapes: **calendar and bookings** (§3.4), **meetings and sessions** (§3.4, with the Review Session mode pre-shaped), **documents and signatures** (§3.5), **seat class and per-member budgets** (§1.3, §1.4).

**Build order after schema:** messaging hub → teams and invites → tasks and approvals → meetings → documents. Each on both sides before the next. Then Crew. Then Suite.

`S3-core` is written next, against §2.4, §3.3 and §3.6 of this document. It cannot start until decision 1 in §8 is answered, because the `documents` table it touches needs to know whether a type column exists.

---

*End of S-F. Next: `S3-core`.*
