# Genreline — S3-core: Schema for Messaging, Approvals, Versioning & Retention

**Status:** Draft for approval.
**Date:** 2026-09-01
**Depends on:** `S0`, `S0-A`, `S0-B`, `S1`, `S2`, `S-F`
**Supersedes:** nothing. Extends `S1` §5 (tenancy predicates) and `S2` §4 (policy classes) with new tables.
**Scope:** four schema shapes plus one behavioural change. Everything here is the work that must be right *before* a feature is built, because getting it wrong forces a rebuild.

**What this document is not.** It is not a feature spec — `S-F` is. It does not describe screens. It describes tables, predicates, constraints and the order they land in.

---

## 0. The test every shape here passes

`S-F` §0 states it: **if I build the feature properly today, will later work force me to rebuild it?**

- Messaging: read state on the message is already wrong for a two-seat client company. Every notification and unread feature built on it inherits the error.
- Approvals: welded to the Client space. An internal team's approval has no home, and Config B is `S1` §4's whole point.
- File versioning: a new cut is a separate row today. Review, compare and variants all need a stack.
- Retention: no table can express deleted. The 90-day grace and 7-year log in `S0` §4 are statements nothing can enforce.

The fifth item, ledger emission, is not schema but is here because approvals and signatures depend on the ledger being trustworthy, and `S-F` §8 decision 4 settled it.

---

## 1. Messaging

### 1.1 The model change

**Today:** `messages.project_id` is the room. A client company with four projects has four disconnected conversations.

**S3-core:** the room is the client company. `project_id` becomes a nullable tag on the message. `S-F` §2.2 has the reasoning.

**The tenancy consequence, and its resolution.** Harness assertion 4 exists because a client teammate scoped to one project could read a sibling project's board. Moving the room to the company puts a scoped member in a room carrying other projects' traffic. RLS resolves it: a member sees **untagged messages plus messages tagged to projects they can see.** One room, filtered per member. This is stricter than today's model, not looser, because it also filters the untagged case correctly.

### 1.2 `message_rooms`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `organization_id` | uuid not null | FK organizations. T-5: stamped from session, never a DEFAULT |
| `kind` | text not null | `client` \| `crew`. CHECK constrained |
| `client_id` | uuid null | FK clients. Required when `kind='client'`, must be null when `kind='crew'` — enforced by CHECK |
| `name` | text null | Crew rooms are named; client rooms take the company name |
| `created_by` | uuid null | FK auth.users ON DELETE SET NULL (AD-003) |
| `created_at` | timestamptz not null default now() | |
| `deleted_at` | timestamptz null | §4 |

**Constraint:** unique on `(organization_id, client_id)` where `kind='client'` and `deleted_at is null`. One room per company, enforced in the database rather than in code.

**Backfill.** Existing messages carry `project_id`. For each distinct client company with messages, create one room and repoint. Messages whose project belongs to a company become tagged with that project. Messages with no resolvable company stay in a crew room for that org. **The backfill is the risky part of this migration** — it must be written to be idempotent and re-runnable, and verified with counts before and after.

### 1.3 `messages` (revised)

Existing table, altered rather than replaced.

| Column | Change |
|---|---|
| `room_id` | **new**, uuid not null FK message_rooms |
| `project_id` | **stays**, becomes nullable — now a tag, not the room key |
| `thread_root_id` | **new**, uuid null, self-FK. Null means a root message |
| `body_tsv` | **new**, tsvector generated from body, GIN indexed |
| `edited_at` | **new**, timestamptz null |
| `deleted_at` | **new**, timestamptz null |
| `read_at` | **removed** — replaced by §1.4. Drop only after the watermark backfill is verified |

**Thread rule:** a thread is one level deep. A reply's `thread_root_id` points at a root; a reply to a reply points at the same root. Enforced by a CHECK that the parent's `thread_root_id` is null. Slack-shaped, and it stops unbounded nesting, which `S0` §3 forbids anyway.

**Tag inheritance:** a reply inherits its root's `project_id`. Enforced by trigger, not by application code, because RLS depends on it.

### 1.4 `message_read_state`

| Column | Type |
|---|---|
| `room_id` | uuid, FK message_rooms |
| `user_id` | uuid, FK auth.users ON DELETE CASCADE |
| `last_read_message_id` | uuid null, FK messages |
| `last_read_at` | timestamptz not null |

