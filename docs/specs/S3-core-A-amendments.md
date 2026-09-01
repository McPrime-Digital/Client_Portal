# Genreline — S3-core-A: Amendments to S3-core

**Status:** Settled. Supersedes the named sections of `S3-core`.
**Date:** 2026-09-01
**Cause:** the Batch 10 item 0 audit. `S3-core` §1 was written against the schema as described in `S1` and `HANDOFF`, not against the `messages` table as it actually stands. Six columns and constraints already exist that the spec treats as new or does not mention.
**Rule:** `S3-core` is not edited. Its text stands as the record. This document governs where they disagree.

**Two of these would have caused data loss.** They are marked.

---

## A-1 — `edited_at` already exists

`S3-core` §1.3 lists `edited_at` as new. It exists in the 0000 baseline and is written today by `app/api/portal/messages/edit/route.ts:41-46`.

**Amendment:** remove from the migration. No change of behaviour.

---

## A-2 — Soft delete already exists as a boolean ⚠️ *data loss*

`messages.is_deleted` (boolean) exists, with two live rows. The delete route at `portal/messages/delete/route.ts:41-44` sets it, **blanks the body, and nulls the attachment reference.**

Two problems:

1. A boolean cannot express *when*. `S0` §4's 90-day grace period and `S3-core` §4.2's purge both need a timestamp. There is nothing for the purge to key on.
2. Blanking the body destroys the message at delete time. A 90-day grace period whose restore returns an empty message is not a grace period.

**Amendment:**
- Add `deleted_at timestamptz null` as specified. Backfill the two live rows from `created_at` — their bodies are already gone and cannot be recovered; record that in the migration comment.
- **Stop blanking the body and nulling the attachment on delete.** Deletion sets `deleted_at`. Invisibility is RLS's job, per `S3-core` §4.1. The purge is what actually destroys content.
- `is_deleted` is dropped in `S3-core` migration 12, alongside `read_at`. Until then both are written, so old code keeps working.

**On the privacy question this raises:** blanking-on-delete was doing real work — it meant a deleted message was genuinely gone. Keeping the body until purge means it is recoverable by a database operator for 90 days. That is the correct trade for a product whose ledger is contractual, and it matches how the activity log already behaves, but it is a trade and it is recorded as one.

---

## A-3 — `reply_to_id` already exists

An FK with `ON DELETE SET NULL` and seven live rows, used for quote-reply. `S3-core` §1.3 introduces `thread_root_id` without mentioning it.

**These are different things and both stay.** `reply_to_id` points at the specific message being answered. `thread_root_id` points at the root of a thread. Slack has the same distinction.

**Amendment:** add `thread_root_id` as specified, keep `reply_to_id` unchanged, and **backfill `thread_root_id` by walking each existing `reply_to_id` chain to its root.** Seven rows. The walk must be bounded — if a cycle exists in the data, report it rather than looping.

---

## A-4 — `project_id` is ON DELETE CASCADE ⚠️ *data loss*

`0000:277`. Correct while `project_id` was the room key. **Catastrophic once it is a tag:** deleting a project would delete every message tagged with it, including a client company's conversation, while the room survives.

`AD-003` says deleting a thing never deletes the work around it. This is the same principle one level up.

**Amendment:** in `S3-core` migration 4, drop and recreate the FK as `ON DELETE SET NULL`. A deleted project leaves its messages in the room, untagged. **This must land in the same migration that makes `project_id` nullable** — not before, because a nullable tag with a cascade is the dangerous state, and not after, because the window between them is when a deletion could happen.

---

## A-5 — `history_from` already has a database anchor

`member_history_from()` exists (`0020:279`) and is enforced at `0021:216-222`.

**Amendment:** `S3-core` §1.6's client predicate calls the existing function rather than restating the comparison. Restating it would create a second definition of the cutoff, which is how the two definitions eventually disagree.

---

## A-6 — `sender_role` is CHECK-constrained to `admin | client`

`0000:259`. Crew rooms have neither.

**Amendment, two parts:**

1. **Widen the CHECK** to `admin | client | crew | collaborator` in migration 2. Minimal, additive, unblocks crew rooms.
2. **Mark `sender_role` for retirement.** It is a denormalised copy of a roster fact, which is the same class of defect as `user_metadata` display names and the advisory `app_metadata.roles` — it is stale the moment someone's role changes. It exists today only because the unread watermark is computed as `sender_role = <the other side>`. Once `message_read_state` lands (`S3-core` §1.4), that use disappears, and the displayed role comes from the roster per `S-F` §2.3. Retire it in migration 12 with `read_at` and `is_deleted`.

---

## A-7 — Two findings that are not amendments but change the work

**The unread model is per-thread and per-role, not per-user.** Every count in the codebase is `read_at IS NULL AND sender_role = <other side>`. One teammate opening a thread marks it read for their whole company. This is exactly the defect `S3-core` §1.4 exists to fix, and the audit confirms all twelve read sites construct it identically — so the replacement is mechanical rather than twelve separate judgements.

**Five of six message insert sites do not stamp `organization_id`.** Only `admin/deadline-check/route.ts:66-74` does; the rest lean on the column DEFAULT. That is T-5 and it is a live defect independent of this work — the Batch 8 finding where a client row and its membership row disagreed about the tenant came from exactly this shape. All six are fixed when the send path is rewritten to write `room_id`.

---

## A-8 — Realtime: a warning for the policy replacement

Filtered `postgres_changes` subscriptions authenticate as the user and are filtered by RLS. **If the replacement policy is stricter than the subscriber's filter, the subscription stops delivering with no error** — the client simply stops receiving messages.

Two subscriptions filter on `project_id=eq.X` (`ProjectDetail.tsx:225-262`, `AdminProjectDetail.tsx:246-271`). After the room model lands, those filters still match, but the rows must remain SELECT-visible under the new predicate.

**Requirement:** after the policy replacement, verify live that both subscriptions still deliver. A harness assertion cannot catch this — it tests queries, not replication. It is a click-test, and it belongs in the batch report.

The audit also notes the company-room model *reduces* channel count: today there is one broadcast channel per thread, so a portal user with seven companies holds ten or more. Rooms are fewer than projects. That is an I-2 improvement arriving as a side effect, not a fix — the budget work stays in S5.

---

## A-9 — Verified starting state

From the live read, for the record:

- 190 messages, not the ~200 estimated.
- Zero null `project_id`, zero orphaned projects or clients, zero org mismatches.
- Seven distinct companies with messages → seven client rooms, zero messages destined for a crew room.
- Eleven attachments, all `r2::` or `client-uploads::` prefixed, **all eleven resolve to a `files` row by path.** `S3-core` migration 7's backfill is an exact-match join over eleven rows.

The backfill is a clean seven-room, 190-row repoint. That does not change the stop-and-report in the batch — it means the report should be short.

---

*End of S3-core-A. `S3-core` governs except where this document names a section.*
