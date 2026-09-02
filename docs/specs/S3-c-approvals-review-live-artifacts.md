# Genreline — S3-c: Approvals, Review & Live Artifacts

**Status:** Draft for approval.
**Date:** 2026-09-02
**Depends on:** `S0`, `S-F`, `S3-core`, `S3-core-A`, `S3-b`
**Supersedes:** `S3-core` §2 (the approvals tables), `S3-core` §9.2 (the expired-stage recommendation), and `S-F` §3.3 where they disagree.
**Sequenced:** after `S3-core` migrations 1–7 (live). This is migration 8 and beyond.

**The correction that drives this document.** `S3-core` §9.2 recommended that an expired approval stage *block*. That was wrong for this product. Genreline is built for AI and hybrid production, not traditional production, and in a hybrid pipeline nothing waits for a client to open an email. Approval is a **record**, not a gate.

---

## 1. The five decisions

**AP-1 — Approval never blocks work.** The engine observes the pipeline; it does not control it. A stage may order itself *inside* an approval — internal review before client sign-off — but no approval stage ever holds up work outside itself.

**AP-2 — Silence auto-advances, and is never recorded as approval.** If a stage's review window lapses with no response, the stage advances with outcome `auto_advanced` and **no actor**. It must never be written as `approved`. The moment the database records a timeout and a human decision under the same value, every certificate, every query and every dispute conflates them, and the record becomes worth less than the chat thread it replaced.

**AP-3 — Auto-advance applies to silence only.** A stage where someone requested changes is not silent — the work is not done and nothing advances. Only an unanswered stage lapses.

**AP-4 — Everything is logged, permanently. Visibility is a read filter, never a write filter.** Every comment, review, decision, reminder, lapse and version is recorded with its author and timestamp. Who may *comment* is controlled; what is *recorded* is not. Otherwise the permission becomes a way to make a review look cleaner than it was, and the Review & Approval page stops being the thing you cannot argue with.

**AP-5 — Live artifacts are minted, not linked.** When a studio makes a Suite artifact available for review, the act of making it available snapshots it. The client sees the real artifact rendered live in their browser, never a download — but pinned to the moment it was offered.

---

## 2. Auto-advance

### 2.1 The review window

Set by anyone holding the capability — multiple roles do. An organization-level default, overridable per approval by a capability-holder. This is `lib/permissions.ts`, not new machinery.

### 2.2 Outcomes

`approval_stages.status` extends to: `pending`, `active`, `complete`, `auto_advanced`, `blocked_on_changes`.

`approvals.status` extends to: `open`, `approved`, `rejected`, `changes_requested`, `auto_advanced`, `withdrawn`.

**`expired` is removed.** It described a stage that had stalled; nothing stalls now.

### 2.3 What the certificate must say

An `auto_advanced` outcome renders in plain language and never as approval:

> No response was received by the agreed review date. Work proceeded under the review window in the production agreement. **This is not a client approval.**

That sentence is what protects the studio. *"Your system approved it on our behalf"* is a bad position in a dispute. *"You had five days, we reminded you three times, and we proceeded as agreed"* is a strong one.

### 2.4 Reminders become load-bearing

If work proceeds without a response, the record must prove the response was sought. Every reminder is a ledger event with its channel, its recipient and its timestamp. `S-V` §X-6's escalation ladder is the mechanism; this is the reason it matters more here than anywhere else in the product.

### 2.5 Late objection

A client who objects after the lapse cannot undo work that has moved on. The objection is still recorded, against the stage, with its timestamp. *"We proceeded on day 4; you objected on day 6"* is a fact worth holding, and hiding it would be the same error as writing a timeout as an approval.

### 2.6 The contract connection

The review window belongs in the production agreement. When `S3-b` §3's Documents engine ships, the agreement states the window and the client signs it — at which point auto-advance is something they agreed to rather than something the software did to them. **Build the link deliberately:** an approval records which contract established its window, where one exists.

---

## 3. One record, three surfaces

An approval is **one row read three ways**, never three copies kept in sync. Copies drift, and the first time the task board and the review page disagree, neither is trusted again.

| Surface | What it shows | Interaction |
|---|---|---|
| **Message room** | An approval card in the conversation | Decide in place; the card updates |
| **Review & Approval page** | The permanent log, everything, forever | Read, filter, export |
| **Project task** | A task that requires approval | Completing it opens the approval |

All three subscribe to the same row. The realtime engine from Batches 14–15 already carries this — an approval decision broadcasts on the room's topic like any other event.

### 3.1 The card in the room

`S-F` §2.3: a message can be an approval gate. The conversation and the contractual record are the same object — request, discussion, decision, in order, in the room where everything else happens.

The card shows the subject, what is being asked, who is assigned, the review window and the remaining time. It updates in place on decision or lapse.

### 3.2 The Review & Approval page

**Its purpose is the permanent record.** Every review, comment, change, decision, reminder, lapse and version, timestamped, attributed, in order. This is the export surface and the dispute surface.

**It is exempt from retention.** Every other table gets soft-delete and a 90-day purge (`S3-core` §4). Approvals, decisions, comments and their ledger rows are carved out the way the activity log already is — **7 years, and the purge function refuses to touch them.** Without the exemption, "permanent" is a word in a spec that a cron job quietly disagrees with.

Deleted people are already handled by `AD-003`: the name pseudonymises, the decision and timestamp stay.

---

## 4. Live artifacts

### 4.1 Where they appear