Primary key `(room_id, user_id)`. Unread count is a keyset count of messages after the watermark that the caller can see — so it respects project scoping without a second code path.

**This replaces `messages.read_at`,** which could only ever record that *someone* read it.

### 1.5 Supporting tables

**`message_reactions`** — `(message_id, user_id, emoji)`, pk all three.

**`message_mentions`** — `id`, `message_id`, `kind` (`user`|`project`|`file`|`task`|`approval`), `target_id`. A join table rather than parsed from body, so "everything mentioning this project" is a query. Written server-side at send time from the parsed body; never accepted from the client (I-6).

**`message_pins`** — `room_id`, `message_id`, `pinned_by`, `pinned_at`.

**`message_saves`** — `user_id`, `message_id`, `saved_at`. Per-user, private.

**`message_room_prefs`** — `room_id`, `user_id`, `level` (`all`|`mentions`|`muted`), pk `(room_id, user_id)`. Absent row means `all`. This is the answer to the notification-overload complaint in `S-F` §2.1.

**`message_attachments`** — `message_id`, `file_id` FK files, `seq`. **Replaces the `"bucket::path"` string.** This is `AD-004-R` item 2 and it closes `HANDOFF` §8.1's body-trusted attachment refs: with a real FK the server validates the file belongs to the caller's tenant, and a forged reference fails at the constraint rather than in a check someone forgot.

### 1.6 RLS

`message_rooms`, Class B (`S2` §4):
- Crew: `is_org_member(organization_id)`.
- Client: `kind='client' AND is_client_member(client_id)`.

`messages`, Class B with the scoping predicate:
- Crew: `is_org_member(organization_id)` and, if the member is project-scoped, `project_id is null OR project_id IN (their projects)`.
- Client: `is_client_member(client_id via room)` AND `(project_id IS NULL OR project_id IN (their projects))` AND `created_at >= history_from`.

`history_from` is already enforced in Postgres (Batch 5). It carries over unchanged.

`message_read_state`, `message_saves`, `message_room_prefs` are per-user: `user_id = auth.uid()`, read and write. Class C shape.

`message_reactions`, `message_mentions`, `message_pins`, `message_attachments` inherit visibility from their message — the policy is an EXISTS against `messages`, which means it inherits the scoping predicate for free rather than restating it.

### 1.7 Indexes

- `messages (room_id, created_at desc, id desc)` — the keyset pagination index. I-1 depends on it.
- `messages (thread_root_id, created_at)` where not null.
- `messages (project_id)` where not null.
- GIN on `body_tsv`.
- `message_read_state (user_id)`.

---

## 2. Approvals

### 2.1 The decoupling

Today approval is welded to client visibility — the code asks whether something is visible to the client. `S-V` §X-2 and `S-F` §3.3 require an engine where the counterparty is a parameter.

**An approval is:** a subject, one or more stages, assignees per stage, a deadline per stage, and an immutable decision record.

### 2.2 `approvals`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `organization_id` | uuid not null | T-5 |
| `subject_kind` | text not null | `file_version` \| `task` \| `milestone` \| `document` \| `message`. CHECK constrained, extensible by migration |
| `subject_id` | uuid not null | Polymorphic. Not an FK — validated in the engine |
| `project_id` | uuid null | FK projects |
| `client_id` | uuid null | FK clients. **Null means an internal approval.** This one nullable column is the decoupling |
| `title` | text not null | |
| `status` | text not null | `open` \| `approved` \| `rejected` \| `changes_requested` \| `expired` \| `withdrawn` |
| `created_by` | uuid null | ON DELETE SET NULL |
| `created_at`, `deleted_at` | timestamptz | |

**On polymorphism.** `subject_kind` plus `subject_id` cannot be a foreign key, which means a dangling subject is possible. The alternative — one nullable FK column per subject type — is worse: every new subject type is a migration on a hot table. The engine validates the subject exists and is in the caller's tenant before insert, and the retention purge (§4) nulls approvals whose subject is gone. Stated here so it is a decision with a known cost rather than an oversight.

### 2.3 `approval_stages`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `approval_id` | uuid not null | |
| `seq` | int not null | Order. Unique per approval |
| `name` | text not null | e.g. "Internal review", "Client sign-off" |
| `mode` | text not null | `sequential` \| `parallel` |
| `deadline_at` | timestamptz null | |
| `status` | text not null | `pending` \| `active` \| `complete` \| `expired` |

