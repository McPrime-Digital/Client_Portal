# Genreline — S-S: Surfaces

**Status:** DRAFT — for approval. No surface in §6 is built until this is settled.
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

*End of S-S. Draft. Governs what a surface contains; `S-R` §8 governs what it may
show to whom.*
