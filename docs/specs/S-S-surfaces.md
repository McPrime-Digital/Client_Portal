# Genreline — S-S: Surfaces

**Status:** Phases A and B BUILT (2026-09-13). §5's four questions are answered
by the owner and recorded in §5. Phase C and D are not started.
**Date:** 2026-09-13
**Depends on:** `S-R` §8 (S-1…S-4) · `S-V` §1–§12 · `S-F` §7 (the v1 cap) · `S0` I-1…I-12
**Owner instruction this answers:** research the world-leading equivalent of every
surface, plan, then build. Not build-then-discover.

---

## 0. Why this document exists

`S-R` §8 specifies the RULES a surface must obey (a dashboard is a projection, a
denied surface is absent, an empty state never names what is missing, one
resolver). It does not specify what any surface CONTAINS, and it names no bar to
clear. Batch 26 built the permission layer underneath and stopped exactly there.

The audit below is the first honest count of what the studio actually has, and it
changes the shape of the work: **most of what is missing is not a surface over a
live engine. It is an engine.** A plan that treats those the same produces
eighteen convincing shells over nothing, which is the failure this project has
already recorded twice under a different name.

---

## 1. The audit — verified 2026-09-13, not quoted

**32 features declared** in `lib/studio/spaces.ts`. **14 have a real surface.**
**18 render the `Phase N · coming soon` card** from
`app/studio/[space]/[feature]/page.tsx`.

The 18 split three ways, and the split is the whole plan:

### 1.1 Engine LIVE, surface missing — 4

| Feature | What already exists behind it |
|---|---|
| `crew/tasks` | `tasks` **122 rows**; `TaskBoard.tsx` shipped inside project pages; `lib/defaultTasks.ts` |
| `crew/control-tower` | `org_credits`, `org_budgets`, `credit_ledger` **18 rows**, `usage_events` **49 rows**, `lib/credits.ts`, `lib/usage.ts`, Stripe checkout + webhook. Rail has carried a `COST` badge at a stub since Batch 12 |
| `client/documents` | documents engine live; `DocEditor` / `ScriptHome` / `DocComments` reachable only through `suite/script` |
| `suite/library` | `files` **43 rows**, `FileVault` live, R2 + signed URLs + multipart |

### 1.2 Engine PARTIAL — 2

`suite/provenance` — `asset_provenance` and `rights` exist since migration 0003,
**0 rows, no lib module, no writer**. `client/brand-kit` — `organizations.logo_url`
and `business_settings` exist; no brand engine.

### 1.3 NO ENGINE — 12

`crew/calendar`, `crew/meetings` (**zero S3-b tables applied** — verified),
`crew/crm`, `crew/leads` (house-only), `suite/workflow`, `suite/generation`,
`suite/remaster`, `suite/finishing`, `suite/arena`, `suite/studio-kits`,
`suite/continuity`, `client/guest-links`.

**A surface cannot be built over an engine that does not exist**, and calling
these "surface work" would repeat the mistake the coming-soon card at least makes
honestly.

### 1.4 The finding that sets the agenda

Projecting capabilities onto the feature list, as `S-R` S-1 requires:

| Persona | Surfaces held | Built |
|---|---|---|
| owner / admin | 32 | 14 |
| crew | 23 | 10 |
| contractor | 23 | 10 |
| finance | 5 | 3 |

**An owner's honest home is 32 tiles of which 18 say "coming soon".** The
projection is correct and the studio is a construction site. Shipping S-1 without
deciding what to do about that would make the product look emptier than it is —
the surfaces that ARE built are strong.