**Inside the Review & Approval tab, minted by the studio, visible only when made available.** Not a top-level destination.

A client does not browse to a script. They open one because they were asked to look at it, and the artifact carries the reason automatically. The top bar is reserved for cross-tenant surfaces (`S-F` §1.2) and never renders in the portal at all.

### 4.2 Minting is the snapshot

**This is the constraint the whole feature turns on.** In a hybrid pipeline, generated assets are *regenerated* rather than edited — a shot re-rolled with a new seed and a new prompt is a different artifact wearing the same name. Approving a moving target produces a worthless record: *"you approved it"* / *"not this version."*

So "Seek approval" on a Suite artifact does three things atomically:

1. Freezes a version of the artifact.
2. Opens an approval against **that frozen version**.
3. Makes it available to the client, rendered live in their browser.

The studio keeps working. The next request mints again. `subject_kind` is already polymorphic in `S3-core` §2.2 and `document` is a listed kind, so the schema supports this without change.

### 4.3 The viewer

**One read-only renderer that takes an artifact type**, not one viewer per artifact. Script, storyboard, shot list, image, video, generated shot. `S-F` §3.3 anticipated this as later work; AP-5 moves it up.

**Read plus comment, never write — and that is a database rule, not a UI decision.** A client can comment on any anchor; they cannot alter the artifact. If the restriction lives only in the viewer component, someone eventually adds an editable field.

### 4.4 Provenance for generated work

`rights` and `asset_provenance` have existed since migration 0003 with zero reads and zero writes. `S-V` §X-3 already names licence, commercial use, talent consent and expiry.

**An approval on a generated artifact carries its provenance:** model, prompt, seed, source assets, licence. So *"the client approved this shot"* also answers *"generated how, from what, licensed under what."* That is what a studio delivering AI work will be asked to prove, and it is the difference between a record and a receipt.

This is the first real consumer of those tables.

---

## 5. Comments

### 5.1 One model, four anchors

A review comment is a message with an anchor. **Not a separate system.**

| Artifact | Anchor |
|---|---|
| Video, animatic, generated shot | Timecode, and frame per `AD-006` |
| Script, treatment, document | Block or line range |
| Storyboard, shot list | Panel or shot |
| Image, still, location plate | Region on the image |

`S3-core` already placed `timecode_ms` on `messages` for this. What it needs is the anchor kind and its value, so a comment on a script and a comment on a frame are the same row with different anchors.

**Why this matters beyond tidiness:** review comments then live in the messaging engine built across Batches 13–16. Threading, mentions, read state, notifications, search, realtime — all of it works on review comments for free. A separate review-comment system rebuilds every one of them.

Frame-accurate playback for *video* still needs the proxy pipeline and stays v1.5 (`AD-006`). Comments on scripts, storyboards, shot lists and images need none of it and ship now.

### 5.2 Who may comment

**All comments are visible to everyone in the review.** The owner or head of team controls **who may comment** — a capability check on write, nothing on read.

No visibility table, no per-comment filter, no read-side branching. One check at the point of writing.

---

## 6. Schema deltas against `S3-core` §2

Everything in `S3-core` §2 stands except:

**`approvals`**
- `status` gains `auto_advanced`, drops `expired`.
- `review_window_hours` int null — the window applied to this approval.
- `contract_id` uuid null — the agreement that established the window (`S3-b` §3), where one exists.
- `subject_version_id` uuid null — the frozen version from AP-5.

**`approval_stages`**
- `status` gains `auto_advanced` and `blocked_on_changes`, drops `expired`.
- `advanced_at` timestamptz null — when it advanced, by decision or lapse.

**`approval_decisions`** — unchanged, and still append-only for everyone including org owners. An `auto_advanced` stage writes **no decision row**, because nobody decided. The lapse is a stage-level fact and a ledger event.

**`approval_comment_permissions`** — `approval_id`, `user_id`, `can_comment` boolean. Absent row means the default for that person's role. Set by a capability-holder.

**`messages`** — `anchor_kind` text null (`timecode`|`block`|`panel`|`region`), `anchor_value` jsonb null. `timecode_ms` folds into `anchor_value` or stays alongside it; decide at build time and record which.

**Retention** — approvals, stages, decisions, comments and their ledger rows are excluded from the `S3-core` §4.2 purge. The purge function must refuse them explicitly, the way it already refuses the activity log.

---

## 7. Harness additions

Beyond `S3-core` §7's assertions 5 and 6:

1. An `auto_advanced` stage has no `approval_decisions` row. Control: a decided stage has one.
2. A user without comment permission cannot insert a review comment. Control: a permitted user can.
3. Every participant reads every comment on an approval they can see. Control: a non-participant reads none.
4. The purge function refuses approval rows. Control: it accepts an ordinary soft-deleted message.

Assertion 4 is the one that makes "permanent" true rather than intended.

---

## 8. Open

1. **Does auto-advance need per-subject windows?** A trailer and a contract amendment plausibly deserve different clocks. Org default plus per-approval override covers it today; per-subject-kind defaults are additive if asked for.
2. **Does the client see the review window before it starts?** Recommendation: yes, prominently, from the moment the card appears. An auto-advance nobody saw coming is a support ticket; one with a visible countdown is a deadline.
3. **Which Suite artifacts ship a viewer first?** Script is the obvious one — it is the furthest built and `AD-005` makes it the adoption gate. Storyboard second.

---

*End of S3-c. Next: the approvals build.*