Ziflow's model, per `S-F` §3.3: stages carry their own owner, permissions and deadline, and a stage that expires is recorded as expired rather than left silently open.

### 2.4 `approval_assignees`

`stage_id`, `user_id` (nullable), `client_id` (nullable), `role` (nullable), `required` boolean.

An assignee is a specific person, or a role on a roster (any approver at the client company). Role assignment matters because a named person leaving should not deadlock an approval.

### 2.5 `approval_decisions`

| Column | Type |
|---|---|
| `id` | uuid pk |
| `stage_id` | uuid not null |
| `actor_id` | uuid null (ON DELETE SET NULL) |
| `actor_name` | text not null — **resolved from the roster at decision time**, never `user_metadata` |
| `decision` | text: `approved` \| `rejected` \| `changes_requested` |
| `comment` | text null |
| `decided_at` | timestamptz not null |

**Append-only.** No UPDATE policy, no DELETE policy, for anyone. A changed mind is a new decision, not an edited one. This table is what `S0` §1 means by contractual provenance, and it is the source for the approval certificate in `S-F` §3.3.

`actor_name` is denormalised deliberately: the name at the moment of decision is the record, and AD-003's tombstone (§4.3) pseudonymises it rather than deleting it.

### 2.6 RLS

`approvals`, Class B:
- Crew: `is_org_member(organization_id)`, plus project scoping where `project_id` is set.
- Client: `client_id IS NOT NULL AND is_client_member(client_id)`, plus project scoping.

Internal approvals (`client_id IS NULL`) are invisible to every client member by construction — no branch, just the predicate.

Stages, assignees and decisions inherit via EXISTS against `approvals`.

**Decisions:** INSERT permitted only to a user who is an assignee of an `active` stage. Enforced in the policy, not only in the engine, so a direct write cannot forge a decision.

---

## 3. File version stacking

### 3.1 Shape

`files` gains three columns:

| Column | Type | Notes |
|---|---|---|
| `parent_file_id` | uuid null, self-FK | Null means this row is the head of a stack |
| `version_no` | int not null default 1 | |
| `is_current` | boolean not null default true | |

A version is a `files` row pointing at the stack head. The head is the first version. **Partial unique index:** one `is_current = true` per stack.

Everything downstream — review, compare, variants, approval subjects — addresses a version by id and asks the stack for its current. `S-F` §3.6.

### 3.2 Why not a separate versions table

A separate table would mean two places a byte can live, two metering paths, and two RLS shapes. `AD-004-R` says one file pipeline. A version is a file.

### 3.3 Metering

Every version is a metered upload. Storage grows per version, which is correct and must be visible in `S-F` §1.4's per-member allocation. Retention (§4) is what stops a stack growing forever.

---

## 4. Retention

### 4.1 Soft delete

`deleted_at timestamptz null` on: `messages`, `message_rooms`, `files`, `documents`, `tasks`, `approvals`, `clients`, `projects`, `invoices`.

Every SELECT policy gains `deleted_at IS NULL`. **This is the change most likely to break something quietly** — a policy that forgets the predicate shows deleted rows, and a query that adds it twice costs nothing. The harness gets an assertion per table.

### 4.2 Purge

A function, run by the existing cron, that hard-deletes rows past their grace window:

- Work rows: 90 days after `deleted_at` (`S0` §4).
- Activity ledger: **never within 7 years**. The purge must refuse to touch it.
- Files: deleting the row must also delete the R2 object, or storage bills for data nobody can reach. This closes `HANDOFF` §8.2, where message deletion already orphans both the file row and the object.

The function takes an organization parameter and is predicated on it. `mark_overdue_invoices` taught this lesson in Batch 7 — a sweep function without a tenant predicate rewrote every tenant's rows.

### 4.3 The AD-003 tombstone

Deleting a person never deletes their work. FKs are already `ON DELETE SET NULL` (0016). What is missing is **pseudonymisation of denormalised names**: `actor_name` on ledger rows and `approval_decisions`, author names cached on messages.

A function that, given a user id, replaces those strings with a stable pseudonym ("Former member") while leaving every row and every timestamp intact. Erasure within 30 days (`S0` §4) means the person's identity is gone; the record that a decision happened is not.