Second finding: **`crew` and `contractor` hold an identical surface list.** That is
correct under R-5a — project scope filters ROWS, not surfaces — but `S-R` §8's own
sketch of a collaborator ("one production, or a few… no indication that any of it
exists") is therefore only partly delivered by the capability layer. It needs a
surface decision, recorded in §5.

---

## 2. The bar — what world-leading means for each surface

Researched 2026-09-13. Only what changes a decision here is recorded.

**Linear — the reactivity bar, and it is a systems property, not a widget.**
Local-first reads, optimistic mutations applied locally and reconciled in the
background, a ⌘K palette that searches the LOCAL object pool rather than the
server. "Linear's speed isn't a property of any single layer — it's a property of
the system." A palette is reported to lift task completion ~25% for power users.

**Frame.io V4 — the review bar.** One unified player across file types; Collections
(saved, dynamic, metadata-driven views); an overhauled comment system —
timestamped, threaded, annotated, hashtag-filterable; account-free share links for
client comment; and **Content Credentials (C2PA)** read and preserved on upload,
including whether an asset was AI-generated.

**Autodesk Flow Production Tracking (ShotGrid) — the incumbent's scope.** Projects,
tasks, assets, shots, versions, notes, reviews, approvals, schedules, progress;
RV for colour-accurate playback with side-by-side version compare.

**2026 dashboard practice.** One primary metric per view, not a wall of charts.
Role-based **experience**, not merely role-based permissions. Empty state treated
as onboarding: what will appear here, and one clear action.

### 2.1 Where Genreline is already ahead, and must SHOW it

Three things this codebase has that the incumbents do not, all currently invisible:

1. **Approval is a RECORD, not a gate** (`S3-c`). Silence auto-advances and is
   never written as approval; there is a printable certificate and a 7-year
   retention carve-out. Frame.io and Flow model approval as a STATUS. This is the
   strongest differentiator in the product and it has no home on any dashboard.
2. **`asset_provenance` + `rights` tables already exist.** Content Credentials
   parity is an engine away, not a rewrite — and AI provenance is becoming table
   stakes.
3. **The capability layer** — seat class, project roles, grants AND denials,
   delegation triggers — is deeper than any of the three. It is also the reason
   S-1 can be a projection at all.

---

## 3. Principles this document adds to S-R §8

- **SS-1 — Build over engines, never ahead of them.** A surface ships only where
  §1.1 or §1.2 says something real is behind it. The other 12 stay one honest card.
- **SS-2 — The coming-soon card is a product surface and is currently a liability.**
  It says "Phase N of the Genreline build", which is a roadmap leak in a
  client-adjacent tool. It becomes: what this will do, and — where true — the
  working thing to use meanwhile.
- **SS-3 — Reactivity is optimistic-first, and it must not cost a channel.**
  I-2 is violated at ~6 subscriptions per hub session. Every surface here uses
  optimistic local mutation + `router.refresh()` and rides an EXISTING topic. A
  seventh channel is a stop-and-report (`S-R` §7's own rule).
- **SS-4 — ⌘K is one surface, not a feature per page.** A single palette over the
  resolved capability set: it can only offer what `heldSurfaces()` returns, so it
  inherits S-2 for free and cannot leak a surface the person lacks.
- **SS-5 — One primary number per surface.** Control Tower's is spend against cap.
  Tasks' is what is overdue. Review's is what is waiting on the studio.
- **SS-6 — Empty states are onboarding (S-3 unchanged).** Say what will appear and
  give one action. Never name the missing capability, never name a production.

---

## 4. The build sequence — proposed

**Phase A · the spine (no new engine).**
1. `/studio` home as a projection (S-1). *Drafted, uncommitted, pending this doc.*
2. ⌘K command palette over `heldSurfaces()` (SS-4).
3. The coming-soon card rewritten (SS-2).

**Phase B · the four live-engine surfaces (§1.1).**
4. `crew/tasks` — cross-production, scoped by RLS. *Drafted, uncommitted.*
5. `crew/control-tower` — spend, cap, burn, ledger. *Drafted, uncommitted.*
6. `suite/library` — the DAM view over `files`, with Frame.io-style saved
   Collections as metadata filters.
7. `client/documents` — the documents engine given its own door.

**Phase C · the differentiator, surfaced.**
8. The approval RECORD as a first-class surface: the chain, the certificate, the
   auto-advance evidence. This is §2.1's first item and the thing no competitor
   has.

**Phase D · engines, not surfaces — a separate decision.**
`S3-b` (calendar/meetings) is a schema that was specified and never applied.
Provenance needs a writer. The Suite's nine AI features need S5. None of these are
surface work and none should be scheduled as if they were.

---

## 5. Open questions — these need answering before Phase A ships

1. **The 18 unbuilt tiles on an owner's home.** Show all held surfaces including
   unbuilt (honest, and the home is mostly grey)? Show only BUILT surfaces and put
   the rest behind a "coming" disclosure? Or drop unbuilt features from the rail
   and the home entirely until they exist?
   *Recommendation: show built surfaces prominently, unbuilt collapsed under one
   line. It keeps the roadmap honest without making the product look empty.*
2. **Does a contractor's home differ from a staff crew member's?** The capability
   layer says no (identical caps, different rows). `S-R` §8 sketches yes.
   *Recommendation: same surfaces, different CONTENT — their home leads with their
   assigned productions. No new capability, no new layout file.*
3. **Is ⌘K in the v1 cap?** `S-F` §7 is the boundary and does not mention it.
4. **Does `suite/library` duplicate `client/files`?** Both read `files`.
   *Recommendation: one engine, two doors — Library is the org-wide DAM view,
   Files stays the per-company vault. Same rule the room model already follows.*

---

## 6. What Phases A and B actually shipped

**A · the spine.** `/studio` is a projection (S-1) — a call sheet written as a
sentence, then held surfaces grouped by space, built ones leading. ⌘K over
`heldSurfaces()`, with NO open/close animation (a 100+/day keyboard action earns
none) and combobox semantics. The coming-soon card stopped publishing the
roadmap. Motion tokens added: the shell had TEN hand-typed cubic-beziers and 202
`transition-all`, and no shared curve at all.

**B · the four live-engine surfaces.**

`crew/control-tower` — and the engine had a hole. **Every usage row that cost
money was unattributed; every row that cost nothing carried an actor.** The muse
route put the user in a JSONB blob and `chargeCredits` never forwarded it to the
column. Fixed at the writer and backfilled (0061), 18/18 recovered, 0
unresolvable.

`crew/tasks` — grouped by WHO IS BLOCKING, not by status, which is only possible
because a task carries `requires_approval` / `approval_status`. Shows the
auto-advance deadline, but ONLY where `review_requested_at` is non-null: all 24
live pending gates predate the engine and have no clock running, and a countdown
from a null start would be fiction on the number a producer acts on.

`suite/library` — org-wide DAM, every facet addressable so a filtered view is a
shareable URL (which is the mechanism behind Frame.io's Collections), plus
storage footprint per production — the number that becomes the bill.

`client/documents` — the index the engine never had. Links INTO Script Design
rather than opening a second editor over the same Yjs document, which is a
recorded remount hazard in this codebase.

### 6.1 The economics model, added because of a constraint stated late

The owner noted that **storage and seats may become billable**. The naive version
of that change — give them a rate, let them into the same total — produces wrong
numbers in the place that must not be wrong, because they are not the same kind
of cost:

| shape | meaning | today |
|---|---|---|
| **flow** | an event costs once (an AI call) | `ai.text.tokens`, `primeos` |
| **stock** | a quantity HELD costs per period (storage) | `storage.bytes`, rate 0 |
| **recurring** | a count OCCUPIED costs per period (seats) | `seat.invited`, rate 0 |

`lib/billing/meters.ts` declares this now, while every rate is zero and nothing
can break. Mixing them would break three things at once: burn (meaningless for a
standing charge), runway (must divide by flow PLUS floor), and the anomaly
detector (a monthly seat charge would read as a 30× spike every month, on
schedule). Measured: ignoring the floor overstates runway **1000 days instead of
117** — an 8.5× error.

Allocation is recorded per meter and is now CLOSED on both sides (0062).
`usage_events.project_id` is a real column with an FK — not a `ref` key, for the
same reason 0061 gave about the actor: a JSONB value cannot be indexed, grouped
or joined. Storage was backfilled from the file it already names (18 of 22 rows;
the other four are company-level files with no production, which is correct). AI
is written going forward: the muse route takes a production, **validates it on
the user client** so a caller cannot attribute spend to a job they cannot see,
and records unallocated rather than misallocated when they cannot. Nothing was
guessed — a wrong production bills the wrong client.

### 6.1.1 Allowance, added because the owner named the OTHER half

Metering answers *what was spent*. It does not answer *what may be spent*, and
the owner named the gap: **an owner, admin or org head must be able to cap a
person's AI usage — daily, weekly or monthly — including a collaborator.**

`member_budgets` and `org_seat_budgets` (0063) are the record; `lib/budgets.ts`
is the one resolver, `checkSpendAllowed(orgId, userId)`, and the muse route's
gate is now a single call to it.

Four decisions worth stating, because each had a wrong version that looks right:

1. **Keyed on GRANULARITY, not on `period_start`.** A row per person per period
   accumulates forever and needs a rollover job that will one day not run; a
   person's cap is ONE row that says "500¢ per week", and the window is computed
   at read time (`windowStart`, weeks beginning Monday). Nothing to sweep.
2. **The seat class carries the DEFAULT, the person carries the exception.**
   Resolution is: their own row → else the `org_seat_budgets` row for their seat
   class → else no limit. This is what makes "every contractor gets $20/week"
   one row instead of one per contractor, and it is why the surface leads with
   policy and calls the per-person rows exceptions.
3. **A row with a NULL `limit_cents` is an explicit "no cap"**, not a missing
   row — it is how you exempt one person from their seat's default without
   deleting the default. Absence and exemption are different states and only one
   of them is a decision.
4. **Soft and hard are stated in words**, not as a boolean the reader must
   interpret: `hard_stop` true "stops calls", false "warns only".

The org-level gate is UNCHANGED and deliberately so: `orgBlocked` remains
`orgHardStop && orgBalanceCents <= 0`. An intermediate version of this file
dropped the first conjunct while claiming it "keeps its existing meaning
exactly" — which would have blocked every org carrying a zero balance by design,
the house org first. A regression assertion holds it: *zero balance + NO org
hard stop → still allowed*.

Enforcement, not display, is why `lib/budgets.ts` is on the I-8 allowlist: it
must read the spend of somebody who is not the caller. The SURFACE is on the
user client and the policy is the boundary — harness 42–43.

**When storage and seats acquire a rate, this needs one decision, not a
rewrite:** whether a cap bounds flow only or the standing charge too. `isFlow()`
already exists to express either answer, and today the gate counts flow.

### 6.3 What Phase C shipped — and the premise that was wrong

**§2.1 said the record "has no home on any dashboard". That was half wrong**,
and the audit is what found it. `ApprovalRecord`, `ApprovalCertificate` and
`ApprovalCard` all existed and rendered. What was actually missing was different:

1. **The chain had no URL.** Opening it was `useState`. It could not be linked
   from a notification, cited in an email, or handed to a colleague. The only
   addressable artifact was `/certificate` — the FORMAL export — with nothing
   between "a row you can expand" and "a document you print".
2. **The page's headline came from the projection, not the engine.** Three tiles
   over `tasks.approval_status`, with the record below them.
3. **A LIVE SCOPING GAP.** `app/studio/client/review/page.tsx` read `tasks`
   through the service role, which bypasses RLS and therefore bypasses the
   project scoping 0057–0059 built. Nothing leaked — both live crew are
   `scope_mode='all'` — but the gap was armed and fires on the first scoped
   seat, which is the whole thing Batch 26 exists to enable.

Built: `/studio/client/review/[id]` (the record at a URL),
`lib/approvalTimeline.ts` (the chain, extracted so the accordion and the page
cannot tell different stories), `lib/approvalIntel.ts`, `listApprovalChains()`
(a page of chains in four queries, not four per approval), the attention band,
and the scoping fix — which SHRANK the I-8 allowlist rather than growing it.

#### The advancement: the record is graded before it is needed

Every competitor shows an approval's STATE. None shows **how well your own audit
trail would hold up if the approval were disputed today**, while there is still
time to fix it. `approvalIntel()` grades each record `strong` / `thin` /
`broken` and says why in one sentence.

The grading is not decoration — each grade names a way the certificate's
load-bearing sentence fails:

| grade | what it means |
|---|---|
| **broken** | the record would assert silence it cannot support |
| **thin** | proceeding is arguable, but the trail is thinner than it should be |
| **strong** | an agreed date, a named recipient, reminders that landed |

Four cases reach `broken`, and none is hypothetical: a stage nobody can act on
(R-11's lockout), a stage addressed to **nobody at all**, a lapse with no
reminder ever delivered, and a lapse where every reminder BOUNCED. A reminder
that failed to deliver is evidence against the studio, not for it, and it was
previously legible only as a parenthetical inside one timeline row.

One case is quieter and was found by the probe rather than by design: **an open
stage with no review date can never lapse**, because `advanceOnSilence` is only
ever reached through a deadline. It waits forever. An earlier draft graded that
`strong` — "nothing is waiting on a review window" — while a client sat on it.
Waiting indefinitely is a failure state that looks like calm.

#### OWED — a ruling on auto-advance with zero recipients

`approval_assignees.client_id` is `on delete cascade` (0038:199), so **deleting a
client company deletes the assignee rows pointing at it**. The sweep's
`anyAssigneeCanDecide()` deliberately returns `any: true` for a stage with zero
recipients (approval-sweep:172), citing `S3-core` §2.4 — "a departed member
neither blocks nor receives". That reasoning is sound for ONE departed assignee
among several. Where it empties the stage, the window still lapses and the
certificate still prints *No response was received by the agreed review date*
about a review nobody could receive.

A live harness fixture is already in exactly this state: `auto_advanced`, zero
assignees. Phase C **surfaces it and does not change it** — auto-advance
semantics are `S3-core` §2.4's to settle, and that is the owner's call, not a
side effect of building a surface. The options are (a) refuse to lapse a stage
with no reachable recipient and mark it blocked, (b) lapse it but have the
certificate state the recipient count, or (c) leave it and rely on the grading.

### 6.4 What Phase D shipped — provenance, and what it is NOT

Phase D was scoped as "engines, not surfaces". Three candidates; only one was
buildable, and the audit is what settled it:

| candidate | state | verdict |
|---|---|---|
| `asset_provenance` + `rights` | tables exist, **zero code references**, 0 rows | BUILT (0064) |
| `S3-b` calendar / meetings / contracts | migration 1 done (0056, 0063); **2, 3, 5, 6 never applied**; migration 4 deferred by the spec itself | a batch of its own — ~10 tables with RLS plus surfaces |
| the Suite's nine AI features | need `S5`, **which does not exist** | a spec to write, not an engine to build |

#### The finding that shaped it

Provenance as specified is FILE-centric, and **every AI call this product makes
produces text** — 15 `primeos` and 3 `ai.text.tokens` meters, not one image. A
file-only writer would have written zero rows: the same dormant-engine outcome
Phase D existed to end, rebuilt one layer up. `document_id` is a real column
with a real FK for the reason 0061 and 0062 both gave about JSONB.

#### What was taken from the world, and what was not

**C2PA** (Coalition for Content Provenance and Authenticity, spec 2.4 — Adobe-led
CAI) is the standard the industry converged on, with the **Creator Assertions
Working Group's `cawg.training-mining`** assertion layered on it. The mapping to
what already existed was near-exact: `parent_asset_id` IS C2PA's ingredient
chain, `signature` IS the claim signature, `params` IS the action parameters.

**The SDKs (`c2pa-rs`, `c2pa-js`, dual MIT/Apache-2.0) were audited and NOT
adopted.** They embed a signed manifest into a BINARY asset; our AI output is
text in a `documents` row, so there is nothing to sign. Taking the dependency
would buy a Rust/WASM toolchain against a forecast. What was adopted is the DATA
MODEL, so that emitting a real manifest when a generation pipeline exists is a
serialization step and not a migration.

#### The two decisions worth restating

1. **The APPLY is the event, not the generation.** A model's answer the writer
   reads and discards is a draft nobody kept. The same answer inserted into the
   screenplay is a fact about the screenplay, and the only one a studio can be
   asked to declare. This makes the table small, true, and about the document
   rather than about the chat.
2. **Proportion, not presence.** "Contains AI content" is equally true of a
   script where a model fixed one line and one where a model wrote every scene.
   Guild and broadcaster terms turn on how much, so `disclosure()` returns a
   SHARE. The share is an upper bound that errs toward over-disclosure —
   generated text later rewritten still counts as having entered, because erring
   the other way would let a studio edit its way out of a declaration.

The default on `rights` is `notAllowed` for all three CAWG purposes. CAWG treats
an absent assertion as "no statement made"; a database is not a manifest, and
the failure mode of a permissive default is a studio's unreleased dailies
becoming training data because nobody filled in a form.

#### Phase D remainder — now built (0065–0068)

`S3-b` migrations 2, 3, 5 and 6 landed as 0065–0068: the calendar, bookings,
meetings and the signing record. Migration 4 (`calendar_connections`) is the
only one outstanding and is **deferred by S3-b §7 answer 1**, not skipped —
external calendar sync needs a token-storage decision the spec itself says must
not be improvised. See `S3-b` §5 for the landed table and §5.1 for the defect in
§1.5 that building it exposed.

**These are ENGINES: tables, constraints and policies with no surfaces yet.**
That is the correct state — S-S SS-1 says build over engines, never ahead of
them, and the reverse now holds: the engines are ahead, and the surfaces
(a calendar, a booking page, a signing flow) are the next batch's work.

Still open from Phase D proper: `rights` has a schema and no writer. A surface
for it — per-file licence, talent consent, the CAWG training triple — is the
smallest next step, and the file viewer is where it belongs.

### 6.5 Phase E — the first surface over the S3-b engines

`S3-b`'s six migrations landed as engines with no surfaces. This is the first of
them: **Crew · Calendar**.

#### The engine had no writer, and that came first

0065 created `calendar_entries` and **nothing wrote to it**. A calendar over an
empty table is the same dormant-engine outcome 0064 had just spent a migration
closing, one table over — so 0074 built the writers before the surface existed.

`S3-b` §1.2 says a derived entry is "written by the same server action that sets
the deadline". Taken literally that is four call sites in `lib/approvals.ts`
alone, plus every one written later, and **the first one somebody forgets is a
deadline that silently never reaches the calendar** — indistinguishable from
having no deadline. It is a trigger instead, which is exactly the argument 0041
made for the task projection and is quoted in `lib/approvals.ts` to this day.

The hard half of a projection is not the insert. A stage that advances, an
approval that is withdrawn, an invoice that is paid — each must REMOVE its entry
or the calendar fills with obligations that no longer exist and becomes the
thing nobody trusts. Proven with controls: completing a stage removes the entry,
re-activating restores it, two re-saves still leave one row, clearing the
deadline removes it, and a paid invoice drops off.

#### A projection is read-only, and the control is in the database

Dragging an approval deadline on a calendar would be overwritten the next time
its stage is saved — so the edit would silently vanish, which is worse than not
offering it. `calendar_entry_projection_guard` refuses a hand edit or delete,
the route returns a sentence saying where to change it instead of a 500, and the
surface renders no control at all on a derived entry. Harness 52 holds it.

#### What the surface does, and what it deliberately does not

One grid. §1.1's premise is that a meeting, a review date and an invoice due
date are the same kind of thing to a person looking at a week, so what an entry
IS shows as a colour rather than as a separate calendar.

- **SS-5** — one primary statement, and it is about the NEXT SEVEN DAYS rather
  than the month on screen. Someone paging back to March does not want to be
  told what was due in March.
- **SS-3** — no realtime channel. I-2 is already violated at ~6 subscriptions
  per session and a calendar is not a live-collaboration surface; it re-renders
  on navigation and after a write. Deliberate, not unfinished.
- **SS-6** — the empty state says what will appear on its own and what the
  reader adds themselves.
- Six-week grid always, so the page does not change height when paging through
  a year; Monday-first; day keys computed LOCALLY, because `toISOString()` puts
  a 23:30 entry on tomorrow.

#### Still engines without surfaces

Bookings (0066), meetings (0067) and contracts/signing (0068) have schema,
constraints, policies and harness assertions — and no pages. Bookings depend on
the calendar that now exists, so that is the natural next one; signing is the
largest of the three and the strongest differentiator after the approval record.

### 6.6 Phase F — scheduling and signing, and what they are FOR

The owner asked the right question before paying for these: *what role do a
calendar, bookings and contracts play in a film OS?* Recorded here because the
answer shapes the build, and because one third of it is a genuine caveat.

**Contracts are the strongest and the most film-specific.** A production signs
constantly: appearance and talent releases for every person on camera, location
agreements, crew deal memos, NDAs before a script goes out, music and stock
licences, client SOWs and change orders. The reason to hold them here rather
than in a separate e-signature product is not tidiness — it is that the
agreement sits next to the production, the files and the approval record, and it
**closes a loop the provenance engine left open**: `rights.talent_consent`
(0064) is a boolean that nothing could substantiate, and a signed appearance
release is the evidence behind it.

**The calendar is the operational spine.** Production is a scheduling business
and the failure mode is a date slipping silently — a review window lapsing, an
invoice ageing. §6.5 built it.

**Bookings is the weakest in isolation, and that is worth saying.** A Cal.com
clone is not a film feature. What makes it one is what sits underneath: casting
and audition slots, client review sessions, grade-suite and ADR time, a
director's availability against a shoot date. The part that earns its place is
the EXCLUSION CONSTRAINT — two people cannot have the same colourist at 3pm, and
an application-side check loses that race.

#### What shipped

`crew/scheduling` — availability by weekday, booking types, and booking a slot.
Every offered time has already survived availability, buffers, minimum notice
and existing bookings, because offering a slot that then bounces off the
constraint is worse than offering none. Nine probe assertions with controls
cover the arithmetic, including DST (09:00 London is 08:00Z in BST and 09:00Z
after the clocks change — a one-pass offset gets one of those wrong) and reading
a weekday in the RULE's timezone rather than the server's.

`client/contracts` + `dashboard/contracts` — draft, staff the signers, send,
sign, decline, void, and the certificate of completion. The three things that
carry enforceability are mechanical: consent recorded BEFORE the signature with
its exact wording stored on the event; `content_hash` taken at send and never
recomputed; and the signer resolved from `auth.uid()` rather than the request
body, so a client owner holding every capability still cannot sign for a
colleague (assertion 53).

#### Named, not silently skipped

- **PDF field placement** — drag-and-drop signature boxes on an uploaded
  document. `contract_fields` has the schema; v1 signs a text body.
- **The single-use signing link for a non-member.** `S3-b` §7 answer 2 puts v1
  on real accounts, and that link is a service-role surface on a legal
  document — the standing rule is no new service-role importers.
- **Meetings (0067)** still has no surface, and needs a LiveKit integration
  rather than a page to be worth one.
- **Client-facing booking pages.** Booking is studio-side today; `booking_types`
  already carries `client_id` for the day a client picks their own slot.

### 6.7 Phase G — bookings out, meetings in, and the research that changed the code

#### Bookings is removed (0076), and §6.6 already said why

The owner's call, and it agrees with the assessment recorded here when it
shipped: a slot picker is a SaaS reflex, not a film feature. All three tables
held zero rows. **The reframe settles it** — this is an AI/HYBRID FILM OS, and
the features that earn their place are the ones answering *what is real and who
agreed to it*. Scheduling was never that.

#### Meetings, and why it is not a Zoom link

`review_session` (AD-006) is the reason to build rather than paste a link. In a
hybrid production the meeting that matters is three people arguing about ONE
SHOT, half of which came out of a model. A screenshare gives the others no
control and anchors nothing they say.

**What was taken from the state of the art, and what was built on top.**
Syncplay (GPL — studied, not copied, and no code is shared with it) settled the
core insight years ago: a play command that arrives 180ms late lands 180ms
behind, because the sender kept playing while it was in flight. The first draft
of `MeetingRoom` had exactly that bug. Three things go beyond it:

1. **A clock-offset handshake.** Compensation needs the sender's clock and two
   browsers do not share one, so an NTP-style ping/pong over the data channel
   estimates the offset per peer. Syncplay gets this from its central server;
   there is no server here, so the peers work it out between themselves.
2. **Rate nudging instead of seeking.** The frame-sync literature is consistent
   that adding or removing a few frames a second is imperceptible while a seek is
   not — so drift under 250ms is corrected by running at 0.97×–1.03× until it is
   gone. A review session that hitches every few seconds is worse than one that
   is quietly 80ms apart.
3. **No infrastructure.** It rides a WebRTC data channel already open and already
   authenticated by the same LiveKit token, which is also what keeps it inside
   I-2's channel cap — a Supabase Realtime subscription would have been a seventh.

`S3-b` §2.3's rule is kept literally: the join token is minted only after the
meeting has been read on the USER client. There is no second permission model
for media, which is the trap a "meeting link" design falls into.

#### Signing, and a licence audit that changed the plan

**Documenso and DocuSeal are both AGPL-3.0.** A network-served derivative would
oblige this product to publish its source, so not a line of either is here. What
was taken is the BAR — and it is the right thing to take from a licence you
cannot use: they produce a **cryptographically signed PDF** (PKCS#12, PAdES),
not merely an audit table. An audit table is a claim; a signed document is
evidence. The crypto stack adopted is `@signpdf/*` + `pdf-lib`, both **MIT**.

**Built on top:** the certificate of completion is rendered INTO the PDF before
it is sealed, so the signature covers the evidence as well as the agreement.
Documenso and DocuSeal keep the trail on their own side — fine until the day you
need it and the vendor is gone. Here the artifact proves itself to anybody
holding the file.

**Single-use signing links (0078)** are built rather than deferred, because the
reframe makes them the common case: the most frequent signature in a hybrid
production comes from somebody who will never hold an account — a background
actor signing an AI-likeness release. `/sign/<token>` is the only route in the
application with no session; every failure returns one answer so a probe cannot
enumerate, and the request has exactly one degree of freedom.

#### 0079 — the join no single-purpose product can make

`rights.talent_consent` was a boolean somebody typed. It is now a CONSEQUENCE of
a signature: a release names its instrument, its asset and the AI-training
permission in CAWG's own vocabulary, and completing it writes the asset's rights
row.

DocuSign cannot do this — a talent release is an opaque PDF to it, with no
concept of an asset or a likeness. Frame.io cannot do it — it will not tell you
whether the face in shot 47 agreed to be modelled. It works only because both
halves are one system, which is the argument for a film OS rather than five
tools.

Proven with controls, including the one that matters: a **location** release
does NOT assert a person's likeness.

#### Still not built, named rather than implied

- **Drag-and-drop PDF field placement.** `contract_fields` has the schema; v1
  signs a text body rendered to PDF.
- **Meeting recording.** v1.5, and a storage-curve decision before a schema one
  (`S3-b` §7 answer 3).

### 6.8 Phase H — the rest of the named-and-skipped, and the market bar

The owner's note: *"they don't seem too advanced at all for a future AI hybrid
production OS."* Fair. §6.7 shipped the shapes; this is the substance.

#### Where the market actually is (researched, not assumed)

| Tool | Has | Lacks |
|---|---|---|
| Frame.io | frame-accurate drawn annotation, timecoded comments | **no live conferencing at all** |
| SyncSketch | synced sessions, drawing, shot review | weaker on edit review |
| Evercast | live conferencing + frame-to-frame annotation + colour-accurate 4K | annotations are a property of the SESSION and die with it |
| Documenso / DocuSeal | PKCS#12 signed PDFs, audit trail, field placement | **AGPL-3.0** — unusable in a commercial SaaS; audit trail stays on their side |

**The gap is the join.** Every one of these makes you choose between a durable
mark and a live conversation, or between a signature and the rights it grants.

#### What was built on top

**Annotations that outlive the session** (`review_annotations`, 0080). Drawn
live over the shared playhead, stored in NORMALISED coordinates at an
`anchor_ms` — the same unit as `messages.anchor_value->>'ms'` (0038) and
`meeting_sync_state.position_ms` (0077). Drawing PAUSES the shared playhead,
which parks the whole room on the frame being argued about. Frame.io cannot do
this because there is nobody in the room; Evercast cannot because the mark is
session state.

**Playback sync beyond Syncplay.** Its latency compensation is the right idea and
the first draft here lacked it entirely. Added on top: a clock-offset handshake
over the data channel (two browsers do not share a clock; Syncplay gets this
from a central server it has and this does not), and rate nudging instead of
seeking — drift under 250ms closes at 0.97×–1.03×, because the frame-sync
literature is consistent that a few frames a second is imperceptible while a
seek is not.

**Recording through Egress, straight to R2.** The bytes never pass through the
application — AD-004-R's argument applied to a two-hour dailies session. The
schema stores an Egress id and a STATUS because Egress is asynchronous, so the
surface says "processing" rather than inferring readiness from whether an object
has appeared.

**Blur and Krisp noise suppression as LOCAL track processors**, so the raw camera
frame never leaves the machine and the recording gets the cleaned signal free.
Both dynamically imported: they ship megabytes of WASM and most people never turn
them on.

**PDF field placement**, the DocuSign gesture that was missing. The source is a
PDF ALREADY IN THE VAULT rather than a new upload path — uploads already have
presigning, multipart, scope resolution and metering, and a contract-only
uploader would be a fourth copy of all of it. Positions are fractions with a
top-left origin so a field lands identically on a phone, a reference monitor and
a 595pt page; PDF's bottom-left origin is converted in exactly one place.
Fields freeze on send, because moving one afterwards changes the document
without changing its hash.

**A signature field is a typed name and there is no drawing canvas**, on purpose.
What carries enforceability is intent, consent and association with the record —
none of which is a picture. A squiggle would imply the drawing is the legally
operative part, which is the misconception the whole design avoids.

#### Still not built

- **Colour-accurate streaming.** Evercast sells on it and it is a real gap for
  grading sessions. It is a media-pipeline problem (10-bit, HDR, calibrated
  transforms), not a schema one.
- **Annotations surfaced outside the room.** The rows exist and carry their
  anchor; a reviewer's timeline that lists them next to the approval record is
  the obvious next surface.

### 6.9 Phase I — the room reaches the client

The owner: conferencing must be available in the Client space, in the client
portal, AND internally. It was internal-only.

#### One room, three doors

| Surface | Who | Absent |
|---|---|---|
| `crew/meetings` | the studio's internal floor | — |
| `client/meetings` | the studio, addressed to a company | — |
| `dashboard/meetings` | the client's own portal | create, end, cancel, record, file picker |

**`client_id` is the boundary.** Null is the internal floor; set means a client
company is party to it. Batch 24 settled this exact split for ROOMS after the
crew hub filtered on `kind` and put a conversation with a client's person on the
studio's internal floor — the same rule one table over, and a client walking
into an internal CALL is a worse version of that bug. Assertion 55 holds it, and
because the media token follows the row (`S3-b` §2.3), that one assertion is also
the access control on the video.

`MeetingScreen` is ONE component rendered by both studio spaces — Batch 15
deleted ~800 lines of duplicated message machinery, and a room is more intricate
than a message list. `MeetingRoom` takes an `endpoint`, so the studio and portal
routes differ only in what they REFUSE.

#### No invite step, deliberately

A meeting opened against a company is joinable by its team the moment it exists,
because `meetings_client_read` already admits them. An invite table would be a
second mechanism to keep in step with the first, and the first is RLS.

#### A client can DRAW (0081)

0080 gave clients SELECT on annotations and nothing more, which makes a review
session half a feature: the client watches the studio draw and then describes
what they mean in words. **The reason to run a review session rather than a
screenshare is that the person giving the note can point at the thing** — that is
Frame.io's entire value, and withholding it leaves a video call with extra steps.

INSERT plus a narrow UPDATE (`created_by = auth.uid()`), no DELETE: a client may
add a mark and retract their own, and cannot touch the studio's or a colleague's.
Removal is the soft delete, so a retracted note leaves a row — a review whose
notes can vanish without trace is one somebody can rewrite afterwards.

#### The meter follows the cost, not the side

A client's participant-minutes are recorded against the STUDIO's organization and
its production. LiveKit bills every participant-minute regardless of which side
of the relationship the person is on, so recording them anywhere else would
understate the cost of exactly the sessions that cost most.

### 6.2 Owner answers to §5

1. Unbuilt stays "coming soon" — built surfaces lead, held-but-unbuilt sit behind
   one line per space rather than hidden (hiding a held surface tells somebody
   they lack a capability they have).
2. Contractor and staff hold the SAME surfaces; scope filters rows, not surfaces
   (R-5a). Recorded rather than changed.
3. ⌘K built.
4. One engine, two doors: Library is org-wide, Files stays per-company.

---

*End of S-S. Phases A–I built, plus allowance (§6.1.1). Governs what a surface contains; `S-R` §8
governs what it may show to whom.*