---

## 5. Ledger emission moves server-side

`S-F` §8 decision 4. The browser-callable activity endpoint is removed. Ledger rows are written by the server as a side effect of the action they record — an approval decision writes its own ledger row inside the same transaction.

**Why this matters more now:** approvals, signatures and meetings all become ledger-dependent in v1. An endpoint that can be called directly is a surface that has to be defended forever; a side effect cannot be called at all. Batch 6 item 1 authorized and validated it correctly, and this removes the need to keep doing so.

**Consequence:** `lib/logActivity.ts` (browser) is deleted. Any surface that currently logs from the client must have its server action write the row instead. Report any that cannot.

---

## 6. Migration sequence

Additive first, destructive last, each applied and deployed before the next.

| # | Contents | Shape |
|---|---|---|
| 1 | `message_rooms`, room RLS | Additive |
| 2 | `messages`: add `room_id` (nullable), `thread_root_id`, `body_tsv`, `edited_at`, `deleted_at` | Additive |
| 3 | **Backfill rooms and repoint messages.** Verify counts. | Data |
| 4 | `messages.room_id` set NOT NULL; new message RLS; indexes | Constraining |
| 5 | `message_read_state` + backfill from `read_at` | Additive |
| 6 | Supporting tables (reactions, mentions, pins, saves, prefs, attachments) + RLS | Additive |
| 7 | **Backfill `message_attachments` from `"bucket::path"` strings.** Report unresolvable rows; do not guess | Data |
| 8 | Approvals: four tables + RLS | Additive |
| 9 | `files`: `parent_file_id`, `version_no`, `is_current` + partial unique index | Additive |
| 10 | `deleted_at` across §4.1 tables; all SELECT policies updated | Constraining |
| 11 | Purge function, tombstone function | Additive |
| 12 | Drop `messages.read_at` and the attachment string column | **Destructive** |

**Rules that apply throughout,** from `HANDOFF` §10: printed never applied; forward-only and idempotent; `drop policy if exists` before every `create policy`; table-shape changes carry apply-then-deploy for additive and deploy-then-apply-then-reload for destructive. Migration 12 is the only deploy-first entry.

**Migration 3 and 7 are the risk.** Both are data backfills against live rows. Each needs a count before, a count after, and a stated expectation. Neither may run without the preceding structural migration deployed.

---

## 7. Harness additions

`scripts/test-rls.ts` is at 10 assertions, 0 vacuous. This adds eight, each with a positive control, because `S2` §2's lesson stands: zero leaks with a zero control proves nothing.

1. Tenant two cannot read tenant one's rooms. Control: reads its own.
2. A project-scoped client teammate reads untagged messages and their own project's tagged ones. Control: reads a tagged message they should see.
3. The same teammate cannot read a sibling project's tagged message. Control: as 2.
4. `history_from` still holds in the company room. Control: reads a message after the cutoff.
5. A client member cannot read an internal approval (`client_id IS NULL`). Control: reads an approval addressed to them.
6. A non-assignee cannot insert an `approval_decision`. Control: an assignee can.
7. Soft-deleted rows are invisible. Control: the same row visible before deletion.
8. A member cannot read another member's `message_read_state`. Control: reads their own.

---

## 8. What this does not cover

`S3-b` takes calendar and bookings, meetings and sessions, documents and signatures, and seat class plus per-member budgets (`S-F` §9).

Not here, deliberately: the mesh gate, the job queue, proxy render, keyset pagination *implementation* (the index is here, the query is per surface), the I-8 service-role migration.

---

## 9. Open questions

1. **Crew rooms: one per org, or many?** This spec allows many (`name` is present) but `S-F` §2.2 does not decide it. One general room is simpler and matches where the product is; channels are additive later. **Recommendation: build the table for many, ship one.**
2. **Does an expired stage block or auto-advance?** Ziflow's conditional rules can hold a proof back. **Recommendation: block, and notify.** An approval that advanced because nobody looked is worse than one that stalls loudly.
3. **`documents.kind`.** `S-F` §8 decision 1 recommends distinct script types. Not in this document's migrations because it belongs with Script Design, but it is additive and cheap. Flagged so it is not forgotten.

---

*End of S3-core. Next: `S3-b`, then the messaging build.*
